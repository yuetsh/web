import { computed, watch } from "vue"
import { usePreferredDark, useStorage } from "@vueuse/core"
import { applyCssVars, dark, light } from "../theme"

// auto：跟随系统；投屏时老师可以手动切回亮色
export type ThemeMode = "auto" | "light" | "dark"

export const themeMode = useStorage<ThemeMode>("theme-mode", "auto")
const prefersDark = usePreferredDark()

export const isDark = computed(
  () => themeMode.value === "dark" || (themeMode.value === "auto" && prefersDark.value),
)

// CSS 变量和 data-theme（markdown、代码高亮的暗色样式按它切换）跟着走
watch(
  isDark,
  (d) => {
    applyCssVars(d ? dark : light)
    const root = document.documentElement
    root.dataset.theme = d ? "dark" : "light"
    root.style.colorScheme = d ? "dark" : "light"
  },
  { immediate: true },
)
