import { ref } from "vue"
import { ReconnectingSocket } from "../utils/socket"

export interface PromptMessage {
  role: "user" | "assistant"
  content: string
  id?: number          // assistant message backend pk (for deletion)
  code?: { html: string | null; css: string | null; js: string | null }
  submitted?: boolean  // whether this assistant message's code has been submitted
  created?: string
  // conversation：AI 对话；edit：学生手改；manual：粘贴外部 AI 的代码
  source?: string
}

type CodeOut = { html: string | null; css: string | null; js: string | null }

export const messages = ref<PromptMessage[]>([])
export const conversationId = ref<string>("")
export const connected = ref(false)
export const streaming = ref(false)
export const streamingContent = ref("")
export const currentTaskId = ref(0)
// 新代码交给工作台处理：init 是连上时对话里最新的那一版，complete 是 AI 刚生成的
let _codeSink:
  | ((code: CodeOut, messageId: number, reason: "init" | "complete") => void)
  | null = null

export function setCodeSink(fn: typeof _codeSink) {
  _codeSink = fn
}

function onMessage(data: any) {
  if (data.type === "init") {
    streaming.value = false
    streamingContent.value = ""
    const alreadyLoaded = conversationId.value === data.conversation_id
    conversationId.value = data.conversation_id
    if (!alreadyLoaded) {
      messages.value = data.messages || []
      const lastAssistant = [...messages.value]
        .reverse()
        .find((m) => m.role === "assistant" && m.code)
      if (lastAssistant?.code && lastAssistant.id) {
        _codeSink?.(lastAssistant.code, lastAssistant.id, "init")
      }
    }
  } else if (data.type === "stream") {
    streaming.value = true
    streamingContent.value += data.content
  } else if (data.type === "complete") {
    streaming.value = false
    messages.value.push({
      role: "assistant",
      content: streamingContent.value,
      id: data.message_id,
      code: data.code,
      submitted: false,
      source: "conversation",
    })
    streamingContent.value = ""
    if (data.code) _codeSink?.(data.code, data.message_id, "complete")
  } else if (data.type === "error") {
    streaming.value = false
    streamingContent.value = ""
    messages.value.push({
      role: "assistant",
      content: data.content,
    })
  }
}

const socket = new ReconnectingSocket({
  onOpen() {
    connected.value = true
  },
  onMessage,
  onDrop() {
    connected.value = false
    // 断开时服务端会删掉还没有回复的提问，这边也去掉
    if (streaming.value) dropPendingPrompt()
  },
  onGiveUp() {
    messages.value.push({
      role: "assistant",
      content: "与服务器的连接已断开，请刷新页面重试",
    })
  },
})

export function connectPrompt(taskId: number) {
  currentTaskId.value = taskId
  socket.connect(`/ws/prompt/${taskId}/`)
}

export function disconnectPrompt() {
  socket.close()
  messages.value = []
  conversationId.value = ""
  connected.value = false
  streaming.value = false
  streamingContent.value = ""
  currentTaskId.value = 0
  _codeSink = null
}

export function sendPrompt(content: string, model: string = "") {
  if (!socket.send({ type: "message", content, model })) return
  streaming.value = true
  messages.value.push({ role: "user", content })
}

function dropPendingPrompt() {
  if (
    messages.value.length > 0 &&
    messages.value[messages.value.length - 1].role === "user"
  ) {
    messages.value.pop()
  }
  streaming.value = false
  streamingContent.value = ""
}

export function stopPrompt() {
  dropPendingPrompt()
  if (currentTaskId.value) {
    connectPrompt(currentTaskId.value)
  }
}

// 手改或粘贴外部代码存成版本后，把这一问一答加到当前对话里显示
export function addVersionPair(
  prompt: string,
  source: string,
  messageId: number,
  code: CodeOut,
) {
  messages.value.push(
    { role: "user", content: prompt, source },
    { role: "assistant", content: "", id: messageId, code, submitted: false, source },
  )
}

export function markMessageSubmitted(assistantMsgId: number) {
  const msg = messages.value.find((m) => m.id === assistantMsgId)
  if (msg) msg.submitted = true
}

export function removeMessagePair(assistantMsgId: number) {
  const idx = messages.value.findIndex((m) => m.id === assistantMsgId)
  if (idx >= 1) {
    messages.value.splice(idx - 1, 2)
  }
}
