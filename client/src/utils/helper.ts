import { useDateFormat } from "@vueuse/core"
import { TASK_TYPE } from "./const"

export function parseTime(utc: Date | string, format = "YYYY年M月D日") {
  const time = useDateFormat(utc, format, { locales: "zh-CN" })
  return time.value
}

export function goHome(router: any, type: TASK_TYPE, display: number) {
  if (type === TASK_TYPE.Tutorial) {
    router.push({ name: "home-tutorial", params: { display } })
  } else if (type === TASK_TYPE.Challenge) {
    if (display) router.push({ name: "home-challenge", params: { display } })
    else router.push({ name: "home-challenge-list" })
  } else {
    router.push({ name: "home" })
  }
}

// 一轮对话 / 一个版本是怎么来的
export function sourceLabel(source: string | null | undefined) {
  if (source === "edit") return "手改"
  if (source === "manual") return "外部 AI"
  if (source === "guidance") return "引导"
  return "AI 对话"
}

// 提问的 Bloom 等级（services/classifier.ts 后台打的标签）
export const PROMPT_LEVELS: Record<number, { name: string; desc: string }> = {
  1: { name: "记忆", desc: "只说要做什么或只报结果，没有自己的要求和解释" },
  2: { name: "理解", desc: "想弄懂原理：问为什么、是什么意思、怎么做到的" },
  3: { name: "应用", desc: "提出具体要求（颜色、布局、功能），照搬题目要求也算" },
  4: { name: "分析", desc: "说清在什么操作、哪个位置出了什么问题，或推测原因" },
  5: { name: "评价", desc: "带理由评判现有结果，或比较不同做法再选择" },
  6: { name: "创造", desc: "题目之外自己构思的整体设计：主题、玩法、交互" },
}

export function levelLabel(level: number | null | undefined) {
  return level ? `L${level} ${PROMPT_LEVELS[level]?.name ?? ""}`.trim() : ""
}
