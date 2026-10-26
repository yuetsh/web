import { app } from "./app"
import { config } from "./config"
import { db } from "./db"
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

// 长期运行的连接按 SQLite 文档建议定期刷新统计信息
setInterval(() => db.run("PRAGMA optimize"), 60 * 60 * 1000)

console.log(`webpreview server listening on http://localhost:${server.port}`)
