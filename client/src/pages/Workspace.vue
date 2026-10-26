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
          />
        </template>
      </n-split>
    </template>
  </n-split>
</template>
<script lang="ts" setup>
import { useMagicKeys, whenever } from "@vueuse/core"
import Editors from "../components/editor/Editors.vue"
import Preview from "../components/editor/Preview.vue"
import TaskPanel from "../components/task/TaskPanel.vue"
import { show, panelSize } from "../store/panel"
import { html, css, js } from "../store/editors"
import { assetBaseUrl } from "../store/task"

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
