import { randomBytes } from "node:crypto"
import { resolve } from "node:path"

const env = process.env

export const DEV = env.ENV !== "production"

export const config = {
  port: Number(env.PORT ?? 8000),
  dbPath: resolve(env.DB_PATH ?? "data/db.sqlite3"),
  mediaRoot: resolve(env.MEDIA_ROOT ?? "../media"),
  mediaUrl: "/media/",
  // 允许跨域访问 / 发起写请求 / 建立 WebSocket 的前端来源
  allowedOrigins: (
    env.ALLOWED_ORIGINS ??
    (DEV
      ? "http://localhost:3000"
      : "https://web.xuyue.cc,http://10.13.114.114:91")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // 未配置时每次启动随机生成：重启后 access token 全部失效，前端会用 refresh token 自动换新的
  jwtSecret: env.JWT_SECRET || randomBytes(32).toString("hex"),
  accessTokenSeconds: 15 * 60,
  refreshTokenSeconds: 60 * 60 * 24 * 14,

  // 测试时不调用真实的模型接口
  llmApiKey: env.NODE_ENV === "test" ? "" : (env.LLM_API_KEY ?? ""),
  llmBaseUrl: env.LLM_BASE_URL ?? "https://api.deepseek.com",
  llmModel: env.LLM_MODEL ?? "deepseek-v4-flash",
  arkApiKey: env.NODE_ENV === "test" ? "" : (env.ARK_API_KEY ?? ""),
  arkBaseUrl: env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
}
