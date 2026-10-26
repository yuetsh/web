import { all, get, run } from "../db"
import { Role } from "../auth"
import { pySum } from "./pyround"

const ROLE_WEIGHT: Record<string, number> = {
  [Role.SUPER]: 0.5,
  [Role.ADMIN]: 0.3,
}

function zoneFor(n: number, score: number): string | null {
  if (n < 5) return "pending"
  if (score >= 4.0) return "featured"
  if (score < 3.0) return "low"
  return null
}

/**
 * 重新计算提交的分数：按角色加权平均得到 raw_score，
 * 再用贝叶斯平均（C=3，全站平均分做先验）平滑得到 score，并更新分区。
 */
export function updateSubmissionScore(submissionId: string) {
  const ratings = all<{ score: number; role: string }>(
    `SELECT r.score, u.role FROM submission_rating r
     JOIN account_user u ON u.id = r.user_id
     WHERE r.submission_id = $id ORDER BY r.id`,
    { id: submissionId },
  )
  const n = ratings.length
  let rawScore = 0
  let score = 0

  if (n > 0) {
    const weights = ratings.map((r) => ROLE_WEIGHT[r.role] ?? 0.2)
    rawScore = pySum(ratings.map((r, i) => r.score * weights[i]!)) / pySum(weights)

    const C = 3
    const mean = get<{ avg: number | null }>(
      `SELECT AVG(raw_score) AS avg FROM submission_submission
       WHERE raw_score > 0 AND id != $id`,
      { id: submissionId },
    )?.avg
    const globalMean = mean || rawScore
    score = (C * globalMean + n * rawScore) / (C + n)
  }

  run(
    `UPDATE submission_submission
     SET raw_score = $raw, score = $score, zone = $zone WHERE id = $id`,
    { raw: rawScore, score, zone: zoneFor(n, score), id: submissionId },
  )
}
