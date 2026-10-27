<script lang="ts" setup>
import { EditorView } from "@codemirror/view"
import { Codemirror } from "vue-codemirror"
import { css } from "@codemirror/lang-css"
import { javascript } from "@codemirror/lang-javascript"
import { html } from "@codemirror/lang-html"
import { computed } from "vue"
import { syntaxHighlighting } from "@codemirror/language"
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark"
import { isDark } from "../../store/theme"

const styleTheme = EditorView.baseTheme({
  "& .cm-scroller": {
    "font-family": "var(--wp-font-mono)",
  },
  "&.cm-editor.cm-focused": {
    outline: "none",
  },
  "&.cm-editor .cm-tooltip.cm-tooltip-autocomplete ul": {
    "font-family": "var(--wp-font-mono)",
  },
})

const bgColors: Record<string, string> = {
  html: "var(--wp-html-soft)",
  css: "var(--wp-css-soft)",
  js: "var(--wp-js-soft)",
}

interface Props {
  language?: "html" | "css" | "js"
  fontSize?: number
}

const props = withDefaults(defineProps<Props>(), {
  language: "html",
  fontSize: 16,
})

const code = defineModel<string>("value")

const lang = computed(() => {
  if (props.language === "html") return html()
  if (props.language === "css") return css()
  return javascript()
})

const bgTheme = computed(() => {
  const bg = bgColors[props.language] ?? "var(--wp-surface)"
  return EditorView.theme(
    {
      "&": { backgroundColor: bg, color: "var(--wp-ink)" },
      ".cm-gutters": { backgroundColor: bg, color: "var(--wp-faint)", borderColor: "var(--wp-line)" },
      ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "rgba(127, 127, 127, 0.08)" },
      ".cm-cursor": { borderLeftColor: "var(--wp-ink)" },
    },
    { dark: isDark.value },
  )
})

// 暗色时换成 One Dark 的语法配色（默认配色是给浅色背景设计的）
const extensions = computed(() => [
  styleTheme,
  bgTheme.value,
  ...(isDark.value ? [syntaxHighlighting(oneDarkHighlightStyle)] : []),
  lang.value,
])
</script>
<template>
  <Codemirror
    v-model="code"
    indentWithTab
    :extensions="extensions"
    :tabSize="4"
    :style="{ height: '100%', fontSize: props.fontSize + 'px' }"
  />
</template>
