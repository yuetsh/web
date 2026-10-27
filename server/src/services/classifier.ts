import { all, get, run } from "../db"
import { complete, llmConfigured } from "./llm"

// 学生在这里是“指挥 AI 做网页”，看的是这句提问里学生自己想了多少，不是要 AI 做的东西有多大：
// 把题目要求原样贴过去，功能列得再多也只是照着做（L3）
const CLASSIFY_SYSTEM_PROMPT = `你是一个教育评估专家。学生在网页制作课上让 AI 生成或修改网页，下面给出题目要求、学生上一轮的提问和这一轮的提问。请按布鲁姆认知分类学，判断“这一轮提问”体现的学生自己的思考层级。

层级定义：
- L1 记忆：只说要做什么，没有自己的要求，或者原样复述题目名称（例："帮我做一个象棋游戏"、"继续"）
- L2 理解：用自己的话说出看到的现象或疑问，但没有具体要求（例："为什么点了没反应"、"还是没有显示"）
- L3 应用：给出具体、可执行的要求，如颜色、布局、要加的功能；照搬或改写题目要求里的功能清单也属于这一级（例："方块大一点，旁边加一个橡皮擦和清空按钮"）
- L4 分析：说清楚在什么操作下出了什么问题，或推测原因、拆解问题出在哪部分（例："拖动绘制时松开鼠标还在画，是不是没监听 mouseup"）
- L5 评价：按某个标准判断现有结果好不好并说明理由，或比较不同做法再做选择（例："现在按钮太多，小学生看不懂，改成只留三个主要按钮"）
- L6 创造：在题目要求之外提出自己的设计，如原创的主题、玩法、交互或整体风格，并说明它们怎么配合（例："改成星空主题：转盘是星座，抽中稀有奖励时流星划过并解锁对应星座的图鉴"）

判断要点：
- 只看学生自己想出来的部分。和题目要求重合的内容不算创造，要求写得长不等于层级高。
- 结合上一轮看：重复上一轮的提问，层级不高于上一轮。

只返回一个数字（1-6），不要解释。`

const MIN_PROMPT_CHARS = 4
const BRIEF_CHARS = 800
const PROMPT_CHARS = 1500

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function callLlm(content: string): Promise<number | null> {
  if (!llmConfigured()) return null
  try {
    const text = await complete(
      [
        { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
        { role: "user", content },
      ],
      // 同一句提示词要得到同一个层级
      { maxTokens: 10, temperature: 0, timeoutMs: 30_000 },
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

// 题目要求去掉图片、压成一段，太长的截掉
function briefOf(content: string) {
  const text = content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return text.length > BRIEF_CHARS ? text.slice(0, BRIEF_CHARS) + "……" : text
}

function clip(text: string) {
  return text.length > PROMPT_CHARS ? text.slice(0, PROMPT_CHARS) + "……" : text
}

// 发给模型的：题目要求、同一对话里上一轮的提问（引导对话只和引导对话比）、这一轮的提问
function classifyInput(msg: { id: number; content: string; source: string; conversation_id: string; created: string }) {
  const task = get<{ title: string; content: string }>(
    `SELECT t.title, t.content FROM prompt_conversation c JOIN task_task t ON t.id = c.task_id WHERE c.id = $conv`,
    { conv: msg.conversation_id },
  )
  const prev = get<{ content: string }>(
    `SELECT content FROM prompt_message
     WHERE conversation_id = $conv AND role = 'user' AND source != 'edit'
       AND (source = 'guidance') = $guidance
       AND (created < $created OR (created = $created AND id < $id))
     ORDER BY created DESC, id DESC LIMIT 1`,
    { conv: msg.conversation_id, guidance: msg.source === "guidance", created: msg.created, id: msg.id },
  )
  return [
    `题目：${task?.title ?? "（未知）"}`,
    `题目要求：${task ? briefOf(task.content) : "（无）"}`,
    `上一轮提问：${prev ? clip(prev.content) : "（这是第一轮）"}`,
    `这一轮提问：${clip(msg.content)}`,
  ].join("\n\n")
}

export async function classifyMessage(messageId: number): Promise<number | null> {
  const msg = get<{ id: number; content: string; source: string; conversation_id: string; created: string }>(
    `SELECT id, content, source, conversation_id, created FROM prompt_message
     WHERE id = $id AND role = 'user' AND source != 'edit'`,
    { id: messageId },
  )
  if (!msg) return null
  // “1”“，”“可以”这类太短，判断不出层级；清掉以前打的标签（--force 重标时）
  if ([...msg.content.trim()].length < MIN_PROMPT_CHARS) {
    run(`UPDATE prompt_message SET prompt_level = NULL WHERE id = $id`, { id: messageId })
    return null
  }
  const level = await callLlm(classifyInput(msg))
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
