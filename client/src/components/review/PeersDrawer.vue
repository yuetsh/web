<template>
  <n-drawer v-model:show="show" :width="600" placement="right">
    <n-drawer-content title="作品" :native-scrollbar="false">
      <n-spin :show="loading">
        <n-result
          v-if="data?.locked"
          status="info"
          title="交过这道题以后就能看到"
          description="先完成自己的作品并提交，再来看看同学们是怎么做的。"
          style="margin-top: 40px"
        />
        <template v-else-if="data">
          <n-flex justify="space-between" align="center" class="bar">
            <span class="hint">
              {{
                roleStaff
                  ? "学生们在这道题上最新的作品。"
                  : "同学们在这道题上最新的作品。打分之前不显示是谁做的，打完分才显示。"
              }}
            </span>
            <n-radio-group v-model:value="scope" size="small">
              <n-radio-button value="class">本班</n-radio-button>
              <n-radio-button value="all">全部班级</n-radio-button>
            </n-radio-group>
          </n-flex>
          <n-empty v-if="!data.items.length" description="还没有同学交这道题" />
          <div class="grid">
            <div v-for="w in data.items" :key="w.id" class="work">
              <button class="thumb" title="点击放大看" @click="large = w">
                <iframe
                  :sandbox="PREVIEW_SANDBOX"
                  :srcdoc="docOf(w)"
                  loading="lazy"
                  tabindex="-1"
                ></iframe>
              </button>
              <div class="info">
                <span :class="{ anon: !w.username }">
                  <span v-if="scope === 'all' && w.classname" class="cls">{{ w.classname }} 班</span>
                  {{ w.username ?? "匿名同学" }}
                </span>
                <span v-if="w.my_score" class="mine">我给了 {{ w.my_score }} 分</span>
              </div>
              <div v-if="!w.my_score" class="rates">
                <n-tooltip v-for="s in scores" :key="s.value">
                  <template #trigger>
                    <button class="rate" :disabled="rating === w.id" @click="rate(w, s.value)">
                      {{ s.value }}
                    </button>
                  </template>
                  {{ s.value }} 分：{{ s.label }}
                </n-tooltip>
              </div>
            </div>
          </div>
        </template>
      </n-spin>
    </n-drawer-content>
  </n-drawer>
  <n-modal
    :show="!!large"
    preset="card"
    :title="large?.username ?? '匿名同学的作品'"
    style="width: 90vw; max-width: 1000px"
    @update:show="(v: boolean) => !v && (large = null)"
  >
    <div v-if="large" class="large">
      <iframe :key="large.id" :sandbox="PREVIEW_SANDBOX" :srcdoc="docOf(large)"></iframe>
    </div>
  </n-modal>
</template>
<script lang="ts" setup>
import { ref, watch } from "vue"
import { useMessage } from "naive-ui"
import { Review, Submission } from "../../api"
import { roleStaff } from "../../store/user"
import { buildPreviewDocument, PREVIEW_SANDBOX } from "../../utils/previewDocument"
import type { PeerWork, PeerWorks } from "../../utils/type"

const show = defineModel<boolean>("show", { required: true })
const props = defineProps<{ taskId: number; assetBaseUrl?: string }>()
const message = useMessage()

const scores = [
  { value: 1, label: "没完成题目要求" },
  { value: 2, label: "完成了一小部分" },
  { value: 3, label: "基本完成" },
  { value: 4, label: "完成得不错" },
  { value: 5, label: "完成且有自己的想法" },
]

const data = ref<PeerWorks | null>(null)
const loading = ref(false)
const rating = ref<string | null>(null)
const large = ref<PeerWork | null>(null)
const scope = ref<"class" | "all">("class")

const docOf = (w: PeerWork) =>
  buildPreviewDocument({ html: w.html, css: w.css, js: w.js, assetBaseUrl: props.assetBaseUrl })

let seq = 0
async function load() {
  if (!props.taskId) return
  const s = ++seq
  loading.value = true
  try {
    const res = await Review.peers(props.taskId, scope.value)
    if (s === seq) data.value = res
  } finally {
    if (s === seq) loading.value = false
  }
}

watch(show, (open) => open && load())
watch(scope, load)

async function rate(w: PeerWork, score: number) {
  rating.value = w.id
  try {
    const res = await Submission.updateScore(w.id, score)
    w.my_score = score
    w.username = res.username ?? null
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "打分失败，请重试")
  } finally {
    rating.value = null
  }
}
</script>
<style scoped>
.bar {
  margin-bottom: 12px;
  flex-wrap: nowrap !important;
}

.hint {
  font-size: 13px;
  color: var(--wp-muted);
}

.cls {
  margin-right: 4px;
  color: var(--wp-muted);
  font-size: 12px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.work {
  border: 1px solid var(--wp-line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--wp-surface);
}

.thumb {
  position: relative;
  display: block;
  width: 100%;
  height: 150px;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--wp-line);
  overflow: hidden;
  background: var(--wp-surface);
  cursor: zoom-in;
}

.thumb iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 300%;
  height: 300%;
  border: 0;
  transform: scale(0.3333);
  transform-origin: 0 0;
  pointer-events: none;
}

.info {
  display: flex;
  justify-content: space-between;
  padding: 8px 10px 4px;
  font-size: 13px;
}

.anon {
  color: var(--wp-muted);
}

.mine {
  color: var(--wp-brand);
  font-size: 12px;
}

.rates {
  display: flex;
  gap: 6px;
  padding: 4px 10px 10px;
}

.rate {
  flex: 1;
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

.large {
  height: 70vh;
  border: 1px solid var(--wp-line);
  border-radius: 6px;
  overflow: hidden;
}

.large iframe {
  width: 100%;
  height: 100%;
  border: 0;
}
</style>
