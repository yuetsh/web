import { describe, expect, test } from "bun:test"
import { pyRound, pySum } from "../src/services/pyround"
import {
  chatModel,
  extractCode,
  parseGuidanceResponse,
  streamChat,
  streamGuidance,
  trimHistory,
  userFacingError,
} from "../src/services/llm"
import { config } from "../src/config"
import { checkPassword, makePassword } from "../src/auth"
import { formatMicros, iso, uuidHex, uuidOut } from "../src/db"
import { toCsv } from "../src/services/gradebook"

describe("pyRound", () => {
  test("银行家舍入，与 Python round() 一致", () => {
    expect(pyRound(2.5)).toBe(2)
    expect(pyRound(3.5)).toBe(4)
    expect(pyRound(0.125, 2)).toBe(0.12)
    expect(pyRound(0.375, 2)).toBe(0.38)
    // 2.675 的二进制值略小于 2.675
    expect(pyRound(2.675, 2)).toBe(2.67)
    expect(pyRound(1 / 3, 2)).toBe(0.33)
    expect(pyRound(95.5)).toBe(96)
  })
})

describe("pySum", () => {
  test("补偿求和，与 Python 3.12+ 的 sum() 一致", () => {
    expect(pySum([0.1, 0.2, 0.3])).toBe(0.6)
    expect(pySum([1e100, 1, -1e100])).toBe(1)
    expect(pySum([])).toBe(0)
  })
})

describe("extractCode", () => {
  test("单个 html 代码块拆出 style 和 script", () => {
    const text = "说明\n```html\n<style>\na{}\n</style>\n<a>x</a>\n<script>\nf()\n</script>\n```"
    expect(extractCode(text)).toEqual({ html: "<a>x</a>", css: "a{}", js: "f()" })
  })
  test("分开的代码块（旧格式）", () => {
    const text = "```html\n<p/>\n```\n```css\np{}\n```\n```javascript\nx()\n```"
    expect(extractCode(text)).toEqual({ html: "<p/>", css: "p{}", js: "x()" })
  })
  test("没有代码块", () => {
    expect(extractCode("hello")).toEqual({ html: null, css: null, js: null })
  })
})

test("parseGuidanceResponse", () => {
  expect(parseGuidanceResponse("[READY]\n\n好")).toEqual(["好", true])
  expect(parseGuidanceResponse("再想想")).toEqual(["再想想", false])
})

test("兼容 Django 的 pbkdf2 密码哈希", async () => {
  // 由 Django 的 PBKDF2PasswordHasher 生成的 "secret" 的哈希
  const django = "pbkdf2_sha256$1000$abcdefghijklmnopqrstuv$1nE4fvOmiD+ZePp39y6TYTXfkn5HEwJDyz8e6UkQE1w="
  expect(await checkPassword("secret", django)).toBe(true)
  expect(await checkPassword("Secret", django)).toBe(false)
  expect(await checkPassword("secret", await makePassword("secret"))).toBe(true)
  expect(await checkPassword("wrong", await makePassword("secret"))).toBe(false)
  expect(await checkPassword("secret", "bcrypt$xxx")).toBe(false)
})

test("时间与 UUID 格式", () => {
  expect(formatMicros(Date.UTC(2026, 0, 2, 3, 4, 5) * 1000 + 678901)).toBe("2026-01-02 03:04:05.678901")
  expect(iso("2026-01-02 03:04:05.678901")).toBe("2026-01-02T03:04:05.678Z")
  const hex = "0123456789abcdef0123456789abcdef"
  expect(uuidOut(hex)).toBe("01234567-89ab-cdef-0123-456789abcdef")
  expect(uuidHex("01234567-89AB-cdef-0123-456789abcdef")).toBe(hex)
  expect(uuidHex("nope")).toBeNull()
})

test("CSV 转义", () => {
  expect(toCsv([["a", 'b"c', "d,e"], [1, 2.5, ""]])).toBe('a,"b""c","d,e"\r\n1,2.5,\r\n')
})

describe("streamChat", () => {
  test("不认识的模型换成默认模型，最后一行没有换行也能读到；生成代码开思考，引导不开", async () => {
    let model = ""
    let thinking: unknown
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        ;({ model, thinking } = (await req.json()) as any)
        const line = (s: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}`
        // 一行拆在两个分块之间，最后一行不带换行
        const body = `${line("你好")}\n\n${line("世")}\n${line("界")}`
        const enc = new TextEncoder()
        const cut = body.indexOf("世") + 2
        return new Response(
          new ReadableStream({
            async start(ctrl) {
              ctrl.enqueue(enc.encode(body.slice(0, cut)))
              await Bun.sleep(5)
              ctrl.enqueue(enc.encode(body.slice(cut)))
              ctrl.close()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      },
    })
    const saved = { ...config }
    Object.assign(config, { llmApiKey: "k", llmBaseUrl: `http://localhost:${server.port}` })
    try {
      let out = ""
      for await (const s of streamChat([{ role: "user", content: "hi" }], "deepseek-v4-flash-thinking")) out += s
      expect(out).toBe("你好世界")
      expect(model).toBe(config.llmModel)
      expect(thinking).toEqual({ type: "enabled" })
      for await (const _ of streamGuidance([{ role: "user", content: "hi" }], "题目：x"));
      expect(thinking).toEqual({ type: "disabled" })
    } finally {
      Object.assign(config, saved)
      server.stop(true)
    }
  })

  test("chatModel 只放行配置里的模型", () => {
    expect(chatModel("doubao-seed-2-1-lite-260915")).toBe("doubao-seed-2-1-lite-260915")
    expect(chatModel(config.llmModel)).toBe(config.llmModel)
    expect(chatModel("gpt-5")).toBe(config.llmModel)
    expect(chatModel("")).toBe(config.llmModel)
  })
})

test("trimHistory 只留最近 20 条，旧回复的代码换成占位", () => {
  const history = Array.from({ length: 30 }, (_, i) => ({
    role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
    content: i % 2 ? `第${i}版\n\`\`\`html\n<p>${i}</p>\n\`\`\`` : `改一下 ${i}`,
  }))
  const out = trimHistory(history)
  expect(out).toHaveLength(20)
  expect(out[0]!.content).toBe("改一下 10")
  expect(out.at(-1)!.content).toContain("<p>29</p>")
  expect(out.at(-3)!.content).toBe("第27版\n```\n（旧版本代码已省略）\n```")
  expect(out.filter((m) => m.content.includes("<p>"))).toHaveLength(1)
})

test("trimHistory 最后一条回复没有代码时，保留之前最新的那份代码", () => {
  const out = trimHistory([
    { role: "user", content: "做个页面" },
    { role: "assistant", content: "第1版\n```html\n<p>1</p>\n```" },
    { role: "user", content: "加个按钮" },
    { role: "assistant", content: "第2版\n```html\n<p>2</p>\n```" },
    { role: "user", content: "为什么按钮是圆的？" },
    { role: "assistant", content: "因为加了 border-radius。" },
  ])
  expect(out[3]!.content).toContain("<p>2</p>")
  expect(out[1]!.content).not.toContain("<p>1</p>")
})

test("userFacingError 不透出接口原始返回", () => {
  const quiet = console.error
  console.error = () => {}
  try {
    expect(userFacingError(new Error('Error code: 401 - {"error":"invalid api key sk-xxx"}'))).toBe(
      "AI 服务出错（401），请稍后重试",
    )
    expect(userFacingError(new Error("Error code: 429 - busy"))).toBe("AI 服务繁忙，请稍后重试")
    expect(userFacingError(new Error("模型响应超时"))).toBe("AI 响应超时，请重试")
    expect(userFacingError(new Error("fetch failed: ECONNREFUSED 10.0.0.1"))).toBe("AI 服务出错，请稍后重试")
  } finally {
    console.error = quiet
  }
})
