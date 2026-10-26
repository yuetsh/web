import { Hono } from "hono"
import { cors } from "hono/cors"
import { config } from "./config"
import { sessionMiddleware } from "./auth"
import { HttpError, ValidationError, type Env } from "./http"
import { isAllowedOrigin } from "./origin"
import account from "./routes/account"
import { tutorial, challenge, creation } from "./routes/tasks"
import { assets, upload } from "./routes/files"
import submission from "./routes/submission"
import prompt from "./routes/prompt"
import { mediaPath } from "./routes/files"

// strict: false —— 带不带结尾的斜杠都能匹配（前端两种写法都有）
export const app = new Hono<Env>({ strict: false })

app.use(
  "/api/*",
  cors({ origin: config.allowedOrigins, credentials: true }),
)

// 会话 cookie 是 SameSite=Lax，再加一道 Origin 校验防止跨站写请求
app.use("/api/*", async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    if (!isAllowedOrigin(c.req.header("origin") ?? null, c.req.header("host") ?? null)) {
      return c.json({ detail: "跨站请求被拒绝" }, 403)
    }
  }
  await next()
})

app.use("/api/*", sessionMiddleware)

const api = new Hono<Env>({ strict: false })
api.route("/account", account)
api.route("/tutorial", tutorial)
api.route("/challenge", challenge)
api.route("/creation", creation)
api.route("/submission", submission)
api.route("/upload", upload)
api.route("/assets", assets)
api.route("/prompt", prompt)
app.route("/api", api)

// 生产环境由 Caddy 直接提供 /media，这里主要给本地开发用
app.get("/media/*", async (c) => {
  const relative = decodeURIComponent(c.req.path.slice("/media/".length))
  let file
  try {
    file = Bun.file(mediaPath(relative))
  } catch {
    return c.notFound()
  }
  if (!(await file.exists())) return c.notFound()
  return new Response(file)
})

app.notFound((c) => c.json({ detail: "Not Found" }, 404))

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ detail: err.detail }, err.status as any)
  }
  if (err instanceof ValidationError) {
    return c.json({ detail: err.issues }, 422)
  }
  console.error(err)
  return c.json({ detail: "服务器内部错误" }, 500)
})
