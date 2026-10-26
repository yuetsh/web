import { Hono } from "hono"
import { z } from "zod"
import { all, get, tx, iso, uuidOut } from "../db"
import { Role, isStaff, requireUser } from "../auth"
import { HttpError, ValidationError, intParam, orNotFound, qs, query, uuidParam, type Env } from "../http"
import { deleteRound, hasRatingsOrAwards } from "../services/cascade"
import {
  classifyConversationMessages,
  classifyMessagesBatch,
  inBackground,
} from "../services/classifier"
import type { MessageRow } from "../services/prompt"

const router = new Hono<Env>()

router.get("/conversations", (c) => {
  const user = requireUser(c)
  const q = query(c, z.object({ task_id: qs.opt(qs.int), user_id: qs.opt(qs.int) }))
  const where: string[] = []
  const params: Record<string, unknown> = {}
  // 普通用户只能看自己的
  if (user.role === Role.NORMAL) {
    where.push("c.user_id = $user_id")
    params.user_id = user.id
  } else if (q.user_id) {
    where.push("c.user_id = $user_id")
    params.user_id = q.user_id
  }
  if (q.task_id) {
    where.push("c.task_id = $task_id")
    params.task_id = q.task_id
  }
  // 不带条件就是全站所有对话（每个还要数一遍消息），会卡住整个服务
  if (!where.length) {
    throw new ValidationError([{ loc: ["query", "task_id"], msg: "需要 task_id 或 user_id" }])
  }
  const rows = all(
    `SELECT c.id, c.user_id, u.username, c.task_id, t.title AS task_title, c.is_active, c.created,
       (SELECT COUNT(*) FROM prompt_message m WHERE m.conversation_id = c.id) AS message_count
     FROM prompt_conversation c
     JOIN account_user u ON u.id = c.user_id
     JOIN task_task t ON t.id = c.task_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY message_count DESC, c.created DESC`,
    params,
  )
  return c.json(
    rows.map((r) => ({
      id: uuidOut(r.id),
      user_id: r.user_id,
      username: r.username,
      task_id: r.task_id,
      task_title: r.task_title,
      is_active: !!r.is_active,
      message_count: r.message_count,
      created: iso(r.created),
    })),
  )
})

router.get("/conversations/:conversation_id/messages", (c) => {
  const user = requireUser(c)
  const id = uuidParam(c, "conversation_id")
  const conv = orNotFound(
    get<{ user_id: number }>(`SELECT user_id FROM prompt_conversation WHERE id = $id`, { id }),
  )
  if (user.role === Role.NORMAL && conv.user_id !== user.id) return c.json([])
  const messages = all<MessageRow>(
    `SELECT * FROM prompt_message WHERE conversation_id = $id ORDER BY created, id`,
    { id },
  )
  return c.json(
    messages.map((m) => ({
      id: m.id,
      role: m.role,
      source: m.source,
      content: m.content,
      code_html: m.code_html,
      code_css: m.code_css,
      code_js: m.code_js,
      prompt_level: m.prompt_level,
      created: iso(m.created),
    })),
  )
})

// 当前用户在某任务下的历史对话轮次：用户提示词 + 紧随其后的 assistant 消息中的页面代码
router.get("/history/:task_id", (c) => {
  const user = requireUser(c)
  const taskId = intParam(c, "task_id")
  const messages = all<MessageRow>(
    `SELECT m.* FROM prompt_message m JOIN prompt_conversation c ON c.id = m.conversation_id
     WHERE c.user_id = $user_id AND c.task_id = $task_id
     ORDER BY m.conversation_id, m.created, m.id`,
    { user_id: user.id, task_id: taskId },
  )
  const byConv = Map.groupBy(messages, (m) => m.conversation_id)

  const items: { key: [string, number]; item: object }[] = []
  for (const msgs of byConv.values()) {
    msgs.forEach((userMsg, idx) => {
      if (userMsg.role !== "user") return
      let asst: MessageRow | undefined
      for (const reply of msgs.slice(idx + 1)) {
        if (reply.role === "user") break
        if (reply.role === "assistant") {
          asst = reply
          break
        }
      }
      if (!asst) return
      items.push({
        key: [userMsg.created, userMsg.id],
        item: {
          user_message_id: userMsg.id,
          assistant_message_id: asst.id,
          submission_id: uuidOut(asst.submission_id),
          source: userMsg.source,
          prompt: userMsg.content,
          prompt_level: userMsg.prompt_level,
          code_html: asst.code_html,
          code_css: asst.code_css,
          code_js: asst.code_js,
          created: iso(userMsg.created),
        },
      })
    })
  }
  items.sort((a, b) =>
    a.key[0] < b.key[0] ? -1 : a.key[0] > b.key[0] ? 1 : a.key[1] - b.key[1],
  )
  return c.json(items.map((i) => i.item))
})

// 对一个对话里的用户消息做层级分类（管理员，后台执行）
router.post("/conversations/:conversation_id/classify", (c) => {
  const user = requireUser(c)
  if (!isStaff(user)) throw new HttpError(403, "没有权限")
  const id = uuidParam(c, "conversation_id")
  const { force } = query(c, z.object({ force: qs.opt(qs.bool).default(false) }))
  orNotFound(get(`SELECT 1 FROM prompt_conversation WHERE id = $id`, { id }))
  inBackground(classifyConversationMessages(id, force))
  return c.json({ message: "开始分类" })
})

// 批量分类所有（或指定任务）对话的用户消息（管理员，后台执行）
router.post("/classify-batch", (c) => {
  const user = requireUser(c)
  if (!isStaff(user)) throw new HttpError(403, "没有权限")
  const q = query(
    c,
    z.object({ task_id: qs.opt(qs.int), force: qs.opt(qs.bool).default(false) }),
  )
  const where = ["m.role = 'user'"]
  const params: Record<string, unknown> = {}
  if (q.task_id) {
    where.push("c.task_id = $task_id")
    params.task_id = q.task_id
  }
  if (!q.force) where.push("m.prompt_level IS NULL")
  const ids = all<{ id: number }>(
    `SELECT m.id FROM prompt_message m JOIN prompt_conversation c ON c.id = m.conversation_id
     WHERE ${where.join(" AND ")} ORDER BY m.created, m.id`,
    params,
  ).map((r) => r.id)
  inBackground(classifyMessagesBatch(ids))
  return c.json({ message: `开始分类 ${ids.length} 条消息`, count: ids.length })
})

// 删除一轮对话（assistant 消息 + 它前面的用户消息）以及关联的提交，只能删自己的
router.delete("/messages/:message_id/pair", (c) => {
  const user = requireUser(c)
  const asst = orNotFound(
    get<MessageRow & { owner_id: number }>(
      `SELECT m.*, c.user_id AS owner_id FROM prompt_message m
       JOIN prompt_conversation c ON c.id = m.conversation_id
       WHERE m.id = $id AND m.role = 'assistant'`,
      { id: intParam(c, "message_id") },
    ),
  )
  if (asst.owner_id !== user.id && user.role !== Role.SUPER) {
    throw new HttpError(403, "只能删除自己的消息")
  }
  if (asst.submission_id && user.role !== Role.SUPER && hasRatingsOrAwards(asst.submission_id)) {
    throw new HttpError(400, "该消息关联的提交已被评分或获奖，无法删除")
  }
  tx(() => deleteRound(asst))
  return c.json({ deleted: true, submission_deleted: !!asst.submission_id })
})

export default router
