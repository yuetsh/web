import { pbkdf2 as pbkdf2Cb, randomBytes, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"
import type { MiddlewareHandler } from "hono"
import { config } from "./config"
import { get, run, now, toDbTime } from "./db"
import { HttpError, type Ctx, type Env } from "./http"

const pbkdf2 = promisify(pbkdf2Cb)

export const Role = {
  SUPER: "super",
  ADMIN: "admin",
  NORMAL: "normal",
} as const
export type Role = (typeof Role)[keyof typeof Role]

export interface User {
  id: number
  username: string
  role: Role
  classname: string
  is_active: number
}

// ── 密码：兼容 Django 的 pbkdf2_sha256 格式，老用户无需重置密码 ──

const ITERATIONS = 600_000

export async function makePassword(raw: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url").slice(0, 22)
  const hash = await pbkdf2(raw, salt, ITERATIONS, 32, "sha256")
  return `pbkdf2_sha256$${ITERATIONS}$${salt}$${hash.toString("base64")}`
}

export async function checkPassword(raw: string, encoded: string) {
  const [algorithm, iterations, salt, hash] = encoded.split("$")
  if (algorithm !== "pbkdf2_sha256" || !iterations || !salt || !hash) {
    return false
  }
  const expected = Buffer.from(hash, "base64")
  const actual = await pbkdf2(
    raw,
    salt,
    Number(iterations),
    expected.length,
    "sha256",
  )
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function setPassword(userId: number, raw: string) {
  run(
    `UPDATE account_user SET password = $password, raw_password = $raw WHERE id = $id`,
    { password: await makePassword(raw), raw: raw.slice(0, 20), id: userId },
  )
  // 改密码后让该用户的其它会话失效（与 Django 行为一致）
  run(`DELETE FROM auth_session WHERE user_id = $id`, { id: userId })
}

// ── 会话 ──

export async function authenticate(username: string, password: string) {
  const row = get<User & { password: string }>(
    `SELECT id, username, role, classname, is_active, password
     FROM account_user WHERE username = $username`,
    { username },
  )
  if (!row || !row.is_active) {
    // 防止通过响应时间判断用户是否存在
    await makePassword(password)
    return null
  }
  if (!(await checkPassword(password, row.password))) return null
  const { password: _, ...user } = row
  return user as User
}

export function login(c: Ctx, user: User) {
  const key = randomBytes(24).toString("base64url")
  const expire = new Date(Date.now() + config.sessionAgeSeconds * 1000)
  run(`DELETE FROM auth_session WHERE expire_at < $now`, { now: now() })
  run(
    `INSERT INTO auth_session (key, user_id, expire_at) VALUES ($key, $user_id, $expire_at)`,
    { key, user_id: user.id, expire_at: toDbTime(expire) },
  )
  run(`UPDATE account_user SET last_login = $now WHERE id = $id`, {
    now: now(),
    id: user.id,
  })
  setCookie(c, config.sessionCookie, key, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: config.sessionAgeSeconds,
  })
}

export function logout(c: Ctx) {
  const key = getCookie(c, config.sessionCookie)
  if (key) run(`DELETE FROM auth_session WHERE key = $key`, { key })
  deleteCookie(c, config.sessionCookie, { path: "/" })
}

export function userFromSessionKey(key: string | undefined): User | null {
  if (!key) return null
  return get<User>(
    `SELECT u.id, u.username, u.role, u.classname, u.is_active
     FROM auth_session s JOIN account_user u ON u.id = s.user_id
     WHERE s.key = $key AND s.expire_at > $now AND u.is_active = 1`,
    { key, now: now() },
  )
}

export function parseCookie(header: string | null, name: string) {
  if (!header) return undefined
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k === name) return decodeURIComponent(v.join("="))
  }
  return undefined
}

export const sessionMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  c.set("user", userFromSessionKey(getCookie(c, config.sessionCookie)))
  await next()
}

// ── 权限 ──

export function requireUser(c: Ctx): User {
  const user = c.get("user")
  if (!user) throw new HttpError(401, "请先登录")
  return user
}

function requireRoles(c: Ctx, roles: Role[]): User {
  const user = requireUser(c)
  if (!roles.includes(user.role)) throw new HttpError(403, "没有权限")
  return user
}

export const requireAdmin = (c: Ctx) =>
  requireRoles(c, [Role.ADMIN, Role.SUPER])
export const requireSuper = (c: Ctx) => requireRoles(c, [Role.SUPER])

export const isStaff = (user: User) =>
  user.role === Role.ADMIN || user.role === Role.SUPER
