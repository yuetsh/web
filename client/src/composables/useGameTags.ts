import { ref } from "vue"
import { Game } from "../api"
import type { GameTag } from "../utils/type"

// 游戏的固定标签（后端 GAME_TAGS），整个页面只取一次
const tags = ref<GameTag[]>([])
let loading: Promise<void> | null = null

export function useGameTags() {
  loading ??= Game.tags()
    .then((list) => {
      tags.value = list
    })
    .catch(() => {
      loading = null
    })
  const label = (key: string) => tags.value.find((t) => t.key === key)?.label ?? key
  return { tags, label }
}
