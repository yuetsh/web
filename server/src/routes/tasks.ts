import { Hono } from "hono"
import { z } from "zod"
import { all, get, run, tx, now } from "../db"
import { Role, canSeeUnpublished, requireAdmin, requireSuper, requireUser, type User } from "../auth"
import { HttpError, body, bool, intParam, notFound, orNotFound, type Env } from "../http"
import { deleteTask } from "../services/cascade"

const TASK_COLUMNS = `t.id, t.created, t.modified, t.display, t.title, t.content, t.task_type,
  t.is_public, t.example_html, t.example_css, t.example_js`

function taskOut(t: any) {
  return {
    id: t.id,
    created: t.created,
    modified: t.modified,
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
  score?: number
  author_id?: number | null
  owner_id?: number | null
}) {
  const ts = now()
  const res = run(
    `INSERT INTO tasks (task_type, display, title, is_public, score, author_id, owner_id, created, modified,
       content, example_html, example_css, example_js)
     VALUES ($type, $display, $title, $is_public, $score, $author_id, $owner_id, $ts, $ts,
       $content, $example_html, $example_css, $example_js)`,
    {
      ts,
      type,
      display: p.display,
      title: p.title,
      content: p.content,
      is_public: p.is_public,
      score: p.score ?? 0,
      author_id: p.author_id ?? null,
      owner_id: p.owner_id ?? null,
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
    `UPDATE tasks SET modified = $ts, title = $title, content = $content, is_public = $is_public,
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
    `SELECT display, title, is_public FROM tasks WHERE id = $id`,
    { id },
  )!
  const isPublic = !t.is_public
  run(`UPDATE tasks SET is_public = $p, modified = $ts WHERE id = $id`, {
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
    `SELECT id FROM tasks WHERE task_type = 'tutorial' AND display = $display`,
    { display },
  )?.id

tutorial.get("/list", (c) => {
  requireSuper(c)
  const rows = all(
    `SELECT display, title, is_public FROM tasks WHERE task_type = 'tutorial' ORDER BY display`,
  )
  return c.json(rows.map((r) => ({ ...r, is_public: bool(r.is_public) })))
})

tutorial.get("/display", (c) => {
  const rows = all<{ display: number }>(
    `SELECT display FROM tasks WHERE task_type = 'tutorial' AND is_public = 1 ORDER BY display`,
  )
  return c.json(rows.map((r) => r.display))
})

tutorial.get("/:display", (c) => {
  const row = orNotFound(
    get(
      `SELECT ${TASK_COLUMNS} FROM tasks t WHERE t.task_type = 'tutorial' AND t.display = $display`,
      { display: intParam(c, "display") },
    ),
  )
  if (!row.is_public && !canSeeUnpublished(c.get("user"), "tutorial")) notFound()
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
  insertTask("tutorial", p)
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
  if (id) deleteTask(id)
  return c.json({ message: "删除成功" })
})

// ── 挑战 ──────────────────────────────────────────────────────────────────────

export const challenge = new Hono<Env>()

const CHALLENGE_SELECT = `SELECT ${TASK_COLUMNS}, t.score, t.pass_score, t.author_id,
    COALESCE(u.username, '') AS author_name
  FROM tasks t
  LEFT JOIN users u ON u.id = t.author_id`

const findChallenge = (display: number) =>
  get<{ id: number; author_id: number | null }>(
    `SELECT id, author_id FROM tasks WHERE task_type = 'challenge' AND display = $display`,
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
  return c.json(
    all(`${CHALLENGE_SELECT} WHERE t.task_type = 'challenge' ORDER BY t.display`).map(challengeSlim),
  )
})

challenge.get("/display", (c) => {
  const user = c.get("user")
  const rows = all(
    `${CHALLENGE_SELECT} WHERE t.task_type = 'challenge' AND t.is_public = 1 ORDER BY t.display DESC`,
  )
  const submitted = new Set(
    user
      ? all<{ task_id: number }>(
          `SELECT DISTINCT task_id FROM submissions WHERE user_id = $id`,
          { id: user.id },
        ).map((r) => r.task_id)
      : [],
  )
  return c.json(rows.map((r) => ({ ...challengeSlim(r), submitted: submitted.has(r.id) })))
})

challenge.get("/:display", (c) => {
  const r = orNotFound(
    get(`${CHALLENGE_SELECT} WHERE t.task_type = 'challenge' AND t.display = $display`, {
      display: intParam(c, "display"),
    }),
  )
  if (!r.is_public && !canSeeUnpublished(c.get("user"), "challenge")) notFound()
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
      run(`UPDATE tasks SET score = $score, author_id = COALESCE(author_id, $author) WHERE id = $id`, {
        id: existing.id,
        score: p.score,
        author: user.id,
      })
    })
    return c.json({ message: "更新成功" })
  }
  insertTask("challenge", { ...p, author_id: user.id })
  return c.json({ message: "创建成功" })
})

// 管理员保存挑战时本来就能设“公开”，这里和它保持一致
challenge.put("/public/:display", (c) => {
  requireAdmin(c)
  const found = orNotFound(findChallenge(intParam(c, "display")))
  return c.json(togglePublic(found.id))
})

challenge.delete("/:display", (c) => {
  requireAdmin(c)
  const found = findChallenge(intParam(c, "display"))
  if (found) deleteTask(found.id)
  return c.json({ message: "删除成功" })
})

// ── 自由创作 ──────────────────────────────────────────────────────────────────

export const creation = new Hono<Env>()

const CREATION_SELECT = `SELECT t.id, t.display, t.title, t.content, t.created, t.modified,
    t.html, t.css, t.js, t.owner_id, u.username AS owner_name
  FROM tasks t
  JOIN users u ON u.id = t.owner_id`

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
    created: r.created,
    modified: r.modified,
  }
}

function cleanTitle(title: string) {
  title = title.trim()
  if (!title) throw new HttpError(400, "主题名称不能为空")
  return [...title].slice(0, 100).join("")
}

function getOwned(user: User, display: number) {
  const r = orNotFound(
    get(`${CREATION_SELECT} WHERE t.task_type = 'creation' AND t.display = $display`, { display }),
  )
  if (r.owner_id !== user.id && user.role !== Role.SUPER) {
    throw new HttpError(403, "只能操作自己的创作")
  }
  return r
}

const loadCreation = (id: number) => get(`${CREATION_SELECT} WHERE t.id = $id`, { id })

const creationIn = z.object({ title: z.string(), content: z.string().default("") })

creation.get("/mine", (c) => {
  const user = requireUser(c)
  const rows = all(`${CREATION_SELECT} WHERE t.owner_id = $id ORDER BY t.created DESC`, {
    id: user.id,
  })
  return c.json(
    rows.map((r) => ({
      display: r.display,
      title: r.title,
      content: r.content,
      created: r.created,
      modified: r.modified,
      has_code: Boolean(r.html || r.css || r.js),
    })),
  )
})

creation.post("/", async (c) => {
  const user = requireUser(c)
  const p = await body(c, creationIn)
  const title = cleanTitle(p.title)
  // 序号在所有创作中自增；查最大值和插入之间没有 await，不会撞号
  const id = tx(() => {
    const last = get<{ display: number }>(
      `SELECT display FROM tasks WHERE task_type = 'creation' ORDER BY display DESC LIMIT 1`,
    )
    const id = insertTask("creation", {
      display: (last?.display ?? 0) + 1,
      title,
      content: p.content,
      is_public: false,
      owner_id: user.id,
    })
    run(`UPDATE tasks SET html = '', css = '', js = '' WHERE id = $id`, { id })
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
  run(`UPDATE tasks SET title = $title, content = $content, modified = $ts WHERE id = $id`, {
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
  run(`UPDATE tasks SET html = $html, css = $css, js = $js, modified = $ts WHERE id = $id`, {
    ...p,
    ts: now(),
    id: r.id,
  })
  return c.json(creationOut(loadCreation(r.id)))
})

creation.delete("/:display", (c) => {
  const user = requireUser(c)
  const r = getOwned(user, intParam(c, "display"))
  deleteTask(r.id)
  return c.json({ message: "删除成功" })
})
