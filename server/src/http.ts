import type { Context } from "hono"
import { z } from "zod"
import type { User } from "./auth"
import { uuidHex } from "./db"

export type Env = { Variables: { user: User | null } }
export type Ctx = Context<Env>

export class HttpError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail)
  }
}

export function notFound(detail = "Not Found"): never {
  throw new HttpError(404, detail)
}

export function orNotFound<T>(value: T, detail?: string): NonNullable<T> {
  if (value === null || value === undefined) notFound(detail)
  return value as NonNullable<T>
}

function formatIssues(error: z.ZodError) {
  return error.issues.map((i) => ({
    loc: i.path,
    msg: i.message,
    type: i.code,
  }))
}

export class ValidationError extends Error {
  constructor(public issues: unknown) {
    super("validation error")
  }
}

export async function body<S extends z.ZodType>(
  c: Ctx,
  schema: S,
): Promise<z.output<S>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new ValidationError([{ loc: ["body"], msg: "无效的 JSON" }])
  }
  const result = schema.safeParse(raw)
  if (!result.success) throw new ValidationError(formatIssues(result.error))
  return result.data
}

export function query<S extends z.ZodType>(c: Ctx, schema: S): z.output<S> {
  const result = schema.safeParse(c.req.query())
  if (!result.success) throw new ValidationError(formatIssues(result.error))
  return result.data
}

// 路径参数里的整数
export function intParam(c: Ctx, name: string): number {
  const v = c.req.param(name) ?? ""
  if (!/^-?\d+$/.test(v)) {
    throw new ValidationError([{ loc: ["path", name], msg: "需要整数" }])
  }
  return Number(v)
}

// 路径参数里的 UUID，返回数据库中的 32 位十六进制形式
export function uuidParam(c: Ctx, name: string): string {
  const hex = uuidHex(c.req.param(name) ?? "")
  if (!hex) throw new ValidationError([{ loc: ["path", name], msg: "需要 UUID" }])
  return hex
}

// 查询参数的通用类型（与 django-ninja / pydantic 的解析方式一致）
export const qs = {
  int: z.coerce.number().int(),
  num: z.coerce.number(),
  bool: z
    .enum(["true", "false", "1", "0", "on", "off", "yes", "no"])
    .transform((v) => ["true", "1", "on", "yes"].includes(v)),
  // 空字符串视为未传
  opt<T extends z.ZodType>(schema: T) {
    return z.preprocess((v) => (v === "" ? undefined : v), schema.optional())
  },
}

export const pageQuery = z.object({
  page: qs.opt(qs.int.min(1)).default(1),
  page_size: qs.opt(qs.int.min(1)),
})

// 与 ninja PageNumberPagination 相同：默认 10 条，最多 100 条
export function pageWindow(p: { page: number; page_size?: number }) {
  const size = Math.min(p.page_size ?? 10, 100)
  return { limit: size, offset: (p.page - 1) * size }
}

export const bool = (v: unknown) => v === 1 || v === true
