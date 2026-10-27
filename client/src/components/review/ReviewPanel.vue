<template>
  <div :class="['panel', { wide }]">
    <div class="head">
      <div class="who">
        <b>{{ sub?.username ?? "…" }}</b>
        <span class="muted">{{ sub?.task_title }}</span>
      </div>
      <n-flex :size="4" :wrap="false" align="center">
        <template v-if="nav">
          <n-tooltip>
            <template #trigger>
              <n-button size="small" quaternary :disabled="!nav.prev" @click="emit('prev')">
                <Icon icon="lucide:arrow-left" />
              </n-button>
            </template>
            上一个学生（J）
          </n-tooltip>
          <n-tooltip>
            <template #trigger>
              <n-button size="small" quaternary :disabled="!nav.next" @click="emit('next')">
                <Icon icon="lucide:arrow-right" />
              </n-button>
            </template>
            下一个学生（K）
          </n-tooltip>
        </template>
        <n-button
          v-if="canWiden"
          size="small"
          quaternary
          @click="emit('toggle-wide')"
        >
          <template #icon>
            <Icon :icon="wide ? 'lucide:minimize-2' : 'lucide:maximize-2'" />
          </template>
          {{ wide ? "小面板" : "大图" }}
        </n-button>
        <n-tooltip>
          <template #trigger>
            <n-button size="small" quaternary @click="emit('close')">
              <Icon icon="lucide:x" />
            </n-button>
          </template>
          {{ wide ? "返回作品墙（Esc）" : "关闭" }}
        </n-tooltip>
      </n-flex>
    </div>

    <n-spin :show="loading" class="body">
      <div v-if="sub" class="layout">
       <div class="stage">
        <div class="versions" v-if="versions.length > 1">
          <span class="muted">共交了 {{ versions.length }} 次：</span>
          <button
            v-for="(v, i) in versions"
            :key="v.id"
            :class="['ver', { on: v.id === currentId }]"
            @click="currentId = v.id"
          >
            第 {{ versions.length - i }} 次
          </button>
        </div>
        <div class="frame">
          <!-- key：换作品时换新的 iframe，不进浏览器历史 -->
          <iframe :key="currentId" :sandbox="PREVIEW_SANDBOX" :srcdoc="doc"></iframe>
        </div>
        <n-flex justify="space-between" align="center" class="meta">
          <span class="muted">
            {{ parseTime(sub.created, "MM-DD HH:mm") }} 提交 ·
            {{ sub.score ? `得分 ${sub.score.toFixed(2)}` : "还没有人评分" }}
          </span>
          <n-button text size="small" @click="openFull">全屏打开</n-button>
        </n-flex>
       </div>
       <div class="side">

        <section>
          <h4>打分</h4>
          <div v-if="sub.my_score" class="muted">你已经给了 {{ sub.my_score }} 分</div>
          <div v-else class="rates">
            <button
              v-for="n in 5"
              :key="n"
              class="rate"
              :disabled="rating"
              @click="rate(n)"
            >
              {{ n }}
            </button>
            <span class="muted hint">数字键 1–5</span>
          </div>
        </section>

        <section>
          <h4>操作</h4>
          <n-flex :size="8">
            <n-button
              size="small"
              :type="sub.flag === 'present' ? 'primary' : 'default'"
              @click="togglePresent"
            >
              {{ sub.flag === "present" ? "已加入课上展示" : "加入课上展示" }}
            </n-button>
            <n-dropdown
              :options="awardOptions"
              trigger="click"
              :disabled="!awardOptions.length"
              @select="addToAward"
            >
              <n-button size="small">加入作品展</n-button>
            </n-dropdown>
          </n-flex>
          <div class="muted hint">P 键：加入 / 取消课上展示</div>
          <n-popconfirm v-if="canDelete" @positive-click="remove">
            <template #trigger>
              <n-button size="small" quaternary type="error" class="delete">删除这一版</n-button>
            </template>
            删除后找不回来，评分和作品展里的这一版也会一起删掉；它对应的那轮 AI 对话也会删掉。
          </n-popconfirm>
        </section>

        <section v-if="sub.reflection">
          <h4>学生说</h4>
          <div class="reflection">{{ sub.reflection }}</div>
        </section>

        <section>
          <n-flex justify="space-between" align="center" class="chain-head">
            <h4>提示词 <span class="muted" v-if="chainSteps">· {{ chainSteps }} 轮</span></h4>
            <n-button v-if="chain.length" size="tiny" quaternary @click="showChain = true">
              逐轮看网页
            </n-button>
          </n-flex>
          <div v-if="!chain.length" class="muted">这份提交没有关联的提示词</div>
          <ol class="chain">
            <li v-for="(r, i) in chain" :key="i" :class="{ guide: r.source === 'guidance' }">
              <n-flex :size="6" align="center">
                <span class="src">{{ sourceLabel(r.source) }}</span>
                <span v-if="r.prompt_level" class="level">{{ levelLabel(r.prompt_level) }}</span>
              </n-flex>
              <div class="q">{{ r.question }}</div>
            </li>
          </ol>
        </section>
       </div>
      </div>
    </n-spin>
    <ChainModal
      v-if="sub"
      v-model:show="showChain"
      :submission-id="sub.id"
      :title="`${sub.username} · ${sub.task_title}`"
      :asset-base-url="`/media/tasks/${sub.task_type}/${sub.task_display}/`"
    />
  </div>
</template>
<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import { useMessage } from "naive-ui"
import { Icon } from "../../icons"
import { Showcase, Submission } from "../../api"
import { buildPreviewDocument, PREVIEW_SANDBOX } from "../../utils/previewDocument"
import { levelLabel, parseTime, sourceLabel } from "../../utils/helper"
import ChainModal from "../submissions/ChainModal.vue"
import type {
  AwardManageOut,
  FlagType,
  PromptRound,
  SubmissionAll,
  SubmissionOut,
} from "../../utils/type"

// 老师看一份提交：预览、交过的各个版本、打分、课上展示、加入作品展、提示词链
const props = defineProps<{
  submissionId: string
  // 大图：预览占满左边，打分和提示词放右边一栏
  wide?: boolean
  // 是否显示“大图 / 小面板”切换
  canWiden?: boolean
  // 作品墙里用：能不能切到上一个 / 下一个学生
  nav?: { prev: boolean; next: boolean }
  // 全部提交页（超管）：能删除这一版
  canDelete?: boolean
}>()
const emit = defineEmits<{
  prev: []
  next: []
  close: []
  "toggle-wide": []
  // 让作品墙同步更新这张卡片
  changed: [patch: { id: string; my_score?: number; score?: number; flag?: FlagType }]
  deleted: [id: string]
}>()

const message = useMessage()
const loading = ref(false)
const currentId = ref(props.submissionId)
const sub = ref<SubmissionAll | null>(null)
const versions = ref<SubmissionOut[]>([])
const chain = ref<PromptRound[]>([])
const rating = ref(false)
const showChain = ref(false)
// 引导对话不生成网页，不算轮数
const chainSteps = computed(() => chain.value.filter((r) => r.source !== "guidance").length)

let awardsCache: Promise<AwardManageOut[]> | null = null
const awards = ref<AwardManageOut[]>([])
const awardOptions = computed(() =>
  awards.value.filter((a) => a.is_active).map((a) => ({ label: a.name, key: a.id })),
)

const doc = computed(() =>
  sub.value
    ? buildPreviewDocument({
        html: sub.value.html,
        css: sub.value.css,
        js: sub.value.js,
        assetBaseUrl: `/media/tasks/${sub.value.task_type}/${sub.value.task_display}/`,
      })
    : "",
)

let seq = 0
async function load(id: string) {
  const s = ++seq
  loading.value = true
  try {
    const data: SubmissionAll = await Submission.get(id)
    if (s !== seq) return
    sub.value = data
    const [list, rounds] = await Promise.all([
      Submission.listByUserTask(data.userid, data.task_id),
      Submission.getPromptChain(id).catch(() => [] as PromptRound[]),
    ])
    if (s !== seq) return
    versions.value = list
    chain.value = rounds
  } finally {
    if (s === seq) loading.value = false
  }
}

watch(
  () => props.submissionId,
  (id) => {
    currentId.value = id
  },
)
watch(currentId, load, { immediate: true })

async function rate(score: number) {
  if (!sub.value || sub.value.my_score || rating.value) return
  rating.value = true
  try {
    const res = await Submission.updateScore(sub.value.id, score)
    sub.value.my_score = score
    message.success(res.message)
    // 重新取一次得分（加权平均由服务端算）
    const fresh: SubmissionAll = await Submission.get(sub.value.id)
    sub.value.score = fresh.score
    emit("changed", { id: sub.value.id, my_score: score, score: fresh.score })
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "打分失败")
  } finally {
    rating.value = false
  }
}

async function togglePresent() {
  if (!sub.value) return
  const flag: FlagType = sub.value.flag === "present" ? null : "present"
  await Submission.updateFlag(sub.value.id, flag)
  sub.value.flag = flag
  emit("changed", { id: sub.value.id, flag })
}

async function addToAward(awardId: number) {
  if (!sub.value) return
  try {
    await Showcase.addAwardItem(awardId, { submission_id: sub.value.id, sort_order: 0 })
    const name = awards.value.find((a) => a.id === awardId)?.name
    message.success(`已加入作品展「${name}」`)
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "加入失败")
  }
}

async function remove() {
  if (!sub.value) return
  const id = sub.value.id
  try {
    await Submission.delete(id)
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "删除失败")
    return
  }
  message.success("已删除")
  emit("deleted", id)
}

function openFull() {
  if (sub.value) window.open(`/submission/${sub.value.id}`, "_blank")
}

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  if (t.closest("input, textarea, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey) return
  if (/^[1-5]$/.test(e.key)) rate(Number(e.key))
  else if (e.key === "p" || e.key === "P") togglePresent()
}

onMounted(async () => {
  window.addEventListener("keydown", onKey)
  awardsCache ??= Showcase.listManageAwards()
  awards.value = await awardsCache.catch(() => [])
})
onUnmounted(() => window.removeEventListener("keydown", onKey))
</script>
<style scoped>
.panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--wp-surface);
}

.head {
  height: 44px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--wp-line);
}

.who {
  min-width: 0;
  display: flex;
  gap: 8px;
  align-items: baseline;
  white-space: nowrap;
  overflow: hidden;
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px 20px;
}

/* 大图：左边预览占满高度，右边一栏单独滚动 */
.wide .body {
  overflow: hidden;
  padding: 0;
}

.wide .body :deep(.n-spin-content) {
  height: 100%;
}

.wide .layout {
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
}

.wide .stage {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 12px 14px;
}

.wide .stage .frame {
  flex: 1;
  height: auto;
  min-height: 0;
}

.wide .side {
  border-left: 1px solid var(--wp-line);
  overflow-y: auto;
  padding: 0 14px 20px;
}

.muted {
  color: var(--wp-muted);
  font-size: 12px;
}

.versions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
}

.ver {
  padding: 1px 8px;
  border: 1px solid var(--wp-line);
  border-radius: 4px;
  background: var(--wp-surface);
  color: var(--wp-ink);
  font-size: 12px;
  cursor: pointer;
}

.ver.on {
  border-color: var(--wp-brand);
  color: var(--wp-brand);
}

.frame {
  height: 260px;
  border: 1px solid var(--wp-line);
  border-radius: 6px;
  overflow: hidden;
}

.frame iframe {
  width: 100%;
  height: 100%;
  border: 0;
}

.meta {
  margin-top: 6px;
}

section {
  margin-top: 16px;
}

h4 {
  margin: 0 0 8px;
  font-size: 13px;
}

.chain-head {
  margin-bottom: 8px;
}

.chain-head h4 {
  margin: 0;
}

.delete {
  margin-top: 8px;
}

.rates {
  display: flex;
  gap: 6px;
  align-items: center;
}

.rate {
  width: 40px;
  padding: 6px 0;
  border: 1px solid var(--wp-line);
  border-radius: 6px;
  background: var(--wp-surface);
  color: var(--wp-ink);
  font: 600 14px var(--wp-font-mono);
  cursor: pointer;
}

.rate:hover:not(:disabled) {
  border-color: var(--wp-brand);
  background: var(--wp-brand-soft);
  color: var(--wp-brand);
}

.hint {
  margin-left: 6px;
  white-space: nowrap;
}

.wide .rates {
  flex-wrap: wrap;
}

/* 交的时候写的反思 */
.reflection {
  padding: 6px 10px;
  border-left: 3px solid var(--wp-brand);
  background: var(--wp-brand-soft);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.chain {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.src {
  font-size: 11px;
  color: var(--wp-muted);
}

/* 不是 list-item，就不占 ol 的序号 */
.chain .guide {
  display: block;
  color: var(--wp-muted);
}

.level {
  font: 600 11px var(--wp-font-mono);
  color: var(--wp-brand);
}

.q {
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
