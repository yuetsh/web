/**
 * 重新计算所有被评过分的提交的 score / raw_score / zone（修改评分规则后使用）。
 *
 *   bun scripts/recalculate-scores.ts [--dry-run]
 */
import { all, get } from "../src/db"
import { updateSubmissionScore } from "../src/services/score"

const rows = all<{ id: string; username: string; title: string; score: number }>(
  `SELECT s.id, u.username, t.title, s.score FROM submission_submission s
   JOIN account_user u ON u.id = s.user_id JOIN task_task t ON t.id = s.task_id
   WHERE EXISTS (SELECT 1 FROM submission_rating r WHERE r.submission_id = s.id)
   ORDER BY s.created DESC`,
)
console.log(`找到 ${rows.length} 个被评过分的提交`)
if (process.argv.includes("--dry-run")) process.exit(0)

for (const [i, s] of rows.entries()) {
  updateSubmissionScore(s.id)
  const after = get<{ score: number; zone: string | null }>(
    `SELECT score, zone FROM submission_submission WHERE id = $id`,
    { id: s.id },
  )!
  console.log(
    `[${i + 1}/${rows.length}] ${s.username}/${s.title}: ${s.score.toFixed(3)} → ${after.score.toFixed(3)}  zone=${after.zone}`,
  )
}
console.log("完成")
