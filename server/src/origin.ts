import { config } from "./config"

// 同源请求，或来自白名单里的前端地址
export function isAllowedOrigin(origin: string | null, host: string | null) {
  if (!origin) return true
  if (config.allowedOrigins.includes(origin)) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
