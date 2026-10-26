<template>
  <n-modal
    preset="card"
    :show="show"
    style="max-width: 60%"
    @update:show="$emit('update:show', $event)"
  >
    <template #header>
      <n-flex align="center">
        <span>前端代码</span>
        <n-button tertiary @click="$emit('copy-to-editor')"
          >复制到编辑框</n-button
        >
      </n-flex>
    </template>
    <n-tabs animated type="segment">
      <n-tab-pane name="html" tab="html">
        <n-code :code="html" language="html" word-wrap />
      </n-tab-pane>
      <n-tab-pane name="css" tab="css">
        <n-code :code="css" language="css" word-wrap />
      </n-tab-pane>
      <n-tab-pane v-if="!!js" name="js" tab="js">
        <n-code :code="js" language="js" word-wrap />
      </n-tab-pane>
    </n-tabs>
  </n-modal>
</template>

<script setup lang="ts">
defineProps<{
  show: boolean
  html: string
  css: string
  js: string
}>()

defineEmits<{
  "update:show": [value: boolean]
  "copy-to-editor": []
}>()
</script>
