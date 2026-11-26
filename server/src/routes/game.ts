import { Hono } from "hono"
import { mkdir, rm } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import { config } from "../config"
import { all, get, run, tx, now } from "../db"
import { Role, isStaff, requireAdmin, requireUser, type User } from "../auth"
import {
  HttpError,
  ValidationError,
  body,
  bool,
  intParam,
  notFound,
  orNotFound,
  pageQuery,
  pageWindow,
  qs,
  query,
  type Ctx,
  type Env,
} from "../http"
import { deleteTask } from "../services/cascade"
import { complete, llmConfigured } from "../services/llm"
import { buildPromptRounds, getActiveConversation, type MessageRow } from "../services/prompt"
import { mediaPath } from "./files"

// 游戏板块：游戏本体是 tasks 里 task_type = 'game' 的一行（和自由创作一样，对话和版本沿用 messages），
// 发布、大厅、评分、举报、老师管理用 games / game_* 表。设计见 docs/plans/2026-11-26-game-section-design.md

export const GAME_TAGS = {
  jump: "跳跃",
  shoot: "射击",
  maze: "迷宫",
  dodge: "躲避",
  catch: "接东西",
  puzzle: "益智",
  adventure: "冒险",
  other: "其他",
} as const
type Tag = keyof typeof GAME_TAGS
const TAG_KEYS = Object.keys(GAME_TAGS) as [Tag, ...Tag[]]

// 老师颁发的徽章；按人气、进步自动发的徽章门槛还没定
export const TEACHER_BADGES = { creative: "最有创意", "best-update": "最佳更新" } as const
type TeacherBadge = keyof typeof TEACHER_BADGES

// 评分人数不到这么多时大厅不显示分数（作者和老师照常能看）
const MIN_RATINGS = 3
const TITLE_MAX = 50
const NOTES_MAX = 200
const COMMENT_MAX = 100
const REASON_MAX = 200
const COVER_MAX_BYTES = 512 * 1024
const COVER_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }

const DAY_MS = 86_400_000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString()

// ── 读游戏 ────────────────────────────────────────────────────────────────────

interface GameRow {
  id: number
  display: number
  title: string
  content: string
  owner_id: number
  owner_name: string
  created: string
  modified: string
  status: "draft" | "listed" | "taken_down"
  latest_version: number
  first_published: string | null
  last_published: string | null
  play_count: number
  rating_sum: number
  rating_count: number
  featured_at: string | null
  replay_public: number
  takedown_reason: string | null
  appeal_at: string | null
  cover: string | null
}

const GAME_COLUMNS = `t.id, t.display, t.title, t.content, t.owner_id, u.username AS owner_name, t.created, t.modified,
  g.status, g.latest_version, g.first_published, g.last_published, g.play_count, g.rating_sum, g.rating_count,
  g.featured_at, g.replay_public, g.takedown_reason, g.appeal_at, g.cover`
const GAME_FROM = `FROM games g JOIN tasks t ON t.id = g.task_id JOIN users u ON u.id = t.owner_id`

function findGame(display: number) {
  return orNotFound(
    get<GameRow>(`SELECT ${GAME_COLUMNS} ${GAME_FROM} WHERE t.task_type = 'game' AND t.display = $display`, {
      display,
    }),
    "游戏不存在",
  )
}

const isOwner = (user: User, g: GameRow) => user.id === g.owner_id
// 作者和老师看得到全部：没满人数的分数、下架原因、每个人打的星
const seesAll = (user: User, g: GameRow) => isOwner(user, g) || isStaff(user)

// 大厅里的游戏谁都能看；草稿和被下架的只有作者和老师能看，别人当作不存在
function visibleGame(user: User, display: number) {
  const g = findGame(display)
  if (g.status !== "listed" && !seesAll(user, g)) notFound("游戏不存在或已下架")
  return g
}

// 作者本人（和超管）才能改
function ownedGame(c: Ctx) {
  const user = requireUser(c)
  const g = findGame(intParam(c, "display"))
  if (!isOwner(user, g) && user.role !== Role.SUPER) throw new HttpError(403, "只能操作自己的游戏")
  return { user, g }
}

function averageOf(sum: number, count: number, always: boolean) {
  if (!count || (count < MIN_RATINGS && !always)) return null
  return Math.round((sum / count) * 10) / 10
}

const coverUrl = (cover: string | null) => (cover ? config.mediaUrl + cover : null)

function tagsOf(taskIds: number[]) {
  const map = new Map<number, Tag[]>()
  if (!taskIds.length) return map
  // id 都是查出来的整数，可以直接拼进 SQL
  const rows = all<{ task_id: number; tag: Tag }>(
    `SELECT task_id, tag FROM game_tags WHERE task_id IN (${taskIds.join(",")}) ORDER BY rowid`,
  )
  for (const r of rows) map.set(r.task_id, [...(map.get(r.task_id) ?? []), r.tag])
  return map
}

// 大厅卡片
function cardOut(g: GameRow, tags: Tag[], always = false) {
  return {
    display: g.display,
    title: g.title,
    author: g.owner_name,
    cover: coverUrl(g.cover),
    tags,
    latest_version: g.latest_version,
    rating: averageOf(g.rating_sum, g.rating_count, always),
    rating_count: g.rating_count,
    play_count: g.play_count,
    last_published: g.last_published,
    featured: !!g.featured_at,
  }
}

function cardsOut(rows: GameRow[], always = false) {
  const tags = tagsOf(rows.map((r) => r.id))
  return rows.map((r) => cardOut(r, tags.get(r.id) ?? [], always))
}

function log(actor: User, g: { id: number; title: string }, action: string, reason = "") {
  run(
    `INSERT INTO game_log (task_id, actor_id, action, game_title, created, reason)
     VALUES ($task_id, $actor_id, $action, $title, $ts, $reason)`,
    { task_id: g.id, actor_id: actor.id, action, title: g.title, ts: now(), reason },
  )
}

function cleanTitle(title: string) {
  title = title.trim()
  if (!title) throw new HttpError(400, "游戏名称不能为空")
  return [...title].slice(0, TITLE_MAX).join("")
}

const clip = (text: string, max: number) => ([...text].length > max ? [...text].slice(0, max).join("") : text)

export const game = new Hono<Env>()

// ── 固定路径（要写在 /:display 前面） ─────────────────────────────────────────

game.get("/tags", (c) => {
  requireUser(c)
  return c.json(TAG_KEYS.map((key) => ({ key, label: GAME_TAGS[key] })))
})

game.get("/mine", (c) => {
  const user = requireUser(c)
  const rows = all<GameRow>(
    `SELECT ${GAME_COLUMNS} ${GAME_FROM}
     WHERE t.owner_id = $id AND t.task_type = 'game' ORDER BY t.modified DESC`,
    { id: user.id },
  )
  const tags = tagsOf(rows.map((r) => r.id))
  return c.json(
    rows.map((r) => ({
      ...cardOut(r, tags.get(r.id) ?? [], true),
      status: r.status,
      takedown_reason: r.takedown_reason,
      appeal_at: r.appeal_at,
      modified: r.modified,
    })),
  )
})

game.post("/", async (c) => {
  const user = requireUser(c)
  const p = await body(c, z.object({ title: z.string(), content: z.string().max(2000).default("") }))
  const title = cleanTitle(p.title)
  // 查最大序号和插入之间没有 await，不会撞号
  const display = tx(() => {
    const last = get<{ display: number }>(
      `SELECT display FROM tasks WHERE task_type = 'game' ORDER BY display DESC LIMIT 1`,
    )
    const display = (last?.display ?? 0) + 1
    const ts = now()
    const res = run(
      `INSERT INTO tasks (task_type, display, title, is_public, owner_id, created, modified, content, html, css, js)
       VALUES ('game', $display, $title, 0, $owner_id, $ts, $ts, $content, '', '', '')`,
      { display, title, owner_id: user.id, ts, content: p.content },
    )
    run(`INSERT INTO games (task_id) VALUES ($id)`, { id: Number(res.lastInsertRowid) })
    return display
  })
  return c.json(workspaceOut(findGame(display)))
})

// 大厅：只列在大厅里的游戏
const SECTIONS = ["featured", "hot", "new", "updated", "top", "random"] as const

game.get("/hall", (c) => {
  requireUser(c)
  const q = query(
    c,
    pageQuery.extend({
      section: qs.opt(z.enum(SECTIONS)).default("new"),
      tag: qs.opt(z.enum(TAG_KEYS)),
    }),
  )
  const { limit, offset } = pageWindow(q)
  const where = ["g.status = 'listed'"]
  const params: Record<string, unknown> = {}
  if (q.tag) {
    where.push("g.task_id IN (SELECT task_id FROM game_tags WHERE tag = $tag)")
    params.tag = q.tag
  }
  let order: string
  switch (q.section) {
    case "featured":
      where.push("g.featured_at IS NOT NULL")
      order = "g.featured_at DESC"
      break
    case "hot":
      // 最近 7 天新增的玩家多的排前面
      order = `(SELECT COUNT(*) FROM game_plays p WHERE p.task_id = g.task_id AND p.first_played >= $since) DESC,
        g.play_count DESC, g.last_published DESC`
      params.since = daysAgo(7)
      break
    case "updated":
      order = "g.last_published DESC"
      break
    case "top":
      where.push(`g.rating_count >= ${MIN_RATINGS}`)
      order = "g.rating_sum * 1.0 / g.rating_count DESC, g.rating_count DESC"
      break
    case "random":
      order = "random()"
      break
    default:
      order = "g.first_published DESC"
  }
  const whereSql = where.join(" AND ")
  const count = get<{ n: number }>(`SELECT COUNT(*) AS n FROM games g WHERE ${whereSql}`, q.tag ? { tag: q.tag } : {})!.n
  const rows = all<GameRow>(
    `SELECT ${GAME_COLUMNS} ${GAME_FROM} WHERE ${whereSql} ORDER BY ${order}, g.task_id DESC
     LIMIT $limit OFFSET $offset`,
    { ...params, limit, offset: q.section === "random" ? 0 : offset },
  )
  return c.json({ items: cardsOut(rows), count })
})

// 周榜 / 月榜：最近 7 / 30 天新增玩家最多的 20 个
game.get("/leaderboard", (c) => {
  requireUser(c)
  const q = query(c, z.object({ period: qs.opt(z.enum(["week", "month"])).default("week") }))
  const ranked = all<{ task_id: number; players: number }>(
    `SELECT p.task_id, COUNT(*) AS players FROM game_plays p
     JOIN games g ON g.task_id = p.task_id
     WHERE p.first_played >= $since AND g.status = 'listed'
     GROUP BY p.task_id ORDER BY players DESC, p.task_id LIMIT 20`,
    { since: daysAgo(q.period === "week" ? 7 : 30) },
  )
  if (!ranked.length) return c.json([])
  const rows = all<GameRow>(
    `SELECT ${GAME_COLUMNS} ${GAME_FROM} WHERE g.task_id IN (${ranked.map((r) => r.task_id).join(",")})`,
  )
  const byId = new Map(cardsOut(rows).map((card, i) => [rows[i]!.id, card]))
  return c.json(
    ranked.map((r, i) => ({ rank: i + 1, new_players: r.players, ...byId.get(r.task_id)! })),
  )
})

// ── 老师 ──────────────────────────────────────────────────────────────────────

// 侧栏的数字提醒
game.get("/admin/summary", (c) => {
  requireAdmin(c)
  const reports = get<{ n: number }>(`SELECT COUNT(*) AS n FROM game_reports WHERE resolved_at IS NULL`)!.n
  const appeals = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM games WHERE status = 'taken_down' AND appeal_at IS NOT NULL`,
  )!.n
  return c.json({ pending_reports: reports, appeals })
})

game.get("/admin/reports", (c) => {
  requireAdmin(c)
  const q = query(c, pageQuery.extend({ status: qs.opt(z.enum(["pending", "all"])).default("pending") }))
  const { limit, offset } = pageWindow(q)
  const where = q.status === "pending" ? "WHERE r.resolved_at IS NULL" : ""
  const count = get<{ n: number }>(`SELECT COUNT(*) AS n FROM game_reports r ${where}`)!.n
  const rows = all(
    `SELECT r.id, r.reason, r.created, r.resolved_at, u.username AS reporter,
       t.display, t.title, g.status
     FROM game_reports r
     JOIN users u ON u.id = r.user_id
     JOIN tasks t ON t.id = r.task_id
     JOIN games g ON g.task_id = r.task_id
     ${where} ORDER BY r.created DESC LIMIT $limit OFFSET $offset`,
    { limit, offset },
  )
  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      reporter: r.reporter,
      created: r.created,
      resolved_at: r.resolved_at,
      game: { display: r.display, title: r.title, status: r.status },
    })),
    count,
  })
})

// 看过举报、不用下架：标成已处理（下架时会自动处理该游戏的所有举报）
game.post("/admin/reports/:id/resolve", (c) => {
  const user = requireAdmin(c)
  const report = orNotFound(
    get<{ id: number; task_id: number; reason: string; resolved_at: string | null; title: string }>(
      `SELECT r.id, r.task_id, r.reason, r.resolved_at, t.title
       FROM game_reports r JOIN tasks t ON t.id = r.task_id WHERE r.id = $id`,
      { id: intParam(c, "id") },
    ),
    "举报不存在",
  )
  if (report.resolved_at) return c.json({ message: "已经处理过了" })
  tx(() => {
    run(`UPDATE game_reports SET resolved_at = $ts, resolved_by = $by WHERE id = $id`, {
      ts: now(),
      by: user.id,
      id: report.id,
    })
    log(user, { id: report.task_id, title: report.title }, "dismiss_report", report.reason)
  })
  return c.json({ message: "已处理" })
})

// 被下架的游戏，申请重新上架的排前面
game.get("/admin/takedowns", (c) => {
  requireAdmin(c)
  const rows = all<GameRow>(
    `SELECT ${GAME_COLUMNS} ${GAME_FROM} WHERE g.status = 'taken_down'
     ORDER BY g.appeal_at IS NULL, g.appeal_at DESC, t.modified DESC`,
  )
  const tags = tagsOf(rows.map((r) => r.id))
  return c.json(
    rows.map((r) => ({
      ...cardOut(r, tags.get(r.id) ?? [], true),
      takedown_reason: r.takedown_reason,
      appeal_at: r.appeal_at,
    })),
  )
})

game.get("/admin/log", (c) => {
  requireAdmin(c)
  const q = query(c, pageQuery)
  const { limit, offset } = pageWindow(q)
  const count = get<{ n: number }>(`SELECT COUNT(*) AS n FROM game_log`)!.n
  const rows = all(
    `SELECT l.id, l.action, l.game_title, l.reason, l.created, u.username AS actor, t.display
     FROM game_log l
     LEFT JOIN users u ON u.id = l.actor_id
     LEFT JOIN tasks t ON t.id = l.task_id
     ORDER BY l.created DESC, l.id DESC LIMIT $limit OFFSET $offset`,
    { limit, offset },
  )
  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      actor: r.actor,
      game: { display: r.display, title: r.game_title },
      reason: r.reason,
      created: r.created,
    })),
    count,
  })
})

// ── 留言 ──────────────────────────────────────────────────────────────────────

function findRating(id: number) {
  return orNotFound(
    get<{
      id: number
      user_id: number
      comment: string | null
      helpful_count: number
      task_id: number
      title: string
      display: number
    }>(
      `SELECT r.id, r.user_id, r.comment, r.helpful_count, gr.task_id, t.title, t.display
       FROM game_ratings r
       JOIN game_releases gr ON gr.id = r.release_id
       JOIN tasks t ON t.id = gr.task_id
       WHERE r.id = $id`,
      { id },
    ),
    "留言不存在",
  )
}

// 点 / 取消“有用”
game.post("/ratings/:id/helpful", (c) => {
  const user = requireUser(c)
  const r = findRating(intParam(c, "id"))
  visibleGame(user, r.display)
  if (!r.comment) throw new HttpError(400, "这条没有留言")
  if (r.user_id === user.id) throw new HttpError(400, "不能给自己的留言点有用")
  const result = tx(() => {
    const had = get(`SELECT 1 FROM game_rating_helpful WHERE rating_id = $rid AND user_id = $uid`, {
      rid: r.id,
      uid: user.id,
    })
    if (had) {
      run(`DELETE FROM game_rating_helpful WHERE rating_id = $rid AND user_id = $uid`, { rid: r.id, uid: user.id })
    } else {
      run(`INSERT INTO game_rating_helpful (rating_id, user_id) VALUES ($rid, $uid)`, { rid: r.id, uid: user.id })
    }
    run(`UPDATE game_ratings SET helpful_count = helpful_count + $d WHERE id = $id`, {
      d: had ? -1 : 1,
      id: r.id,
    })
    return { helped: !had, helpful_count: r.helpful_count + (had ? -1 : 1) }
  })
  return c.json(result)
})

// 老师删留言：只清掉文字，星级还算在分数里；删掉的文字记进操作记录
game.delete("/ratings/:id/comment", (c) => {
  const user = requireAdmin(c)
  const r = findRating(intParam(c, "id"))
  if (!r.comment) return c.json({ message: "留言已经删掉了" })
  tx(() => {
    run(`UPDATE game_ratings SET comment = NULL, helpful_count = 0 WHERE id = $id`, { id: r.id })
    run(`DELETE FROM game_rating_helpful WHERE rating_id = $id`, { id: r.id })
    log(user, { id: r.task_id, title: r.title }, "delete_comment", r.comment!)
  })
  return c.json({ message: "留言已删除" })
})

// ── 作者：工作台 ──────────────────────────────────────────────────────────────

function workspaceOut(g: GameRow) {
  const code = get<{ html: string; css: string; js: string }>(
    `SELECT html, css, js FROM tasks WHERE id = $id`,
    { id: g.id },
  )!
  return {
    task_id: g.id,
    display: g.display,
    title: g.title,
    content: g.content,
    ...code,
    status: g.status,
    latest_version: g.latest_version,
    tags: tagsOf([g.id]).get(g.id) ?? [],
    cover: coverUrl(g.cover),
    replay_public: bool(g.replay_public),
    takedown_reason: g.takedown_reason,
    appeal_at: g.appeal_at,
    created: g.created,
    modified: g.modified,
    // 版本条上标出哪几版发布过
    releases: all<{ version: number; message_id: number | null }>(
      `SELECT version, message_id FROM game_releases WHERE task_id = $id ORDER BY version`,
      { id: g.id },
    ),
  }
}

game.get("/:display/workspace", (c) => {
  const { g } = ownedGame(c)
  return c.json(workspaceOut(g))
})

game.put("/:display", async (c) => {
  const { g } = ownedGame(c)
  const p = await body(c, z.object({ title: z.string(), content: z.string().max(2000).default("") }))
  run(`UPDATE tasks SET title = $title, content = $content, modified = $ts WHERE id = $id`, {
    title: cleanTitle(p.title),
    content: p.content,
    ts: now(),
    id: g.id,
  })
  return c.json(workspaceOut(findGame(g.display)))
})

game.put("/:display/code", async (c) => {
  const { g } = ownedGame(c)
  const p = await body(
    c,
    z.object({ html: z.string().default(""), css: z.string().default(""), js: z.string().default("") }),
  )
  run(`UPDATE tasks SET html = $html, css = $css, js = $js, modified = $ts WHERE id = $id`, {
    ...p,
    ts: now(),
    id: g.id,
  })
  return c.json({ message: "已保存" })
})

// 作者可以删，版本、评分、留言、举报一起删掉（前端要二次确认）
game.delete("/:display", async (c) => {
  const { g } = ownedGame(c)
  deleteTask(g.id)
  if (g.cover) await rm(mediaPath(g.cover), { force: true })
  return c.json({ message: "删除成功" })
})

// 发布：把某一版（某条 AI 回复，不传就是工作台里的当前代码）存成新的发布版本
game.post("/:display/releases", async (c) => {
  const { g } = ownedGame(c)
  const p = await body(
    c,
    z.object({
      message_id: z.number().int().optional(),
      notes: z.string().trim().max(NOTES_MAX).default(""),
      tags: z.array(z.enum(TAG_KEYS)).min(1).max(2),
    }),
  )
  let code: { html: string | null; css: string | null; js: string | null }
  if (p.message_id !== undefined) {
    code = orNotFound(
      get(
        `SELECT m.code_html AS html, m.code_css AS css, m.code_js AS js
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE m.id = $id AND m.role = 'assistant' AND c.task_id = $task_id AND c.user_id = $owner_id`,
        { id: p.message_id, task_id: g.id, owner_id: g.owner_id },
      ),
      "这一版不存在",
    )
  } else {
    code = get(`SELECT html, css, js FROM tasks WHERE id = $id`, { id: g.id })!
  }
  if (!code.html?.trim() && !code.css?.trim() && !code.js?.trim()) {
    throw new HttpError(400, "这一版没有代码")
  }
  const tags = [...new Set(p.tags)]
  const result = tx(() => {
    const current = get<{ latest_version: number; status: string }>(
      `SELECT latest_version, status FROM games WHERE task_id = $id`,
      { id: g.id },
    )!
    const version = current.latest_version + 1
    const ts = now()
    const res = run(
      `INSERT INTO game_releases (task_id, version, message_id, created, notes)
       VALUES ($task_id, $version, $message_id, $ts, $notes)`,
      { task_id: g.id, version, message_id: p.message_id ?? null, ts, notes: p.notes },
    )
    run(`INSERT INTO game_release_code (release_id, html, css, js) VALUES ($id, $html, $css, $js)`, {
      id: Number(res.lastInsertRowid),
      ...code,
    })
    run(`DELETE FROM game_tags WHERE task_id = $id`, { id: g.id })
    for (const tag of tags) run(`INSERT INTO game_tags (task_id, tag) VALUES ($id, $tag)`, { id: g.id, tag })
    // 被下架的游戏发布新版也不会自动上架，要老师恢复
    const status = current.status === "draft" ? "listed" : current.status
    run(
      `UPDATE games SET latest_version = $version, status = $status, last_published = $ts,
         first_published = COALESCE(first_published, $ts), rating_sum = 0, rating_count = 0
       WHERE task_id = $id`,
      { version, status, ts, id: g.id },
    )
    return { version, status }
  })
  return c.json(result)
})

const NOTES_PROMPT = `下面是学生上次发布游戏以来让 AI 做的改动。把它们写成给玩家看的更新说明：一两句话，不超过 60 个字，
只写玩家玩得出来的变化，像“加了第二关；主角跳得更高了”。直接输出更新说明，不要引号、标题或前缀。`

// 更新说明的草稿：上次发布以来 AI 每次回复里的“做了什么”，有模型时再让它压成一两句
game.post("/:display/notes-draft", async (c) => {
  const { g } = ownedGame(c)
  const since =
    get<{ created: string }>(
      `SELECT created FROM game_releases WHERE task_id = $id ORDER BY version DESC LIMIT 1`,
      { id: g.id },
    )?.created ?? ""
  const replies = all<{ content: string }>(
    `SELECT m.content FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.task_id = $task_id AND c.user_id = $owner_id AND m.role = 'assistant'
       AND m.source = 'conversation' AND m.created > $since
     ORDER BY m.created, m.id`,
    { task_id: g.id, owner_id: g.owner_id, since },
  )
  const changes = replies
    .map((r) => /\*\*做了什么\*\*\s*[:：]\s*([^\n]+)/.exec(r.content)?.[1]?.trim())
    .filter((s): s is string => !!s)
  if (!changes.length) return c.json({ notes: "" })
  let notes = clip(changes.join("；"), NOTES_MAX)
  if (llmConfigured()) {
    try {
      const text = await complete(
        [
          { role: "system", content: NOTES_PROMPT },
          { role: "user", content: changes.map((s) => `- ${s}`).join("\n") },
        ],
        { thinking: false, maxTokens: 200, temperature: 0.3, timeoutMs: 30_000 },
      )
      if (text.trim()) notes = clip(text.trim(), NOTES_MAX)
    } catch (e) {
      console.error("notes-draft LLM call failed:", e)
    }
  }
  return c.json({ notes })
})

// 封面：预览自动截的图，或学生自己换的
game.put("/:display/cover", async (c) => {
  const { g } = ownedGame(c)
  const form = await c.req.formData().catch(() => null)
  const file = form?.get("image")
  if (!(file instanceof File)) throw new ValidationError([{ loc: ["body", "image"], msg: "缺少图片" }])
  const ext = COVER_TYPES[file.type]
  if (!ext) throw new HttpError(400, "封面只能是 PNG、JPG 或 WebP 图片")
  if (file.size > COVER_MAX_BYTES) throw new HttpError(400, "封面图片不能超过 512 KB")
  const stored = `games/${g.id}/cover-${crypto.randomUUID()}.${ext}`
  const full = mediaPath(stored)
  await mkdir(dirname(full), { recursive: true })
  await Bun.write(full, file)
  // 上面 await 期间游戏可能被删了
  const current = get<{ cover: string | null }>(`SELECT cover FROM games WHERE task_id = $id`, { id: g.id })
  if (!current) {
    await rm(full, { force: true })
    notFound("游戏不存在")
  }
  run(`UPDATE games SET cover = $cover WHERE task_id = $id`, { cover: stored, id: g.id })
  if (current.cover) await rm(mediaPath(current.cover), { force: true })
  return c.json({ cover: coverUrl(stored) })
})

game.put("/:display/replay", async (c) => {
  const { g } = ownedGame(c)
  const p = await body(c, z.object({ public: z.boolean() }))
  run(`UPDATE games SET replay_public = $p WHERE task_id = $id`, { p: p.public, id: g.id })
  return c.json({ replay_public: p.public })
})

game.post("/:display/appeal", (c) => {
  const { g } = ownedGame(c)
  if (g.status !== "taken_down") throw new HttpError(400, "游戏没有被下架")
  run(`UPDATE games SET appeal_at = $ts WHERE task_id = $id`, { ts: now(), id: g.id })
  return c.json({ message: "已申请，等老师处理" })
})

// ── 所有人：游戏页 ────────────────────────────────────────────────────────────

game.get("/:display", (c) => {
  const user = requireUser(c)
  const g = visibleGame(user, intParam(c, "display"))
  const full = seesAll(user, g)
  const releases = all<{ id: number; version: number; notes: string; created: string; rating_sum: number; rating_count: number }>(
    `SELECT id, version, notes, created, rating_sum, rating_count FROM game_releases
     WHERE task_id = $id ORDER BY version DESC`,
    { id: g.id },
  )
  const latest = releases[0]
  const code = latest
    ? get<{ html: string | null; css: string | null; js: string | null }>(
        `SELECT html, css, js FROM game_release_code WHERE release_id = $id`,
        { id: latest.id },
      )
    : null
  const mine = latest
    ? get<{ stars: number; comment: string | null }>(
        `SELECT stars, comment FROM game_ratings WHERE release_id = $rid AND user_id = $uid`,
        { rid: latest.id, uid: user.id },
      )
    : null
  const played = !!get(`SELECT 1 FROM game_plays WHERE task_id = $id AND user_id = $uid`, {
    id: g.id,
    uid: user.id,
  })
  return c.json({
    ...cardOut(g, tagsOf([g.id]).get(g.id) ?? [], full),
    task_id: g.id,
    content: g.content,
    status: g.status,
    is_owner: isOwner(user, g),
    replay_public: bool(g.replay_public),
    takedown_reason: full ? g.takedown_reason : null,
    appeal_at: full ? g.appeal_at : null,
    releases: releases.map((r) => ({
      version: r.version,
      notes: r.notes,
      created: r.created,
      rating: averageOf(r.rating_sum, r.rating_count, full),
      rating_count: r.rating_count,
    })),
    badges: all<{ badge: TeacherBadge }>(
      `SELECT badge FROM game_badges WHERE task_id = $id ORDER BY created`,
      { id: g.id },
    ).map((b) => ({ key: b.badge, label: TEACHER_BADGES[b.badge] ?? b.badge })),
    code,
    my_rating: mine,
    played,
  })
})

// 某一版的代码：玩家只能玩最新版，作者和老师能看所有旧版
game.get("/:display/releases/:version", (c) => {
  const user = requireUser(c)
  const g = visibleGame(user, intParam(c, "display"))
  const version = intParam(c, "version")
  if (version !== g.latest_version && !seesAll(user, g)) throw new HttpError(403, "只能玩最新版")
  const r = orNotFound(
    get(
      `SELECT r.version, r.notes, r.created, code.html, code.css, code.js
       FROM game_releases r JOIN game_release_code code ON code.release_id = r.id
       WHERE r.task_id = $id AND r.version = $version`,
      { id: g.id, version },
    ),
    "版本不存在",
  )
  return c.json(r)
})

// 留言：只显示名字和留言；每个人打的星只有老师看得到（老师还能看到没写留言的打分）
game.get("/:display/ratings", (c) => {
  const user = requireUser(c)
  const g = visibleGame(user, intParam(c, "display"))
  const q = query(c, pageQuery.extend({ version: qs.opt(qs.int) }))
  const { limit, offset } = pageWindow(q)
  const release = get<{ id: number }>(
    `SELECT id FROM game_releases WHERE task_id = $id AND version = $version`,
    { id: g.id, version: q.version ?? g.latest_version },
  )
  if (!release) return c.json({ items: [], count: 0 })
  const staff = isStaff(user)
  const where = staff ? "r.release_id = $rid" : "r.release_id = $rid AND r.comment IS NOT NULL"
  const count = get<{ n: number }>(`SELECT COUNT(*) AS n FROM game_ratings r WHERE ${where}`, {
    rid: release.id,
  })!.n
  const rows = all(
    `SELECT r.id, r.user_id, r.stars, r.comment, r.helpful_count, r.modified, u.username,
       EXISTS (SELECT 1 FROM game_rating_helpful h WHERE h.rating_id = r.id AND h.user_id = $me) AS helped
     FROM game_ratings r JOIN users u ON u.id = r.user_id
     WHERE ${where}
     ORDER BY r.helpful_count DESC, r.modified DESC, r.id DESC LIMIT $limit OFFSET $offset`,
    { rid: release.id, me: user.id, limit, offset },
  )
  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      username: r.username,
      comment: r.comment,
      helpful_count: r.helpful_count,
      helped: bool(r.helped),
      mine: r.user_id === user.id,
      created: r.modified,
      ...(staff ? { stars: r.stars } : {}),
    })),
    count,
  })
})

// 成长回放：从第一轮对话到最新一版；作者和老师能看，作者公开后所有人能看
game.get("/:display/replay", (c) => {
  const user = requireUser(c)
  const g = visibleGame(user, intParam(c, "display"))
  if (!seesAll(user, g) && !g.replay_public) throw new HttpError(403, "作者没有公开制作过程")
  const convId = getActiveConversation(g.owner_id, g.id)
  if (!convId) return c.json({ rounds: [] })
  const last = get<MessageRow>(
    `SELECT * FROM messages WHERE conversation_id = $conv ORDER BY created DESC, id DESC LIMIT 1`,
    { conv: convId },
  )
  if (!last) return c.json({ rounds: [] })
  const released = new Map(
    all<{ version: number; message_id: number }>(
      `SELECT version, message_id FROM game_releases WHERE task_id = $id AND message_id IS NOT NULL`,
      { id: g.id },
    ).map((r) => [r.message_id, r.version]),
  )
  return c.json({
    rounds: buildPromptRounds(last).map((r) => ({
      ...r,
      version: r.assistant_msg_id ? (released.get(r.assistant_msg_id) ?? null) : null,
    })),
  })
})

// ── 玩家 ──────────────────────────────────────────────────────────────────────

// 玩满 30 秒时前端上报一次；每人每个游戏只算一个玩家，作者自己玩不算
game.post("/:display/play", (c) => {
  const user = requireUser(c)
  const g = visibleGame(user, intParam(c, "display"))
  if (isOwner(user, g) || g.status !== "listed") return c.json({ counted: false, play_count: g.play_count })
  const counted = tx(() => {
    const ts = now()
    const existed = get(`SELECT 1 FROM game_plays WHERE task_id = $id AND user_id = $uid`, {
      id: g.id,
      uid: user.id,
    })
    if (existed) {
      run(`UPDATE game_plays SET last_played = $ts WHERE task_id = $id AND user_id = $uid`, {
        ts,
        id: g.id,
        uid: user.id,
      })
      return false
    }
    run(`INSERT INTO game_plays (task_id, user_id, first_played, last_played) VALUES ($id, $uid, $ts, $ts)`, {
      id: g.id,
      uid: user.id,
      ts,
    })
    run(`UPDATE games SET play_count = play_count + 1 WHERE task_id = $id`, { id: g.id })
    return true
  })
  return c.json({ counted, play_count: g.play_count + (counted ? 1 : 0) })
})

// 给最新版打分（1～5 星）和写一句话；要玩过，不能给自己打，改分覆盖原来的
game.put("/:display/rating", async (c) => {
  const user = requireUser(c)
  const g = visibleGame(user, intParam(c, "display"))
  const p = await body(
    c,
    z.object({
      stars: z.number().int().min(1).max(5),
      comment: z.string().trim().max(COMMENT_MAX).optional(),
    }),
  )
  if (g.status !== "listed") throw new HttpError(400, "游戏不在大厅里，不能打分")
  if (isOwner(user, g)) throw new HttpError(400, "不能给自己的游戏打分")
  const played = get(`SELECT 1 FROM game_plays WHERE task_id = $id AND user_id = $uid`, {
    id: g.id,
    uid: user.id,
  })
  if (!played) throw new HttpError(400, "玩过才能打分")
  const comment = p.comment || null
  const result = tx(() => {
    const release = get<{ id: number }>(
      `SELECT id FROM game_releases WHERE task_id = $id AND version = $version`,
      { id: g.id, version: g.latest_version },
    )!
    const old = get<{ id: number; stars: number }>(
      `SELECT id, stars FROM game_ratings WHERE release_id = $rid AND user_id = $uid`,
      { rid: release.id, uid: user.id },
    )
    const ts = now()
    let dSum = p.stars
    let dCount = 1
    if (old) {
      run(`UPDATE game_ratings SET stars = $stars, comment = $comment, modified = $ts WHERE id = $id`, {
        stars: p.stars,
        comment,
        ts,
        id: old.id,
      })
      dSum = p.stars - old.stars
      dCount = 0
    } else {
      run(
        `INSERT INTO game_ratings (release_id, user_id, stars, created, modified, comment)
         VALUES ($rid, $uid, $stars, $ts, $ts, $comment)`,
        { rid: release.id, uid: user.id, stars: p.stars, ts, comment },
      )
    }
    const params = { d_sum: dSum, d_count: dCount }
    run(
      `UPDATE game_releases SET rating_sum = rating_sum + $d_sum, rating_count = rating_count + $d_count WHERE id = $id`,
      { ...params, id: release.id },
    )
    run(
      `UPDATE games SET rating_sum = rating_sum + $d_sum, rating_count = rating_count + $d_count WHERE task_id = $id`,
      { ...params, id: g.id },
    )
    return get<{ rating_sum: number; rating_count: number }>(
      `SELECT rating_sum, rating_count FROM games WHERE task_id = $id`,
      { id: g.id },
    )!
  })
  return c.json({
    stars: p.stars,
    comment,
    rating: averageOf(result.rating_sum, result.rating_count, false),
    rating_count: result.rating_count,
  })
})

// 举报：同一个人对同一个游戏没处理完的举报只留一条，再举报就更新理由
game.post("/:display/report", async (c) => {
  const user = requireUser(c)
  const g = visibleGame(user, intParam(c, "display"))
  const p = await body(c, z.object({ reason: z.string().trim().min(1).max(REASON_MAX) }))
  if (isOwner(user, g)) throw new HttpError(400, "不能举报自己的游戏")
  tx(() => {
    const pending = get<{ id: number }>(
      `SELECT id FROM game_reports WHERE task_id = $id AND user_id = $uid AND resolved_at IS NULL`,
      { id: g.id, uid: user.id },
    )
    if (pending) {
      run(`UPDATE game_reports SET reason = $reason, created = $ts WHERE id = $id`, {
        reason: p.reason,
        ts: now(),
        id: pending.id,
      })
    } else {
      run(
        `INSERT INTO game_reports (task_id, user_id, reason, created) VALUES ($id, $uid, $reason, $ts)`,
        { id: g.id, uid: user.id, reason: p.reason, ts: now() },
      )
    }
  })
  return c.json({ message: "已举报，老师会看到" })
})

// ── 老师：管理某个游戏 ────────────────────────────────────────────────────────

game.post("/:display/takedown", async (c) => {
  const user = requireAdmin(c)
  const g = findGame(intParam(c, "display"))
  const p = await body(c, z.object({ reason: z.string().trim().min(1).max(REASON_MAX) }))
  tx(() => {
    run(
      `UPDATE games SET status = 'taken_down', takedown_reason = $reason, appeal_at = NULL, featured_at = NULL
       WHERE task_id = $id`,
      { reason: p.reason, id: g.id },
    )
    // 下架就算处理了这个游戏的所有举报
    run(
      `UPDATE game_reports SET resolved_at = $ts, resolved_by = $by WHERE task_id = $id AND resolved_at IS NULL`,
      { ts: now(), by: user.id, id: g.id },
    )
    log(user, g, "take_down", p.reason)
  })
  return c.json({ message: "已下架" })
})

game.post("/:display/restore", (c) => {
  const user = requireAdmin(c)
  const g = findGame(intParam(c, "display"))
  if (g.status !== "taken_down") throw new HttpError(400, "游戏没有被下架")
  const status = g.latest_version > 0 ? "listed" : "draft"
  tx(() => {
    run(
      `UPDATE games SET status = $status, takedown_reason = NULL, appeal_at = NULL WHERE task_id = $id`,
      { status, id: g.id },
    )
    log(user, g, "restore")
  })
  return c.json({ status })
})

game.put("/:display/featured", async (c) => {
  const user = requireAdmin(c)
  const g = findGame(intParam(c, "display"))
  const p = await body(c, z.object({ featured: z.boolean() }))
  if (p.featured && g.status !== "listed") throw new HttpError(400, "只能推荐在大厅里的游戏")
  tx(() => {
    run(`UPDATE games SET featured_at = $ts WHERE task_id = $id`, { ts: p.featured ? now() : null, id: g.id })
    log(user, g, p.featured ? "feature" : "unfeature")
  })
  return c.json({ featured: p.featured })
})

game.post("/:display/badges", async (c) => {
  const user = requireAdmin(c)
  const g = findGame(intParam(c, "display"))
  const keys = Object.keys(TEACHER_BADGES) as [TeacherBadge, ...TeacherBadge[]]
  const p = await body(c, z.object({ badge: z.enum(keys) }))
  const exists = get(`SELECT 1 FROM game_badges WHERE task_id = $id AND badge = $badge`, {
    id: g.id,
    badge: p.badge,
  })
  if (exists) throw new HttpError(400, "这个游戏已经有这个徽章了")
  tx(() => {
    run(
      `INSERT INTO game_badges (user_id, task_id, badge, awarded_by, created) VALUES ($uid, $id, $badge, $by, $ts)`,
      { uid: g.owner_id, id: g.id, badge: p.badge, by: user.id, ts: now() },
    )
    log(user, g, "award_badge", TEACHER_BADGES[p.badge])
  })
  return c.json({ message: `已颁发“${TEACHER_BADGES[p.badge]}”` })
})
