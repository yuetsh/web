import { getRefreshToken, refreshAccessToken, wsUrl } from "../token"

const MAX_DELAY_MS = 30_000
// 连续这么多次没连上就放弃，让用户刷新页面
const MAX_FAILURES = 6

interface Handlers {
  onOpen?: () => void
  onMessage: (data: any) => void
  // 非主动断开（服务器重启、网络断了），之后会自动重连
  onDrop?: () => void
  onGiveUp?: () => void
}

// 带断线重连的 WebSocket：非主动关闭时按 1s、2s、4s… 退避重连。
// 握手就失败多半是 access token 失效（比如服务端重启换了密钥），重连前先强制刷新
export class ReconnectingSocket {
  private ws: WebSocket | null = null
  private path = ""
  // 取 token、等重连期间又调用了 connect/close 时，作废旧的那次
  private seq = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private failures = 0

  constructor(private handlers: Handlers) {}

  connect(path: string) {
    this.close()
    this.path = path
    this.failures = 0
    this.open(this.seq)
  }

  close() {
    this.seq++
    clearTimeout(this.timer)
    const ws = this.ws
    this.ws = null
    ws?.close()
  }

  send(data: unknown) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(data))
    return true
  }

  private async open(seq: number) {
    const url = await wsUrl(this.path)
    if (seq !== this.seq) return
    const socket = new WebSocket(url)
    this.ws = socket
    let opened = false

    socket.onopen = () => {
      if (socket !== this.ws) return
      opened = true
      this.failures = 0
      this.handlers.onOpen?.()
    }
    socket.onmessage = (event) => {
      if (socket === this.ws) this.handlers.onMessage(JSON.parse(event.data))
    }
    socket.onclose = async () => {
      if (socket !== this.ws) return
      this.ws = null
      this.handlers.onDrop?.()
      if (++this.failures > MAX_FAILURES || !getRefreshToken()) {
        this.handlers.onGiveUp?.()
        return
      }
      if (!opened) await refreshAccessToken()
      if (seq !== this.seq) return
      const delay = Math.min(1000 * 2 ** (this.failures - 1), MAX_DELAY_MS)
      this.timer = setTimeout(() => {
        if (seq === this.seq) this.open(seq)
      }, delay)
    }
  }
}
