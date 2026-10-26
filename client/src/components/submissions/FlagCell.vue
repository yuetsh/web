<template>
  <n-popover v-if="isAdmin" trigger="click">
    <template #trigger>
      <span :style="dotStyle" />
    </template>
    <n-space vertical size="small">
      <n-button
        v-for="opt in FLAG_OPTIONS"
        :key="opt.value"
        text
        @click="$emit('update:flag', opt.value)"
      >
        <span style="display: flex; align-items: center; gap: 6px">
          <span
            :style="{
              display: 'inline-block',
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: opt.color,
            }"
          />
          {{ opt.label }}
        </span>
      </n-button>
      <n-button
        v-if="flag"
        text
        block
        type="error"
        @click="$emit('update:flag', null)"
      >
        清除
      </n-button>
    </n-space>
  </n-popover>
  <span v-else :style="dotStyle" />
</template>

<script setup lang="ts">
import { computed } from "vue"
import type { FlagType } from "../../utils/type"

const FLAG_OPTIONS: {
  value: NonNullable<FlagType>
  color: string
  label: string
}[] = [
  { value: "red", color: "#e03030", label: "值得展示" },
  { value: "blue", color: "#2080f0", label: "需要讲解" },
  { value: "green", color: "#18a058", label: "优秀作品" },
  { value: "yellow", color: "#f0a020", label: "需要改进" },
]

const props = defineProps<{
  flag: FlagType
  isAdmin: boolean
}>()

defineEmits<{ "update:flag": [value: FlagType] }>()

const dotStyle = computed(() => {
  const match = FLAG_OPTIONS.find((f) => f.value === props.flag)
  return {
    display: "inline-block",
    width: "12px",
    height: "12px",
    borderRadius: "50%",
    backgroundColor: match ? match.color : "transparent",
    border: match ? "none" : "1px dashed #ccc",
    cursor: props.isAdmin ? "pointer" : "default",
  }
})
</script>
