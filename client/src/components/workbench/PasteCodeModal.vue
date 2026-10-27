<template>
  <n-modal
    v-model:show="show"
    preset="card"
    title="粘贴外部 AI 生成的代码"
    style="width: 640px; max-width: 94vw"
  >
    <n-form-item
      label="你在外部 AI 里说了什么"
      :validation-status="promptTooShort ? 'warning' : undefined"
      :feedback="promptTooShort ? `再写具体一点：你让 AI 做了什么、改了什么（至少 ${MIN_PROMPT} 个字）` : ''"
    >
      <n-input
        v-model:value="prompt"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 6 }"
        placeholder="把你发给豆包、DeepSeek 等 AI 的话粘贴到这里；说了好几轮的，每一轮都贴进来，一轮一行"
      />
    </n-form-item>
    <n-form-item label="完整的网页代码" :show-feedback="false" style="margin-top: 12px">
      <n-input
        v-model:value="raw"
        type="textarea"
        :autosize="{ minRows: 8, maxRows: 16 }"
        placeholder="粘贴整页 HTML，里面的 <style> 和 <script> 会自动拆到 CSS 和 JS"
        class="code-input"
      />
    </n-form-item>
    <n-text depth="3" class="hint">
      保存后会成为一个新版本，提示词会记进你的提示词记录里。
    </n-text>
    <template #footer>
      <n-flex justify="end">
        <n-button @click="show = false">取消</n-button>
        <n-button
          type="primary"
          :disabled="[...prompt.trim()].length < MIN_PROMPT || !raw.trim()"
          :loading="saving"
          @click="save"
        >
          存为新版本
        </n-button>
      </n-flex>
    </template>
  </n-modal>
</template>
<script lang="ts" setup>
import { computed, ref } from "vue"
import { splitHtml, type Code } from "../../utils/code"

const show = defineModel<boolean>("show", { required: true })
const props = defineProps<{
  onSave: (prompt: string, code: Code) => Promise<void>
}>()

const prompt = ref("")
// 以前四分之一的外部提示词只有“1”“倒计时”这样几个字，看不出学生想了什么
const MIN_PROMPT = 8
const promptTooShort = computed(() => {
  const n = [...prompt.value.trim()].length
  return n > 0 && n < MIN_PROMPT
})
const raw = ref("")
const saving = ref(false)

async function save() {
  saving.value = true
  try {
    await props.onSave(prompt.value.trim(), splitHtml(raw.value))
    prompt.value = ""
    raw.value = ""
    show.value = false
  } finally {
    saving.value = false
  }
}
</script>
<style scoped>
.code-input :deep(textarea) {
  font-family: var(--wp-font-mono);
  font-size: 13px;
}

.hint {
  display: block;
  margin-top: 8px;
  font-size: 12px;
}
</style>
