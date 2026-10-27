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
// 不传班级时：所有有班级的学生
const ALL_MEMBERS = `SELECT id FROM account_user
  WHERE classname != '' AND role IN ('normal', 'admin') AND is_active = 1`

function members(classname: string | undefined) {
  return classname
    ? { sql: CLASS_MEMBERS, params: { classname } as Record<string, unknown> }
    : { sql: ALL_MEMBERS, params: {} as Record<string, unknown> }
}

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
// 不传 classname 就是全部班级
router.get("/progress", (c) => {
  requireStaff(requireUser(c))
  const { classname } = query(c, z.object({ classname: z.string().min(1).optional() }))
  const m = members(classname)
  const studentCount = get<{ n: number }>(`SELECT COUNT(*) AS n FROM (${m.sql})`, m.params)!.n
  const rows = all<{ task_id: number; n: number }>(
    `SELECT s.task_id, COUNT(DISTINCT s.user_id) AS n FROM submission_submission s
     WHERE s.user_id IN (${m.sql}) GROUP BY s.task_id`,
    m.params,
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
  const q = query(
    c,
    z.object({ classname: z.string().min(1).optional(), task_id: z.coerce.number().int() }),
  )
  orNotFound(get(`SELECT 1 FROM task_task WHERE id = $id`, { id: q.task_id }), "任务不存在")
  const m = members(q.classname)
  const students = all<{ id: number; username: string; classname: string }>(
    `SELECT id, username, classname FROM account_user WHERE id IN (${m.sql})
     ORDER BY classname, username, id`,
    m.params,
  )
  const latest = latestByUser(q.task_id, m.sql, m.params)
  const rows = loadRows([...latest.values()].map((l) => l.rid), user.id)
  return c.json(
    students.map((s) => {
      const r = rows.get(s.id)
      return {
        user_id: s.id,
        username: s.username,
        classname: s.classname,
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

// 学生看同学在这道题上的作品：自己交过才开放；自己打分之前不显示作者和得分。
// scope=class 只看本班（默认，一个班几十份），scope=all 看全校所有班
router.get("/peers/:task_id", (c) => {
  const user = requireUser(c)
  const taskId = intParam(c, "task_id")
  const { scope } = query(c, z.object({ scope: z.enum(["class", "all"]).default("class") }))
  orNotFound(get(`SELECT 1 FROM task_task WHERE id = $id`, { id: taskId }), "任务不存在")
  const submitted = get(
    `SELECT 1 FROM submission_submission WHERE user_id = $me AND task_id = $task_id LIMIT 1`,
    { me: user.id, task_id: taskId },
  )
  if (!submitted) return c.json({ locked: true, items: [] })
  const byClass = scope === "class" && !!user.classname
  const members = `SELECT id FROM account_user
    WHERE role = 'normal' AND is_active = 1 AND id != $me
      ${byClass ? "AND classname = $classname" : ""}`
  const params = byClass ? { classname: user.classname, me: user.id } : { me: user.id }
  const latest = latestByUser(taskId, members, params)
  const rows = loadRows([...latest.values()].map((l) => l.rid), user.id)
  const people = new Map(
    all<{ id: number; username: string; classname: string }>(
      `SELECT id, username, classname FROM account_user WHERE id IN (${members})`,
      params,
    ).map((u) => [u.id, u]),
  )
  const items = [...rows.values()]
    .sort((a, b) => (a.created < b.created ? 1 : -1))
    .map((r) => {
      const rated = (r.my_score || 0) > 0
      const p = people.get(r.user_id)
      return {
        id: uuidOut(r.id),
        username: rated ? p?.username : null,
        // 班级不算身份信息，打分前也显示
        classname: p?.classname ?? "",
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
