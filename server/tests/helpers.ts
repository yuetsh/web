import { app } from "../src/app"
import { makePassword } from "../src/auth"
import { newId, now, resetDb, run } from "../src/db"

export const PASSWORD = "pw123456"
// 哈希很慢，所有测试用户共用一个
const HASH = await makePassword(PASSWORD)

export function freshDb() {
  resetDb()
}

export function makeUser(username: string, role = "normal", classname = "") {
  const res = run(
    `INSERT INTO users (username, password, raw_password, role, classname, created)
     VALUES ($username, $hash, $raw, $role, $classname, $now)`,
    { hash: HASH, username, now: now(), role, raw: PASSWORD, classname },
  )
  return Number(res.lastInsertRowid)
}

export function makeTask(title: string, taskType = "challenge", display = 1, isPublic = true) {
  const ts = now()
  const res = run(
    `INSERT INTO tasks (task_type, display, title, is_public, created, modified)
     VALUES ($type, $display, $title, $public, $ts, $ts)`,
    { ts, display, title, type: taskType, public: isPublic },
  )
  return Number(res.lastInsertRowid)
}

export function makeSubmission(userId: number, taskId: number, score = 0, created?: string) {
  const id = newId()
  const ts = created ?? now()
  run(
    `INSERT INTO submissions (id, user_id, task_id, created, modified, score) VALUES ($id, $user_id, $task_id, $ts, $ts, $score)`,
    { id, ts, score, task_id: taskId, user_id: userId },
  )
  run(`INSERT INTO submission_code (submission_id, html, css, js) VALUES ($id, '', '', '')`, { id })
  return id
}

/** 登录后返回一个带 access token 的请求函数，tokens 是登录拿到的 token */
export async function client(username?: string) {
  const tokens = { access_token: "", refresh_token: "" }
  if (username) {
    const res = await app.request("/api/account/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: PASSWORD }),
    })
    if (res.status !== 200) throw new Error(`login failed: ${res.status}`)
    Object.assign(tokens, await res.json())
  }
  const request = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = {}
    if (tokens.access_token) headers.authorization = `Bearer ${tokens.access_token}`
    if (body !== undefined) headers["content-type"] = "application/json"
    const res = await app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let json: any = text
    try {
      json = JSON.parse(text)
    } catch {}
    return { status: res.status, json, text, headers: res.headers }
  }
  return Object.assign(request, { tokens })
}
