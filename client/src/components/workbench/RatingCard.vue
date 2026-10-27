<template>
  <n-modal
    :show="!!(current || revealed)"
    preset="card"
    :title="done ? 'AI 写好了' : '等 AI 写代码的时候，给同学的作品打个分'"
    :closable="false"
    :mask-closable="false"
    :close-on-esc="false"
    :auto-focus="false"
    style="width: 90vw; max-width: 1000px"
  >
    <template #header-extra>
      <n-button v-if="done" type="primary" size="small" @click="close"
        >看结果</n-button
      >
      <n-button v-else-if="current" text size="small" @click="next(true)"
        >跳过这份</n-button
      >
    </template>
    <div v-if="revealed" class="revealed">
      刚才那份是 <b>{{ revealed }}</b> 的作品，谢谢你的评分
    </div>
    <template v-else-if="current">
      <div class="task">{{ current.task_title }}</div>
      <div class="large">
        <iframe
          :key="current.submission_id"
          :sandbox="PREVIEW_SANDBOX"
          :srcdoc="doc"
        ></iframe>
      </div>
      <div class="rates">
        <button
          v-for="s in scores"
          :key="s.value"
          class="rate"
          :disabled="rating"
          @click="rate(s.value)"
        >
          <b>{{ s.value }}</b> {{ s.label }}
        </button>
      </div>
    </template>
  </n-modal>
</template>
<script lang="ts" setup>
import { computed, ref, watch } from "vue"
import { useMessage } from "naive-ui"
import { Submission } from "../../api"
import {
  buildPreviewDocument,
  PREVIEW_SANDBOX,
} from "../../utils/previewDocument"
import type { RandomRatingItem } from "../../utils/type"

// AI 生成期间弹框遮住页面，让学生给一份同学的作品打分（学生只关心结果，不用盯着代码一行行出来）。
// 打分前不显示作者，减少给熟人打高分。AI 写完时正在看的这份不收走，换成“看结果”按钮
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
const done = ref(false)
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

function close() {
  seq++
  current.value = null
  revealed.value = ""
  done.value = false
}

async function rate(score: number) {
  if (!current.value) return
  rating.value = true
  try {
    const res = await Submission.updateScore(current.value.submission_id, score)
    revealed.value = res.username ?? "同学"
    current.value = null
    const s = seq
    setTimeout(() => {
      if (s !== seq) return
      revealed.value = ""
      if (props.active) next()
      else done.value = false
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
    if (active) {
      done.value = false
      next()
    } else if (current.value) {
      seq++
      done.value = true
    } else {
      close()
    }
  },
  { immediate: true },
)
</script>
<style scoped>
.task {
  font-weight: 600;
  margin-bottom: 8px;
}

.large {
  height: 60vh;
  border: 1px solid var(--wp-line);
  border-radius: 6px;
  overflow: hidden;
}

.large iframe {
  width: 100%;
  height: 100%;
  border: 0;
}

.rates {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.rate {
  flex: 1;
  padding: 8px;
  border: 1px solid var(--wp-line);
  border-radius: 6px;
  background: var(--wp-surface);
  color: var(--wp-ink);
  font: 13px var(--wp-font-sans);
  cursor: pointer;
}

.rate b {
  font-family: var(--wp-font-mono);
  margin-right: 4px;
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

.revealed {
  padding: 48px 0;
  text-align: center;
  font-size: 15px;
  color: var(--wp-muted);
}
</style>
