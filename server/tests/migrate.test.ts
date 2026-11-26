import { afterEach, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDb } from "../src/db"

let dir = ""
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

// 用旧的 Django 表结构造一个库，写几条 Django 格式的数据
async function legacyDb() {
  dir = await mkdtemp(join(tmpdir(), "wp-migrate-"))
  const path = join(dir, "db.sqlite3")
  const old = new Database(path, { strict: true })
  old.run(await readFile(join(import.meta.dir, "django-schema.sql"), "utf8"))
  old.run(`CREATE TABLE django_migrations (id integer PRIMARY KEY, app text, name text, applied datetime)`)
  old.run(`INSERT INTO account_user VALUES
    (1, 'pbkdf2_sha256$1000$salt$hash', '2026-10-01 08:00:00.123456', 1, 'boss', 'b@x.com', 1, 1, '2026-01-01 00:00:00', 'super', NULL, ''),
    (2, 'pbkdf2_sha256$1000$salt$hash', NULL, 0, 'stu', '', 0, 1, '2026-02-03 04:05:06.789000', 'normal', '123456', 'a1')`)
  old.run(`INSERT INTO task_task VALUES
    (10, '2026-03-01 00:00:00.000001', '2026-03-02 00:00:00.5', '教程', '内容', 'tutorial', 1, 1, NULL, '<p>', NULL),
    (11, '2026-03-01 00:00:00.000002', '2026-03-02 00:00:00', '挑战', '要求', 'challenge', 1, 1, 'a{}', '<b>', 'x()'),
    (12, '2026-03-01 00:00:00.000003', '2026-03-02 00:00:00', '我的作品', '', 'creation', 0, 1, NULL, NULL, NULL)`)
  old.run(`INSERT INTO task_tutorial VALUES (10)`)
  old.run(`INSERT INTO task_challenge VALUES (11, 5, 3.5, 1)`)
  old.run(`INSERT INTO task_creation VALUES (12, '<h1>', 'h1{}', '', 2)`)
  old.run(`INSERT INTO task_taskasset VALUES (1, 'a.png', 'tasks/challenge/1/a.png', 11)`)
  const sub = "0123456789abcdef0123456789abcdef"
  old.run(`INSERT INTO submission_submission VALUES
    ('2026-04-01 01:02:03.456789', '2026-04-01 01:02:03.456789', $sub, 4.2, '<p>hi', 'p{}', NULL, 11, 2, 'present', 4.5, 'featured', 7)`, { sub } as any)
  old.run(`INSERT INTO submission_rating VALUES (1, 5, '2026-04-02 00:00:00.000000', $sub, 1)`, { sub } as any)
  old.run(`INSERT INTO submission_award VALUES (1, '2026-04-03 00:00:00', '2026-04-03 00:00:00', '最佳', '', 0, 1, 'manual')`)
  old.run(`INSERT INTO submission_submissionaward VALUES
    (1, '2026-04-03 00:00:00', '2026-04-03 00:00:00', 0, '2026-04-03 00:00:00', 1, $sub, 0)`, { sub } as any)
  old.run(`INSERT INTO submission_reflection VALUES ($sub, '按钮颜色', '2026-04-01 01:02:03.456789')`, { sub } as any)
  const conv = "fedcba9876543210fedcba9876543210"
  old.run(`INSERT INTO prompt_conversation VALUES ('2026-04-01 00:00:00', '2026-04-01 00:00:00', $conv, 1, 11, 2)`, { conv } as any)
  old.run(`INSERT INTO prompt_message VALUES
    (1, 'user', '做个页面', NULL, NULL, NULL, '2026-04-01 00:00:01.000000', $conv, 2, 'conversation', NULL),
    (2, 'assistant', '好的', '<p>hi', 'p{}', NULL, '2026-04-01 00:00:02.000000', $conv, NULL, 'conversation', $sub)`,
    { conv, sub } as any)
  old.run(`INSERT INTO auth_refresh_token VALUES ('h', 2, '2026-12-01 00:00:00.000000')`)
  old.close()
  return path
}

test("旧的 Django 表结构启动时迁移到新表", async () => {
  const path = await legacyDb()
  const quiet = console.log
  console.log = () => {}
  let db: Database
  try {
    db = openDb(path)
  } finally {
    console.log = quiet
  }
  const one = (sql: string) => db.query(sql).get() as any
  const tables = (db.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as any[]).map(
    (r) => r.name,
  )
  expect(tables).toEqual([
    "award_items",
    "awards",
    "conversations",
    "messages",
    "ratings",
    "reflections",
    "refresh_tokens",
    "submission_code",
    "submissions",
    "task_assets",
    "tasks",
    "users",
  ])
  expect(one(`PRAGMA user_version`).user_version).toBe(1)

  expect(one(`SELECT * FROM users WHERE id = 1`)).toMatchObject({
    username: "boss",
    role: "super",
    created: "2026-01-01T00:00:00.000Z",
    last_login: "2026-10-01T08:00:00.123Z",
  })
  expect(one(`SELECT created, last_login FROM users WHERE id = 2`)).toEqual({
    created: "2026-02-03T04:05:06.789Z",
    last_login: null,
  })

  expect(one(`SELECT * FROM tasks WHERE id = 11`)).toMatchObject({
    task_type: "challenge",
    score: 5,
    pass_score: 3.5,
    author_id: 1,
    owner_id: null,
    modified: "2026-03-02T00:00:00.000Z",
    example_html: "<b>",
  })
  expect(one(`SELECT owner_id, html, css FROM tasks WHERE id = 12`)).toEqual({ owner_id: 2, html: "<h1>", css: "h1{}" })
  expect(one(`SELECT modified FROM tasks WHERE id = 10`).modified).toBe("2026-03-02T00:00:00.500Z")

  const sub = "01234567-89ab-cdef-0123-456789abcdef"
  // 微秒截到毫秒
  expect(one(`SELECT * FROM submissions`)).toEqual({
    id: sub,
    user_id: 2,
    task_id: 11,
    created: "2026-04-01T01:02:03.456Z",
    modified: "2026-04-01T01:02:03.456Z",
    score: 4.2,
    raw_score: 4.5,
    zone: "featured",
    flag: "present",
    view_count: 7,
  })
  expect(one(`SELECT * FROM submission_code`)).toEqual({ submission_id: sub, html: "<p>hi", css: "p{}", js: null })
  expect(one(`SELECT submission_id FROM ratings`).submission_id).toBe(sub)
  expect(one(`SELECT submission_id, awarded_at FROM award_items`)).toEqual({
    submission_id: sub,
    awarded_at: "2026-04-03T00:00:00.000Z",
  })
  expect(one(`SELECT content FROM reflections WHERE submission_id = '${sub}'`).content).toBe("按钮颜色")
  expect(one(`SELECT id FROM conversations`).id).toBe("fedcba98-7654-3210-fedc-ba9876543210")
  expect(db.query(`SELECT id, conversation_id, submission_id FROM messages ORDER BY id`).all()).toEqual([
    { id: 1, conversation_id: "fedcba98-7654-3210-fedc-ba9876543210", submission_id: null },
    { id: 2, conversation_id: "fedcba98-7654-3210-fedc-ba9876543210", submission_id: sub },
  ])
  expect(one(`SELECT expire_at FROM refresh_tokens`).expire_at).toBe("2026-12-01T00:00:00.000Z")

  // 自增 id 接着旧数据往后排
  db.run(`INSERT INTO messages (conversation_id, role, created, content) VALUES ('fedcba98-7654-3210-fedc-ba9876543210', 'user', 'x', 'x')`)
  expect(one(`SELECT MAX(id) AS m FROM messages`).m).toBe(3)

  // 级联删除生效：删提交连带代码、评分、作品展、反思、关联的 AI 消息
  db.run(`DELETE FROM submissions WHERE id = '${sub}'`)
  for (const t of ["submission_code", "ratings", "award_items", "reflections"]) {
    expect(one(`SELECT COUNT(*) AS n FROM ${t}`).n).toBe(0)
  }
  expect(one(`SELECT COUNT(*) AS n FROM messages`).n).toBe(2)
  db.close()

  // 再次打开不会重复迁移
  openDb(path).close()
})

test("迁移出错时整体回滚，旧表原样保留", async () => {
  const path = await legacyDb()
  const old = new Database(path, { strict: true })
  // 指向不存在的提交：外键对不上
  old.run(`INSERT INTO submission_rating VALUES (2, 3, '2026-04-02 00:00:00', 'ffffffffffffffffffffffffffffffff', 1)`)
  old.close()
  const quiet = console.log
  console.log = () => {}
  try {
    expect(() => openDb(path)).toThrow(/外键/)
  } finally {
    console.log = quiet
  }
  const db = new Database(path)
  expect((db.query(`SELECT COUNT(*) AS n FROM submission_rating`).get() as any).n).toBe(2)
  expect(db.query(`SELECT 1 FROM sqlite_master WHERE name = 'users'`).get()).toBeNull()
  expect((db.query(`PRAGMA user_version`).get() as any).user_version).toBe(0)
  db.close()
})
