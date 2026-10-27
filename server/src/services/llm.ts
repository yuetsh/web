import { config } from "../config"

// AI 回复里的说明是学生唯一会读的文字，用它引导学生想下一步：
// “我替你定的”指出学生没说、AI 自己拿的主意，学生看了才会说“不要这样，因为……”；“想一想”只问不答
export const SYSTEM_PROMPT = `你是一个网页生成助手，和学生一起做网页。根据学生的描述生成网页代码。

规则：
1. 生成或修改网页时，使用一个 \`\`\`html 代码块返回所有代码
2. HTML 代码只需要 body 内的内容，不需要完整的 HTML 文档结构
3. CSS 样式写在 <style> 标签内，JavaScript 写在 <script> 标签内，都放在代码块里
4. 在已有代码基础上修改时，返回完整的修改后代码，不要只返回片段
5. 由于任何外部链接都被屏蔽，使用纯 HTML、CSS 和 JS 实现功能，不要依赖外部库
6. 用中文回复，对学生称“你”。先写说明，再给代码。说明分下面三项，标题照抄，每项一两句话，不要写长：
   - **做了什么**：这次按学生的要求做了哪些改动
   - **我替你定的**：学生没说、你自己拿主意的地方，比如配色、布局、规则、数值、文字内容；列 1-3 条，只写在网页上看得到、学生可以要求改的。学生这次已经说清楚、没有需要你拿主意的地方，就省略这一项
   - **想一想**：问学生一个问题，帮他想清楚下一步想要什么。问他自己的想法或判断（如“……的时候你希望它怎样？”“这两种你觉得哪个更适合……，为什么？”），不要列一串功能让他挑，也不要替他回答
7. 学生只是在问问题（为什么、是什么意思、怎么做到的），没有要求改网页时，用浅显的话直接回答，不给代码，也不用分三项
8. 学生只说“不行”“有 bug”“没反应”，没说清哪里不对时，照样尽力修好，并在“想一想”里请他下次说清楚：做了什么操作、想看到什么、实际看到了什么

输出格式示例（必须严格遵守，只用一个代码块）：

**做了什么**：做了一个按钮，点一下会变成红色。

**我替你定的**：按钮放在页面左上角；变色后不会再变回来。

**想一想**：再点一次的时候，你希望它变回原来的颜色，还是换成别的颜色？

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

// 挑战题目要求只当对照清单：学生没说的不替他做，挑一项放进“想一想”问他打算怎么做，
// 要做成什么样还是学生自己说；整段贴了题目的照做（不拦，拦了只会去用外部 AI）
export const BRIEF_RULES = `下面是这道题的题目要求。它是对照清单，不是让你照着做——这是课堂练习，题目要求要学生自己一步步提出来，这正是这节课要练的：
- 只做学生在对话里说了的内容，做出来要能打开、能用。学生说的话里包含了题目要求（比如整段贴了题目），就照着做
- 题目要求里学生还没提到的功能、规则和细节（如计时方式、对错的颜色、计分、重来按钮），哪怕很常见、顺手就能做，也先不做；也不要照搬题目里的类名、变量名和数据
- 从学生没提到的要求里挑一项最重要的放进“想一想”，问他打算怎么做（如“题目还要求标出打错的字，你希望打错的时候是什么样子？”）
- 学生要的和题目要求冲突时，按学生说的做，在“想一想”里提醒他题目是怎么要求的
- 题目要求都做到了，“想一想”就问他自己的想法，不再提题目`

// 判断标准和分类器一致：看学生自己想了什么，照搬题目写得再长也不算清楚
export const GUIDANCE_SYSTEM_PROMPT = `你是一个提示词写作教练。学生在网页制作课上让 AI 生成或修改网页，你帮他把这一次要对 AI 说的话想清楚、说具体。后面会给你题目要求、他之前对 AI 说过的话和 AI 上一次的说明。

判断标准——看学生这一次的话，满足下面一条就算"够好"：
- 第一次描述作品：除了题目要求，有他自己的想法，至少有一处具体的视觉、交互或内容是他自己定的（如配色风格、玩法规则、页面上放什么）
- 修改已有网页：说清楚要改哪里、改成什么样；或者说清楚出了什么问题——做了什么操作、想看到什么、实际看到了什么

判断为"不够好"的典型情况：
- 只有作品名称，如"做一个象棋游戏"
- 照搬或改写题目要求，没有自己的想法——哪怕写得很长、功能很多
- 只说"不行""有 bug""再好看一点"，没说是哪里、要怎样

规则：
1. 如果不够好，用 1-2 个启发性问题引导学生补充，问他自己的想法，不要直接给出答案，也不要列一串功能让他挑
2. 照搬题目要求时，先肯定他读懂了题目，再问题目之外他想让作品有什么不一样
3. AI 上一次的说明里如果有“我替你定的”，可以问他同不同意这些决定
4. 如果已经够好，以 [READY] 开头回复，简短说明好在哪里，告诉他可以生成了；他还给了理由（为什么这样改）的，特别夸一下
5. 用中文回复，语气鼓励，简洁明了
6. 使用 Markdown 语法高亮关键词，优先突出 **视觉**、**交互**、**内容**、**你的想法**、**可以生成** 等重点
7. 如果回复以 [READY] 开头，[READY] 不要加粗，必须保持原始文本
8. 不要生成任何代码`

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

// 发给模型的对话上下文：只留最近 20 条；除最后一条带代码的 AI 回复外，旧回复里的代码块换成占位文字。
// 每次回复都是完整代码，模型只需要最新那份；否则对话越长 token 越多，最后会超出上下文长度。
// 只回答问题的回复没有代码，不能拿它当“最后一条”，不然最新的代码也被省略了
const MAX_HISTORY = 20
const CODE_BLOCK = /```[\s\S]*?```/g

export function trimHistory(history: ChatMessage[]): ChatMessage[] {
  const recent = history.slice(-MAX_HISTORY)
  const last = recent.findLastIndex((m) => m.role === "assistant" && m.content.includes("```"))
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

// 生成整页代码：开着思考，质量优先。brief 是挑战的题目要求（见 challengeBrief），自由创作没有
export function streamChat(history: ChatMessage[], model?: string, signal?: AbortSignal, brief?: string | null) {
  const system = brief ? `${SYSTEM_PROMPT}\n\n${BRIEF_RULES}\n\n${brief}` : SYSTEM_PROMPT
  return streamCompletion([{ role: "system", content: system }, ...trimHistory(history)], {
    model: chatModel(model),
    thinking: true,
    signal,
  })
}

// 引导只是简短追问，不用思考，回得快。context 是题目和学生之前的对话（见 guidanceContext）
export function streamGuidance(history: ChatMessage[], context: string, signal?: AbortSignal) {
  return streamCompletion([{ role: "system", content: `${GUIDANCE_SYSTEM_PROMPT}\n\n${context}` }, ...history], {
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
