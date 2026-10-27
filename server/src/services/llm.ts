import { config } from "../config"

export const SYSTEM_PROMPT = `你是一个网页生成助手。根据用户的需求描述，生成网页代码。

规则：
1. 使用一个 \`\`\`html 代码块返回所有代码
2. HTML 代码只需要 body 内的内容，不需要完整的 HTML 文档结构
3. CSS 样式写在 <style> 标签内，JavaScript 写在 <script> 标签内，都放在代码块里
4. 用中文回复，先简要说明你做了什么，然后给出代码
5. 在已有代码基础上修改时，返回完整的修改后代码，不要只返回片段
6. 由于任何外部链接都被屏蔽，使用纯 HTML、CSS 和 JS 实现功能，不要依赖外部库

输出格式示例（必须严格遵守，只用一个代码块）：

好的，我为你创建了一个点击按钮变色的示例。

\`\`\`html
<style>
button { padding: 8px 16px; }
</style>

<button id="btn">点击我</button>

<script>
document.getElementById('btn').onclick = function() {
  this.style.background = 'red';
};
</script>
\`\`\``

export const GUIDANCE_SYSTEM_PROMPT = `你是一个提示词写作教练，帮助学生写出清晰、具体的网页需求描述。

判断标准——满足以下条件视为"够好"：
- 有明确主题（例如：登录页、计时器、商品卡片列表）
- 至少包含以下一项具体描述：颜色/布局/风格、交互行为（按钮点击、动画等）、页面内容（文字、数量、图标）

判断为"不够好"的典型情况：
- 目标太泛，如"做一个好看的页面"
- 只有主题，完全没有任何视觉、交互或内容描述

规则：
1. 如果提示词不够好，用 1-2 个启发性问题引导学生补充细节，不要直接给出答案
2. 如果提示词已经够好，以 [READY] 开头回复，简短夸奖学生并说明可以生成了
3. 用中文回复，语气鼓励，简洁明了
4. 使用 Markdown 语法高亮关键词，优先突出 **主题**、**视觉**、**交互**、**内容**、**可以生成** 等重点
5. 如果回复以 [READY] 开头，[READY] 不要加粗，必须保持原始文本
6. 不要生成任何代码`

// 走火山方舟（ARK）接口的模型
const ARK_MODELS = new Set(["doubao-seed-2-1-lite-260915"])

// 客户端可选的模型；不认识的（比如浏览器里存着改版前的模型名）一律换成默认模型
export function chatModel(model?: string) {
  return model && (model === config.llmModel || ARK_MODELS.has(model)) ? model : config.llmModel
}

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

// DeepSeek（deepseek-flash）默认先思考再回答，思考的内容在 reasoning_content 里，也算输出 token；
// 思考模式下 temperature 不起作用。thinking 只发给 DeepSeek，豆包不传
interface CompletionOptions {
  model?: string
  stream: boolean
  thinking?: boolean
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  timeoutMs?: number
}

// 流式生成：超过这么久没收到新数据才算超时，另有一个总时长上限
const STREAM_IDLE_MS = 120_000
const STREAM_MAX_MS = 15 * 60_000

export const llmConfigured = () => !!config.llmApiKey

function buildRequest(messages: ChatMessage[], opts: CompletionOptions) {
  const model = opts.model || config.llmModel
  const ark = ARK_MODELS.has(model)
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: opts.stream,
  }
  if (!ark && opts.thinking !== undefined) body.thinking = { type: opts.thinking ? "enabled" : "disabled" }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens
  if (opts.temperature !== undefined) body.temperature = opts.temperature
  const apiKey = ark ? config.arkApiKey : config.llmApiKey
  if (!apiKey) throw new Error("未配置模型接口密钥")
  const baseUrl = (ark ? config.arkBaseUrl : config.llmBaseUrl).replace(/\/$/, "")
  const signals = [AbortSignal.timeout(opts.timeoutMs ?? 120_000)]
  if (opts.signal) signals.push(opts.signal)
  return fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.any(signals),
  })
}

async function ensureOk(res: Response) {
  if (res.ok) return
  const text = await res.text().catch(() => "")
  throw new Error(`Error code: ${res.status} - ${text.slice(0, 500)}`)
}

// 读取 OpenAI 兼容接口的 SSE 流，逐段产出文本
async function* streamCompletion(
  messages: ChatMessage[],
  { model, thinking, signal }: { model?: string; thinking?: boolean; signal?: AbortSignal },
): AsyncGenerator<string> {
  // 带思考的模型生成整页代码可能超过两分钟，只要一直有数据就不该中断
  const idle = new AbortController()
  let timer = setTimeout(() => idle.abort(new Error("模型响应超时")), STREAM_IDLE_MS)
  const resetIdle = () => {
    clearTimeout(timer)
    timer = setTimeout(() => idle.abort(new Error("模型响应超时")), STREAM_IDLE_MS)
  }
  const signals = [idle.signal]
  if (signal) signals.push(signal)
  try {
    const res = await buildRequest(messages, {
      model,
      stream: true,
      thinking,
      signal: AbortSignal.any(signals),
      timeoutMs: STREAM_MAX_MS,
    })
    await ensureOk(res)
    if (!res.body) return
    const decoder = new TextDecoder()
    let buffer = ""
    // 返回 true 表示收到了 [DONE]
    function* parse(lines: string[]): Generator<string, boolean> {
      for (const raw of lines) {
        const line = raw.trim()
        if (!line.startsWith("data:")) continue
        const data = line.slice(5).trim()
        if (data === "[DONE]") return true
        const json = JSON.parse(data)
        if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error))
        // 思考阶段只有 delta.reasoning_content，不发给学生（它也会重置空闲计时）
        const content = json.choices?.[0]?.delta?.content
        if (content) yield content
      }
      return false
    }
    for await (const chunk of res.body) {
      resetIdle()
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop()!
      if (yield* parse(lines)) return
    }
    // 最后一行可能没有换行
    yield* parse([buffer + decoder.decode()])
  } finally {
    clearTimeout(timer)
  }
}

// 发给模型的对话上下文：只留最近 20 条；除最后一条 AI 回复外，旧回复里的代码块换成占位文字。
// 每次回复都是完整代码，模型只需要最新那份；否则对话越长 token 越多，最后会超出上下文长度
const MAX_HISTORY = 20
const CODE_BLOCK = /```[\s\S]*?```/g

export function trimHistory(history: ChatMessage[]): ChatMessage[] {
  const recent = history.slice(-MAX_HISTORY)
  const last = recent.findLastIndex((m) => m.role === "assistant")
  return recent.map((m, i) =>
    m.role === "assistant" && i !== last
      ? { ...m, content: m.content.replace(CODE_BLOCK, "```\n（旧版本代码已省略）\n```") }
      : m,
  )
}

// 给学生看的错误：不把模型接口的原始返回（可能带接口细节）原样发出去，完整信息写日志
export function userFacingError(e: unknown) {
  console.error("LLM request failed:", e)
  const message = e instanceof Error ? e.message : String(e)
  if (message === "模型响应超时" || (e instanceof Error && e.name === "TimeoutError")) {
    return "AI 响应超时，请重试"
  }
  const status = /^Error code: (\d+)/.exec(message)?.[1]
  if (status === "429") return "AI 服务繁忙，请稍后重试"
  return status ? `AI 服务出错（${status}），请稍后重试` : "AI 服务出错，请稍后重试"
}

// 生成整页代码：开着思考，质量优先
export function streamChat(history: ChatMessage[], model?: string, signal?: AbortSignal) {
  return streamCompletion([{ role: "system", content: SYSTEM_PROMPT }, ...trimHistory(history)], {
    model: chatModel(model),
    thinking: true,
    signal,
  })
}

// 引导只是简短追问，不用思考，回得快
export function streamGuidance(history: ChatMessage[], signal?: AbortSignal) {
  return streamCompletion([{ role: "system", content: GUIDANCE_SYSTEM_PROMPT }, ...history], {
    thinking: false,
    signal,
  })
}

export async function complete(
  messages: ChatMessage[],
  opts: { model?: string; thinking?: boolean; maxTokens?: number; temperature?: number; timeoutMs?: number } = {},
): Promise<string> {
  const res = await buildRequest(messages, {
    model: opts.model ?? config.llmModel,
    stream: false,
    thinking: opts.thinking,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    timeoutMs: opts.timeoutMs,
  })
  await ensureOk(res)
  const json: any = await res.json()
  return json.choices?.[0]?.message?.content ?? ""
}

export interface ExtractedCode {
  html: string | null
  css: string | null
  js: string | null
}

// 从 AI 回复中提取代码：支持单个 html 代码块（新）或分开的 html/css/js 代码块（旧）
export function extractCode(text: string): ExtractedCode {
  const result: ExtractedCode = { html: null, css: null, js: null }
  const pattern = /```(html|css|js|javascript|typescript|ts|jsx|tsx)\s*\n([\s\S]*?)```/gi
  for (const [, rawLang, code] of text.matchAll(pattern)) {
    let lang = rawLang!.toLowerCase()
    if (["javascript", "typescript", "ts", "jsx", "tsx"].includes(lang)) lang = "js"
    const key = lang as keyof ExtractedCode
    if (key in result && result[key] === null) result[key] = code!.trim()
  }

  // 单个 HTML 代码块：把 <style>/<script> 的内容拆出来，并从 html 中去掉
  if (result.html && result.css === null && result.js === null) {
    let html = result.html
    const style = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(html)
    if (style) {
      result.css = style[1]!.trim()
      html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    }
    const script = /<script[^>]*>([\s\S]*?)<\/script>/i.exec(html)
    if (script) {
      result.js = script[1]!.trim()
      html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    }
    result.html = html.trim()
  }
  return result
}

export function parseGuidanceResponse(full: string): [string, boolean] {
  if (full.startsWith("[READY]")) {
    return [full.slice("[READY]".length).replace(/^\n+/, ""), true]
  }
  return [full, false]
}
