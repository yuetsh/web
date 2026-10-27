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
  return "AI 对话"
}

// 提问的 Bloom 等级（services/classifier.ts 后台打的标签）
export const PROMPT_LEVELS: Record<number, { name: string; desc: string }> = {
  1: { name: "记忆", desc: "复述或识别知识点" },
  2: { name: "理解", desc: "用自己的话解释概念" },
  3: { name: "应用", desc: "把知识用到新情境" },
  4: { name: "分析", desc: "拆解结构、找出规律" },
  5: { name: "评价", desc: "按标准作出判断" },
  6: { name: "创造", desc: "整合信息做出新东西" },
}

export function levelLabel(level: number | null | undefined) {
  return level ? `L${level} ${PROMPT_LEVELS[level]?.name ?? ""}`.trim() : ""
}
