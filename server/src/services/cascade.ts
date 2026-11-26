import { get, run, tx } from "../db"
import { getPrecedingUserMessage, type MessageRow } from "./prompt"

// 删除的共用规则。关联数据（代码、评分、作品展条目、反思、对话、关联的 AI 消息）
// 都靠外键的 ON DELETE CASCADE 一起删掉

// 被评过分或获过奖的提交只有超管能删
export const hasRatingsOrAwards = (submissionId: string) =>
  !!get(
    `SELECT 1 WHERE EXISTS (SELECT 1 FROM ratings WHERE submission_id = $id)
       OR EXISTS (SELECT 1 FROM award_items WHERE submission_id = $id)`,
    { id: submissionId },
  )

// 删除一轮对话：AI 回复、它前面那条用户提问，以及回复关联的提交
export function deleteRound(asst: MessageRow) {
  tx(() => {
    const userMsg = getPrecedingUserMessage(asst)
    if (userMsg) run(`DELETE FROM messages WHERE id = $id`, { id: userMsg.id })
    run(`DELETE FROM messages WHERE id = $id`, { id: asst.id })
    if (asst.submission_id) run(`DELETE FROM submissions WHERE id = $id`, { id: asst.submission_id })
  })
}

export function deleteTask(taskId: number) {
  run(`DELETE FROM tasks WHERE id = $id`, { id: taskId })
}
