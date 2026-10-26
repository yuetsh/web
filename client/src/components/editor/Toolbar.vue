<template>
  <n-flex align="center" class="corner">
    <n-button quaternary v-if="!show" @click="showTutorial">显示教程</n-button>
    <template v-if="user.loaded && authed">
      <n-tooltip>
        <template #trigger>
          <n-button quaternary @click="emit('format')">整理代码</n-button>
        </template>
        自动整理缩进和换行
      </n-tooltip>
      <n-button
        type="primary"
        :disabled="submitDisabled"
        :loading="submitLoading"
        @click="emit('submit')"
      >
        提交
      </n-button>
    </template>
  </n-flex>
</template>
<script lang="ts" setup>
import { computed } from "vue"
import { authed, user } from "../../store/user"
import { show, panelSize } from "../../store/panel"
import { taskId } from "../../store/task"

defineProps<{
  submitLoading: boolean
}>()
const emit = defineEmits(["format", "submit"])

const submitDisabled = computed(() => {
  return taskId.value === 0
})

function showTutorial() {
  show.value = true
  panelSize.value = 2 / 5
}
</script>
<style scoped>
.corner {
  margin-right: 12px;
}
</style>
