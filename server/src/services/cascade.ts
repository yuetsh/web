import { all, run } from "../db"

// Django 的 on_delete=CASCADE 是在应用层做的，这里手动按依赖顺序删除。
// 调用方负责包在事务里。

export function deleteSubmissions(where: string, params: Record<string, unknown>) {
  // 先查出 id 再逐个按等值删：prompt_message.submission_id 绝大多数是 NULL，
  // 统计信息会让 SQLite 觉得这个索引没用，写成 IN (子查询) 时它会扫整张大表（几百毫秒）
  const ids = all<{ id: string }>(`SELECT id FROM submission_submission WHERE ${where}`, params)
  for (const { id } of ids) {
    run(`DELETE FROM submission_rating WHERE submission_id = $id`, { id })
    run(`DELETE FROM submission_submissionaward WHERE submission_id = $id`, { id })
    run(`DELETE FROM prompt_message WHERE submission_id = $id`, { id })
  }
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
