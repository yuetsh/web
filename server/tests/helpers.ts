import { app } from "../src/app"
import { makePassword } from "../src/auth"
import { newUuidHex, now, resetDb, run, uuidOut } from "../src/db"

export const PASSWORD = "pw123456"
// 哈希很慢，所有测试用户共用一个
const HASH = await makePassword(PASSWORD)

export function freshDb() {
  resetDb()
}

export function makeUser(username: string, role = "normal", classname = "") {
  const res = run(
    `INSERT INTO account_user (password, last_login, is_superuser, username, email, is_staff, is_active, date_joined, role, raw_password, classname)
     VALUES ($hash, NULL, 0, $username, '', 0, 1, $now, $role, $raw, $classname)`,
    { hash: HASH, username, now: now(), role, raw: PASSWORD, classname },
  )
  return Number(res.lastInsertRowid)
}

export function makeTask(title: string, taskType = "challenge", display = 1, isPublic = true) {
  const ts = now()
  const res = run(
    `INSERT INTO task_task (created, modified, display, title, content, task_type, is_public, example_html, example_css, example_js)
     VALUES ($ts, $ts, $display, $title, '', $type, $public, NULL, NULL, NULL)`,
    { ts, display, title, type: taskType, public: isPublic },
  )
  const id = Number(res.lastInsertRowid)
  if (taskType === "challenge") {
    run(`INSERT INTO task_challenge (task_ptr_id, score, pass_score, author_id) VALUES ($id, 0, NULL, NULL)`, { id })
  } else if (taskType === "tutorial") {
    run(`INSERT INTO task_tutorial (task_ptr_id) VALUES ($id)`, { id })
  }
  return id
}

export function makeSubmission(userId: number, taskId: number, score = 0, created?: string) {
  const id = newUuidHex()
  const ts = created ?? now()
  run(
    `INSERT INTO submission_submission (id, created, modified, score, html, css, js, task_id, user_id, flag, raw_score, zone, view_count)
     VALUES ($id, $ts, $ts, $score, '', '', '', $task_id, $user_id, NULL, 0, NULL, 0)`,
    { id, ts, score, task_id: taskId, user_id: userId },
  )
  return id
}

export const uuid = (hex: string) => uuidOut(hex)

/** 登录后返回一个带 cookie 的请求函数 */
export async function client(username?: string) {
  let cookie = ""
  if (username) {
    const res = await app.request("/api/account/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: PASSWORD }),
    })
    if (res.status !== 200) throw new Error(`login failed: ${res.status}`)
    cookie = res.headers.get("set-cookie")!.split(";")[0]!
  }
  return async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { cookie }
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
}
