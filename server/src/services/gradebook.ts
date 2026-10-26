import { all } from "../db"
import { uuidOut } from "../db"
import { HttpError } from "../http"
import { pyRound, pySum } from "./pyround"

export type GradebookTaskType = "tutorial" | "challenge"
type Grade = "A" | "B" | "C" | "D" | "E"

export interface GradebookFilters {
  classname: string
  task_type?: GradebookTaskType
  username?: string
  include_all_tasks?: boolean
}

interface GradebookTask {
  id: number
  display: number
  title: string
  task_type: string
  submitted_count: number
  coverage: number
  included: boolean
}

interface GradebookRow {
  user_id: number
  username: string
  classname: string
  rank: number
  grade: Grade
  assessment_grade: Grade
  assessment_score: number
  top3_score: number
  scores: Record<number, { score: number; submitted: boolean; submission_id: string | null }>
  tutorial_total: number
  challenge_total: number
  total_score: number
  average_score: number | null
  submitted_task_count: number
  missing_task_count: number
}

export interface Gradebook {
  classname: string
  classes: string[]
  task_count: number
  included_task_count: number
  student_count: number
  coverage_threshold_count: number
  tasks: GradebookTask[]
  rows: GradebookRow[]
}

const score = (value: number | null | undefined) => pyRound(value || 0, 2)

// Python 字符串比较（按码点），不能用 localeCompare
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function gradeForRank(rank: number, n: number): Grade {
  if (rank <= Math.ceil(0.3 * n)) return "A"
  if (rank <= Math.ceil(0.7 * n)) return "B"
  if (rank <= Math.ceil(0.9 * n)) return "C"
  if (rank <= Math.ceil(0.95 * n)) return "D"
  return "E"
}

// 考核等级：A10% B20% C40% D20% E10%，按最高三次提交均分排名
function assessmentGradeForRank(rank: number, n: number): Grade {
  if (rank <= Math.ceil(0.1 * n)) return "A"
  if (rank <= Math.ceil(0.3 * n)) return "B"
  if (rank <= Math.ceil(0.7 * n)) return "C"
  if (rank <= Math.ceil(0.9 * n)) return "D"
  return "E"
}

// 考核分数：各等级对应的分数段（高分→低分），段内按名次线性铺开；最高分封顶 99
const ASSESSMENT_SCORE_BANDS: Record<Grade, [number, number]> = {
  A: [92, 99],
  B: [84, 91],
  C: [76, 83],
  D: [68, 75],
  E: [60, 67],
}

function assessmentScore(indexInGrade: number, gradeSize: number, grade: Grade) {
  const [low, high] = ASSESSMENT_SCORE_BANDS[grade]
  if (gradeSize <= 1) return high
  // 段内第 1 名拿段顶，最后 1 名拿段底
  return pyRound(high - (indexInGrade / (gradeSize - 1)) * (high - low))
}

export function buildGradebook(filters: GradebookFilters): Gradebook {
  const classname = filters.classname?.trim() ?? ""
  if (!classname) throw new HttpError(400, "请选择班级")

  const classes = all<{ classname: string }>(
    `SELECT DISTINCT classname FROM account_user
     WHERE role IN ('normal', 'admin') AND classname != '' ORDER BY classname`,
  ).map((r) => r.classname)

  const students = all<{ id: number; username: string; classname: string }>(
    `SELECT id, username, classname FROM account_user
     WHERE role IN ('normal', 'admin') AND classname = $classname
     ORDER BY username, id`,
    { classname },
  )
  const studentCount = students.length
  const coverageThreshold = studentCount ? Math.ceil(studentCount * 0.5) : 0

  const typeFilter = filters.task_type ? `AND t.task_type = $task_type` : ""
  const typeParams = filters.task_type ? { task_type: filters.task_type } : {}

  const taskRows = all<{ id: number; display: number; title: string; task_type: string; submitted_count: number }>(
    `SELECT t.id, t.display, t.title, t.task_type, COUNT(DISTINCT s.user_id) AS submitted_count
     FROM submission_submission s
     JOIN task_task t ON t.id = s.task_id
     JOIN account_user u ON u.id = s.user_id
     WHERE u.role IN ('normal', 'admin') AND u.classname = $classname ${typeFilter}
     GROUP BY t.id`,
    { classname, ...typeParams },
  )
  taskRows.sort(
    (a, b) =>
      (a.task_type === "tutorial" ? 0 : 1) - (b.task_type === "tutorial" ? 0 : 1) ||
      a.display - b.display ||
      a.id - b.id,
  )

  const allTasks: GradebookTask[] = taskRows.map((t) => ({
    id: t.id,
    display: t.display,
    title: t.title,
    task_type: t.task_type,
    submitted_count: t.submitted_count,
    coverage: studentCount ? score(t.submitted_count / studentCount) : 0,
    included: studentCount > 0 && t.submitted_count >= coverageThreshold,
  }))

  const tasks = allTasks.filter((t) => filters.include_all_tasks || t.included)
  const visibleTaskIds = new Set(tasks.map((t) => t.id))
  const includedTaskCount = tasks.filter((t) => t.included).length

  // 每个 (学生, 任务) 取最高分的提交；同分取最新
  const best = new Map<string, { id: string; score: number }>()
  if (studentCount && visibleTaskIds.size) {
    const subs = all<{ id: string; user_id: number; task_id: number; score: number }>(
      `SELECT s.id, s.user_id, s.task_id, s.score
       FROM submission_submission s JOIN account_user u ON u.id = s.user_id
       WHERE u.role IN ('normal', 'admin') AND u.classname = $classname
       ORDER BY s.user_id, s.task_id, s.score DESC, s.created DESC, s.id DESC`,
      { classname },
    )
    for (const s of subs) {
      if (!visibleTaskIds.has(s.task_id)) continue
      const key = `${s.user_id}:${s.task_id}`
      if (!best.has(key)) best.set(key, s)
    }
  }

  let rows: GradebookRow[] = students.map((student) => {
    const scores: GradebookRow["scores"] = {}
    let tutorialTotal = 0
    let challengeTotal = 0
    const submittedScores: number[] = []
    let submittedTaskCount = 0
    let missingTaskCount = 0

    for (const task of tasks) {
      const sub = best.get(`${student.id}:${task.id}`)
      const cellScore = sub ? score(sub.score) : 0
      scores[task.id] = {
        score: cellScore,
        submitted: !!sub,
        submission_id: sub ? uuidOut(sub.id) : null,
      }
      if (!task.included) continue
      if (sub) {
        submittedTaskCount++
        submittedScores.push(cellScore)
      } else {
        missingTaskCount++
      }
      if (task.task_type === "tutorial") tutorialTotal += cellScore
      else challengeTotal += cellScore
    }

    tutorialTotal = score(tutorialTotal)
    challengeTotal = score(challengeTotal)
    const top3 = submittedScores.sort((a, b) => b - a).slice(0, 3)
    const top3Score = top3.length ? score(pySum(top3) / top3.length) : 0
    const totalScore = score(tutorialTotal + challengeTotal)
    return {
      user_id: student.id,
      username: student.username,
      classname: student.classname,
      rank: 0,
      grade: "E",
      assessment_grade: "E",
      assessment_score: 60,
      top3_score: top3Score,
      scores,
      tutorial_total: tutorialTotal,
      challenge_total: challengeTotal,
      total_score: totalScore,
      average_score: includedTaskCount ? score(totalScore / includedTaskCount) : null,
      submitted_task_count: submittedTaskCount,
      missing_task_count: missingTaskCount,
    }
  })

  rows.sort((a, b) => b.total_score - a.total_score || cmp(a.username, b.username))
  rows.forEach((row, i) => {
    row.rank = i + 1
    row.grade = gradeForRank(i + 1, studentCount)
  })

  // 考核等级：按最高三次提交均分单独排名后定级（不改变上面的总分排名）
  const assessmentOrder = [...rows].sort(
    (a, b) => b.top3_score - a.top3_score || cmp(a.username, b.username),
  )
  assessmentOrder.forEach((row, i) => {
    row.assessment_grade = assessmentGradeForRank(i + 1, studentCount)
  })

  // 考核分数：在各等级段内按名次线性铺开到对应分数段
  const groups = new Map<Grade, GradebookRow[]>()
  for (const row of assessmentOrder) {
    const g = groups.get(row.assessment_grade) ?? []
    g.push(row)
    groups.set(row.assessment_grade, g)
  }
  for (const [grade, group] of groups) {
    group.forEach((row, i) => {
      row.assessment_score = assessmentScore(i, group.length, grade)
    })
  }

  const username = filters.username?.trim().toLowerCase() ?? ""
  if (username) rows = rows.filter((r) => r.username.toLowerCase().includes(username))

  return {
    classname,
    classes,
    task_count: tasks.length,
    included_task_count: includedTaskCount,
    student_count: studentCount,
    coverage_threshold_count: coverageThreshold,
    tasks,
    rows,
  }
}

function csvNumber(value: number) {
  if (Number.isInteger(value)) return String(value)
  return pyRound(value, 2).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
}

const taskTypeLabel = (t: string) => (t === "tutorial" ? "教程" : "挑战")

export function gradebookCsvRows(gb: Gradebook): (string | number)[][] {
  const rows: (string | number)[][] = [
    [
      "排名",
      "平时等级",
      "考核等级",
      "考核分数",
      "用户名",
      "班级",
      ...gb.tasks.map((t) => `${taskTypeLabel(t.task_type)}${t.display}-${t.title}`),
      "教程合计",
      "挑战合计",
      "总分",
      "平均分",
      "已提交任务数",
      "未提交任务数",
    ],
  ]
  for (const row of gb.rows) {
    rows.push([
      row.rank,
      row.grade,
      row.assessment_grade,
      row.assessment_score,
      row.username,
      row.classname,
      ...gb.tasks.map((t) => csvNumber(row.scores[t.id]!.score)),
      csvNumber(row.tutorial_total),
      csvNumber(row.challenge_total),
      csvNumber(row.total_score),
      row.average_score === null ? "" : csvNumber(row.average_score),
      row.submitted_task_count,
      row.missing_task_count,
    ])
  }
  return rows
}

// 与 Python csv 模块默认行为一致：含逗号/引号/换行时加引号，行尾 \r\n
export function toCsv(rows: (string | number)[][]) {
  const cell = (v: string | number) => {
    const s = String(v)
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"
}
