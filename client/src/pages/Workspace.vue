<template>
  <n-split :size="panelSize" @update-size="changeSize" min="400px" max="900px">
    <template #1>
      <TaskPanel @hide="hide" />
    </template>
    <template #2>
      <n-split direction="vertical" min="200px">
        <template #1>
          <Editors />
        </template>
        <template #2>
          <Preview
            :html="html"
            :css="css"
            :js="js"
            :asset-base-url="assetBaseUrl"
            :storage-task-id="taskId"
          />
        </template>
      </n-split>
    </template>
  </n-split>
</template>
<script lang="ts" setup>
import { watch } from "vue"
import { useMagicKeys, whenever } from "@vueuse/core"
import Editors from "../components/editor/Editors.vue"
import Preview from "../components/editor/Preview.vue"
import TaskPanel from "../components/task/TaskPanel.vue"
import { show, panelSize } from "../store/panel"
import { html, css, js } from "../store/editors"
import { assetBaseUrl, taskId } from "../store/task"
import { saveTaskCode } from "../composables/useTaskCode"

// 每一节教程的代码各存一份；任务 id 和代码一起看，切换小节时不会把新一节的代码存到上一节下面
watch([taskId, html, css, js], ([id]) => {
  if (id) saveTaskCode(id, { html: html.value, css: css.value, js: js.value })
})

const { ctrl_s } = useMagicKeys({
  passive: false,
  onEventFired(e) {
    if (e.ctrlKey && e.key === "s" && e.type === "keydown") e.preventDefault()
  },
})

const { ctrl_r } = useMagicKeys({
  passive: false,
  onEventFired(e) {
    if (e.ctrlKey && e.key === "r" && e.type === "keydown") e.preventDefault()
  },
})

function changeSize(n: number) {
  panelSize.value = n
  if (n > 0) show.value = true
}

function hide() {
  panelSize.value = 0
  show.value = false
}

whenever(ctrl_s!, () => {})
whenever(ctrl_r!, () => {})
</script>
