import { Hono } from "hono"
import { z } from "zod"
import { all, get, iso, uuidOut } from "../db"
import { isStaff, requireUser, type User } from "../auth"
import { HttpError, intParam, orNotFound, query, type Env } from "../http"

// 老师按“班级 × 任务”批改，学生看本班同学的作品。挂在 /submission/review 下
const router = new Hono<Env>()

function requireStaff(user: User) {
  if (!isStaff(user)) throw new HttpError(403, "没有权限")
}

// 和成绩册一致：班里的学生包括当助教的 admin
const CLASS_MEMBERS = `SELECT id FROM account_user
  WHERE classname = $classname AND role IN ('normal', 'admin') AND is_active = 1`

// 每个人在这个任务上最新的一次提交，以及提交了几次。
// 先只在 slim 覆盖索引上找，再按 rowid 读这几行的完整内容（代码是宽列，见 CLAUDE.md）
function latestByUser(taskId: number, members: string, params: Record<string, unknown>) {
  const rows = all<{ rid: number; user_id: number; created: string }>(
    `SELECT s.rowid AS rid, s.user_id, s.created FROM submission_submission s
     WHERE s.task_id = $task_id AND s.user_id IN (${members})`,
    { task_id: taskId, ...params },
  )
  const latest = new Map<number, { rid: number; created: string; count: number }>()
  for (const r of rows) {
    const cur = latest.get(r.user_id)
    if (!cur) latest.set(r.user_id, { rid: r.rid, created: r.created, count: 1 })
    else {
      cur.count++
      if (r.created > cur.created) Object.assign(cur, { rid: r.rid, created: r.created })
    }
  }
  return latest
}

function loadRows(rids: number[], me: number) {
  if (!rids.length) return new Map<number, any>()
  const rows = all(
    `SELECT s.rowid AS rid, s.id, s.user_id, s.score, s.html, s.css, s.js, s.flag,
       s.view_count, s.created,
       (SELECT r.score FROM submission_rating r WHERE r.user_id = $me AND r.submission_id = s.id) AS my_score,
       (SELECT COUNT(*) FROM submission_rating r WHERE r.submission_id = s.id) AS rating_count
     FROM submission_submission s WHERE s.rowid IN (SELECT value FROM json_each($rids))`,
    { rids: JSON.stringify(rids), me },
  )
  return new Map(rows.map((r) => [r.user_id as number, r]))
}

// 班级列表和可批改的任务（教程、挑战）
router.get("/options", (c) => {
  requireStaff(requireUser(c))
  const classes = all<{ classname: string }>(
    `SELECT DISTINCT classname FROM account_user
     WHERE role IN ('normal', 'admin') AND classname != '' ORDER BY classname`,
  ).map((r) => r.classname)
  const tasks = all(
    `SELECT id, task_type, display, title, is_public FROM task_task
     WHERE task_type IN ('tutorial', 'challenge')
     ORDER BY task_type = 'challenge', display`,
  ).map((t) => ({ ...t, is_public: !!t.is_public }))
  return c.json({ classes, tasks })
})

// 一个班每个任务交了几个人
router.get("/progress", (c) => {
  requireStaff(requireUser(c))
  const { classname } = query(c, z.object({ classname: z.string().min(1) }))
  const studentCount = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM (${CLASS_MEMBERS})`,
    { classname },
  )!.n
  const rows = all<{ task_id: number; n: number }>(
    `SELECT s.task_id, COUNT(DISTINCT s.user_id) AS n FROM submission_submission s
     WHERE s.user_id IN (${CLASS_MEMBERS}) GROUP BY s.task_id`,
    { classname },
  )
  return c.json({
    student_count: studentCount,
    submitted: Object.fromEntries(rows.map((r) => [r.task_id, r.n])),
  })
})

// 作品墙：班里每个学生在这个任务上最新的一次提交（没交的 submission 为 null）
router.get("/class", (c) => {
  const user = requireUser(c)
  requireStaff(user)
  const q = query(c, z.object({ classname: z.string().min(1), task_id: z.coerce.number().int() }))
  orNotFound(get(`SELECT 1 FROM task_task WHERE id = $id`, { id: q.task_id }), "任务不存在")
  const students = all<{ id: number; username: string }>(
    `SELECT id, username FROM account_user
     WHERE classname = $classname AND role IN ('normal', 'admin') AND is_active = 1
     ORDER BY username, id`,
    { classname: q.classname },
  )
  const latest = latestByUser(q.task_id, CLASS_MEMBERS, { classname: q.classname })
  const rows = loadRows([...latest.values()].map((l) => l.rid), user.id)
  return c.json(
    students.map((s) => {
      const r = rows.get(s.id)
      return {
        user_id: s.id,
        username: s.username,
        submission: r
          ? {
              id: uuidOut(r.id),
              score: r.score,
              my_score: r.my_score || 0,
              rating_count: r.rating_count,
              flag: r.flag,
              view_count: r.view_count,
              submit_count: latest.get(s.id)!.count,
              created: iso(r.created),
              html: r.html,
              css: r.css,
              js: r.js,
            }
          : null,
      }
    }),
  )
})

// 学生看本班同学在这道题上的作品：自己交过才开放；自己打分之前不显示作者和得分
router.get("/peers/:task_id", (c) => {
  const user = requireUser(c)
  const taskId = intParam(c, "task_id")
  orNotFound(get(`SELECT 1 FROM task_task WHERE id = $id`, { id: taskId }), "任务不存在")
  const submitted = get(
    `SELECT 1 FROM submission_submission WHERE user_id = $me AND task_id = $task_id LIMIT 1`,
    { me: user.id, task_id: taskId },
  )
  if (!submitted || !user.classname) return c.json({ locked: true, items: [] })
  const members = `SELECT id FROM account_user
    WHERE classname = $classname AND role = 'normal' AND is_active = 1 AND id != $me`
  const params = { classname: user.classname, me: user.id }
  const latest = latestByUser(taskId, members, params)
  const rows = loadRows([...latest.values()].map((l) => l.rid), user.id)
  const names = new Map(
    all<{ id: number; username: string }>(`SELECT id, username FROM account_user WHERE id IN (${members})`, params).map(
      (u) => [u.id, u.username],
    ),
  )
  const items = [...rows.values()]
    .sort((a, b) => (a.created < b.created ? 1 : -1))
    .map((r) => {
      const rated = (r.my_score || 0) > 0
      return {
        id: uuidOut(r.id),
        username: rated ? names.get(r.user_id) : null,
        score: rated ? r.score : null,
        my_score: r.my_score || 0,
        created: iso(r.created),
        html: r.html,
        css: r.css,
        js: r.js,
      }
    })
  return c.json({ locked: false, items })
})

export default router
