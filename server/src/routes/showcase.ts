import { Hono } from "hono"
import { z } from "zod"
import { all, get, run, tx, now, iso, uuidHex, uuidOut } from "../db"
import { requireAdmin, requireUser } from "../auth"
import { HttpError, ValidationError, body, bool, intParam, orNotFound, uuidParam, type Ctx, type Env } from "../http"
import { buildPromptRounds, type MessageRow } from "../services/prompt"

const router = new Hono<Env>()

const ITEM_ORDERINGS = ["manual", "awarded_at", "score", "view_count"] as const

// 作品排序方式 → ORDER BY
const ORDER_BY: Record<string, string> = {
  manual: "sa.sort_order, sa.id",
  awarded_at: "sa.awarded_at DESC, sa.sort_order, sa.id",
  score: "s.score DESC, sa.sort_order, sa.id",
  view_count: "s.view_count DESC, sa.sort_order, sa.id",
}

const HAS_CHAIN = `EXISTS (SELECT 1 FROM prompt_message m WHERE m.submission_id = s.id) AS has_prompt_chain`

const ITEM_SELECT = `SELECT sa.id, sa.submission_id, sa.sort_order, sa.awarded_at, sa.is_stale,
    u.username, t.title AS task_title, t.display AS task_display,
    s.score, s.view_count, s.html, s.css, s.js, ${HAS_CHAIN}
  FROM submission_submissionaward sa
  JOIN submission_submission s ON s.id = sa.submission_id
  JOIN account_user u ON u.id = s.user_id
  JOIN task_task t ON t.id = s.task_id`

function itemManageOut(r: any) {
  return {
    id: r.id,
    submission_id: uuidOut(r.submission_id),
    username: r.username,
    task_title: r.task_title,
    task_display: r.task_display,
    score: r.score,
    view_count: r.view_count,
    sort_order: r.sort_order,
    awarded_at: iso(r.awarded_at),
    has_prompt_chain: bool(r.has_prompt_chain),
    is_stale: bool(r.is_stale),
  }
}

const loadItem = (id: number) => get(`${ITEM_SELECT} WHERE sa.id = $id`, { id })

function awardManageOut(a: any) {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    sort_order: a.sort_order,
    is_active: bool(a.is_active),
    item_ordering: a.item_ordering,
    item_count: a.item_count,
  }
}

const AWARD_SELECT = `SELECT a.*, (SELECT COUNT(*) FROM submission_submissionaward sa WHERE sa.award_id = a.id) AS item_count
  FROM submission_award a`

const awardIn = z.object({
  name: z.string(),
  description: z.string().default(""),
  sort_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
  item_ordering: z.string().default("manual"),
})

async function parseAward(c: Ctx) {
  const p = await body(c, awardIn)
  if (!(ITEM_ORDERINGS as readonly string[]).includes(p.item_ordering)) {
    throw new HttpError(400, "无效的作品排序方式")
  }
  return p
}

function assertNameFree(name: string, exceptId = 0) {
  if (get(`SELECT 1 FROM submission_award WHERE name = $name AND id != $id`, { name, id: exceptId })) {
    throw new HttpError(400, "奖项名称已存在")
  }
}

// ── 前台作品展 ────────────────────────────────────────────────────────────────

router.get("/", (c) => {
  requireUser(c)
  const awards = all(`SELECT * FROM submission_award WHERE is_active = 1 ORDER BY sort_order`)
  const result = []
  for (const award of awards) {
    const items = all(
      `${ITEM_SELECT} WHERE sa.award_id = $id ORDER BY ${ORDER_BY[award.item_ordering] ?? ORDER_BY.manual}`,
      { id: award.id },
    )
    if (!items.length) continue
    result.push({
      id: award.id,
      name: award.name,
      description: award.description,
      item_ordering: award.item_ordering,
      items: items.map((r) => ({
        submission_id: uuidOut(r.submission_id),
        username: r.username,
        task_title: r.task_title,
        task_display: r.task_display,
        score: r.score,
        view_count: r.view_count,
        html: r.html,
        css: r.css,
        js: r.js,
        has_prompt_chain: bool(r.has_prompt_chain),
      })),
    })
  }
  return c.json(result)
})

// ── 管理 ──────────────────────────────────────────────────────────────────────

router.get("/manage/awards", (c) => {
  requireAdmin(c)
  return c.json(all(`${AWARD_SELECT} ORDER BY a.sort_order, a.id`).map(awardManageOut))
})

router.post("/manage/awards", async (c) => {
  requireAdmin(c)
  const p = await parseAward(c)
  assertNameFree(p.name)
  const ts = now()
  const res = run(
    `INSERT INTO submission_award (created, modified, name, description, sort_order, is_active, item_ordering)
     VALUES ($ts, $ts, $name, $description, $sort_order, $is_active, $item_ordering)`,
    { ts, ...p },
  )
  return c.json(awardManageOut(get(`${AWARD_SELECT} WHERE a.id = $id`, { id: Number(res.lastInsertRowid) })))
})

router.put("/manage/awards/:award_id", async (c) => {
  requireAdmin(c)
  const id = intParam(c, "award_id")
  const p = await parseAward(c)
  orNotFound(get(`SELECT 1 FROM submission_award WHERE id = $id`, { id }))
  assertNameFree(p.name, id)
  run(
    `UPDATE submission_award SET name = $name, description = $description, sort_order = $sort_order,
       is_active = $is_active, item_ordering = $item_ordering, modified = $ts
     WHERE id = $id`,
    { id, ts: now(), ...p },
  )
  return c.json(awardManageOut(get(`${AWARD_SELECT} WHERE a.id = $id`, { id })))
})

router.delete("/manage/awards/:award_id", (c) => {
  requireAdmin(c)
  const id = intParam(c, "award_id")
  orNotFound(get(`SELECT 1 FROM submission_award WHERE id = $id`, { id }))
  tx(() => {
    run(`DELETE FROM submission_submissionaward WHERE award_id = $id`, { id })
    run(`DELETE FROM submission_award WHERE id = $id`, { id })
  })
  return c.json({ message: "删除成功" })
})

router.get("/manage/submissions/:submission_id", (c) => {
  requireAdmin(c)
  const id = uuidParam(c, "submission_id")
  const s = orNotFound(
    get(
      `SELECT s.id, u.username, t.title AS task_title, t.display AS task_display,
         s.score, s.view_count, ${HAS_CHAIN}
       FROM submission_submission s
       JOIN account_user u ON u.id = s.user_id
       JOIN task_task t ON t.id = s.task_id
       WHERE s.id = $id`,
      { id },
    ),
  )
  return c.json({
    submission_id: uuidOut(s.id),
    username: s.username,
    task_title: s.task_title,
    task_display: s.task_display,
    score: s.score,
    view_count: s.view_count,
    has_prompt_chain: bool(s.has_prompt_chain),
  })
})

router.get("/manage/awards/:award_id/items", (c) => {
  requireAdmin(c)
  const award = orNotFound(
    get<{ id: number; item_ordering: string }>(`SELECT id, item_ordering FROM submission_award WHERE id = $id`, {
      id: intParam(c, "award_id"),
    }),
  )
  const items = all(
    `${ITEM_SELECT} WHERE sa.award_id = $id ORDER BY ${ORDER_BY[award.item_ordering] ?? ORDER_BY.manual}`,
    { id: award.id },
  )
  return c.json(items.map(itemManageOut))
})

router.post("/manage/awards/:award_id/items", async (c) => {
  requireAdmin(c)
  const awardId = intParam(c, "award_id")
  const p = await body(c, z.object({ submission_id: z.string(), sort_order: z.number().int().default(0) }))
  const submissionId = uuidHex(p.submission_id)
  if (!submissionId) throw new ValidationError([{ loc: ["body", "submission_id"], msg: "需要 UUID" }])
  orNotFound(get(`SELECT 1 FROM submission_award WHERE id = $id`, { id: awardId }))
  orNotFound(get(`SELECT 1 FROM submission_submission WHERE id = $id`, { id: submissionId }))
  if (
    get(`SELECT 1 FROM submission_submissionaward WHERE award_id = $a AND submission_id = $s`, {
      a: awardId,
      s: submissionId,
    })
  ) {
    throw new HttpError(400, "该作品已在奖项中")
  }
  const ts = now()
  const res = run(
    `INSERT INTO submission_submissionaward (created, modified, sort_order, awarded_at, award_id, submission_id, is_stale)
     VALUES ($ts, $ts, $sort_order, $ts, $award_id, $submission_id, 0)`,
    { ts, sort_order: p.sort_order, award_id: awardId, submission_id: submissionId },
  )
  return c.json(itemManageOut(loadItem(Number(res.lastInsertRowid))))
})

router.put("/manage/items/:item_id", async (c) => {
  requireAdmin(c)
  const id = intParam(c, "item_id")
  const { sort_order } = await body(c, z.object({ sort_order: z.number().int().default(0) }))
  orNotFound(get(`SELECT 1 FROM submission_submissionaward WHERE id = $id`, { id }))
  run(`UPDATE submission_submissionaward SET sort_order = $sort_order, modified = $ts WHERE id = $id`, {
    sort_order,
    ts: now(),
    id,
  })
  return c.json(itemManageOut(loadItem(id)))
})

router.delete("/manage/items/:item_id", (c) => {
  requireAdmin(c)
  const id = intParam(c, "item_id")
  orNotFound(get(`SELECT 1 FROM submission_submissionaward WHERE id = $id`, { id }))
  run(`DELETE FROM submission_submissionaward WHERE id = $id`, { id })
  return c.json({ message: "删除成功" })
})

// 把作品展条目切换到该学生该挑战的最新提交
router.put("/manage/items/:item_id/refresh", (c) => {
  requireAdmin(c)
  const id = intParam(c, "item_id")
  const item = orNotFound(
    get<{ user_id: number; task_id: number; submission_id: string; award_id: number }>(
      `SELECT s.user_id, s.task_id, sa.submission_id, sa.award_id
       FROM submission_submissionaward sa JOIN submission_submission s ON s.id = sa.submission_id
       WHERE sa.id = $id`,
      { id },
    ),
  )
  const latest = get<{ id: string }>(
    `SELECT id FROM submission_submission WHERE user_id = $user_id AND task_id = $task_id
     ORDER BY created DESC LIMIT 1`,
    { user_id: item.user_id, task_id: item.task_id },
  )
  const target = latest?.id ?? item.submission_id
  if (
    target !== item.submission_id &&
    get(`SELECT 1 FROM submission_submissionaward WHERE award_id = $a AND submission_id = $s`, {
      a: item.award_id,
      s: target,
    })
  ) {
    throw new HttpError(400, "最新提交已在该奖项中")
  }
  run(
    `UPDATE submission_submissionaward SET submission_id = $sid, is_stale = 0, modified = $ts WHERE id = $id`,
    { sid: target, ts: now(), id },
  )
  return c.json(itemManageOut(loadItem(id)))
})

// ── 作品详情 ──────────────────────────────────────────────────────────────────

function assertAwarded(submissionId: string) {
  if (
    !get(
      `SELECT 1 FROM submission_submissionaward sa JOIN submission_award a ON a.id = sa.award_id
       WHERE sa.submission_id = $id AND a.is_active = 1`,
      { id: submissionId },
    )
  ) {
    throw new HttpError(404, "作品不存在或未授奖")
  }
}

router.get("/:submission_id", (c) => {
  requireUser(c)
  const id = uuidParam(c, "submission_id")
  assertAwarded(id)
  const s = orNotFound(
    get(
      `SELECT s.id, u.username, t.title AS task_title, t.display AS task_display,
         s.score, s.view_count, s.html, s.css, s.js, ${HAS_CHAIN}
       FROM submission_submission s
       JOIN account_user u ON u.id = s.user_id
       JOIN task_task t ON t.id = s.task_id
       WHERE s.id = $id`,
      { id },
    ),
  )
  const awards = all<{ name: string }>(
    `SELECT a.name FROM submission_submissionaward sa JOIN submission_award a ON a.id = sa.award_id
     WHERE sa.submission_id = $id AND a.is_active = 1 ORDER BY sa.sort_order, sa.id`,
    { id },
  )
  return c.json({
    submission_id: uuidOut(s.id),
    username: s.username,
    task_title: s.task_title,
    task_display: s.task_display,
    score: s.score,
    view_count: s.view_count,
    html: s.html,
    css: s.css,
    js: s.js,
    awards: awards.map((a) => a.name),
    has_prompt_chain: bool(s.has_prompt_chain),
  })
})

router.get("/:submission_id/prompt-chain", (c) => {
  requireUser(c)
  const id = uuidParam(c, "submission_id")
  assertAwarded(id)
  orNotFound(get(`SELECT 1 FROM submission_submission WHERE id = $id`, { id }))
  const msg = get<MessageRow>(`SELECT * FROM prompt_message WHERE submission_id = $id`, { id })
  if (!msg) throw new HttpError(404, "该作品没有关联提示词链")
  return c.json(buildPromptRounds(msg))
})

export default router
