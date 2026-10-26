import { ref } from "vue"
import { wsUrl } from "../token"

export interface GuidanceMessage {
  role: "user" | "assistant"
  content: string
  id?: number
}

export const messages = ref<GuidanceMessage[]>([])
export const connected = ref(false)
export const streaming = ref(false)
export const streamingContent = ref("")
export const isReady = ref(false)
export const isOpen = ref(false)
export const initialPrompt = ref("")

let ws: WebSocket | null = null
let _taskId = 0
// 取 token 要等一下，期间又重连或关闭时作废这次连接
let connectSeq = 0

async function connect(taskId: number) {
  if (ws) ws.close()
  ws = null
  const seq = ++connectSeq
  const url = await wsUrl(`/ws/guidance/${taskId}/`)
  if (seq !== connectSeq) return
  ws = new WebSocket(url)
  setupHandlers(ws)
}

function setupHandlers(socket: WebSocket) {
  socket.onopen = () => {
    connected.value = true
    if (initialPrompt.value) {
      sendToSocket(initialPrompt.value)
    }
  }

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data)
    if (data.type === "init") {
      streaming.value = false
      streamingContent.value = ""
    } else if (data.type === "stream") {
      streaming.value = true
      streamingContent.value += data.content
    } else if (data.type === "complete") {
      streaming.value = false
      const content = streamingContent.value.replace(/^\[READY\]\n?/, "")
      messages.value.push({ role: "assistant", content, id: data.message_id })
      streamingContent.value = ""
      if (data.is_ready) isReady.value = true
    } else if (data.type === "error") {
      streaming.value = false
      streamingContent.value = ""
      messages.value.push({ role: "assistant", content: data.content })
    }
  }

  socket.onclose = () => {
    connected.value = false
  }
}

function sendToSocket(content: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  streaming.value = true
  messages.value.push({ role: "user", content })
  ws.send(JSON.stringify({ type: "message", content }))
}

export function openGuidance(taskId: number, prompt: string) {
  if (!taskId) return

  _taskId = taskId
  initialPrompt.value = prompt
  messages.value = []
  isReady.value = false
  streamingContent.value = ""
  isOpen.value = true

  connect(taskId)
}

export function sendGuidance(content: string) {
  sendToSocket(content)
}

export function stopGuidance() {
  if (
    messages.value.length > 0 &&
    messages.value[messages.value.length - 1].role === "user"
  ) {
    messages.value.pop()
  }
  streaming.value = false
  streamingContent.value = ""
  if (_taskId) {
    initialPrompt.value = ""
    connect(_taskId)
  }
}

export function closeGuidance() {
  connectSeq++
  if (ws) {
    ws.close()
    ws = null
  }
  isOpen.value = false
  messages.value = []
  isReady.value = false
  connected.value = false
  streaming.value = false
  streamingContent.value = ""
  initialPrompt.value = ""
  _taskId = 0
}
