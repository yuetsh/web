import { run } from "../db"

// Django 的 on_delete=CASCADE 是在应用层做的，这里手动按依赖顺序删除。
// 调用方负责包在事务里。

export function deleteSubmissions(where: string, params: Record<string, unknown>) {
  const ids = `SELECT id FROM submission_submission WHERE ${where}`
  run(`DELETE FROM submission_rating WHERE submission_id IN (${ids})`, params)
  run(`DELETE FROM submission_submissionaward WHERE submission_id IN (${ids})`, params)
  run(`DELETE FROM prompt_message WHERE submission_id IN (${ids})`, params)
  run(`DELETE FROM submission_submission WHERE ${where}`, params)
}

export function deleteTask(taskId: number) {
  const p = { task_id: taskId }
  deleteSubmissions("task_id = $task_id", p)
  run(
    `DELETE FROM prompt_message WHERE conversation_id IN
       (SELECT id FROM prompt_conversation WHERE task_id = $task_id)`,
    p,
  )
  run(`DELETE FROM prompt_conversation WHERE task_id = $task_id`, p)
  run(`DELETE FROM task_taskasset WHERE task_id = $task_id`, p)
  run(`DELETE FROM task_tutorial WHERE task_ptr_id = $task_id`, p)
  run(`DELETE FROM task_challenge WHERE task_ptr_id = $task_id`, p)
  run(`DELETE FROM task_creation WHERE task_ptr_id = $task_id`, p)
  run(`DELETE FROM task_task WHERE id = $task_id`, p)
}
