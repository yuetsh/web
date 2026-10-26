import { ref } from "vue"
import { useStorage } from "@vueuse/core"
import { TASK_TYPE } from "../utils/const"

const currentTask = window.location.pathname.startsWith("/challenge")
  ? TASK_TYPE.Challenge
  : TASK_TYPE.Tutorial

export const taskTab = ref(currentTask)
export const taskId = ref(0)
export const challengeDisplay = useStorage("challenge-display", 0)
export const assetBaseUrl = ref("")
