/**
 * 用大模型给学生提示词标注布鲁姆认知层级（L1-L6）。
 *
 *   bun scripts/classify-prompts.ts [--task-id N] [--force] [--dry-run]
 *
 * 默认只处理还没有层级的用户消息；--force 重新标注全部。
 */
import { parseArgs } from "node:util"
import { all } from "../src/db"
import { classifyMessage } from "../src/services/classifier"
import { llmConfigured } from "../src/services/llm"

const { values } = parseArgs({
  options: {
    "task-id": { type: "string" },
    force: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
})

const where = ["m.role = 'user'", "m.source != 'edit'"]
const params: Record<string, unknown> = {}
if (values["task-id"]) {
  where.push("c.task_id = $task_id")
  params.task_id = Number(values["task-id"])
}
if (!values.force) where.push("m.prompt_level IS NULL")

const ids = all<{ id: number }>(
  `SELECT m.id FROM prompt_message m JOIN prompt_conversation c ON c.id = m.conversation_id
   WHERE ${where.join(" AND ")} ORDER BY m.created, m.id`,
  params,
).map((r) => r.id)

console.log(`找到 ${ids.length} 条消息需要标注`)
if (values["dry-run"]) process.exit(0)
if (!llmConfigured()) {
  console.error("没有配置 LLM_API_KEY")
  process.exit(1)
}

for (const [i, id] of ids.entries()) {
  const level = await classifyMessage(id)
  console.log(`[${i + 1}/${ids.length}] msg#${id} → ${level ? `L${level}` : "(跳过)"}`)
  await Bun.sleep(300)
}
console.log("完成")
