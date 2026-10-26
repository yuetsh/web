import { createHash, pbkdf2 as pbkdf2Cb, randomBytes, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import { sign, verify } from "hono/jwt"
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
  // 改密码后让该用户的 refresh token 全部失效（与 Django 行为一致）
  run(`DELETE FROM auth_refresh_token WHERE user_id = $id`, { id: userId })
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

// access token 是短期 JWT（只带用户 id，每次请求仍查一次用户，封号立即生效）；
// refresh token 是随机串，表 auth_refresh_token 里只存它的 sha256，用来换新的 access token
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

function signAccessToken(userId: number) {
  const exp = Math.floor(Date.now() / 1000) + config.accessTokenSeconds
  return sign({ sub: userId, exp }, config.jwtSecret, "HS256")
}

export async function issueTokens(user: User) {
  const refreshToken = randomBytes(32).toString("base64url")
  const expire = new Date(Date.now() + config.refreshTokenSeconds * 1000)
  run(`DELETE FROM auth_refresh_token WHERE expire_at < $now`, { now: now() })
  run(
    `INSERT INTO auth_refresh_token (token_hash, user_id, expire_at) VALUES ($hash, $user_id, $expire_at)`,
    { hash: hashToken(refreshToken), user_id: user.id, expire_at: toDbTime(expire) },
  )
  run(`UPDATE account_user SET last_login = $now WHERE id = $id`, {
    now: now(),
    id: user.id,
  })
  return { access_token: await signAccessToken(user.id), refresh_token: refreshToken }
}

export async function refreshAccessToken(refreshToken: string) {
  const row = get<{ id: number }>(
    `SELECT u.id FROM auth_refresh_token t JOIN account_user u ON u.id = t.user_id
     WHERE t.token_hash = $hash AND t.expire_at > $now AND u.is_active = 1`,
    { hash: hashToken(refreshToken), now: now() },
  )
  if (!row) throw new HttpError(401, "登录已过期，请重新登录")
  return signAccessToken(row.id)
}

export function revokeRefreshToken(refreshToken: string) {
  run(`DELETE FROM auth_refresh_token WHERE token_hash = $hash`, { hash: hashToken(refreshToken) })
}

export async function userFromAccessToken(token: string | null | undefined): Promise<User | null> {
  if (!token) return null
  let payload
  try {
    payload = await verify(token, config.jwtSecret, "HS256")
  } catch {
    return null
  }
  return get<User>(
    `SELECT id, username, role, classname, is_active FROM account_user
     WHERE id = $id AND is_active = 1`,
    { id: Number(payload.sub) },
  )
}

export const authMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  const header = c.req.header("authorization")
  let user: User | null = null
  if (header?.startsWith("Bearer ")) {
    user = await userFromAccessToken(header.slice("Bearer ".length))
    // 带了 token 却无效（过期、被封号）时返回 401，前端据此去刷新 token，而不是当成未登录
    if (!user) throw new HttpError(401, "登录已过期")
  }
  c.set("user", user)
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

// 未公开的教程只有超管能看，未公开的挑战管理员也能看（和能编辑它们的人一致）
export const canSeeUnpublished = (user: User | null | undefined, kind: "tutorial" | "challenge") =>
  !!user && (kind === "tutorial" ? user.role === Role.SUPER : isStaff(user))
