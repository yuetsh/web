import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { config } from "./config"

// 表结构与原 Django 项目保持一致（表名、列名、时间格式、UUID 存储方式），
// 这样旧的 db.sqlite3 可以直接使用，Postgres 的数据也能原样导入。
const SCHEMA = `
CREATE TABLE IF NOT EXISTS "account_user" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "password" varchar(128) NOT NULL, "last_login" datetime NULL, "is_superuser" bool NOT NULL, "username" varchar(150) NOT NULL UNIQUE, "email" varchar(254) NOT NULL, "is_staff" bool NOT NULL, "is_active" bool NOT NULL, "date_joined" datetime NOT NULL, "role" varchar(20) NOT NULL, "raw_password" varchar(20) NULL, "classname" varchar(50) NOT NULL);

CREATE TABLE IF NOT EXISTS "task_task" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "created" datetime NOT NULL, "modified" datetime NOT NULL, "title" varchar(100) NOT NULL, "content" text NOT NULL, "task_type" varchar(20) NOT NULL, "is_public" bool NOT NULL, "display" integer NOT NULL, "example_css" text NULL, "example_html" text NULL, "example_js" text NULL);
CREATE INDEX IF NOT EXISTS "task_task_display_97da6aab" ON "task_task" ("display");
CREATE UNIQUE INDEX IF NOT EXISTS "task_task_display_task_type_f648533c_uniq" ON "task_task" ("display", "task_type");
CREATE TABLE IF NOT EXISTS "task_tutorial" ("task_ptr_id" bigint NOT NULL PRIMARY KEY REFERENCES "task_task" ("id") DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE IF NOT EXISTS "task_challenge" ("task_ptr_id" bigint NOT NULL PRIMARY KEY REFERENCES "task_task" ("id") DEFERRABLE INITIALLY DEFERRED, "score" integer NOT NULL, "pass_score" real NULL, "author_id" bigint NULL REFERENCES "account_user" ("id") DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX IF NOT EXISTS "task_challenge_author_id_d4492927" ON "task_challenge" ("author_id");
CREATE TABLE IF NOT EXISTS "task_creation" ("task_ptr_id" bigint NOT NULL PRIMARY KEY REFERENCES "task_task" ("id") DEFERRABLE INITIALLY DEFERRED, "html" text NOT NULL, "css" text NOT NULL, "js" text NOT NULL, "owner_id" bigint NOT NULL REFERENCES "account_user" ("id") DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX IF NOT EXISTS "task_creation_owner_id_6ae3c55d" ON "task_creation" ("owner_id");
CREATE TABLE IF NOT EXISTS "task_taskasset" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "name" varchar(100) NOT NULL, "file" varchar(100) NOT NULL, "task_id" bigint NOT NULL REFERENCES "task_task" ("id") DEFERRABLE INITIALLY DEFERRED);
CREATE UNIQUE INDEX IF NOT EXISTS "task_taskasset_task_id_name_dc8ea9a8_uniq" ON "task_taskasset" ("task_id", "name");
CREATE INDEX IF NOT EXISTS "task_taskasset_task_id_0921deb6" ON "task_taskasset" ("task_id");

CREATE TABLE IF NOT EXISTS "submission_submission" ("created" datetime NOT NULL, "modified" datetime NOT NULL, "id" char(32) NOT NULL PRIMARY KEY, "score" real NOT NULL, "html" text NULL, "css" text NULL, "js" text NULL, "task_id" bigint NOT NULL REFERENCES "task_task" ("id") DEFERRABLE INITIALLY DEFERRED, "user_id" bigint NOT NULL REFERENCES "account_user" ("id") DEFERRABLE INITIALLY DEFERRED, "flag" varchar(10) NULL, "raw_score" real NOT NULL, "zone" varchar(10) NULL, "view_count" integer unsigned NOT NULL CHECK ("view_count" >= 0));
CREATE INDEX IF NOT EXISTS "submission_submission_task_id_91e9556b" ON "submission_submission" ("task_id");
CREATE INDEX IF NOT EXISTS "submission_submission_user_id_71741691" ON "submission_submission" ("user_id");
CREATE INDEX IF NOT EXISTS "submission_submission_flag_d96bc4aa" ON "submission_submission" ("flag");
CREATE INDEX IF NOT EXISTS "submission_submission_zone_a1bbf0a2" ON "submission_submission" ("zone");
CREATE TABLE IF NOT EXISTS "submission_rating" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "score" integer NOT NULL, "created" datetime NOT NULL, "submission_id" char(32) NOT NULL REFERENCES "submission_submission" ("id") DEFERRABLE INITIALLY DEFERRED, "user_id" bigint NOT NULL REFERENCES "account_user" ("id") DEFERRABLE INITIALLY DEFERRED);
CREATE UNIQUE INDEX IF NOT EXISTS "submission_rating_user_id_submission_id_29be4c39_uniq" ON "submission_rating" ("user_id", "submission_id");
CREATE INDEX IF NOT EXISTS "submission_rating_submission_id_a20dcece" ON "submission_rating" ("submission_id");
CREATE INDEX IF NOT EXISTS "submission_rating_user_id_cfd08017" ON "submission_rating" ("user_id");
CREATE TABLE IF NOT EXISTS "submission_award" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "created" datetime NOT NULL, "modified" datetime NOT NULL, "name" varchar(100) NOT NULL UNIQUE, "description" text NOT NULL, "sort_order" integer NOT NULL, "is_active" bool NOT NULL, "item_ordering" varchar(20) NOT NULL);
CREATE INDEX IF NOT EXISTS "submission_award_sort_order_280640ce" ON "submission_award" ("sort_order");
CREATE TABLE IF NOT EXISTS "submission_submissionaward" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "created" datetime NOT NULL, "modified" datetime NOT NULL, "sort_order" integer NOT NULL, "awarded_at" datetime NOT NULL, "award_id" bigint NOT NULL REFERENCES "submission_award" ("id") DEFERRABLE INITIALLY DEFERRED, "submission_id" char(32) NOT NULL REFERENCES "submission_submission" ("id") DEFERRABLE INITIALLY DEFERRED, "is_stale" bool NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "submission_submissionaward_submission_id_award_id_6fab326b_uniq" ON "submission_submissionaward" ("submission_id", "award_id");
CREATE INDEX IF NOT EXISTS "submission_submissionaward_sort_order_7d90e1d6" ON "submission_submissionaward" ("sort_order");
CREATE INDEX IF NOT EXISTS "submission_submissionaward_awarded_at_8093b2c7" ON "submission_submissionaward" ("awarded_at");
CREATE INDEX IF NOT EXISTS "submission_submissionaward_award_id_b229157e" ON "submission_submissionaward" ("award_id");
CREATE INDEX IF NOT EXISTS "submission_submissionaward_submission_id_209aabba" ON "submission_submissionaward" ("submission_id");

CREATE TABLE IF NOT EXISTS "prompt_conversation" ("created" datetime NOT NULL, "modified" datetime NOT NULL, "id" char(32) NOT NULL PRIMARY KEY, "is_active" bool NOT NULL, "task_id" bigint NOT NULL REFERENCES "task_task" ("id") DEFERRABLE INITIALLY DEFERRED, "user_id" bigint NOT NULL REFERENCES "account_user" ("id") DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX IF NOT EXISTS "prompt_conversation_task_id_90287800" ON "prompt_conversation" ("task_id");
CREATE INDEX IF NOT EXISTS "prompt_conversation_user_id_ecc418b3" ON "prompt_conversation" ("user_id");
CREATE TABLE IF NOT EXISTS "prompt_message" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "role" varchar(10) NOT NULL, "content" text NOT NULL, "code_html" text NULL, "code_css" text NULL, "code_js" text NULL, "created" datetime NOT NULL, "conversation_id" char(32) NOT NULL REFERENCES "prompt_conversation" ("id") DEFERRABLE INITIALLY DEFERRED, "prompt_level" integer NULL, "source" varchar(12) NOT NULL, "submission_id" char(32) NULL UNIQUE REFERENCES "submission_submission" ("id") DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX IF NOT EXISTS "prompt_message_conversation_id_af18dd4b" ON "prompt_message" ("conversation_id");
CREATE INDEX IF NOT EXISTS "prompt_message_prompt_level_e461b596" ON "prompt_message" ("prompt_level");

CREATE TABLE IF NOT EXISTS "auth_session" ("key" text NOT NULL PRIMARY KEY, "user_id" bigint NOT NULL REFERENCES "account_user" ("id") ON DELETE CASCADE, "expire_at" datetime NOT NULL);
CREATE INDEX IF NOT EXISTS "auth_session_user_id" ON "auth_session" ("user_id");
`

export function openDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path, { strict: true, create: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA foreign_keys = ON")
  db.run(SCHEMA)
  return db
}

export let db = openDb(process.env.NODE_ENV === "test" ? ":memory:" : config.dbPath)

// 仅供测试使用：换一个全新的内存库
export function resetDb() {
  db.close()
  db = openDb(":memory:")
}

type Params = Record<string, unknown>

export function all<T = any>(sql: string, params: Params = {}): T[] {
  return db.query(sql).all(params as any) as T[]
}

export function get<T = any>(sql: string, params: Params = {}): T | null {
  return (db.query(sql).get(params as any) as T) ?? null
}

export function run(sql: string, params: Params = {}) {
  return db.query(sql).run(params as any)
}

export function tx<T>(fn: () => T): T {
  return db.transaction(fn)()
}

// ── 时间：与 Django 在 SQLite 中的存储格式一致（UTC, "YYYY-MM-DD HH:MM:SS.ffffff"）──

let lastMicros = 0

// 严格递增的时间戳，避免同一毫秒内连续插入的消息排序不稳定
export function now(): string {
  let micros = Date.now() * 1000
  if (micros <= lastMicros) micros = lastMicros + 1
  lastMicros = micros
  return formatMicros(micros)
}

export function formatMicros(micros: number): string {
  const d = new Date(Math.floor(micros / 1000))
  const frac = String(micros % 1_000_000).padStart(6, "0")
  return d.toISOString().slice(0, 19).replace("T", " ") + "." + frac
}

export function toDbTime(d: Date): string {
  return formatMicros(d.getTime() * 1000)
}

// 数据库时间 → ISO 8601，格式与 Django 的 JSON 输出一致（毫秒精度，UTC 用 Z）
export function iso(value: string): string
export function iso(value: string | null): string | null
export function iso(value: string | null): string | null {
  if (!value) return null
  return value.replace(" ", "T").slice(0, 23) + "Z"
}

// ── UUID：SQLite 中按 Django 的方式存成 32 位无连字符的十六进制 ──

const UUID_RE =
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i

export function uuidHex(value: string): string | null {
  if (!UUID_RE.test(value)) return null
  return value.replaceAll("-", "").toLowerCase()
}

export function uuidOut(hex: string): string
export function uuidOut(hex: string | null): string | null
export function uuidOut(hex: string | null): string | null {
  if (!hex) return null
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function newUuidHex(): string {
  return crypto.randomUUID().replaceAll("-", "")
}

export function likeEscape(s: string): string {
  return "%" + s.replace(/[\\%_]/g, (m) => "\\" + m) + "%"
}
