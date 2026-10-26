import { Hono } from "hono"
import { mkdir, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, extname, join, resolve, sep } from "node:path"
import { config } from "../config"
import { all, get, run } from "../db"
import { canSeeUnpublished, requireAdmin, requireSuper, type User } from "../auth"
import { HttpError, ValidationError, intParam, notFound, orNotFound, type Ctx, type Env } from "../http"

// 与 Django 的 get_valid_filename 一致：空格换成下划线，去掉除字母数字、-、_、. 以外的字符
export function validFilename(name: string) {
  const s = name.trim().replaceAll(" ", "_").replace(/[^-\p{L}\p{N}_.]/gu, "")
  if (!s || s === "." || s === "..") throw new HttpError(400, `无效的文件名：${name}`)
  return s
}

// 解析 media 下的相对路径，防止越出 media 目录
export function mediaPath(relative: string) {
  const root = config.mediaRoot
  const full = resolve(root, relative)
  if (full !== root && !full.startsWith(root + sep)) throw new HttpError(400, "无效的路径")
  return full
}

async function saveFile(relative: string, file: File) {
  let target = relative
  // 同名文件已存在时加随机后缀（Django 存储的行为）
  while (existsSync(mediaPath(target))) {
    const ext = extname(relative)
    const suffix = Math.random().toString(36).slice(2, 9)
    target = relative.slice(0, relative.length - ext.length) + "_" + suffix + ext
  }
  const full = mediaPath(target)
  await mkdir(dirname(full), { recursive: true })
  await Bun.write(full, file)
  return target
}

async function formFile(c: Ctx, field: string) {
  const form = await c.req.formData().catch(() => null)
  const value = form?.get(field)
  if (!(value instanceof File)) {
    throw new ValidationError([{ loc: ["body", field], msg: "缺少文件" }])
  }
  return { form: form!, file: value }
}

// ── 任务素材 ──────────────────────────────────────────────────────────────────

export const assets = new Hono<Env>()

type Kind = "challenge" | "tutorial"

function findTask(kind: Kind, display: number) {
  return orNotFound(
    get<{ id: number; task_type: string; display: number; is_public: number }>(
      `SELECT t.id, t.task_type, t.display, t.is_public FROM task_task t
       JOIN task_${kind} x ON x.task_ptr_id = t.id WHERE t.display = $display`,
      { display },
    ),
  )
}

const assetOut = (a: { name: string; file: string }) => ({
  name: a.name,
  url: config.mediaUrl + a.file,
})

for (const kind of ["challenge", "tutorial"] as const) {
  // 挑战素材管理员可改，教程素材仅超管可改
  const requireEditor: (c: Ctx) => User = kind === "challenge" ? requireAdmin : requireSuper

  assets.get(`/${kind}/:display`, (c) => {
    const task = findTask(kind, intParam(c, "display"))
    if (!task.is_public && !canSeeUnpublished(c.get("user"), kind)) notFound()
    const rows = all<{ name: string; file: string }>(
      `SELECT name, file FROM task_taskasset WHERE task_id = $id ORDER BY id`,
      { id: task.id },
    )
    return c.json(rows.map(assetOut))
  })

  assets.post(`/${kind}/:display`, async (c) => {
    requireEditor(c)
    const task = findTask(kind, intParam(c, "display"))
    const { form, file } = await formFile(c, "file")
    const name = form.get("name")
    if (typeof name !== "string" || !name) {
      throw new ValidationError([{ loc: ["body", "name"], msg: "缺少文件名" }])
    }
    const existing = get<{ id: number; file: string }>(
      `SELECT id, file FROM task_taskasset WHERE task_id = $task_id AND name = $name`,
      { task_id: task.id, name },
    )
    if (existing?.file) await rm(mediaPath(existing.file), { force: true })
    const stored = await saveFile(
      `tasks/${task.task_type}/${task.display}/${validFilename(name)}`,
      file,
    )
    // 上面 await 期间可能有同名上传先写入了，用 upsert 而不是按 existing 选 INSERT / UPDATE
    run(
      `INSERT INTO task_taskasset (name, file, task_id) VALUES ($name, $file, $task_id)
       ON CONFLICT (task_id, name) DO UPDATE SET file = excluded.file`,
      { name, file: stored, task_id: task.id },
    )
    return c.json(assetOut({ name, file: stored }))
  })

  assets.delete(`/${kind}/:display/:name`, async (c) => {
    requireEditor(c)
    const task = findTask(kind, intParam(c, "display"))
    const asset = orNotFound(
      get<{ id: number; file: string }>(
        `SELECT id, file FROM task_taskasset WHERE task_id = $task_id AND name = $name`,
        { task_id: task.id, name: c.req.param("name") },
      ),
    )
    if (asset.file) await rm(mediaPath(asset.file), { force: true })
    run(`DELETE FROM task_taskasset WHERE id = $id`, { id: asset.id })
    return c.json({ message: "删除成功" })
  })
}

// ── 编辑器里插入图片 ──────────────────────────────────────────────────────────

export const upload = new Hono<Env>()

upload.post("/", async (c) => {
  requireSuper(c)
  const { file } = await formFile(c, "image")
  const filename = crypto.randomUUID() + extname(file.name)
  await mkdir(config.mediaRoot, { recursive: true })
  await Bun.write(join(config.mediaRoot, filename), file)
  return c.json({ url: config.mediaUrl + filename })
})
