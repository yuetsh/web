import { reactive } from "vue"
import { Game } from "../api"

// 教学侧栏“游戏”上的数字：待处理的举报 + 申请重新上架的游戏（老师才有）
export const gameSummary = reactive({ pending_reports: 0, appeals: 0 })

export async function refreshGameSummary() {
  try {
    Object.assign(gameSummary, await Game.summary())
  } catch {
    // 拿不到就不显示数字
  }
}
