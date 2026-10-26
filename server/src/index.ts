import { app } from "./app"
import { config } from "./config"
import { upgrade, websocket, type WsData } from "./ws"

const server = Bun.serve<WsData>({
  port: config.port,
  // 上传素材 / 图片
  maxRequestBodySize: 50 * 1024 * 1024,
  // AI 生成走 WebSocket，普通接口不会太久
  idleTimeout: 120,
  fetch(req, server) {
    const res = upgrade(req, server)
    if (res !== null) return res
    return app.fetch(req)
  },
  websocket,
})

console.log(`webpreview server listening on http://localhost:${server.port}`)
