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

const DEFAULT_MODEL = "deepseek-flash"
// 走火山方舟（ARK）接口的模型
const ARK_MODELS = new Set(["doubao-seed-2-1-lite-260915"])

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

interface CompletionOptions {
  model?: string
  stream: boolean
  maxTokens?: number
  signal?: AbortSignal
  timeoutMs?: number
}

export const llmConfigured = () => !!config.llmApiKey

function buildRequest(messages: ChatMessage[], opts: CompletionOptions) {
  const model = opts.model || DEFAULT_MODEL
  const ark = ARK_MODELS.has(model)
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: opts.stream,
  }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens
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
  model?: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const res = await buildRequest(messages, { model, stream: true, signal })
  await ensureOk(res)
  if (!res.body) return
  const decoder = new TextDecoder()
  let buffer = ""
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith("data:")) continue
      const data = line.slice(5).trim()
      if (data === "[DONE]") return
      const json = JSON.parse(data)
      if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error))
      const content = json.choices?.[0]?.delta?.content
      if (content) yield content
    }
  }
}

export function streamChat(history: ChatMessage[], model?: string, signal?: AbortSignal) {
  return streamCompletion([{ role: "system", content: SYSTEM_PROMPT }, ...history], model, signal)
}

export function streamGuidance(history: ChatMessage[], signal?: AbortSignal) {
  return streamCompletion(
    [{ role: "system", content: GUIDANCE_SYSTEM_PROMPT }, ...history],
    undefined,
    signal,
  )
}

export async function complete(
  messages: ChatMessage[],
  opts: { model?: string; maxTokens?: number; timeoutMs?: number } = {},
): Promise<string> {
  const res = await buildRequest(messages, {
    model: opts.model ?? config.llmModel,
    stream: false,
    maxTokens: opts.maxTokens,
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
