/**
 * 对比某个日期前后，学生和 AI 对话的情况（比如改了 AI 的回复方式以后有没有变化）。
 * 日期按北京时间，分界日期那天算“之后”。只读，不改数据。
 *
 *   bun scripts/prompt-stats.ts <分界日期> [--from 日期] [--to 日期]
 *   bun scripts/prompt-stats.ts 2026-10-28 --from 2026-09-01
 *
 * 层级是打标签时的标准；分类标准改过以后，先跑 classify-prompts.ts --force 重打，前后才好比。
 */
import { all, toDbTime } from "../src/db"

const args = process.argv.slice(2)
const opt = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const split = args[0]
if (!split || !/^\d{4}-\d{2}-\d{2}$/.test(split)) {
  console.log("用法：bun scripts/prompt-stats.ts <分界日期> [--from 日期] [--to 日期]")
  process.exit(1)
}
const day = (d: string) => toDbTime(new Date(`${d}T00:00:00+08:00`))
const nextDay = (d: string) => toDbTime(new Date(new Date(`${d}T00:00:00+08:00`).getTime() + 86_400_000))
const periods = [
  { name: `${opt("--from") ?? "最早"} ~ ${split} 之前`, from: opt("--from") ? day(opt("--from")!) : "", to: day(split) },
  { name: `${split} ~ ${opt("--to") ?? "现在"}`, from: day(split), to: opt("--to") ? nextDay(opt("--to")!) : "9999" },
]

// 和 PromptPanel 里一样：只说“不行”“没反应”的短抱怨；“出问题了”拼出来的句子
const VAGUE =
  /不行|不对|没反应|没用|没效果|用不了|不能用|不能玩|动不了|进不去|打不开|没显示|不显示|显示不出|bug|出错|报错|错了|坏了|白屏|空白|有问题/i
const PROBLEM = /^我.+，(想看到.+，)?但实际.+。$/s

type Msg = {
  conversation_id: string
  source: string
  content: string
  prompt_level: number | null
  created: string
  // 在这个对话的 AI 对话里是第几轮（只数 conversation）
  round: number | null
}

// 批处理脚本，整表扫一遍没关系
const msgs = all<Msg>(
  `SELECT conversation_id, source, content, prompt_level, created,
     CASE WHEN source = 'conversation'
       THEN ROW_NUMBER() OVER (PARTITION BY conversation_id, source = 'conversation' ORDER BY created, id) END AS round
   FROM prompt_message WHERE role = 'user'`,
)
const subs = all<{ created: string; reflected: number }>(
  `SELECT s.created, r.submission_id IS NOT NULL AS reflected
   FROM submission_submission s JOIN task_task t ON t.id = s.task_id
   LEFT JOIN submission_reflection r ON r.submission_id = s.id
   WHERE t.task_type = 'challenge'`,
)

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—")
const chars = (s: string) => [...s.trim()].length

function stats(from: string, to: string) {
  const inRange = (t: string) => t >= from && t < to
  const ms = msgs.filter((m) => inRange(m.created))
  const byConv = new Map<string, Msg[]>()
  for (const m of ms) byConv.set(m.conversation_id, [...(byConv.get(m.conversation_id) ?? []), m])

  const convs = [...byConv.values()]
  const ai = convs.filter((c) => c.some((m) => m.source === "conversation"))
  const manualOnly = convs.filter((c) => c.some((m) => m.source === "manual") && !c.some((m) => m.source === "conversation"))
  const rounds = ai.map((c) => c.filter((m) => m.source === "conversation").length)
  const bucket = (lo: number, hi: number) => rounds.filter((n) => n >= lo && n <= hi).length

  const asked = ms.filter((m) => m.source === "conversation")
  const levels = [1, 2, 3, 4, 5, 6].map((l) => asked.filter((m) => m.prompt_level === l).length)
  const leveled = levels.reduce((a, b) => a + b, 0)
  const later = asked.filter((m) => (m.round ?? 1) >= 2 && m.prompt_level)
  const vague = asked.filter((m) => chars(m.content) <= 15 && VAGUE.test(m.content))
  const problem = asked.filter((m) => PROBLEM.test(m.content.trim()))
  const manual = ms.filter((m) => m.source === "manual")
  const s = subs.filter((x) => inRange(x.created))

  return [
    ["有对话或版本的作品", `${convs.length}`],
    ["只粘贴外部代码", `${manualOnly.length}（${pct(manualOnly.length, convs.length)}）`],
    ["和平台 AI 对话的作品", `${ai.length}`],
    ["  平均轮数", ai.length ? (rounds.reduce((a, b) => a + b, 0) / ai.length).toFixed(2) : "—"],
    ["  1 轮", pct(bucket(1, 1), ai.length)],
    ["  2–3 轮", pct(bucket(2, 3), ai.length)],
    ["  4–6 轮", pct(bucket(4, 6), ai.length)],
    ["  7 轮以上", pct(bucket(7, Infinity), ai.length)],
    ["提问（AI 对话）", `${asked.length}，已分级 ${leveled}`],
    ...levels.map((n, i) => [`  L${i + 1}`, pct(n, leveled)]),
    ["  L4–L6", pct(levels[3]! + levels[4]! + levels[5]!, leveled)],
    ["  第 2 轮起的 L1", pct(later.filter((m) => m.prompt_level === 1).length, later.length)],
    ["  只说“不行”的短抱怨", `${vague.length}（${pct(vague.length, asked.length)}）`],
    ["  用“出问题了”", `${problem.length}（${pct(problem.length, asked.length)}）`],
    ["用了“帮我写清楚”的作品", `${convs.filter((c) => c.some((m) => m.source === "guidance")).length}（占和 AI 对话的 ${pct(ai.filter((c) => c.some((m) => m.source === "guidance")).length, ai.length)}）`],
    ["外部 AI 提示词", `${manual.length}，12 字以内 ${pct(manual.filter((m) => chars(m.content) <= 12).length, manual.length)}`],
    ["挑战提交", `${s.length}，写了反思 ${pct(s.filter((x) => x.reflected).length, s.length)}`],
  ]
}

const [a, b] = periods.map((p) => stats(p.from, p.to))
// 终端里中文占两格
const cols = (k: string) => [...k].reduce((n, ch) => n + (ch.codePointAt(0)! >= 0x2e80 ? 2 : 1), 0)
const width = Math.max(...a!.map(([k]) => cols(k!))) + 2
const pad = (k: string) => k + " ".repeat(width - cols(k))
console.log(`${pad("")}${periods[0]!.name}  →  ${periods[1]!.name}`)
for (const [i, [k, v]] of a!.entries()) console.log(`${pad(k!)}${v}  →  ${b![i]![1]}`)
