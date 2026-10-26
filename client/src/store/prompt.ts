import { ref } from "vue"
import { WS_BASE_URL } from "../utils/const"
import { html, css, js } from "./editors"

export interface PromptMessage {
  role: "user" | "assistant"
  content: string
  id?: number          // assistant message backend pk (for deletion)
  code?: { html: string | null; css: string | null; js: string | null }
  submitted?: boolean  // whether this assistant message's code has been submitted
  created?: string
}

export const messages = ref<PromptMessage[]>([])
export const conversationId = ref<string>("")
export const connected = ref(false)
export const streaming = ref(false)
export const streamingContent = ref("")
export const currentTaskId = ref(0)
let _onCodeComplete:
  | ((
      code: { html: string | null; css: string | null; js: string | null },
      messageId: number
    ) => void)
  | null = null

export function setOnCodeComplete(fn: typeof _onCodeComplete) {
  _onCodeComplete = fn
}

let ws: WebSocket | null = null

export function connectPrompt(taskId: number) {
  currentTaskId.value = taskId
  if (ws) ws.close()

  ws = new WebSocket(`${WS_BASE_URL}/ws/prompt/${taskId}/`)

  ws.onopen = () => {
    connected.value = true
  }

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)

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
        if (lastAssistant?.code) {
          applyCode(lastAssistant.code)
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
      })
      streamingContent.value = ""
      if (data.code) {
        applyCode(data.code)
        if (_onCodeComplete) {
          _onCodeComplete(data.code, data.message_id)
        }
      }
    } else if (data.type === "error") {
      streaming.value = false
      streamingContent.value = ""
      messages.value.push({
        role: "assistant",
        content: data.content,
      })
    }
  }

  ws.onclose = () => {
    connected.value = false
  }
}

export function disconnectPrompt() {
  if (ws) {
    ws.close()
    ws = null
  }
  messages.value = []
  conversationId.value = ""
  connected.value = false
  streaming.value = false
  streamingContent.value = ""
  currentTaskId.value = 0
  _onCodeComplete = null
}

export function sendPrompt(content: string, model: string = "") {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  streaming.value = true
  messages.value.push({ role: "user", content })
  ws.send(JSON.stringify({ type: "message", content, model }))
}

export function stopPrompt() {
  if (
    messages.value.length > 0 &&
    messages.value[messages.value.length - 1].role === "user"
  ) {
    messages.value.pop()
  }
  streaming.value = false
  streamingContent.value = ""
  if (currentTaskId.value) {
    connectPrompt(currentTaskId.value)
  }
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

function applyCode(code: {
  html: string | null
  css: string | null
  js: string | null
}) {
  if (code.html !== null) html.value = code.html
  if (code.css !== null) css.value = code.css
  if (code.js !== null) js.value = code.js
}
