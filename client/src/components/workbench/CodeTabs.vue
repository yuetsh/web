<template>
  <n-tabs
    v-model:value="tab"
    type="card"
    size="small"
    class="code-tabs"
    :class="`tab-active-${tab}`"
    pane-class="code-pane"
  >
    <template #prefix><slot name="prefix" /></template>
    <n-tab-pane name="html">
      <template #tab><span class="lang-tab lang-html">HTML</span></template>
      <Editor v-model:value="code.html" :font-size="size" language="html" />
    </n-tab-pane>
    <n-tab-pane name="css">
      <template #tab><span class="lang-tab lang-css">CSS</span></template>
      <Editor v-model:value="code.css" :font-size="size" language="css" />
    </n-tab-pane>
    <n-tab-pane name="js">
      <template #tab><span class="lang-tab lang-js">JS</span></template>
      <Editor v-model:value="code.js" :font-size="size" language="js" />
    </n-tab-pane>
    <template #suffix>
      <n-flex align="center" :wrap="false" :size="4" class="suffix">
        <n-dropdown :options="sizeOptions" @select="(v: number) => (size = v)">
          <n-button quaternary size="small">字号 {{ size }}</n-button>
        </n-dropdown>
        <slot name="suffix" />
      </n-flex>
    </template>
  </n-tabs>
</template>
<script lang="ts" setup>
import { ref } from "vue"
import Editor from "../editor/Editor.vue"
import { size } from "../../store/editors"
import type { Code } from "../../utils/code"

// 直接改传进来的响应式对象，工作台按任务保存它
defineProps<{ code: Code }>()

const tab = ref<"html" | "css" | "js">("html")
const sizeOptions = [12, 14, 16, 18, 20, 24, 28, 32].map((n) => ({
  label: `${n}`,
  key: n,
}))
</script>
<style scoped>
.code-tabs {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.code-tabs :deep(.n-tabs-pane-wrapper) {
  flex: 1;
  min-height: 0;
}

.code-tabs :deep(.code-pane) {
  height: 100%;
  padding: 0;
  overflow: auto;
}

.code-tabs :deep(.n-tabs-nav) {
  background: var(--wp-surface);
}

.code-tabs :deep(.n-tabs-tab[data-name="html"]) {
  background-color: var(--wp-html-soft) !important;
}
.code-tabs :deep(.n-tabs-tab[data-name="css"]) {
  background-color: var(--wp-css-soft) !important;
}
.code-tabs :deep(.n-tabs-tab[data-name="js"]) {
  background-color: var(--wp-js-soft) !important;
}

.suffix {
  padding-right: 8px;
}
</style>
