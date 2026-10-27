<template>
  <div v-if="current || revealed" class="rating-card">
    <div class="head">
      <span>等 AI 的时候，给同学的作品打个分</span>
      <n-button v-if="current" text size="tiny" @click="next(true)">跳过</n-button>
    </div>
    <div v-if="revealed" class="revealed">
      刚才那份是 <b>{{ revealed }}</b> 的作品，谢谢你的评分
    </div>
    <div v-else-if="current" class="body">
      <button class="thumb" title="点击放大看" @click="showLarge = true">
        <iframe
          :sandbox="PREVIEW_SANDBOX"
          :srcdoc="doc"
          tabindex="-1"
          loading="lazy"
        ></iframe>
      </button>
      <div class="info">
        <div class="task">{{ current.task_title }}</div>
        <div class="rates">
          <n-tooltip v-for="s in scores" :key="s.value">
            <template #trigger>
              <button class="rate" :disabled="rating" @click="rate(s.value)">
                {{ s.value }}
              </button>
            </template>
            {{ s.value }} 分：{{ s.label }}
          </n-tooltip>
        </div>
        <div class="legend">1 没完成 · 3 基本完成 · 5 完成且有自己的想法</div>
      </div>
    </div>
  </div>
  <n-modal
    v-model:show="showLarge"
    preset="card"
    :title="current ? `同学的作品 · ${current.task_title}` : '同学的作品'"
    style="width: 90vw; max-width: 1000px"
  >
    <div class="large">
      <iframe :sandbox="PREVIEW_SANDBOX" :srcdoc="doc"></iframe>
    </div>
    <div class="large-rates">
      <button
        v-for="s in scores"
        :key="s.value"
        class="rate wide"
        :disabled="rating"
        @click="rate(s.value)"
      >
        <b>{{ s.value }}</b> {{ s.label }}
      </button>
    </div>
  </n-modal>
</template>
<script lang="ts" setup>
import { computed, ref, watch } from "vue"
import { useMessage } from "naive-ui"
import { Submission } from "../../api"
import { buildPreviewDocument, PREVIEW_SANDBOX } from "../../utils/previewDocument"
import type { RandomRatingItem } from "../../utils/type"

// AI 生成期间在对话里显示一份同学的作品让学生打分。打分前不显示作者，减少给熟人打高分
const props = defineProps<{ active: boolean }>()
const message = useMessage()

const scores = [
  { value: 1, label: "没完成题目要求" },
  { value: 2, label: "完成了一小部分" },
  { value: 3, label: "基本完成" },
  { value: 4, label: "完成得不错" },
  { value: 5, label: "完成且有自己的想法" },
]

const current = ref<RandomRatingItem | null>(null)
const revealed = ref("")
const rating = ref(false)
const showLarge = ref(false)
let seq = 0

const doc = computed(() =>
  current.value
    ? buildPreviewDocument({
        html: current.value.html ?? "",
        css: current.value.css ?? "",
        js: current.value.js ?? "",
      })
    : "",
)

async function next(skip = false) {
  const s = ++seq
  const exclude = skip ? current.value?.submission_id : undefined
  try {
    const item = await Submission.randomForRating(exclude)
    // 请求期间 AI 已经回复完了，就不要再显示
    if (s !== seq || !props.active) return
    current.value = item
  } catch {
    if (s === seq) current.value = null
  }
}

async function rate(score: number) {
  if (!current.value) return
  rating.value = true
  try {
    const res = await Submission.updateScore(current.value.submission_id, score)
    revealed.value = res.username ?? "同学"
    current.value = null
    showLarge.value = false
    setTimeout(() => {
      revealed.value = ""
      if (props.active) next()
    }, 1800)
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "打分失败，请重试")
  } finally {
    rating.value = false
  }
}

watch(
  () => props.active,
  (active) => {
    if (active) next()
    else {
      seq++
      current.value = null
      revealed.value = ""
      showLarge.value = false
    }
  },
  { immediate: true },
)
</script>
<style scoped>
.rating-card {
  margin: 4px 0 16px;
  padding: 10px 12px;
  border: 1px solid var(--wp-line);
  border-radius: 8px;
  background: var(--wp-surface);
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--wp-muted);
  margin-bottom: 8px;
}

.body {
  display: grid;
  grid-template-columns: 132px 1fr;
  gap: 12px;
  align-items: center;
}

.thumb {
  position: relative;
  width: 132px;
  height: 84px;
  padding: 0;
  border: 1px solid var(--wp-line);
  border-radius: 6px;
  overflow: hidden;
  cursor: zoom-in;
  background: var(--wp-surface);
}

/* 按 4 倍大小渲染再缩小，看起来像网页缩略图 */
.thumb iframe {
  width: 528px;
  height: 336px;
  border: 0;
  transform: scale(0.25);
  transform-origin: 0 0;
  pointer-events: none;
}

.task {
  font-weight: 600;
  margin-bottom: 6px;
}

.rates {
  display: flex;
  gap: 6px;
}

.rate {
  min-width: 32px;
  padding: 4px 0;
  border: 1px solid var(--wp-line);
  border-radius: 6px;
  background: var(--wp-surface);
  color: var(--wp-ink);
  font: 600 13px var(--wp-font-mono);
  cursor: pointer;
}

.rate:hover:not(:disabled) {
  border-color: var(--wp-brand);
  background: var(--wp-brand-soft);
  color: var(--wp-brand);
}

.rate:focus-visible {
  outline: 2px solid var(--wp-brand);
  outline-offset: 1px;
}

.legend {
  margin-top: 6px;
  font-size: 11px;
  color: var(--wp-faint);
}

.revealed {
  font-size: 13px;
  color: var(--wp-muted);
}

.large {
  height: 65vh;
  border: 1px solid var(--wp-line);
  border-radius: 6px;
  overflow: hidden;
}

.large iframe {
  width: 100%;
  height: 100%;
  border: 0;
}

.large-rates {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.rate.wide {
  flex: 1;
  padding: 8px;
  font: 13px var(--wp-font-sans);
}

.rate.wide b {
  font-family: var(--wp-font-mono);
  margin-right: 4px;
}
</style>
