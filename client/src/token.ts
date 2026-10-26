import axios from "axios"
import { BASE_URL, STORAGE_KEY, WS_BASE_URL } from "./utils/const"

// access token 有效期很短，快过期时提前换新的
const REFRESH_AHEAD_MS = 30_000

export function setTokens(tokens: {
  access_token: string
  refresh_token?: string
}) {
  localStorage.setItem(STORAGE_KEY.ACCESS_TOKEN, tokens.access_token)
  if (tokens.refresh_token) {
    localStorage.setItem(STORAGE_KEY.REFRESH_TOKEN, tokens.refresh_token)
  }
}

export function clearTokens() {
  localStorage.removeItem(STORAGE_KEY.ACCESS_TOKEN)
  localStorage.removeItem(STORAGE_KEY.REFRESH_TOKEN)
}

export const getRefreshToken = () =>
  localStorage.getItem(STORAGE_KEY.REFRESH_TOKEN)

export const hasLogin = () => !!getRefreshToken()

function expiresSoon(token: string) {
  try {
    const payload = token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")
    const { exp } = JSON.parse(atob(payload))
    return exp * 1000 - Date.now() < REFRESH_AHEAD_MS
  } catch {
    return true
  }
}

let refreshing: Promise<string | null> | null = null

// 同时有多个请求要刷新时只发一次
export function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return Promise.resolve(null)
  refreshing ??= axios
    .post(`${BASE_URL}/account/refresh`, { refresh_token: refreshToken })
    .then((res) => {
      setTokens(res.data)
      return res.data.access_token as string
    })
    .catch((err) => {
      // refresh token 失效（过期、改密码、封号）才清掉；网络错误下次再试
      if (err.response?.status === 401) clearTokens()
      return null
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

export async function getAccessToken() {
  const token = localStorage.getItem(STORAGE_KEY.ACCESS_TOKEN)
  if (token && !expiresSoon(token)) return token
  return refreshAccessToken()
}

// 浏览器建 WebSocket 时不能加请求头，token 放在查询参数里
export async function wsUrl(path: string) {
  const token = await getAccessToken()
  return `${WS_BASE_URL}${path}?token=${encodeURIComponent(token ?? "")}`
}
