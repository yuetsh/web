<script lang="ts" setup>
import { EditorView } from "@codemirror/view"
import { Codemirror } from "vue-codemirror"
import { css } from "@codemirror/lang-css"
import { javascript } from "@codemirror/lang-javascript"
import { html } from "@codemirror/lang-html"
import { computed } from "vue"

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
  return EditorView.theme({
    "&": { backgroundColor: bg },
    ".cm-gutters": { backgroundColor: bg },
  })
})

const extensions = computed(() => [styleTheme, bgTheme.value, lang.value])
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
