import { Hono } from "hono"
import { z } from "zod"
import { all, get, run, tx, now, likeEscape, newId, uuid } from "../db"
import { Role, isStaff, requireSuper, requireUser, type User } from "../auth"
import {
  HttpError,
  ValidationError,
  body,
  intParam,
  notFound,
  orNotFound,
  pageQuery,
  pageWindow,
  qs,
  query,
  type Env,
  uuidParam,
} from "../http"
import { deleteRound, hasRatingsOrAwards } from "../services/cascade"
import { updateSubmissionScore } from "../services/score"
import { classifyMessage, inBackground } from "../services/classifier"
import { buildGradebook, gradebookCsvRows, toCsv } from "../services/gradebook"
import {
  buildPromptRounds,
  createConversation,
  getActiveConversation,
  getPrecedingUserMessage,
  insertMessage,
  promptChainStats,
  type MessageRow,
} from "../services/prompt"
import { pyRound } from "../services/pyround"
import showcase from "./showcase"
import review from "./review"

const router = new Hono<Env>()

router.route("/showcase", showcase)
router.route("/review", review)

const inShowcase = (id: string) => !!get(`SELECT 1 FROM award_items WHERE submission_id = $id`, { id })

// 学生能看的提交：自己的、进了作品展的、自己也交过的那道题上同学（任何班）的。老师都能看
function canView(user: User, sub: { id: string; user_id: number; task_id: number }) {
  if (isStaff(user) || sub.user_id === user.id) return true
  if (inShowcase(sub.id)) return true
  return !!get(
    `SELECT 1 FROM submissions WHERE user_id = $me AND task_id = $task_id LIMIT 1`,
    { me: user.id, task_id: sub.task_id },
  )
}

function requireView(user: User, id: string) {
  const sub = orNotFound(
    get<{ id: string; user_id: number; task_id: number }>(
      `SELECT id, user_id, task_id FROM submissions WHERE id = $id`,
      { id },
    ),
  )
  if (!canView(user, sub)) throw new HttpError(403, "交过这道题以后才能看同学的作品")
}

// 当天（UTC 零点起）的评分次数，与原实现保持一致
function todayRatingCount(userId: number) {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start.getTime() + 86_400_000)
  return get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ratings
     WHERE user_id = $id AND created >= $start AND created < $end`,
    { id: userId, start: start.toISOString(), end: end.toISOString() },
  )!.n
}

const SUBMISSION_SELECT = `SELECT s.id, s.user_id, u.username, s.task_id, t.display AS task_display,
    t.title AS task_title, t.task_type, s.score, code.html, code.css, code.js, s.flag, s.zone,
    s.view_count, s.created, s.modified,
    (SELECT r.score FROM ratings r WHERE r.user_id = $me AND r.submission_id = s.id) AS my_score`

// +s.task_id：不让 SQLite 先遍历所有任务、再按 submissions_task_user 索引逐条回表
// （按 zone 等非索引列筛选时要几百毫秒），而是直接扫 submissions（表里没有代码，扫一遍很快）。
// WHERE 里的 s.task_id = 不受影响，照样走索引
const SUBMISSION_FROM = `FROM submissions s
  JOIN users u ON u.id = s.user_id
  JOIN tasks t ON t.id = +s.task_id`

// 代码在另一张表，只在读这一页的完整内容时才连上
const WITH_CODE = `LEFT JOIN submission_code code ON code.submission_id = s.id`

function submissionOut(s: any) {
  return {
    id: s.id,
    userid: s.user_id,
    username: s.username,
    task_id: s.task_id,
    task_display: s.task_display,
    task_title: s.task_title,
    task_type: s.task_type,
    score: s.score,
    my_score: s.my_score || 0,
    html: s.html,
    css: s.css,
    js: s.js,
    flag: s.flag,
    zone: s.zone,
    submit_count: s.submit_count || 0,
    view_count: s.view_count,
    created: s.created,
    modified: s.modified,
  }
}

// ── 创建提交 ──────────────────────────────────────────────────────────────────

router.post("/", async (c) => {
  const user = requireUser(c)
  const p = await body(
    c,
    z.object({
      task_id: z.number().int(),
      html: z.string().nullable().optional(),
      css: z.string().nullable().optional(),
      js: z.string().nullable().optional(),
      prompt: z.string().nullable().optional(),
      message_id: z.number().int().nullable().optional(), // 关联的 assistant message
      reflection: z.string().max(1000).nullable().optional(), // 交的时候写的一句反思，可以不写
    }),
  )
  const task = orNotFound(
    get<{ id: number; task_type: string }>(`SELECT id, task_type FROM tasks WHERE id = $id`, {
      id: p.task_id,
    }),
  )
  if (task.task_type === "creation") throw new HttpError(400, "自由创作不需要提交")
  if (task.task_type === "game") throw new HttpError(400, "游戏用发布，不用提交")

  const code = { html: p.html ?? null, css: p.css ?? null, js: p.js ?? null }

  const reflection = p.reflection?.trim() || null

  const { submissionId, newUserMsgId } = tx(() => {
    let manualAsstMsgId: number | null = null
    let linkedMsg: MessageRow | null = null
    let newUserMsgId: number | null = null

    if (p.prompt) {
      const convId =
        getActiveConversation(user.id, task.id) ?? createConversation(user.id, task.id, false)
      newUserMsgId = insertMessage({
        conversation_id: convId,
        role: "user",
        content: p.prompt,
        source: "manual",
      })
      manualAsstMsgId = insertMessage({
        conversation_id: convId,
        role: "assistant",
        content: "",
        code_html: code.html,
        code_css: code.css,
        code_js: code.js,
        source: "manual",
      })
    } else if (p.message_id) {
      linkedMsg = get<MessageRow>(
        `SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE m.id = $id AND m.role = 'assistant' AND c.user_id = $user_id AND c.task_id = $task_id`,
        { id: p.message_id, user_id: user.id, task_id: task.id },
      )
      if (!linkedMsg) {
        console.warn(
          `create_submission: message_id ${p.message_id} not found for user ${user.id} task ${task.id}`,
        )
      } else {
        newUserMsgId = getPrecedingUserMessage(linkedMsg)?.id ?? null
      }
    }

    // 同一条 AI 消息重复提交时更新原来的提交，而不是再建一条
    if (linkedMsg?.submission_id) {
      run(
        `UPDATE submission_code SET html = $html, css = $css, js = $js WHERE submission_id = $id`,
        { ...code, id: linkedMsg.submission_id },
      )
      return { submissionId: linkedMsg.submission_id, newUserMsgId }
    }

    const id = newId()
    const ts = now()
    run(
      `INSERT INTO submissions (id, user_id, task_id, created, modified) VALUES ($id, $user_id, $task_id, $ts, $ts)`,
      { id, ts, task_id: task.id, user_id: user.id },
    )
    run(`INSERT INTO submission_code (submission_id, html, css, js) VALUES ($id, $html, $css, $js)`, {
      id,
      ...code,
    })
    const msgToLink = manualAsstMsgId ?? linkedMsg?.id
    if (msgToLink) {
      run(`UPDATE messages SET submission_id = $sid WHERE id = $mid`, {
        sid: id,
        mid: msgToLink,
      })
    }
    // 该学生该任务之前进入作品展的提交标记为“有更新”
    run(
      `UPDATE award_items SET is_stale = 1
       WHERE is_stale = 0 AND submission_id != $id AND submission_id IN
         (SELECT id FROM submissions WHERE user_id = $user_id AND task_id = $task_id)`,
      { id, user_id: user.id, task_id: task.id },
    )
    return { submissionId: id, newUserMsgId }
  })

  // 同一版再交时没写就留着上次写的
  if (reflection) {
    run(
      `INSERT INTO reflections (submission_id, content, modified) VALUES ($id, $content, $ts)
       ON CONFLICT (submission_id) DO UPDATE SET content = excluded.content, modified = excluded.modified`,
      { id: submissionId, content: reflection, ts: now() },
    )
  }

  // 只对新增的提示词做层级分类
  if (
    newUserMsgId !== null &&
    !get(`SELECT 1 FROM messages WHERE id = $id AND prompt_level IS NOT NULL`, {
      id: newUserMsgId,
    })
  ) {
    inBackground(classifyMessage(newUserMsgId))
  }

  return c.json({ id: submissionId })
})

// ── 列表 ──────────────────────────────────────────────────────────────────────

const listQuery = pageQuery.extend({
  task_id: qs.opt(qs.int),
  task_type: qs.opt(z.enum(["tutorial", "challenge"])),
  username: qs.opt(z.string()),
  user_id: qs.opt(qs.int),
  flag: qs.opt(z.enum(["red", "blue", "green", "yellow", "any"])),
  zone: qs.opt(z.enum(["featured", "low", "pending"])),
  score_min: qs.opt(qs.num),
  score_max_exclusive: qs.opt(qs.num),
  score_lt_threshold: qs.opt(qs.num),
  ordering: qs.opt(z.string()),
  grouped: qs.opt(qs.bool).default(true),
})

router.get("/", (c) => {
  const user = requireUser(c)
  const f = query(c, listQuery)
  const where: string[] = []
  const params: Record<string, unknown> = {}

  if (f.task_id) {
    orNotFound(get(`SELECT 1 FROM tasks WHERE id = $id`, { id: f.task_id }))
    where.push("s.task_id = $task_id")
    params.task_id = f.task_id
  } else if (f.task_type) {
    where.push("t.task_type = $task_type")
    params.task_type = f.task_type
  }
  // 学生只能看自己的提交（同学的作品走 /review/peers）
  if (user.role === Role.NORMAL) {
    where.push("s.user_id = $user_id")
    params.user_id = user.id
  } else {
    if (f.username) {
      where.push(`u.username LIKE $username ESCAPE '\\'`)
      params.username = likeEscape(f.username)
    }
    if (f.user_id) {
      where.push("s.user_id = $user_id")
      params.user_id = f.user_id
    }
  }
  if (f.flag === "any") where.push("s.flag IS NOT NULL")
  else if (f.flag) {
    where.push("s.flag = $flag")
    params.flag = f.flag
  }
  if (f.zone) {
    where.push("s.zone = $zone")
    params.zone = f.zone
  }
  if (f.score_lt_threshold !== undefined) {
    where.push("s.score < $score_lt")
    params.score_lt = f.score_lt_threshold
  } else {
    if (f.score_min !== undefined) {
      where.push("s.score >= $score_min")
      params.score_min = f.score_min
    }
    if (f.score_max_exclusive !== undefined) {
      where.push("s.score < $score_max")
      params.score_max = f.score_max_exclusive
    }
  }
  if (f.grouped) {
    // 分组模式：每个 (user, task) 只保留最新一条
    // 比 rowid 而不是 id：子查询只走 submissions_user_task 索引，不用回表
    where.push(`s.rowid = (SELECT s3.rowid FROM submissions s3
      WHERE s3.user_id = s.user_id AND s3.task_id = s.task_id ORDER BY s3.created DESC LIMIT 1)`)
  }

  const orderings: Record<string, string> = {
    "-score": "s.score DESC",
    score: "s.score ASC",
    "-created": "s.created DESC",
  }
  // 同分、同一时间的提交很多，加上 rowid 让排序唯一，翻页才不会重复或漏掉
  const orderBy = `${orderings[f.ordering ?? ""] ?? "s.created DESC"}, s.rowid DESC`
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const { limit, offset } = pageWindow(f)

  // 先排序分页拿到这一页的 rowid，再读这几行的代码和子查询；
  // 否则 SQLite 会先为每一条符合条件的提交算好所有输出列（包括读代码）再排序
  const items = all(
    `${SUBMISSION_SELECT},
       (SELECT COUNT(*) FROM submissions s2
        WHERE s2.user_id = s.user_id AND s2.task_id = s.task_id) AS submit_count
     ${SUBMISSION_FROM} ${WITH_CODE}
     WHERE s.rowid IN (SELECT s.rowid ${SUBMISSION_FROM} ${whereSql}
                       ORDER BY ${orderBy} LIMIT $limit OFFSET $offset)
     ORDER BY ${orderBy}`,
    { ...params, me: user.id, limit, offset },
  )
  const count = get<{ n: number }>(`SELECT COUNT(*) AS n ${SUBMISSION_FROM} ${whereSql}`, params)!.n
  return c.json({ items: items.map(submissionOut), count })
})

router.get("/by-user-task", (c) => {
  const me = requireUser(c)
  const q = query(c, z.object({ user_id: qs.int, task_id: qs.int }))
  if (me.role === Role.NORMAL && q.user_id !== me.id) throw new HttpError(403, "没有权限")
  const rows = all(
    `${SUBMISSION_SELECT} ${SUBMISSION_FROM} ${WITH_CODE}
     WHERE s.user_id = $user_id AND s.task_id = $task_id ORDER BY s.created DESC`,
    { me: me.id, user_id: q.user_id, task_id: q.task_id },
  )
  return c.json(rows.map(submissionOut))
})

// 随机返回一个待打分的其他同学的提交（AI 生成期间的随手打分弹窗）
router.get("/random-for-rating", (c) => {
  const user = requireUser(c)
  const q = query(c, z.object({ exclude_id: qs.opt(z.string()) }))
  let excludeId: string | null = null
  if (q.exclude_id) {
    excludeId = uuid(q.exclude_id)
    if (!excludeId) throw new ValidationError([{ loc: ["query", "exclude_id"], msg: "需要 UUID" }])
  }
  if (user.role === Role.NORMAL && todayRatingCount(user.id) >= 30) return c.json(null)

  // 学生只抽自己也交过的题（和同学作品一样，没交过的题不能看别人的答案）
  const cond = `s.user_id != $me
      ${user.role === Role.NORMAL ? "AND s.task_id IN (SELECT task_id FROM submissions WHERE user_id = $me)" : ""}
      AND NOT EXISTS (SELECT 1 FROM ratings r WHERE r.submission_id = s.id AND r.user_id = $me)
      ${excludeId ? "AND s.id != $exclude" : ""}`
  const params = { me: user.id, ...(excludeId ? { exclude: excludeId } : {}) }
  const fewRatings = `(SELECT COUNT(*) FROM ratings r WHERE r.submission_id = s.id) < 5`
  // 每个学生生成代码时都会调这个接口，ORDER BY RANDOM() 要把所有提交过一遍（6 万条约 50ms，期间整个服务都卡住）。
  // 先随机抽几十个 rowid 试试，抽到评分少于 5 个的就用；抽不中再退回全表随机
  const maxRowid = get<{ m: number | null }>(`SELECT MAX(rowid) AS m FROM submissions`)!.m ?? 0
  let picked: { rid: number } | null = null
  for (let round = 0; round < 3 && maxRowid && !picked; round++) {
    const sample = Array.from({ length: 64 }, () => 1 + Math.floor(Math.random() * maxRowid))
    // 抽样作为参数传入（SQL 文本固定，db.query 按文本缓存语句，拼进 SQL 会让缓存越来越大）
    picked = get<{ rid: number }>(
      `SELECT s.rowid AS rid FROM submissions s
       WHERE s.rowid IN (SELECT value FROM json_each($sample)) AND ${cond} AND ${fewRatings}
       ORDER BY RANDOM() LIMIT 1`,
      { ...params, sample: JSON.stringify(sample) },
    )
  }
  const base = `SELECT s.rowid AS rid FROM submissions s WHERE ${cond}`
  picked ??=
    get<{ rid: number }>(`${base} AND ${fewRatings} ORDER BY RANDOM() LIMIT 1`, params) ??
    get<{ rid: number }>(`${base} ORDER BY RANDOM() LIMIT 1`, params)
  if (!picked) return c.json(null)
  const pick = get(
    `SELECT s.id, t.title AS task_title, t.display AS task_display,
       t.task_type, code.html, code.css, code.js
     ${SUBMISSION_FROM} ${WITH_CODE} WHERE s.rowid = $rid`,
    { rid: picked.rid },
  )!
  // 打分前不告诉作者是谁（打完分 PUT /:id/score 会返回）
  return c.json({
    submission_id: pick.id,
    task_title: pick.task_title,
    task_display: pick.task_display,
    task_type: pick.task_type,
    html: pick.html,
    css: pick.css,
    js: pick.js,
  })
})

// ── 统计 ──────────────────────────────────────────────────────────────────────

router.get("/stats/:task_id", (c) => {
  const user = requireUser(c)
  if (!isStaff(user)) throw new HttpError(403, "没有权限")
  const taskId = intParam(c, "task_id")
  const { classname } = query(c, z.object({ classname: qs.opt(z.string()) }))
  orNotFound(get(`SELECT 1 FROM tasks WHERE id = $id`, { id: taskId }))

  const classes = all<{ classname: string }>(
    `SELECT DISTINCT classname FROM users
     WHERE role = 'normal' AND classname != '' ORDER BY classname`,
  ).map((r) => r.classname)

  // 学生范围：普通用户，可按班级过滤
  const students = all<{ id: number; username: string; classname: string }>(
    `SELECT id, username, classname FROM users
     WHERE role = 'normal' ${classname ? "AND classname = $classname" : ""}
     ORDER BY classname, username`,
    classname ? { classname } : {},
  )
  const studentIds = new Set(students.map((s) => s.id))

  const subs = all<{ id: string; user_id: number; created: string; score: number; flag: string | null }>(
    `SELECT id, user_id, created, score, flag FROM submissions WHERE task_id = $id`,
    { id: taskId },
  )
  const studentSubs = subs.filter((s) => studentIds.has(s.user_id))

  const submittedIds = new Set(studentSubs.map((s) => s.user_id))
  const latest = new Map<number, (typeof subs)[number]>()
  const subCount = new Map<number, number>()
  for (const s of studentSubs) {
    const cur = latest.get(s.user_id)
    if (!cur || s.created > cur.created) latest.set(s.user_id, s)
    subCount.set(s.user_id, (subCount.get(s.user_id) ?? 0) + 1)
  }

  // 平均分：每人最新一次提交中分数 > 0 的
  const scored = [...latest.values()].filter((s) => s.score > 0)
  const averageScore = scored.length
    ? pyRound(scored.reduce((a, s) => a + s.score, 0) / scored.length, 2)
    : null

  // 未评分：提交过但该任务下所有提交都没人打分
  const ratedIds = new Set(
    all<{ user_id: number }>(
      `SELECT DISTINCT s.user_id FROM ratings r
       JOIN submissions s ON s.id = r.submission_id WHERE s.task_id = $id`,
      { id: taskId },
    ).map((r) => r.user_id),
  )

  const tag = (s: { username: string; classname: string }) => ({
    username: s.username,
    classname: s.classname,
  })
  const dist = { count_1: 0, count_2: 0, count_3: 0, count_4_plus: 0 }
  for (const n of subCount.values()) {
    if (n === 1) dist.count_1++
    else if (n === 2) dist.count_2++
    else if (n === 3) dist.count_3++
    else dist.count_4_plus++
  }

  // 高分作品：每人分数最高的一份（同分取较早的），取前五
  const best = new Map<number, (typeof subs)[number]>()
  for (const s of studentSubs) {
    const cur = best.get(s.user_id)
    if (s.score > 0 && (!cur || s.score > cur.score || (s.score === cur.score && s.created < cur.created)))
      best.set(s.user_id, s)
  }
  const studentById = new Map(students.map((s) => [s.id, s]))
  const topScored = [...best.values()]
    .sort((a, b) => b.score - a.score || (a.created < b.created ? -1 : 1))
    .slice(0, 5)
    .map((s) => ({ ...tag(studentById.get(s.user_id)!), score: s.score, submission_id: s.id }))

  const unrated = students.filter((s) => submittedIds.has(s.id) && !ratedIds.has(s.id))
  return c.json({
    submitted_count: submittedIds.size,
    unsubmitted_count: students.length - submittedIds.size,
    average_score: averageScore,
    unrated_count: unrated.length,
    unsubmitted_users: students.filter((s) => !submittedIds.has(s.id)).map(tag),
    unrated_users: unrated.map(tag),
    submission_count_distribution: dist,
    present_count: studentSubs.filter((s) => s.flag === "present").length,
    classes,
    top_scored: topScored,
    // 每人最新一版是怎么问出来的
    prompts: promptChainStats([...latest.values()].map((s) => s.id)),
  })
})

// ── 成绩册 ────────────────────────────────────────────────────────────────────

const gradebookQuery = z.object({
  classname: z.string().default(""),
  task_type: qs.opt(z.enum(["tutorial", "challenge"])),
  username: qs.opt(z.string()),
  include_all_tasks: qs.opt(qs.bool).default(false),
})

router.get("/gradebook", (c) => {
  requireSuper(c)
  return c.json(buildGradebook(query(c, gradebookQuery)))
})

router.get("/gradebook/export", (c) => {
  requireSuper(c)
  const gb = buildGradebook(query(c, gradebookQuery))
  const filename = encodeURIComponent(`gradebook-${gb.classname}.csv`)
  return c.body("﻿" + toCsv(gradebookCsvRows(gb)), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
  })
})

// ── 单个提交 ──────────────────────────────────────────────────────────────────

router.delete("/:id", (c) => {
  const user = requireUser(c)
  const id = uuidParam(c, "id")
  const sub = orNotFound(
    get<{ user_id: number }>(`SELECT user_id FROM submissions WHERE id = $id`, { id }),
  )
  if (sub.user_id !== user.id && user.role !== Role.SUPER) {
    throw new HttpError(403, "只能删除自己的提交")
  }
  if (user.role !== Role.SUPER && hasRatingsOrAwards(id)) {
    throw new HttpError(400, "该提交已被评分或获奖，无法删除")
  }
  // 有关联的 AI 回复时，回复和它前面的提问一起删掉
  const asst = get<MessageRow>(`SELECT * FROM messages WHERE submission_id = $id`, { id })
  if (asst) deleteRound(asst)
  else run(`DELETE FROM submissions WHERE id = $id`, { id })
  return c.json({ message: "删除成功" })
})

router.get("/:id/prompt-chain", (c) => {
  const user = requireUser(c)
  const id = uuidParam(c, "id")
  requireView(user, id)
  const msg = get<MessageRow>(`SELECT * FROM messages WHERE submission_id = $id`, { id })
  if (!msg) throw new HttpError(404, "该提交没有关联提示词链")
  return c.json(buildPromptRounds(msg))
})

router.get("/:id", (c) => {
  const user = requireUser(c)
  const id = uuidParam(c, "id")
  requireView(user, id)
  const s = orNotFound(
    get(`${SUBMISSION_SELECT} ${SUBMISSION_FROM} ${WITH_CODE} WHERE s.id = $id`, { me: user.id, id }),
  )
  // 反思只给老师和作者本人看
  const reflection =
    isStaff(user) || s.user_id === user.id
      ? (get<{ content: string }>(`SELECT content FROM reflections WHERE submission_id = $id`, { id })
          ?.content ?? null)
      : null
  const out = { ...submissionOut(s), reflection }
  // 和同学作品一样：学生给同学打分之前不告诉作者和得分（作品展里的本来就署名）
  if (!isStaff(user) && s.user_id !== user.id && !out.my_score && !inShowcase(id)) {
    return c.json({ ...out, userid: null, username: null, score: null })
  }
  return c.json(out)
})

// 增加浏览次数（仅在全屏预览时调用）
router.post("/:id/view", (c) => {
  requireUser(c)
  const id = uuidParam(c, "id")
  const res = run(`UPDATE submissions SET view_count = view_count + 1 WHERE id = $id`, { id })
  if (!res.changes) notFound("提交不存在")
  return c.json({ ok: true })
})

router.put("/:id/score", async (c) => {
  const user = requireUser(c)
  const id = uuidParam(c, "id")
  const { score } = await body(c, z.object({ score: z.number().int().max(5) }))
  if (score <= 0) throw new HttpError(400, "分数不能为零")
  requireView(user, id)
  const sub = orNotFound(
    get<{ user_id: number; username: string }>(
      `SELECT s.user_id, u.username FROM submissions s
       JOIN users u ON u.id = s.user_id WHERE s.id = $id`,
      { id },
    ),
  )
  if (sub.user_id === user.id) throw new HttpError(400, "不能给自己的提交打分")

  const exists = get(`SELECT 1 FROM ratings WHERE user_id = $user_id AND submission_id = $id`, {
    user_id: user.id,
    id,
  })
  if (exists) return c.json({ message: "你已经给这个提交打过分了" })
  if (user.role === Role.NORMAL && todayRatingCount(user.id) >= 30) {
    throw new HttpError(400, "普通用户每天最多只能评分30次。")
  }
  tx(() => {
    run(
      `INSERT INTO ratings (submission_id, user_id, score, created) VALUES ($id, $user_id, $score, $ts)`,
      { score, ts: now(), id, user_id: user.id },
    )
    updateSubmissionScore(id)
  })
  // 互评时打分前是匿名的，打完分再告诉作者是谁
  return c.json({ message: "打分成功", username: sub.username })
})

router.put("/:id/flag", async (c) => {
  const user = requireUser(c)
  if (!isStaff(user)) throw new HttpError(403, "没有权限")
  const id = uuidParam(c, "id")
  const { flag } = await body(
    c,
    z.object({
      flag: z.enum(["present", "red", "blue", "green", "yellow"]).nullable().default(null),
    }),
  )
  orNotFound(get(`SELECT 1 FROM submissions WHERE id = $id`, { id }))
  run(`UPDATE submissions SET flag = $flag WHERE id = $id`, { flag, id })
  return c.json({ flag })
})

export default router
