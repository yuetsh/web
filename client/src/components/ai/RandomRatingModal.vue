<template>
  <n-modal
    preset="card"
    :show="show"
    title="等待 AI 回复时，给同学的作品打个分吧"
    style="width: 90vw; max-width: 960px"
    @update:show="onUpdateShow"
  >
    <n-text
      v-if="current"
      depth="3"
      style="font-size: 12px; display: block; margin-bottom: 8px"
    >
      {{ current.task_title }} · 提交者 {{ current.username }}
    </n-text>
    <div class="preview-wrapper">
      <iframe class="preview-iframe" :srcdoc="previewContent"></iframe>
    </div>
    <div class="rate-row">
      <n-rate
        v-if="current"
        :key="current.submission_id"
        :size="32"
        @update:value="onRate"
      />
    </div>
    <n-text
      depth="3"
      style="font-size: 11px; display: block; text-align: center; margin-top: 8px"
    >
      打分后自动换下一个作品；AI 回复完成后弹窗会自动关闭
    </n-text>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue"
import { useMessage } from "naive-ui"
import { Submission } from "../../api"
import { streaming } from "../../store/prompt"
import { buildPreviewDocument } from "../../utils/previewDocument"
import type { RandomRatingItem } from "../../utils/type"

const message = useMessage()

const show = ref(false)
const current = ref<RandomRatingItem | null>(null)
const previewContent = ref("")
let reshowTimer: ReturnType<typeof setTimeout> | null = null

function clearReshowTimer() {
  if (reshowTimer !== null) {
    clearTimeout(reshowTimer)
    reshowTimer = null
  }
}

async function fetchAndShow() {
  try {
    const item = await Submission.randomForRating(current.value?.submission_id)
    if (item) {
      current.value = item
      previewContent.value = buildPreviewDocument({
        html: item.html ?? "",
        css: item.css ?? "",
        js: item.js ?? "",
      })
      show.value = true
    } else {
      show.value = false
    }
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "获取作品失败，请重试")
  }
}

async function onRate(score: number) {
  if (!current.value) return
  try {
    await Submission.updateScore(current.value.submission_id, score)
    message.success("感谢评分！")
    await fetchAndShow()
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "打分失败，请重试")
  }
}

function onUpdateShow(value: boolean) {
  show.value = value
  if (!value) {
    clearReshowTimer()
    if (streaming.value) {
      reshowTimer = setTimeout(fetchAndShow, 30_000)
    }
  }
}

watch(
  streaming,
  (val) => {
    clearReshowTimer()
    if (val) {
      fetchAndShow()
    } else {
      show.value = false
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  clearReshowTimer()
})
</script>

<style scoped>
.preview-wrapper {
  height: 70vh;
  border: 1px solid #eee;
  border-radius: 4px;
  overflow: hidden;
}

.preview-iframe {
  width: 100%;
  height: 100%;
  border: none;
}

.rate-row {
  display: flex;
  justify-content: center;
  padding: 16px 0;
}
</style>
