import { Hono } from "hono"
import { randomInt } from "node:crypto"
import { z } from "zod"
import { all, get, run, tx, now, iso, likeEscape } from "../db"
import {
  Role,
  authenticate,
  issueTokens,
  makePassword,
  refreshAccessToken,
  revokeRefreshToken,
  requireSuper,
  requireUser,
  setPassword,
} from "../auth"
import { HttpError, body, bool, intParam, orNotFound, pageQuery, pageWindow, query, type Env } from "../http"

const router = new Hono<Env>()

const roleEnum = z.enum([Role.SUPER, Role.ADMIN, Role.NORMAL])

// 只用 2-9 的数字，避免和字母 O/l 混淆
function generatePassword(length = 6) {
  return Array.from({ length }, () => String(randomInt(2, 10))).join("")
}

async function insertUser(u: {
  username: string
  password: string
  role?: string
  classname?: string
  email?: string
}) {
  // 先算哈希（异步），再同步地查重 + 插入：中间没有 await，并发注册同名不会撞唯一约束变成 500
  const password = await makePassword(u.password)
  if (userExists(u.username)) throw new HttpError(400, "用户已存在")
  const res = run(
    `INSERT INTO account_user
       (password, last_login, is_superuser, username, email, is_staff, is_active, date_joined, role, raw_password, classname)
     VALUES ($password, NULL, 0, $username, $email, 0, 1, $now, $role, $raw, $classname)`,
    {
      password,
      username: u.username,
      email: u.email ?? "",
      now: now(),
      role: u.role ?? Role.NORMAL,
      raw: u.password.slice(0, 20),
      classname: u.classname ?? "",
    },
  )
  return Number(res.lastInsertRowid)
}

const userExists = (username: string) =>
  !!get(`SELECT 1 FROM account_user WHERE username = $username`, { username })

router.post("/register", async (c) => {
  const payload = await body(
    c,
    z.object({
      username: z.string(),
      email: z.email(),
      password: z.string().min(6).max(20),
    }),
  )
  await insertUser(payload)
  return c.json({ message: "创建成功" })
})

router.post("/login", async (c) => {
  const payload = await body(c, z.object({ username: z.string(), password: z.string() }))
  const user = await authenticate(payload.username, payload.password)
  if (!user) throw new HttpError(401, "账号密码错误")
  return c.json({ username: user.username, role: user.role, ...(await issueTokens(user)) })
})

router.post("/refresh", async (c) => {
  const payload = await body(c, z.object({ refresh_token: z.string() }))
  return c.json({ access_token: await refreshAccessToken(payload.refresh_token) })
})

// access token 是无状态的，退出只需作废 refresh token；不要求登录，过期了也能退出
router.post("/logout", async (c) => {
  const payload = await body(c, z.object({ refresh_token: z.string().optional() }))
  if (payload.refresh_token) revokeRefreshToken(payload.refresh_token)
  return c.json({ message: "退出成功" })
})

router.get("/profile", (c) => {
  const user = c.get("user")
  if (user) return c.json({ username: user.username, role: user.role })
  return c.json({ username: "", role: Role.NORMAL })
})

router.get("/list", (c) => {
  requireSuper(c)
  const q = query(
    c,
    pageQuery.extend({
      username: z.string().default(""),
      role: z.string().optional(),
    }),
  )
  const where = [`username LIKE $username ESCAPE '\\'`]
  const params: Record<string, unknown> = { username: likeEscape(q.username) }
  if (q.role) {
    where.push(`role = $role`)
    params.role = q.role
  }
  const whereSql = where.join(" AND ")
  const { limit, offset } = pageWindow(q)
  const rows = all(
    `SELECT id, username, raw_password, role, classname, date_joined, last_login, is_active
     FROM account_user WHERE ${whereSql} ORDER BY id DESC LIMIT $limit OFFSET $offset`,
    { ...params, limit, offset },
  )
  const count = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM account_user WHERE ${whereSql}`,
    params,
  )!.n
  return c.json({
    items: rows.map((u) => ({
      id: u.id,
      username: u.username,
      raw_password: u.role !== Role.SUPER ? u.raw_password : "",
      role: u.role,
      classname: u.classname,
      date_joined: iso(u.date_joined),
      last_login: iso(u.last_login),
      is_active: bool(u.is_active),
    })),
    count,
  })
})

router.post("/batch", async (c) => {
  requireSuper(c)
  const payload = await body(
    c,
    z.object({ names: z.array(z.string()), classname: z.string() }),
  )
  const names = payload.names.map((n) => n.trim()).filter(Boolean)
  const usernames = names.map((n) => "web" + payload.classname + n)
  if (new Set(usernames).size !== usernames.length) {
    throw new HttpError(400, "名单中有重复的名字，创建失败")
  }
  if (usernames.some(userExists)) {
    throw new HttpError(400, "有些用户已经存在，创建失败")
  }

  const users = await Promise.all(
    usernames.map(async (username) => {
      const raw = generatePassword()
      return { username, raw, password: await makePassword(raw) }
    }),
  )
  const ts = now()
  tx(() => {
    // 算哈希期间可能有人建了同名用户，插入前在同一个同步事务里再查一次
    if (usernames.some(userExists)) throw new HttpError(400, "有些用户已经存在，创建失败")
    for (const u of users) {
      run(
        `INSERT INTO account_user
           (password, last_login, is_superuser, username, email, is_staff, is_active, date_joined, role, raw_password, classname)
         VALUES ($password, NULL, 0, $username, '', 0, 1, $now, 'normal', $raw, $classname)`,
        { password: u.password, username: u.username, now: ts, raw: u.raw, classname: payload.classname },
      )
    }
  })
  return c.json({ message: "批量创建成功" })
})

// 新建单个用户（替代原来 Django Admin 的新增页面）
router.post("/create", async (c) => {
  requireSuper(c)
  const payload = await body(
    c,
    z.object({
      username: z.string().trim().min(1, "用户名不能为空").max(150),
      password: z.string().min(6, "密码至少 6 位").max(20, "密码最多 20 位"),
      role: roleEnum.default(Role.NORMAL),
      classname: z.string().trim().max(50).default(""),
    }),
  )
  const id = await insertUser(payload)
  return c.json({ id, message: "创建成功" })
})

// 修改用户（替代原来 Django Admin 的修改页面）
router.put("/:id{[0-9]+}", async (c) => {
  requireSuper(c)
  const id = intParam(c, "id")
  const payload = await body(
    c,
    z.object({
      username: z.string().trim().min(1, "用户名不能为空").max(150).optional(),
      password: z.string().max(20, "密码最多 20 位").optional(),
      role: roleEnum.optional(),
      classname: z.string().trim().max(50).optional(),
    }),
  )
  const user = orNotFound(
    get<{ id: number; username: string; role: string }>(
      `SELECT id, username, role FROM account_user WHERE id = $id`,
      { id },
    ),
    "查无此人",
  )
  if (user.role === Role.SUPER) throw new HttpError(400, "不能在这里修改超级管理员")
  if (payload.password && payload.password.length < 6) {
    throw new HttpError(400, "密码至少 6 位")
  }
  if (payload.username && payload.username !== user.username && userExists(payload.username)) {
    throw new HttpError(400, "用户名已存在")
  }
  run(
    `UPDATE account_user SET
       username = COALESCE($username, username),
       role = COALESCE($role, role),
       classname = COALESCE($classname, classname)
     WHERE id = $id`,
    {
      id,
      username: payload.username ?? null,
      role: payload.role ?? null,
      classname: payload.classname ?? null,
    },
  )
  if (payload.password) await setPassword(id, payload.password)
  return c.json({ message: "修改成功" })
})

router.get("/:id{[0-9]+}", (c) => {
  requireSuper(c)
  const u = orNotFound(
    get<{ is_active: number }>(
      `SELECT id, username, role, classname, is_active FROM account_user WHERE id = $id`,
      { id: intParam(c, "id") },
    ),
    "查无此人",
  )
  return c.json({ ...u, is_active: bool(u.is_active) })
})

router.put("/active/:id", (c) => {
  requireSuper(c)
  const id = intParam(c, "id")
  const user = orNotFound(
    get<{ username: string; is_active: number }>(
      `SELECT username, is_active FROM account_user WHERE id = $id`,
      { id },
    ),
    "查无此人",
  )
  const active = !user.is_active
  run(`UPDATE account_user SET is_active = $active WHERE id = $id`, { active, id })
  if (!active) run(`DELETE FROM auth_refresh_token WHERE user_id = $id`, { id })
  return c.json({ message: `${user.username} ${active ? "解封" : "封号"}成功` })
})

router.get("/classes", (c) => {
  const rows = all<{ classname: string }>(
    `SELECT DISTINCT classname FROM account_user WHERE classname > '' ORDER BY classname`,
  )
  return c.json(rows.map((r) => r.classname))
})

router.get("/names", (c) => {
  const { classname } = query(c, z.object({ classname: z.string() }))
  const prefix = "web" + classname
  const rows = all<{ username: string }>(
    `SELECT username FROM account_user
     WHERE classname = $classname AND substr(username, 1, $len) = $prefix
     ORDER BY username`,
    { classname, prefix, len: prefix.length },
  )
  return c.json(rows.map((u) => ({ name: u.username.slice(prefix.length), username: u.username })))
})

export default router
