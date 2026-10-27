import { reactive, ref, watch, type Ref } from "vue"
import { user } from "../store/user"
import { emptyCode, type Code } from "../utils/code"

const key = (taskId: number) => `web-code:${user.username}:${taskId}`

export function readTaskCode(taskId: number): Code | null {
  return user.username ? read(taskId) : null
}

function read(taskId: number): Code | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key(taskId)) ?? "null")
    return saved && typeof saved.html === "string" ? { ...emptyCode(), ...saved } : null
  } catch {
    return null
  }
}

// 直接写入某个任务的代码（比如把别人的提交复制过去），下次打开那个任务的工作台时读到
export function saveTaskCode(taskId: number, code: Code) {
  try {
    localStorage.setItem(key(taskId), JSON.stringify(code))
  } catch {}
}

// 工作台里正在编辑的代码，每个任务各存一份（按用户 + 任务存在 localStorage）。
// 以前挑战、教程、自由创作共用一份，在挑战页点“清空”会把教程里的代码也清掉
export function useTaskCode(taskId: Ref<number>) {
  const code = reactive(emptyCode())
  // 打开时本地有没有存着这个任务的代码；没有的话由调用方填入最新版本
  const restored = ref(false)

  // 用户名也在 key 里，刚打开页面时可能还没取到
  watch(
    () => [taskId.value, user.username] as const,
    ([id]) => {
      const saved = id && user.username ? read(id) : null
      Object.assign(code, saved ?? emptyCode())
      restored.value = !!saved
    },
    { immediate: true },
  )

  let timer: ReturnType<typeof setTimeout> | undefined
  watch(
    () => ({ ...code }),
    (value) => {
      if (!taskId.value || !user.username) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        try {
          localStorage.setItem(key(taskId.value), JSON.stringify(value))
        } catch {}
      }, 300)
    },
  )

  return { code, restored }
}
