import { all, get, run, now, newUuidHex } from "../db"
import { Role, type User } from "../auth"

export interface MessageRow {
  id: number
  conversation_id: string
  role: string
  source: string
  content: string
  code_html: string | null
  code_css: string | null
  code_js: string | null
  created: string
  prompt_level: number | null
  submission_id: string | null
}

// 自由创作只有创作者本人（和超管）能对话，其他任务对所有登录用户开放
export function canAccessTask(user: User, taskId: number) {
  const row = get<{ owner_id: number }>(
    `SELECT owner_id FROM task_creation WHERE task_ptr_id = $id`,
    { id: taskId },
  )
  if (!row) return true
  return row.owner_id === user.id || user.role === Role.SUPER
}

// 当前用户在该任务下消息最多的那个对话
export function getActiveConversation(userId: number, taskId: number) {
  return get<{ id: string }>(
    `SELECT c.id FROM prompt_conversation c
     WHERE c.user_id = $user_id AND c.task_id = $task_id
     ORDER BY (SELECT COUNT(*) FROM prompt_message m WHERE m.conversation_id = c.id) DESC,
              c.created DESC
     LIMIT 1`,
    { user_id: userId, task_id: taskId },
  )?.id
}

export function createConversation(userId: number, taskId: number, isActive = true) {
  const id = newUuidHex()
  const ts = now()
  run(
    `INSERT INTO prompt_conversation (id, created, modified, is_active, task_id, user_id)
     VALUES ($id, $ts, $ts, $active, $task_id, $user_id)`,
    { id, ts, active: isActive, task_id: taskId, user_id: userId },
  )
  return id
}

export function getOrCreateActiveConversation(userId: number, taskId: number) {
  return getActiveConversation(userId, taskId) ?? createConversation(userId, taskId)
}

export function insertMessage(m: {
  conversation_id: string
  role: string
  content: string
  source?: string
  code_html?: string | null
  code_css?: string | null
  code_js?: string | null
  submission_id?: string | null
}): number {
  const res = run(
    `INSERT INTO prompt_message
       (conversation_id, role, source, content, code_html, code_css, code_js, created, submission_id)
     VALUES ($conversation_id, $role, $source, $content, $code_html, $code_css, $code_js, $created, $submission_id)`,
    {
      conversation_id: m.conversation_id,
      role: m.role,
      source: m.source ?? "conversation",
      content: m.content,
      code_html: m.code_html ?? null,
      code_css: m.code_css ?? null,
      code_js: m.code_js ?? null,
      created: now(),
      submission_id: m.submission_id ?? null,
    },
  )
  return Number(res.lastInsertRowid)
}

// 不是 AI 生成的版本（手改 / 粘贴外部 AI 的代码），AI 回复那一条的正文写成和 AI 输出一样的代码块，
// 后面接着和 AI 对话时，它在上下文里看到的就是这份代码
export const EDIT_PROMPT = "（手动修改了代码）"

export function codeAsMarkdown(code: {
  code_html: string | null
  code_css: string | null
  code_js: string | null
}) {
  const parts = [
    code.code_css ? `<style>\n${code.code_css}\n</style>` : "",
    code.code_html ?? "",
    code.code_js ? `<script>\n${code.code_js}\n</script>` : "",
  ].filter(Boolean)
  return "```html\n" + parts.join("\n\n") + "\n```"
}

export function getPrecedingUserMessage(asst: Pick<MessageRow, "id" | "conversation_id" | "created">) {
  return get<MessageRow>(
    `SELECT * FROM prompt_message
     WHERE conversation_id = $conv AND role = 'user'
       AND (created < $created OR (created = $created AND id < $id))
     ORDER BY created DESC, id DESC LIMIT 1`,
    { conv: asst.conversation_id, created: asst.created, id: asst.id },
  )
}

export function buildPromptRounds(source: MessageRow) {
  let messages = all<MessageRow>(
    `SELECT * FROM prompt_message WHERE conversation_id = $conv ORDER BY created, id`,
    { conv: source.conversation_id },
  )
  let idx = messages.findIndex((m) => m.id === source.id)
  if (idx < 0) idx = messages.length - 1
  messages = messages.slice(0, idx + 1)

  const rounds = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.role !== "user") continue
    let reply: MessageRow | undefined
    for (const r of messages.slice(i + 1)) {
      if (r.role === "user") break
      if (r.role === "assistant") {
        reply = r
        break
      }
    }
    rounds.push({
      question: msg.content,
      source: msg.source,
      prompt_level: msg.prompt_level,
      assistant_msg_id: reply?.id ?? null,
      html: reply?.code_html ?? null,
      css: reply?.code_css ?? null,
      js: reply?.code_js ?? null,
    })
  }
  return rounds
}
