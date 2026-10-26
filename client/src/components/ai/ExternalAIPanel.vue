<template>
  <div class="external-panel">
    <div class="content-area">
      <div class="field-label">提示词</div>
      <n-input
        v-model:value="promptText"
        type="textarea"
        :autosize="{ minRows: 3, maxRows: 8 }"
        placeholder="粘贴你发给外部 AI 的提示词..."
      />
      <div class="code-field">
        <div class="field-label" style="margin-top: 12px">完整的代码</div>
        <n-input
          v-model:value="rawCode"
          type="textarea"
          class="code-input"
          placeholder="粘贴完整的前端代码..."
        />
      </div>
      <div v-if="splitResult" class="split-result">
        <n-tag size="small" type="success"
          >HTML · {{ splitResult.html.length }} 字符</n-tag
        >
        <n-tag size="small" type="info"
          >CSS · {{ splitResult.css.length }} 字符</n-tag
        >
        <n-tag size="small" type="warning"
          >JS · {{ splitResult.js.length }} 字符</n-tag
        >
      </div>
    </div>
    <div class="action-bar">
      <n-button :disabled="!rawCode.trim()" @click="applyPreview"
        >应用预览</n-button
      >
      <n-button
        type="primary"
        :disabled="!splitResult || !promptText.trim()"
        :loading="submitting"
        @click="submit"
      >
        提交
      </n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue"
import { useMessage } from "naive-ui"
import { html, css, js } from "../../store/editors"
import { Submission } from "../../api"

const props = defineProps<{ taskId: number }>()
const emit = defineEmits<{
  submitted: []
}>()
const message = useMessage()

const promptText = ref("")
const rawCode = ref("")
const splitResult = ref<{ html: string; css: string; js: string } | null>(null)
const submitting = ref(false)

watch(rawCode, () => {
  splitResult.value = null
})

function splitHtml(raw: string): { html: string; css: string; js: string } {
  let result = raw
  const cssBlocks: string[] = []
  const jsBlocks: string[] = []

  result = result.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, content) => {
    cssBlocks.push(content.trim())
    return ""
  })
  result = result.replace(
    /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi,
    (_, content) => {
      jsBlocks.push(content.trim())
      return ""
    },
  )

  return {
    html: result.trim(),
    css: cssBlocks.join("\n\n"),
    js: jsBlocks.join("\n\n"),
  }
}

function applyPreview() {
  const result = splitHtml(rawCode.value)
  splitResult.value = result
  html.value = result.html
  css.value = result.css
  js.value = result.js
}

async function submit() {
  if (!splitResult.value) return
  submitting.value = true
  try {
    await Submission.create(props.taskId, {
      html: splitResult.value.html,
      css: splitResult.value.css,
      js: splitResult.value.js,
      prompt: promptText.value.trim(),
    })
    emit("submitted")
    message.success("提交成功")
    promptText.value = ""
    rawCode.value = ""
    splitResult.value = null
  } catch {
    message.error("提交失败，请重试")
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.external-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.content-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
}

.code-field {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.code-input {
  flex: 1;
  min-height: 0;
}

.code-input :deep(.n-input__textarea) {
  height: 100%;
}

.code-input :deep(.n-input__textarea-el) {
  height: 100%;
  resize: none;
}

.field-label {
  font-size: 12px;
  font-weight: bold;
  color: #666;
  margin-bottom: 6px;
}

.split-result {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.action-bar {
  padding: 12px;
  border-top: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
}
</style>
