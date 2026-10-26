/**
 * 把旧 Django 项目的 Postgres 数据导入 SQLite（一次性迁移）。
 *
 *   POSTGRES_HOST=... POSTGRES_DB=... POSTGRES_USER=... POSTGRES_PASSWORD=... \
 *     bun scripts/migrate-from-postgres.ts [--force]
 *
 * 目标库为 DB_PATH（默认 data/db.sqlite3）。目标库已有数据时需要 --force（会先清空）。
 * 会话不迁移，所有人需要重新登录一次。
 */
import { SQL } from "bun"
import { config } from "../src/config"
import { db } from "../src/db"

// 按外键依赖顺序
const TABLES = [
  "account_user",
  "task_task",
  "task_tutorial",
  "task_challenge",
  "task_creation",
  "task_taskasset",
  "submission_submission",
  "submission_rating",
  "submission_award",
  "submission_submissionaward",
  "prompt_conversation",
  "prompt_message",
]

const force = process.argv.includes("--force")
const env = process.env
for (const key of ["POSTGRES_HOST", "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"]) {
  if (!env[key]) {
    console.error(`缺少环境变量 ${key}`)
    process.exit(1)
  }
}

const pg = new SQL({
  hostname: env.POSTGRES_HOST,
  port: Number(env.POSTGRES_PORT ?? 5432),
  database: env.POSTGRES_DB,
  username: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD,
})

const existing = db.query(`SELECT COUNT(*) AS n FROM account_user`).get() as { n: number }
if (existing.n > 0 && !force) {
  console.error(`目标库 ${config.dbPath} 已有数据，加 --force 会清空后重新导入`)
  process.exit(1)
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

// 按 Postgres 的列类型转换成 Django 在 SQLite 中的存储格式
function selectExpr(column: string, pgType: string) {
  const c = quote(column)
  switch (pgType) {
    case "timestamp with time zone":
      return `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS ${c}`
    case "timestamp without time zone":
      return `to_char(${c}, 'YYYY-MM-DD HH24:MI:SS.US') AS ${c}`
    case "uuid":
      return `replace(${c}::text, '-', '') AS ${c}`
    case "boolean":
      return `${c}::int AS ${c}`
    case "bigint":
      return `${c}::text AS ${c}`
    default:
      return c
  }
}

const counts: Record<string, number> = {}
const rowsByTable: Record<string, Record<string, unknown>[]> = {}

for (const table of TABLES) {
  const sqliteColumns = (db.query(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[]).map(
    (c) => c.name,
  )
  const pgColumns = await pg`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}`
  if (!pgColumns.length) throw new Error(`Postgres 中没有表 ${table}`)
  const pgTypes = new Map<string, string>(pgColumns.map((c: any) => [c.column_name, c.data_type]))
  const missing = sqliteColumns.filter((c) => !pgTypes.has(c))
  if (missing.length) throw new Error(`Postgres 表 ${table} 缺少列：${missing.join(", ")}`)

  const select = sqliteColumns.map((c) => selectExpr(c, pgTypes.get(c)!)).join(", ")
  const rows: Record<string, unknown>[] = await pg.unsafe(`SELECT ${select} FROM ${quote(table)}`)
  for (const row of rows) {
    for (const c of sqliteColumns) {
      if (pgTypes.get(c) === "bigint" && row[c] !== null) row[c] = Number(row[c])
    }
  }
  rowsByTable[table] = rows
  console.log(`读取 ${table}: ${rows.length} 行`)
}
await pg.close()

db.transaction(() => {
  db.run("PRAGMA defer_foreign_keys = ON")
  for (const table of [...TABLES].reverse()) db.run(`DELETE FROM ${quote(table)}`)
  db.run(`DELETE FROM auth_session`)
  for (const table of TABLES) {
    const rows = rowsByTable[table]!
    if (!rows.length) {
      counts[table] = 0
      continue
    }
    const columns = Object.keys(rows[0]!)
    const insert = db.prepare(
      `INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")})
       VALUES (${columns.map((c) => "$" + c).join(", ")})`,
    )
    for (const row of rows) insert.run(row as any)
    counts[table] = rows.length
  }
})()

// 校验
let ok = true
for (const table of TABLES) {
  const n = (db.query(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get() as { n: number }).n
  if (n !== counts[table]) ok = false
  console.log(`${n === counts[table] ? "✓" : "✗"} ${table}: ${n}`)
}
const fk = db.query(`PRAGMA foreign_key_check`).all()
if (fk.length) {
  ok = false
  console.error("外键检查失败：", fk.slice(0, 10))
}
console.log(ok ? `\n导入完成：${config.dbPath}` : "\n导入有问题，请检查上面的输出")
process.exit(ok ? 0 : 1)
