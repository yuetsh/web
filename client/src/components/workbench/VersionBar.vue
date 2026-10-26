<template>
  <div class="version-bar">
    <span class="label">版本</span>
    <div class="chips">
      <span v-if="!versions.length" class="empty">
        还没有版本：让 AI 生成，或者在“代码”里自己写
      </span>
      <n-tooltip v-for="v in versions" :key="v.id">
        <template #trigger>
          <button
            :class="['chip', { on: v.id === selectedId && !modified }]"
            @click="emit('select', v.id)"
          >
            v{{ v.n }}
            <span v-if="v.source === 'edit'" class="src">手改</span>
            <span v-else-if="v.source === 'manual'" class="src">外部</span>
            <Icon v-if="v.submitted" icon="lucide:check" :width="12" class="ok" />
          </button>
        </template>
        {{ describe(v) }}
      </n-tooltip>
      <span v-if="modified" class="chip on draft">当前修改</span>
    </div>
    <n-button quaternary size="small" @click="emit('history')">全部历史</n-button>
    <template v-if="kind === 'challenge'">
      <span v-if="submittedLabel" class="hint">{{ submittedLabel }}</span>
      <n-button
        type="primary"
        size="small"
        :disabled="!canSubmit || selectedSubmitted"
        :loading="busy"
        @click="emit('submit')"
      >
        {{ modified ? "交当前修改" : selectedSubmitted ? "已交这一版" : "交这一版" }}
      </n-button>
    </template>
    <n-button
      v-else
      type="primary"
      size="small"
      :disabled="!canSubmit"
      :loading="busy"
      @click="emit('submit')"
    >
      保存作品
    </n-button>
  </div>
</template>
<script lang="ts" setup>
import { computed } from "vue"
import { Icon } from "../../icons"

export interface VersionItem {
  id: number
  n: number
  source: string
  submitted: boolean
}

const props = defineProps<{
  kind: "challenge" | "creation"
  versions: VersionItem[]
  selectedId: number | null
  modified: boolean
  canSubmit: boolean
  busy: boolean
}>()
const emit = defineEmits<{ select: [id: number]; submit: []; history: [] }>()

const selectedSubmitted = computed(
  () =>
    !props.modified &&
    !!props.versions.find((v) => v.id === props.selectedId)?.submitted,
)

const submittedLabel = computed(() => {
  const done = props.versions.filter((v) => v.submitted).map((v) => `v${v.n}`)
  if (done.length > 3) return `已交 ${done.length} 个版本`
  return done.length ? `已交 ${done.join("、")}` : ""
})

function describe(v: VersionItem) {
  const from =
    v.source === "edit" ? "你手改的" : v.source === "manual" ? "外部 AI 生成的" : "AI 生成的"
  return `${from}第 ${v.n} 版${v.submitted ? "，已提交" : ""}，点击查看`
}
</script>
<style scoped>
.version-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--wp-line);
  background: var(--wp-surface);
  min-width: 0;
}

.label {
  font-size: 12px;
  color: var(--wp-muted);
  flex: none;
}

.chips {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  border: 1px solid var(--wp-line);
  border-radius: 6px;
  background: var(--wp-surface);
  color: var(--wp-ink);
  font: 12px/20px var(--wp-font-mono);
  cursor: pointer;
}

.chip:hover {
  border-color: var(--wp-brand);
}

.chip.on {
  border-color: var(--wp-brand);
  color: var(--wp-brand);
  font-weight: 600;
}

.chip.draft {
  cursor: default;
  border-style: dashed;
  font-family: var(--wp-font-sans);
}

.chip:focus-visible {
  outline: 2px solid var(--wp-brand);
  outline-offset: 1px;
}

.src {
  font-family: var(--wp-font-sans);
  font-size: 11px;
  color: var(--wp-muted);
}

.ok {
  color: var(--wp-brand);
}

.empty,
.hint {
  font-size: 12px;
  color: var(--wp-faint);
  white-space: nowrap;
}
</style>
