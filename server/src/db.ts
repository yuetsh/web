import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { config } from "./config"

// 约定：时间是 UTC 的 ISO 字符串（toISOString，毫秒精度，按字符串比较即按时间比较），只用 now() 写；
// 布尔是 0/1；提交和对话的 id 是标准 UUID 字符串。
// 外键都带 ON DELETE CASCADE，删任务 / 提交只需删那一行（要求 PRAGMA foreign_keys = ON）。
// 子表的外键列都要有索引，否则级联删除会扫整张子表
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  -- 老师要能把密码告诉忘了密码的学生
  raw_password TEXT,
  role TEXT NOT NULL DEFAULT 'normal',
  classname TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created TEXT NOT NULL,
  last_login TEXT
);

-- 教程、挑战、自由创作共用一张表，按 task_type 区分；display 是各类型内的序号，用作网址
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_type TEXT NOT NULL,
  display INTEGER NOT NULL,
  title TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  -- 挑战
  score INTEGER NOT NULL DEFAULT 0,
  pass_score REAL,
  author_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  -- 自由创作
  owner_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
  created TEXT NOT NULL,
  modified TEXT NOT NULL,
  -- 大字段放最后：只读前面小列的查询不用读它们的溢出页
  content TEXT NOT NULL DEFAULT '',
  example_html TEXT,
  example_css TEXT,
  example_js TEXT,
  -- 自由创作的代码
  html TEXT,
  css TEXT,
  js TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_type_display ON tasks (task_type, display);
CREATE INDEX IF NOT EXISTS tasks_owner ON tasks (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_author ON tasks (author_id) WHERE author_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file TEXT NOT NULL,
  UNIQUE (task_id, name)
);

-- 提交只放小列，代码在 submission_code：列表、打分、统计扫这张表时不用读代码
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  created TEXT NOT NULL,
  modified TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  raw_score REAL NOT NULL DEFAULT 0,
  -- pending（评分不到 5 个）/ featured / low / NULL
  zone TEXT,
  -- 只用 present：老师课上要展示的
  flag TEXT,
  view_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS submissions_user_task ON submissions (user_id, task_id, created);
CREATE INDEX IF NOT EXISTS submissions_task_user ON submissions (task_id, user_id, created);
-- 老师课上要展示的提交，只有几百条
CREATE INDEX IF NOT EXISTS submissions_flag ON submissions (flag) WHERE flag IS NOT NULL;
CREATE TABLE IF NOT EXISTS submission_code (
  submission_id TEXT PRIMARY KEY REFERENCES submissions (id) ON DELETE CASCADE,
  html TEXT,
  css TEXT,
  js TEXT
);
-- 学生交作品时写的一句反思（最满意的改动和理由）；可以不写
CREATE TABLE IF NOT EXISTS reflections (
  submission_id TEXT PRIMARY KEY REFERENCES submissions (id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  modified TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  created TEXT NOT NULL,
  UNIQUE (user_id, submission_id)
);
CREATE INDEX IF NOT EXISTS ratings_submission ON ratings (submission_id);

-- 作品展：奖项和获奖作品
CREATE TABLE IF NOT EXISTS awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  -- manual / awarded_at / score / view_count
  item_ordering TEXT NOT NULL DEFAULT 'manual',
  created TEXT NOT NULL,
  modified TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS award_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  award_id INTEGER NOT NULL REFERENCES awards (id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- 作者后来又交了新版本
  is_stale INTEGER NOT NULL DEFAULT 0,
  awarded_at TEXT NOT NULL,
  created TEXT NOT NULL,
  modified TEXT NOT NULL,
  UNIQUE (submission_id, award_id)
);
CREATE INDEX IF NOT EXISTS award_items_award ON award_items (award_id);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created TEXT NOT NULL,
  modified TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS conversations_user_task ON conversations (user_id, task_id);
CREATE INDEX IF NOT EXISTS conversations_task ON conversations (task_id);

-- source：conversation（和 AI 对话）/ edit（手改代码）/ manual（粘贴外部 AI 的代码）/ guidance（“帮我写清楚”）
-- 学生交的是哪一版：那条 assistant 消息的 submission_id；删提交时这条消息跟着删
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'conversation',
  prompt_level INTEGER,
  submission_id TEXT REFERENCES submissions (id) ON DELETE CASCADE,
  created TEXT NOT NULL,
  content TEXT NOT NULL,
  code_html TEXT,
  code_css TEXT,
  code_js TEXT
);
-- 课堂总结统计提示词链用的覆盖索引：只读小列，不碰 content / code_*
CREATE INDEX IF NOT EXISTS messages_chain ON messages (conversation_id, created, id, role, source, prompt_level);
CREATE UNIQUE INDEX IF NOT EXISTS messages_submission ON messages (submission_id) WHERE submission_id IS NOT NULL;

-- ── 游戏 ──
-- 游戏本体是 tasks 里 task_type = 'game' 的一行（owner_id 是作者，html/css/js 是工作台里的当前代码），
-- 对话和版本沿用 conversations / messages；下面是游戏特有的东西，都随 tasks 级联删除

-- 和 tasks 一对一；大厅列表只扫这张小表，统计在写评分 / 游玩时顺手更新
CREATE TABLE IF NOT EXISTS games (
  task_id INTEGER PRIMARY KEY REFERENCES tasks (id) ON DELETE CASCADE,
  -- draft（没发布过）/ listed（在大厅）/ taken_down（被老师下架）
  status TEXT NOT NULL DEFAULT 'draft',
  latest_version INTEGER NOT NULL DEFAULT 0,
  first_published TEXT,
  last_published TEXT,
  play_count INTEGER NOT NULL DEFAULT 0,
  -- 最新版的评分
  rating_sum INTEGER NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  featured_at TEXT,
  replay_public INTEGER NOT NULL DEFAULT 0,
  takedown_reason TEXT,
  appeal_at TEXT,
  cover TEXT
);
CREATE INDEX IF NOT EXISTS games_status ON games (status, last_published);
CREATE INDEX IF NOT EXISTS games_featured ON games (featured_at) WHERE featured_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS game_tags (
  task_id INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (task_id, tag)
);
CREATE INDEX IF NOT EXISTS game_tags_tag ON game_tags (tag, task_id);

-- 每次发布一行；代码在 game_release_code，扫版本列表时不读代码
CREATE TABLE IF NOT EXISTS game_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  -- 发布的是哪条 AI 回复；消息删了不影响已发布的代码
  message_id INTEGER REFERENCES messages (id) ON DELETE SET NULL,
  rating_sum INTEGER NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (task_id, version)
);
CREATE INDEX IF NOT EXISTS game_releases_message ON game_releases (message_id) WHERE message_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS game_release_code (
  release_id INTEGER PRIMARY KEY REFERENCES game_releases (id) ON DELETE CASCADE,
  html TEXT,
  css TEXT,
  js TEXT
);

-- 玩满 30 秒记一次，每人每个游戏一行；周榜 / 月榜按 first_played 数新增玩家
CREATE TABLE IF NOT EXISTS game_plays (
  task_id INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  first_played TEXT NOT NULL,
  last_played TEXT NOT NULL,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS game_plays_user ON game_plays (user_id);
CREATE INDEX IF NOT EXISTS game_plays_first ON game_plays (first_played, task_id);

-- 每人每版一条，可以改；老师删留言只清 comment，星级保留
CREATE TABLE IF NOT EXISTS game_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id INTEGER NOT NULL REFERENCES game_releases (id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  stars INTEGER NOT NULL,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  modified TEXT NOT NULL,
  comment TEXT,
  UNIQUE (user_id, release_id)
);
CREATE INDEX IF NOT EXISTS game_ratings_release ON game_ratings (release_id);
CREATE TABLE IF NOT EXISTS game_rating_helpful (
  rating_id INTEGER NOT NULL REFERENCES game_ratings (id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (rating_id, user_id)
);
CREATE INDEX IF NOT EXISTS game_rating_helpful_user ON game_rating_helpful (user_id);

CREATE TABLE IF NOT EXISTS game_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS game_reports_task ON game_reports (task_id);
CREATE INDEX IF NOT EXISTS game_reports_user ON game_reports (user_id);
CREATE INDEX IF NOT EXISTS game_reports_resolver ON game_reports (resolved_by) WHERE resolved_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS game_reports_pending ON game_reports (created) WHERE resolved_at IS NULL;

-- 徽章：自动发的 awarded_by 为 NULL；玩家徽章没有 task_id
CREATE TABLE IF NOT EXISTS game_badges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks (id) ON DELETE CASCADE,
  badge TEXT NOT NULL,
  awarded_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS game_badges_user ON game_badges (user_id);
CREATE INDEX IF NOT EXISTS game_badges_task ON game_badges (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS game_badges_awarder ON game_badges (awarded_by) WHERE awarded_by IS NOT NULL;

-- 老师的操作记录。游戏删了记录要留着，所以 task_id 是 SET NULL，另存一份标题
CREATE TABLE IF NOT EXISTS game_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER REFERENCES tasks (id) ON DELETE SET NULL,
  actor_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  -- take_down / restore / delete_comment / feature / unfeature / award_badge / dismiss_report
  action TEXT NOT NULL,
  game_title TEXT NOT NULL,
  created TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS game_log_task ON game_log (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS game_log_actor ON game_log (actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS game_log_created ON game_log (created);

-- 登录用 JWT：access token 不落库，refresh token 只存 sha256
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expire_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user ON refresh_tokens (user_id);
`

// 表结构的版本。改已有的表时加一步：if (version < N) { ...; version = N }
const SCHEMA_VERSION = 1

export function openDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path, { strict: true, create: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
  db.run("PRAGMA busy_timeout = 5000")

  const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version
  if (version === 0) {
    const legacy = db.query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'account_user'`).get()
    if (legacy) {
      throw new Error("这是旧的 Django 表结构，请先用 d3203c6 版本启动一次（会自动迁移），再换回新代码")
    }
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  } else if (version > SCHEMA_VERSION) {
    throw new Error(`数据库版本 ${version} 比代码新（${SCHEMA_VERSION}），请更新代码`)
  }
  db.run(SCHEMA)

  db.run("PRAGMA foreign_keys = ON")
  // SQLite 不会自动 ANALYZE，没有统计信息时规划器常挑错索引；0x10002 = 打开时只分析必要的表
  db.run("PRAGMA optimize=0x10002")
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

// ── 时间 ──

let lastMs = 0

// 严格递增的时间戳（同一毫秒内连续调用往后顺延 1 毫秒），连续插入的消息按时间排序才稳定
export function now(): string {
  let ms = Date.now()
  if (ms <= lastMs) ms = lastMs + 1
  lastMs = ms
  return new Date(ms).toISOString()
}

// ── UUID ──

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i

// 校验并规范成小写、带连字符的形式；不是 UUID 返回 null
export function uuid(value: string): string | null {
  if (!UUID_RE.test(value)) return null
  const hex = value.replaceAll("-", "").toLowerCase()
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const newId = () => crypto.randomUUID()

export function likeEscape(s: string): string {
  return "%" + s.replace(/[\\%_]/g, (m) => "\\" + m) + "%"
}
