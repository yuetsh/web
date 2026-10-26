import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import type { Server } from "bun"
import { app } from "../src/app"
import { config } from "../src/config"
import { all } from "../src/db"
import { upgrade, websocket, type WsData } from "../src/ws"
import { client, freshDb, makeTask, makeUser } from "./helpers"

// 假的模型接口：每段之间停一下，方便测试中途断开
const PIECES = ["好的", "```html\n<p>hi</p>\n```"]
// 最近一次发给模型的请求
let lastRequest: any = null
const llm = Bun.serve({
  port: 0,
  async fetch(req) {
    lastRequest = await req.json()
    const enc = new TextEncoder()
    const stream = new ReadableStream({
      async start(ctrl) {
        for (const piece of PIECES) {
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`))
          await Bun.sleep(150)
        }
        ctrl.enqueue(enc.encode("data: [DONE]\n\n"))
        ctrl.close()
      },
    })
    return new Response(stream, { headers: { "content-type": "text/event-stream" } })
  },
})

let server: Server<WsData>
const saved = { ...config }

beforeAll(() => {
  Object.assign(config, { llmApiKey: "k", llmBaseUrl: `http://localhost:${llm.port}` })
  server = Bun.serve<WsData>({
    port: 0,
    async fetch(req, srv) {
      const res = await upgrade(req, srv)
      return res !== null ? res : app.fetch(req)
    },
    websocket,
  })
})

afterAll(() => {
  Object.assign(config, saved)
  server.stop(true)
  llm.stop(true)
})

beforeEach(freshDb)

interface Conn {
  ws: WebSocket
  msgs: any[]
  next: (type: string) => Promise<any>
}

// 握手失败时返回 null
function connect(path: string): Promise<Conn | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${server.port}${path}`)
    const msgs: any[] = []
    const waiters: { type: string; resolve: (m: any) => void }[] = []
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data))
      msgs.push(m)
      const i = waiters.findIndex((w) => w.type === m.type)
      if (i >= 0) waiters.splice(i, 1)[0]!.resolve(m)
    }
    const next = (type: string) =>
      new Promise<any>((res) => {
        const seen = msgs.find((m) => m.type === type && !m._taken)
        if (seen) {
          seen._taken = true
          res(seen)
        } else {
          waiters.push({ type, resolve: (m) => ((m._taken = true), res(m)) })
        }
      })
    ws.onopen = () => resolve({ ws, msgs, next })
    ws.onerror = () => resolve(null)
  })
}

async function setup() {
  makeUser("stu")
  const task = makeTask("挑战")
  const stu = await client("stu")
  return { task, token: stu.tokens.access_token }
}

describe("WebSocket 代码生成", () => {
  test("正常生成：流式返回并保存一问一答", async () => {
    const { task, token } = await setup()
    const c = (await connect(`/ws/prompt/${task}/?token=${token}`))!
    expect((await c.next("init")).messages).toEqual([])
    c.ws.send(JSON.stringify({ type: "message", content: "做个页面" }))
    const done = await c.next("complete")
    expect(done.code.html).toBe("<p>hi</p>")
    const streamed = c.msgs.filter((m) => m.type === "stream").map((m) => m.content).join("")
    expect(streamed).toBe(PIECES.join(""))
    expect(all(`SELECT role FROM prompt_message ORDER BY id`).map((m) => m.role)).toEqual(["user", "assistant"])
    c.ws.close()
  })

  test("AI 回复中再发消息会被拒绝", async () => {
    const { task, token } = await setup()
    const c = (await connect(`/ws/prompt/${task}/?token=${token}`))!
    await c.next("init")
    c.ws.send(JSON.stringify({ type: "message", content: "第一条" }))
    c.ws.send(JSON.stringify({ type: "message", content: "第二条" }))
    expect((await c.next("error")).content).toContain("上一条消息还在处理")
    await c.next("complete")
    expect(all(`SELECT content FROM prompt_message WHERE role = 'user'`)).toEqual([{ content: "第一条" }])
    c.ws.close()
  })

  test("中途断开：删掉没有回复的提问", async () => {
    const { task, token } = await setup()
    const c = (await connect(`/ws/prompt/${task}/?token=${token}`))!
    await c.next("init")
    c.ws.send(JSON.stringify({ type: "message", content: "做个页面" }))
    await c.next("stream")
    c.ws.close()
    await Bun.sleep(400)
    expect(all(`SELECT * FROM prompt_message`)).toEqual([])
  })

  test("手改的版本进入对话，AI 下一轮在它上面改", async () => {
    makeUser("stu")
    const task = makeTask("挑战")
    const stu = await client("stu")
    const c = (await connect(`/ws/prompt/${task}/?token=${stu.tokens.access_token}`))!
    await c.next("init")
    c.ws.send(JSON.stringify({ type: "message", content: "做个页面" }))
    await c.next("complete")

    const saved = await stu("POST", "/api/prompt/versions", {
      task_id: task,
      html: "<p>我改过的</p>",
      css: "p { color: red }",
      js: "",
    })
    expect(saved.json.source).toBe("edit")

    c.ws.send(JSON.stringify({ type: "message", content: "再加个按钮" }))
    await c.next("complete")
    const sent = lastRequest.messages.map((m: any) => `${m.role}:${m.content}`)
    // system、第一轮、手改那一轮、这一轮的提问
    expect(sent.at(-3)).toBe("user:（手动修改了代码）")
    expect(sent.at(-2)).toContain("<p>我改过的</p>")
    expect(sent.at(-2)).toContain("p { color: red }")
    expect(sent.at(-1)).toBe("user:再加个按钮")
    c.ws.close()
  })

  test("token 无效或任务不存在时握手失败", async () => {
    const { task, token } = await setup()
    expect(await connect(`/ws/prompt/${task}/?token=bad`)).toBeNull()
    expect(await connect(`/ws/prompt/9999/?token=${token}`)).toBeNull()
  })
})
