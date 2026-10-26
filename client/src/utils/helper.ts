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
