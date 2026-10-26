import { Hono } from "hono"
import { z } from "zod"
import { all, get, run, tx, now, iso } from "../db"
import { Role, requireAdmin, requireSuper, requireUser, type User } from "../auth"
import { HttpError, body, bool, intParam, orNotFound, type Env } from "../http"
import { deleteTask } from "../services/cascade"

const TASK_COLUMNS = `t.id, t.created, t.modified, t.display, t.title, t.content, t.task_type,
  t.is_public, t.example_html, t.example_css, t.example_js`

function taskOut(t: any) {
  return {
    id: t.id,
    task_ptr: t.id,
    created: iso(t.created),
    modified: iso(t.modified),
    display: t.display,
    title: t.title,
    content: t.content,
    task_type: t.task_type,
    is_public: bool(t.is_public),
    example_html: t.example_html,
    example_css: t.example_css,
    example_js: t.example_js,
  }
}

function insertTask(type: string, p: {
  display: number
  title: string
  content: string
  is_public: boolean
  example_html?: string | null
  example_css?: string | null
  example_js?: string | null
}) {
  const ts = now()
  const res = run(
    `INSERT INTO task_task (created, modified, display, title, content, task_type, is_public, example_html, example_css, example_js)
     VALUES ($ts, $ts, $display, $title, $content, $type, $is_public, $example_html, $example_css, $example_js)`,
    {
      ts,
      type,
      display: p.display,
      title: p.title,
      content: p.content,
      is_public: p.is_public,
      example_html: p.example_html ?? null,
      example_css: p.example_css ?? null,
      example_js: p.example_js ?? null,
    },
  )
  return Number(res.lastInsertRowid)
}

function updateTask(id: number, p: {
  title: string
  content: string
  is_public: boolean
  example_html?: string | null
  example_css?: string | null
  example_js?: string | null
}) {
  run(
    `UPDATE task_task SET modified = $ts, title = $title, content = $content, is_public = $is_public,
       example_html = $example_html, example_css = $example_css, example_js = $example_js
     WHERE id = $id`,
    {
      id,
      ts: now(),
      title: p.title,
      content: p.content,
      is_public: p.is_public,
      example_html: p.example_html ?? null,
      example_css: p.example_css ?? null,
      example_js: p.example_js ?? null,
    },
  )
}

function togglePublic(id: number) {
  const t = get<{ display: number; title: string; is_public: number }>(
    `SELECT display, title, is_public FROM task_task WHERE id = $id`,
    { id },
  )!
  const isPublic = !t.is_public
  run(`UPDATE task_task SET is_public = $p, modified = $ts WHERE id = $id`, {
    p: isPublic,
    ts: now(),
    id,
  })
  return { message: `【${t.display}】${t.title} 已${isPublic ? "公开" : "隐藏"}` }
}

const exampleFields = {
  example_html: z.string().nullable().optional(),
  example_css: z.string().nullable().optional(),
  example_js: z.string().nullable().optional(),
}

// ── 教程 ──────────────────────────────────────────────────────────────────────

export const tutorial = new Hono<Env>()

const findTutorialId = (display: number) =>
  get<{ id: number }>(
    `SELECT t.id FROM task_task t JOIN task_tutorial x ON x.task_ptr_id = t.id
     WHERE t.display = $display`,
    { display },
  )?.id

tutorial.get("/list", (c) => {
  requireSuper(c)
  const rows = all(
    `SELECT t.display, t.title, t.is_public FROM task_task t
     JOIN task_tutorial x ON x.task_ptr_id = t.id ORDER BY t.display`,
  )
  return c.json(rows.map((r) => ({ ...r, is_public: bool(r.is_public) })))
})

tutorial.get("/display", (c) => {
  const rows = all<{ display: number }>(
    `SELECT t.display FROM task_task t JOIN task_tutorial x ON x.task_ptr_id = t.id
     WHERE t.is_public = 1 ORDER BY t.display`,
  )
  return c.json(rows.map((r) => r.display))
})

tutorial.get("/:display", (c) => {
  const row = orNotFound(
    get(
      `SELECT ${TASK_COLUMNS} FROM task_task t JOIN task_tutorial x ON x.task_ptr_id = t.id
       WHERE t.display = $display`,
      { display: intParam(c, "display") },
    ),
  )
  return c.json(taskOut(row))
})

tutorial.post("/", async (c) => {
  requireSuper(c)
  const p = await body(
    c,
    z.object({
      display: z.number().int(),
      title: z.string(),
      content: z.string(),
      is_public: z.boolean().default(false),
      ...exampleFields,
    }),
  )
  const id = findTutorialId(p.display)
  if (id) {
    updateTask(id, p)
    return c.json({ message: "更新成功" })
  }
  tx(() => {
    const newId = insertTask("tutorial", p)
    run(`INSERT INTO task_tutorial (task_ptr_id) VALUES ($id)`, { id: newId })
  })
  return c.json({ message: "创建成功" })
})

tutorial.put("/public/:display", (c) => {
  requireSuper(c)
  const id = orNotFound(findTutorialId(intParam(c, "display")))
  return c.json(togglePublic(id))
})

tutorial.delete("/:display", (c) => {
  requireSuper(c)
  const id = findTutorialId(intParam(c, "display"))
  if (id) tx(() => deleteTask(id))
  return c.json({ message: "删除成功" })
})

// ── 挑战 ──────────────────────────────────────────────────────────────────────

export const challenge = new Hono<Env>()

const CHALLENGE_SELECT = `SELECT ${TASK_COLUMNS}, x.score, x.pass_score, x.author_id,
    COALESCE(u.username, '') AS author_name
  FROM task_task t
  JOIN task_challenge x ON x.task_ptr_id = t.id
  LEFT JOIN account_user u ON u.id = x.author_id`

const findChallenge = (display: number) =>
  get<{ id: number; author_id: number | null }>(
    `SELECT t.id, x.author_id FROM task_task t JOIN task_challenge x ON x.task_ptr_id = t.id
     WHERE t.display = $display`,
    { display },
  )

function challengeSlim(r: any) {
  return {
    display: r.display,
    title: r.title,
    score: r.score,
    pass_score: r.pass_score,
    is_public: bool(r.is_public),
    author_name: r.author_name,
  }
}

challenge.get("/list", (c) => {
  requireAdmin(c)
  return c.json(all(`${CHALLENGE_SELECT} ORDER BY t.display`).map(challengeSlim))
})

challenge.get("/display", (c) => {
  const user = c.get("user")
  const rows = all(`${CHALLENGE_SELECT} WHERE t.is_public = 1 ORDER BY t.display DESC`)
  const submitted = new Set(
    user
      ? all<{ task_id: number }>(
          `SELECT DISTINCT task_id FROM submission_submission WHERE user_id = $id`,
          { id: user.id },
        ).map((r) => r.task_id)
      : [],
  )
  return c.json(rows.map((r) => ({ ...challengeSlim(r), submitted: submitted.has(r.id) })))
})

challenge.get("/:display", (c) => {
  const r = orNotFound(
    get(`${CHALLENGE_SELECT} WHERE t.display = $display`, {
      display: intParam(c, "display"),
    }),
  )
  return c.json({
    ...taskOut(r),
    score: r.score,
    pass_score: r.pass_score,
    author: r.author_id,
    author_name: r.author_name,
  })
})

challenge.post("/", async (c) => {
  const user = requireAdmin(c)
  const p = await body(
    c,
    z.object({
      display: z.number().int(),
      title: z.string(),
      content: z.string(),
      score: z.number().int().default(0),
      is_public: z.boolean().default(false),
      ...exampleFields,
    }),
  )
  const existing = findChallenge(p.display)
  if (existing) {
    tx(() => {
      updateTask(existing.id, p)
      run(
        `UPDATE task_challenge SET score = $score, author_id = COALESCE(author_id, $author)
         WHERE task_ptr_id = $id`,
        { id: existing.id, score: p.score, author: user.id },
      )
    })
    return c.json({ message: "更新成功" })
  }
  tx(() => {
    const id = insertTask("challenge", p)
    run(
      `INSERT INTO task_challenge (task_ptr_id, score, pass_score, author_id)
       VALUES ($id, $score, NULL, $author)`,
      { id, score: p.score, author: user.id },
    )
  })
  return c.json({ message: "创建成功" })
})

challenge.put("/public/:display", (c) => {
  requireSuper(c)
  const found = orNotFound(findChallenge(intParam(c, "display")))
  return c.json(togglePublic(found.id))
})

challenge.delete("/:display", (c) => {
  requireAdmin(c)
  const found = findChallenge(intParam(c, "display"))
  if (found) tx(() => deleteTask(found.id))
  return c.json({ message: "删除成功" })
})

// ── 自由创作 ──────────────────────────────────────────────────────────────────

export const creation = new Hono<Env>()

const CREATION_SELECT = `SELECT t.id, t.display, t.title, t.content, t.created, t.modified,
    x.html, x.css, x.js, x.owner_id, u.username AS owner_name
  FROM task_task t
  JOIN task_creation x ON x.task_ptr_id = t.id
  JOIN account_user u ON u.id = x.owner_id`

function creationOut(r: any) {
  return {
    task_id: r.id,
    display: r.display,
    title: r.title,
    content: r.content,
    html: r.html,
    css: r.css,
    js: r.js,
    owner_name: r.owner_name,
    created: iso(r.created),
    modified: iso(r.modified),
  }
}

function cleanTitle(title: string) {
  title = title.trim()
  if (!title) throw new HttpError(400, "主题名称不能为空")
  return [...title].slice(0, 100).join("")
}

function getOwned(user: User, display: number) {
  const r = orNotFound(get(`${CREATION_SELECT} WHERE t.display = $display`, { display }))
  if (r.owner_id !== user.id && user.role !== Role.SUPER) {
    throw new HttpError(403, "只能操作自己的创作")
  }
  return r
}

const loadCreation = (id: number) => get(`${CREATION_SELECT} WHERE t.id = $id`, { id })

const creationIn = z.object({ title: z.string(), content: z.string().default("") })

creation.get("/mine", (c) => {
  const user = requireUser(c)
  const rows = all(`${CREATION_SELECT} WHERE x.owner_id = $id ORDER BY t.created DESC`, {
    id: user.id,
  })
  return c.json(
    rows.map((r) => ({
      display: r.display,
      title: r.title,
      content: r.content,
      created: iso(r.created),
      modified: iso(r.modified),
      has_code: Boolean(r.html || r.css || r.js),
    })),
  )
})

creation.post("/", async (c) => {
  const user = requireUser(c)
  const p = await body(c, creationIn)
  const title = cleanTitle(p.title)
  const id = tx(() => {
    // 序号在所有创作中自增
    const last = get<{ display: number }>(
      `SELECT t.display FROM task_task t JOIN task_creation x ON x.task_ptr_id = t.id
       ORDER BY t.display DESC LIMIT 1`,
    )
    const id = insertTask("creation", {
      display: (last?.display ?? 0) + 1,
      title,
      content: p.content,
      is_public: false,
    })
    run(
      `INSERT INTO task_creation (task_ptr_id, html, css, js, owner_id) VALUES ($id, '', '', '', $owner)`,
      { id, owner: user.id },
    )
    return id
  })
  return c.json(creationOut(loadCreation(id)))
})

creation.get("/:display", (c) => {
  const user = requireUser(c)
  return c.json(creationOut(getOwned(user, intParam(c, "display"))))
})

creation.put("/:display", async (c) => {
  const user = requireUser(c)
  const r = getOwned(user, intParam(c, "display"))
  const p = await body(c, creationIn)
  run(`UPDATE task_task SET title = $title, content = $content, modified = $ts WHERE id = $id`, {
    title: cleanTitle(p.title),
    content: p.content,
    ts: now(),
    id: r.id,
  })
  return c.json(creationOut(loadCreation(r.id)))
})

creation.put("/:display/code", async (c) => {
  const user = requireUser(c)
  const r = getOwned(user, intParam(c, "display"))
  const p = await body(
    c,
    z.object({
      html: z.string().default(""),
      css: z.string().default(""),
      js: z.string().default(""),
    }),
  )
  tx(() => {
    run(`UPDATE task_creation SET html = $html, css = $css, js = $js WHERE task_ptr_id = $id`, {
      ...p,
      id: r.id,
    })
    run(`UPDATE task_task SET modified = $ts WHERE id = $id`, { ts: now(), id: r.id })
  })
  return c.json(creationOut(loadCreation(r.id)))
})

creation.delete("/:display", (c) => {
  const user = requireUser(c)
  const r = getOwned(user, intParam(c, "display"))
  tx(() => deleteTask(r.id))
  return c.json({ message: "删除成功" })
})
