import { ref } from "vue"
import { WS_BASE_URL } from "../utils/const"

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

  if (ws) ws.close()
  ws = new WebSocket(`${WS_BASE_URL}/ws/guidance/${taskId}/`)
  setupHandlers(ws)
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
    if (ws) ws.close()
    ws = new WebSocket(`${WS_BASE_URL}/ws/guidance/${_taskId}/`)
    initialPrompt.value = ""
    setupHandlers(ws)
  }
}

export function closeGuidance() {
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
