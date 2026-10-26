import type { Server, ServerWebSocket, WebSocketHandler } from "bun"
import { all, get, run, iso, uuidOut } from "./db"
import { userFromAccessToken, type User } from "./auth"
import { canAccessTask, getOrCreateActiveConversation, insertMessage } from "./services/prompt"
import {
  extractCode,
  parseGuidanceResponse,
  streamChat,
  streamGuidance,
  userFacingError,
  type ChatMessage,
} from "./services/llm"

type Kind = "prompt" | "guidance"

export interface WsData {
  kind: Kind
  user: User
  taskId: number
  conversationId: string
  // 正在等待 AI 回复的用户消息；对话中断时删掉，避免留下没有回复的提问
  pendingUserMessageId: number | null
  abort: AbortController
  closed: boolean
  // 正在处理一条消息（等 AI 回复）；期间再发来的直接拒绝，不排队，免得一次塞几百条刷模型费用
  busy: boolean
  // 引导对话只在本次连接内保留上下文
  guidanceHistory: ChatMessage[]
}

type WS = ServerWebSocket<WsData>

const PATH_RE = /^\/ws\/(prompt|guidance)\/(\d+)\/?$/

// 处理 WebSocket 升级请求；返回 undefined 表示已升级，返回 Response 表示拒绝或不是 ws 路径
// 浏览器建 WebSocket 时不能加请求头，access token 放在 ?token= 里
export async function upgrade(
  req: Request,
  server: Server<WsData>,
): Promise<Response | undefined | null> {
  const url = new URL(req.url)
  const match = PATH_RE.exec(url.pathname)
  if (!match) return null
  const user = await userFromAccessToken(url.searchParams.get("token"))
  if (!user) return new Response("Unauthorized", { status: 401 })
  const taskId = Number(match[2])
  if (!get(`SELECT 1 FROM task_task WHERE id = $id`, { id: taskId })) {
    return new Response("Not Found", { status: 404 })
  }
  if (!canAccessTask(user, taskId)) return new Response("Forbidden", { status: 403 })

  const ok = server.upgrade(req, {
    data: {
      kind: match[1] as Kind,
      user,
      taskId,
      conversationId: "",
      pendingUserMessageId: null,
      abort: new AbortController(),
      closed: false,
      busy: false,
      guidanceHistory: [],
    },
  })
  return ok ? undefined : new Response("Upgrade failed", { status: 400 })
}

function send(ws: WS, data: unknown) {
  if (!ws.data.closed) ws.send(JSON.stringify(data))
}

function dropPendingUserMessage(ws: WS) {
  if (ws.data.pendingUserMessageId !== null) {
    run(`DELETE FROM prompt_message WHERE id = $id`, { id: ws.data.pendingUserMessageId })
    ws.data.pendingUserMessageId = null
  }
}

function conversationHistory(conversationId: string) {
  return all<{
    id: number
    role: string
    content: string
    code_html: string | null
    code_css: string | null
    code_js: string | null
    submission_id: string | null
    created: string
  }>(
    `SELECT id, role, content, code_html, code_css, code_js, submission_id, created
     FROM prompt_message WHERE conversation_id = $id AND source = 'conversation'
     ORDER BY created, id`,
    { id: conversationId },
  )
}

async function streamToClient(ws: WS, chunks: AsyncIterable<string>) {
  let full = ""
  for await (const chunk of chunks) {
    full += chunk
    send(ws, { type: "stream", content: chunk })
  }
  return full
}

async function handlePrompt(ws: WS, data: any) {
  if ((data.type ?? "message") === "new_conversation") return
  const prompt = String(data.content ?? "").trim()
  const model = String(data.model ?? "")
  if (!prompt) return

  ws.data.pendingUserMessageId = insertMessage({
    conversation_id: ws.data.conversationId,
    role: "user",
    content: prompt,
  })
  try {
    const history: ChatMessage[] = conversationHistory(ws.data.conversationId).map((m) => ({
      role: m.role as ChatMessage["role"],
      content: m.content,
    }))
    let full: string
    try {
      full = await streamToClient(ws, streamChat(history, model, ws.data.abort.signal))
    } catch (e) {
      // 客户端自己断开导致的中止不算出错
      if (!ws.data.closed) send(ws, { type: "error", content: userFacingError(e) })
      return
    }
    if (ws.data.closed) return

    const code = extractCode(full)
    const messageId = insertMessage({
      conversation_id: ws.data.conversationId,
      role: "assistant",
      content: full,
      code_html: code.html,
      code_css: code.css,
      code_js: code.js,
    })
    ws.data.pendingUserMessageId = null
    send(ws, { type: "complete", code, message_id: messageId })
  } finally {
    dropPendingUserMessage(ws)
  }
}

async function handleGuidance(ws: WS, data: any) {
  const prompt = String(data.content ?? "").trim()
  if (!prompt) return

  ws.data.pendingUserMessageId = insertMessage({
    conversation_id: ws.data.conversationId,
    role: "user",
    content: prompt,
    source: "guidance",
  })
  ws.data.guidanceHistory.push({ role: "user", content: prompt })
  try {
    let full: string
    try {
      full = await streamToClient(ws, streamGuidance(ws.data.guidanceHistory, ws.data.abort.signal))
    } catch (e) {
      // 这条提问没有回复，留在上下文里会出现连续两条用户消息
      ws.data.guidanceHistory.pop()
      // 客户端自己断开导致的中止不算出错
      if (!ws.data.closed) send(ws, { type: "error", content: userFacingError(e) })
      return
    }
    if (ws.data.closed) return

    const [clean, isReady] = parseGuidanceResponse(full)
    ws.data.guidanceHistory.push({ role: "assistant", content: clean })
    const messageId = insertMessage({
      conversation_id: ws.data.conversationId,
      role: "assistant",
      content: clean,
      source: "guidance",
    })
    ws.data.pendingUserMessageId = null
    send(ws, { type: "complete", message_id: messageId, is_ready: isReady })
  } finally {
    dropPendingUserMessage(ws)
  }
}

export const websocket: WebSocketHandler<WsData> = {
  // AI 生成可能要一两分钟，期间没有客户端消息
  idleTimeout: 960,
  sendPings: true,
  // 提示词不会这么长；Bun 默认 16MB
  maxPayloadLength: 64 * 1024,

  open(ws) {
    const d = ws.data
    try {
      d.conversationId = getOrCreateActiveConversation(d.user.id, d.taskId)
    } catch (e) {
      // 比如任务刚被删掉；不关掉的话客户端会一直等 init
      console.error("websocket open failed:", e)
      ws.close(1011, "conversation unavailable")
      return
    }
    if (d.kind === "guidance") {
      send(ws, { type: "init", messages: [] })
      return
    }
    send(ws, {
      type: "init",
      conversation_id: uuidOut(d.conversationId),
      messages: conversationHistory(d.conversationId).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        code:
          m.role === "assistant" ? { html: m.code_html, css: m.code_css, js: m.code_js } : null,
        submitted: m.role === "assistant" ? m.submission_id !== null : null,
        created: iso(m.created),
      })),
    })
  },

  message(ws, raw) {
    let data: any
    try {
      data = JSON.parse(String(raw))
    } catch {
      return
    }
    if (ws.data.busy) {
      send(ws, { type: "error", content: "上一条消息还在处理，请等 AI 回复完再发" })
      return
    }
    const handler = ws.data.kind === "prompt" ? handlePrompt : handleGuidance
    ws.data.busy = true
    handler(ws, data)
      .catch((e) => {
        console.error("websocket handler failed:", e)
        send(ws, { type: "error", content: "服务器出错，请刷新页面重试" })
      })
      .finally(() => {
        ws.data.busy = false
      })
  },

  close(ws) {
    ws.data.closed = true
    // 客户端断开时停止向模型请求，未完成的提问会在 finally 中删除
    ws.data.abort.abort()
    dropPendingUserMessage(ws)
  },
}
