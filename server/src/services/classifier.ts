import { all, get, run } from "../db"
import { complete, llmConfigured } from "./llm"

const CLASSIFY_SYSTEM_PROMPT = `你是一个教育评估专家。根据布鲁姆认知分类学，分析以下学生在前端学习中发送给AI助手的一条提示词，判断该提示词所体现的认知层级。

层级定义：
- L1 记忆：能背诵HTML标签语法（例："帮我写一个按钮"）
- L2 理解：能解释flex布局原理（例："为什么这里不居中？"）
- L3 应用：能独立搭建页面结构（例："用flex做导航栏，间距16px"）
- L4 分析：能定位跨浏览器兼容性bug（例："Safari中margin失效，原因？"）
- L5 评价：能对比并选择方案（例："对比Grid与Flex方案优劣"）
- L6 创造：能设计并实现原创交互作品（例："设计夜间/日间切换效果"）

只返回一个数字（1-6），不要解释。`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function callLlm(content: string): Promise<number | null> {
  if (!llmConfigured()) return null
  try {
    const text = await complete(
      [
        { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
        { role: "user", content },
      ],
      { maxTokens: 10, timeoutMs: 30_000 },
    )
    const match = /[1-6]/.exec(text)
    if (!match) {
      console.warn(`classify: unexpected LLM response '${text}'`)
      return null
    }
    return Number(match[0])
  } catch (e) {
    console.error("classify LLM call failed:", e)
    return null
  }
}

export async function classifyMessage(messageId: number): Promise<number | null> {
  const msg = get<{ content: string }>(
    `SELECT content FROM prompt_message WHERE id = $id AND role = 'user' AND source != 'edit'`,
    { id: messageId },
  )
  if (!msg) return null
  const level = await callLlm(msg.content)
  if (level !== null) {
    run(`UPDATE prompt_message SET prompt_level = $level WHERE id = $id`, {
      level,
      id: messageId,
    })
  }
  return level
}

export async function classifyConversationMessages(conversationId: string, force = false) {
  const rows = all<{ id: number }>(
    `SELECT id FROM prompt_message
     WHERE conversation_id = $id AND role = 'user' AND source != 'edit' ${force ? "" : "AND prompt_level IS NULL"}
     ORDER BY created, id`,
    { id: conversationId },
  )
  for (const { id } of rows) {
    await classifyMessage(id)
    await sleep(300)
  }
}

export async function classifyMessagesBatch(ids: number[]) {
  for (const id of ids) {
    await classifyMessage(id)
    await sleep(500)
  }
}

// 后台执行，不阻塞请求
export function inBackground(p: Promise<unknown>) {
  p.catch((e) => console.error("background task failed:", e))
}
