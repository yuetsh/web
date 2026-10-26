import { useStorage } from "@vueuse/core"
import { ref } from "vue"
import { Tutorial } from "../api"

export const step = useStorage("tutorial-step", 1)
export const tutorialIds = ref<number[]>([])

export async function loadTutorials(): Promise<void> {
  tutorialIds.value = await Tutorial.listDisplay()
  if (tutorialIds.value.length && !tutorialIds.value.includes(step.value)) {
    step.value = tutorialIds.value[0] as number
  }
}

export function prevDisabled(): boolean {
  const i = tutorialIds.value.indexOf(step.value)
  return i <= 0
}

export function nextDisabled(): boolean {
  const i = tutorialIds.value.indexOf(step.value)
  return i === -1 || i === tutorialIds.value.length - 1
}

export function prev(): void {
  const i = tutorialIds.value.indexOf(step.value)
  if (i > 0) step.value = tutorialIds.value[i - 1] as number
}

export function next(): void {
  const i = tutorialIds.value.indexOf(step.value)
  if (i !== -1 && i < tutorialIds.value.length - 1)
    step.value = tutorialIds.value[i + 1] as number
}
