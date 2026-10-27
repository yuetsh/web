<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="title"
    style="width: 520px; max-width: 94vw"
    :mask-closable="!saving"
  >
    <div class="question">
      {{ hasEarlier ? "比起第一版，这一版你最满意的改动是什么？为什么这样改？" : "这一版你最满意的地方是什么？为什么？" }}
    </div>
    <n-input
      v-model:value="reflection"
      type="textarea"
      :autosize="{ minRows: 3, maxRows: 6 }"
      :maxlength="500"
      placeholder="比如：我把按钮从五个减到三个，因为按钮太多了看不出先点哪个"
    />
    <n-text depth="3" class="hint">可以不写，直接交。写了的话，老师批改时能看到。</n-text>
    <template #footer>
      <n-flex justify="end">
        <n-button :disabled="saving" @click="show = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="save">交</n-button>
      </n-flex>
    </template>
  </n-modal>
</template>
<script lang="ts" setup>
import { ref } from "vue"

// 交作品前问一句反思：最满意的改动和理由。不拦着交，只是让学生回头看一眼自己改了什么
const show = defineModel<boolean>("show", { required: true })
const props = defineProps<{
  title: string
  // 之前还有别的版本，就问“比起第一版”
  hasEarlier: boolean
  onSubmit: (reflection: string) => Promise<void>
}>()

const reflection = ref("")
const saving = ref(false)

async function save() {
  saving.value = true
  try {
    await props.onSubmit(reflection.value.trim())
    reflection.value = ""
    show.value = false
  } finally {
    saving.value = false
  }
}
</script>
<style scoped>
.question {
  margin-bottom: 10px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--wp-ink);
}

.hint {
  display: block;
  margin-top: 8px;
  font-size: 12px;
}
</style>
