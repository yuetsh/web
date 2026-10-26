import { ref } from "vue"
import { ReconnectingSocket } from "../utils/socket"

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

let _taskId = 0
// 打开弹窗时带过来的提示词，连上后发一次；重连时不再重发
let unsentPrompt = ""

const socket = new ReconnectingSocket({
  onOpen() {
    connected.value = true
    if (unsentPrompt) {
      sendToSocket(unsentPrompt)
      unsentPrompt = ""
    }
  },
  onMessage(data) {
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
  },
  onDrop() {
    connected.value = false
    if (streaming.value) dropPendingMessage()
  },
  onGiveUp() {
    messages.value.push({
      role: "assistant",
      content: "与服务器的连接已断开，请刷新页面重试",
    })
  },
})

function connect(taskId: number) {
  socket.connect(`/ws/guidance/${taskId}/`)
}

function sendToSocket(content: string) {
  if (!socket.send({ type: "message", content })) return
  streaming.value = true
  messages.value.push({ role: "user", content })
}

function dropPendingMessage() {
  if (
    messages.value.length > 0 &&
    messages.value[messages.value.length - 1].role === "user"
  ) {
    messages.value.pop()
  }
  streaming.value = false
  streamingContent.value = ""
}

export function openGuidance(taskId: number, prompt: string) {
  if (!taskId) return

  _taskId = taskId
  initialPrompt.value = prompt
  unsentPrompt = prompt
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
  dropPendingMessage()
  if (_taskId) {
    initialPrompt.value = ""
    unsentPrompt = ""
    connect(_taskId)
  }
}

export function closeGuidance() {
  socket.close()
  unsentPrompt = ""
  isOpen.value = false
  messages.value = []
  isReady.value = false
  connected.value = false
  streaming.value = false
  streamingContent.value = ""
  initialPrompt.value = ""
  _taskId = 0
}
