import type { Database } from "bun:sqlite"

// 一次性迁移：把沿用 Django 的旧表（account_user、task_task + 子表、submission_submission……）
// 搬进新表结构。启动时发现旧表且 user_version = 0 就执行，整个过程在一个事务里，出错则原样回滚。
// 生产库迁移完成后这个文件就可以删掉，连同 db.ts 里对它的调用和 tests/migrate.test.ts、tests/django-schema.sql。
//
// 转换：时间 "YYYY-MM-DD HH:MM:SS.ffffff" → ISO "YYYY-MM-DDTHH:MM:SS.mmmZ"（微秒截到毫秒，和以前接口返回的一样）；
// UUID 32 位十六进制 → 带连字符；task_tutorial / task_challenge / task_creation 并进 tasks；
// 提交的代码拆到 submission_code；去掉 Django 才用的列（email、is_staff、is_superuser）

// 小数部分从第 21 个字符开始；没有小数（Django 在微秒为 0 时不写）就补 000。NULL 还是 NULL
const T = (col: string) => `strftime('%Y-%m-%dT%H:%M:%S', ${col}) || '.' || substr(substr(${col}, 21) || '000', 1, 3) || 'Z'`
const U = (col: string) =>
  `lower(substr(${col}, 1, 8) || '-' || substr(${col}, 9, 4) || '-' || substr(${col}, 13, 4) || '-' ||
         substr(${col}, 17, 4) || '-' || substr(${col}, 21))`

const LEGACY_TABLES = [
  "auth_refresh_token",
  "prompt_message",
  "prompt_conversation",
  "submission_reflection",
  "submission_submissionaward",
  "submission_award",
  "submission_rating",
  "submission_submission",
  "task_taskasset",
  "task_tutorial",
  "task_challenge",
  "task_creation",
  "task_task",
  "account_user",
  // Django 自己的表，新代码从来不用
  "account_user_groups",
  "account_user_user_permissions",
  "auth_group_permissions",
  "auth_group",
  "auth_permission",
  "auth_session",
  "django_admin_log",
  "django_content_type",
  "django_migrations",
  "django_session",
]

export function migrateFromDjango(db: Database, schema: string) {
  const exists = (name: string) =>
    !!db.query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $name`).get({ name })
  const count = (table: string) =>
    (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

  console.log("检测到旧的 Django 表结构，开始迁移……")
  const started = Date.now()
  // 外键检查不能在事务里开关；迁移期间关着，最后用 foreign_key_check 整体核对
  db.run("PRAGMA foreign_keys = OFF")
  db.transaction(() => {
    db.run(schema)

    db.run(`INSERT INTO users (id, username, password, raw_password, role, classname, is_active, created, last_login)
      SELECT id, username, password, raw_password, role, classname, is_active, ${T("date_joined")}, ${T("last_login")}
      FROM account_user`)

    db.run(`INSERT INTO tasks (id, task_type, display, title, is_public, score, pass_score, author_id, owner_id,
        created, modified, content, example_html, example_css, example_js, html, css, js)
      SELECT t.id, t.task_type, t.display, t.title, t.is_public, COALESCE(ch.score, 0), ch.pass_score, ch.author_id,
        cr.owner_id, ${T("t.created")}, ${T("t.modified")}, t.content, t.example_html, t.example_css, t.example_js,
        cr.html, cr.css, cr.js
      FROM task_task t
      LEFT JOIN task_challenge ch ON ch.task_ptr_id = t.id
      LEFT JOIN task_creation cr ON cr.task_ptr_id = t.id`)

    db.run(`INSERT INTO task_assets (id, task_id, name, file) SELECT id, task_id, name, file FROM task_taskasset`)

    db.run(`INSERT INTO submissions (id, user_id, task_id, created, modified, score, raw_score, zone, flag, view_count)
      SELECT ${U("id")}, user_id, task_id, ${T("created")}, ${T("modified")}, score, raw_score, zone, flag, view_count
      FROM submission_submission`)
    db.run(`INSERT INTO submission_code (submission_id, html, css, js)
      SELECT ${U("id")}, html, css, js FROM submission_submission`)
    db.run(`INSERT INTO reflections (submission_id, content, modified)
      SELECT ${U("submission_id")}, content, ${T("modified")} FROM submission_reflection`)
    db.run(`INSERT INTO ratings (id, submission_id, user_id, score, created)
      SELECT id, ${U("submission_id")}, user_id, score, ${T("created")} FROM submission_rating`)

    db.run(`INSERT INTO awards (id, name, description, sort_order, is_active, item_ordering, created, modified)
      SELECT id, name, description, sort_order, is_active, item_ordering, ${T("created")}, ${T("modified")}
      FROM submission_award`)
    db.run(`INSERT INTO award_items (id, award_id, submission_id, sort_order, is_stale, awarded_at, created, modified)
      SELECT id, award_id, ${U("submission_id")}, sort_order, is_stale, ${T("awarded_at")}, ${T("created")}, ${T("modified")}
      FROM submission_submissionaward`)

    db.run(`INSERT INTO conversations (id, user_id, task_id, is_active, created, modified)
      SELECT ${U("id")}, user_id, task_id, is_active, ${T("created")}, ${T("modified")} FROM prompt_conversation`)
    db.run(`INSERT INTO messages (id, conversation_id, role, source, prompt_level, submission_id, created,
        content, code_html, code_css, code_js)
      SELECT id, ${U("conversation_id")}, role, source, prompt_level,
        CASE WHEN submission_id IS NULL THEN NULL ELSE ${U("submission_id")} END, ${T("created")},
        content, code_html, code_css, code_js
      FROM prompt_message`)

    if (exists("auth_refresh_token")) {
      db.run(`INSERT INTO refresh_tokens (token_hash, user_id, expire_at)
        SELECT token_hash, user_id, ${T("expire_at")} FROM auth_refresh_token`)
    }

    // 行数对不上说明 SELECT 写错了，宁可启动失败也不丢数据
    const pairs: [string, string][] = [
      ["account_user", "users"],
      ["task_task", "tasks"],
      ["task_taskasset", "task_assets"],
      ["submission_submission", "submissions"],
      ["submission_submission", "submission_code"],
      ["submission_reflection", "reflections"],
      ["submission_rating", "ratings"],
      ["submission_award", "awards"],
      ["submission_submissionaward", "award_items"],
      ["prompt_conversation", "conversations"],
      ["prompt_message", "messages"],
    ]
    for (const [from, to] of pairs) {
      if (count(from) !== count(to)) throw new Error(`迁移 ${from} → ${to} 行数不一致`)
    }

    for (const table of LEGACY_TABLES) db.run(`DROP TABLE IF EXISTS "${table}"`)

    const broken = db.query(`PRAGMA foreign_key_check`).all()
    if (broken.length) {
      throw new Error(`迁移后有 ${broken.length} 处外键对不上，例如 ${JSON.stringify(broken.slice(0, 5))}`)
    }
  })()
  // 删掉的旧表留下大量空闲页，整理一次把文件缩回来
  db.run("VACUUM")
  console.log(`迁移完成，用时 ${Date.now() - started} ms`)
}
