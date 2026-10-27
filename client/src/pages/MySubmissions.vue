<template>
  <div class="mine">
    <aside class="tasks">
      <div class="tasks-head">
        <b>我的提交</b>
        <span class="muted">{{ tasks.length }} 个任务</span>
      </div>
      <n-spin :show="loadingList" class="task-list">
        <template v-for="g in groups" :key="g.label">
          <div class="group-label">{{ g.label }}</div>
          <button
            v-for="t in g.items"
            :key="t.task_id"
            :class="['task', { on: t.task_id === taskId }]"
            @click="taskId = t.task_id"
          >
            <span class="task-title">{{ t.task_display }}. {{ t.task_title }}</span>
            <span class="task-meta">
              {{ t.submit_count }} 次 · {{ parseTime(t.created, "MM-DD") }}
            </span>
          </button>
        </template>
        <n-empty
          v-if="!loadingList && !tasks.length"
          description="还没有交过作品"
          style="margin-top: 60px"
        />
      </n-spin>
    </aside>

    <main class="detail">
      <template v-if="task">
        <div class="detail-head">
          <div class="title">
            <span class="kind">{{ task.task_type === TASK_TYPE.Tutorial ? "教程" : "挑战" }}</span>
            <b>{{ task.task_display }}. {{ task.task_title }}</b>
          </div>
          <n-button size="small" quaternary icon-placement="right" @click="openTask">
            打开这道题
            <template #icon><Icon icon="lucide:arrow-right" /></template>
          </n-button>
        </div>

        <n-spin :show="loadingVersions" class="stage">
          <div v-if="versions.length" class="versions">
            <button
              v-for="(v, i) in versions"
              :key="v.id"
              :class="['ver', { on: v.id === currentId }]"
              @click="currentId = v.id"
            >
              第 {{ versions.length - i }} 次
              <span class="ver-score">{{ v.score ? v.score.toFixed(1) : "未评" }}</span>
              <span v-if="v.id === bestId && versions.length > 1" class="best">计入成绩</span>
            </button>
          </div>
          <div class="frame">
            <iframe
              v-if="current"
              :key="current.id"
              :sandbox="PREVIEW_SANDBOX"
              :srcdoc="doc"
            ></iframe>
          </div>
          <div v-if="current" class="meta">
            <span class="muted">
              {{ parseTime(current.created, "YYYY-MM-DD HH:mm") }} 提交 ·
              {{ current.score ? `得分 ${current.score.toFixed(2)}` : "还没有人评分" }}
              <template v-if="versions.length > 1"> · 成绩按分数最高的一次算</template>
            </span>
            <n-flex :size="4" :wrap="false">
              <n-button
                v-if="task.task_type === TASK_TYPE.Challenge"
                size="small"
                quaternary
                @click="showChain = true"
              >
                提示词
              </n-button>
              <n-popconfirm @positive-click="copyToEditor">
                <template #trigger>
                  <n-button size="small" quaternary>放回编辑器</n-button>
                </template>
                把这一版的代码放进这道题的编辑器，会替换编辑器里现在的代码。
              </n-popconfirm>
              <n-popconfirm @positive-click="remove">
                <template #trigger>
                  <n-button size="small" quaternary type="error">删除这一版</n-button>
                </template>
                删除后找不回来；它对应的那轮 AI 对话也会一起删掉。<br />
                已经有人评过分的不能删。
              </n-popconfirm>
            </n-flex>
          </div>
        </n-spin>
      </template>
      <n-empty v-else-if="tasks.length" description="选一个任务" style="margin-top: 120px" />
    </main>
  </div>

  <ChainModal
    v-if="current"
    v-model:show="showChain"
    :submission-id="current.id"
    :username="current.username"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { useMessage } from "naive-ui"
import { Icon } from "../icons"
import { Submission } from "../api"
import ChainModal from "../components/submissions/ChainModal.vue"
import { saveTaskCode } from "../composables/useTaskCode"
import { TASK_TYPE } from "../utils/const"
import { goHome, parseTime } from "../utils/helper"
import { buildPreviewDocument, PREVIEW_SANDBOX } from "../utils/previewDocument"
import type { SubmissionOut } from "../utils/type"

// 学生看自己交过的作品：左边按任务列出，右边看每一次交的版本
type Version = SubmissionOut & { html: string | null; css: string | null; js: string | null }

const route = useRoute()
const router = useRouter()
const message = useMessage()

const tasks = ref<SubmissionOut[]>([])
const loadingList = ref(false)
const taskId = ref<number | null>(route.query.task ? Number(route.query.task) : null)
const versions = ref<Version[]>([])
const loadingVersions = ref(false)
const currentId = ref<string | null>(null)
const showChain = ref(false)

const task = computed(() => tasks.value.find((t) => t.task_id === taskId.value) ?? null)
const current = computed(() => versions.value.find((v) => v.id === currentId.value) ?? null)

const groups = computed(() =>
  [
    { label: "教程", type: TASK_TYPE.Tutorial },
    { label: "挑战", type: TASK_TYPE.Challenge },
  ]
    .map((g) => ({
      label: g.label,
      items: tasks.value
        .filter((t) => t.task_type === g.type)
        .sort((a, b) => a.task_display - b.task_display),
    }))
    .filter((g) => g.items.length),
)

// 和成绩册一样：分数最高的一次计入成绩，同分取最新
const bestId = computed(() => {
  let best: Version | null = null
  for (const v of versions.value) if (v.score > 0 && (!best || v.score > best.score)) best = v
  return best?.id ?? null
})

const doc = computed(() =>
  current.value
    ? buildPreviewDocument({
        html: current.value.html ?? "",
        css: current.value.css ?? "",
        js: current.value.js ?? "",
        assetBaseUrl: `/media/tasks/${current.value.task_type}/${current.value.task_display}/`,
      })
    : "",
)

async function loadTasks() {
  loadingList.value = true
  try {
    const all: SubmissionOut[] = []
    for (let page = 1; ; page++) {
      const res = await Submission.list({ page, page_size: 100, grouped: true })
      all.push(...res.items)
      if (all.length >= res.count || !res.items.length) break
    }
    tasks.value = all
    if (!task.value) taskId.value = groups.value[0]?.items[0]?.task_id ?? null
  } finally {
    loadingList.value = false
  }
}

let seq = 0
async function loadVersions() {
  const s = ++seq
  const t = task.value
  if (!t) {
    versions.value = []
    return
  }
  loadingVersions.value = true
  try {
    const list = (await Submission.listByUserTask(t.userid, t.task_id)) as Version[]
    if (s !== seq) return
    versions.value = list
    if (!list.some((v) => v.id === currentId.value)) currentId.value = list[0]?.id ?? null
  } finally {
    if (s === seq) loadingVersions.value = false
  }
}

watch(taskId, (id) => {
  router.replace({ query: id ? { task: String(id) } : {} })
  loadVersions()
})

function openTask() {
  if (task.value) goHome(router, task.value.task_type, task.value.task_display)
}

function copyToEditor() {
  const v = current.value
  if (!v) return
  // 教程和挑战的代码都按任务各存一份，打开那个任务时读到
  saveTaskCode(v.task_id, { html: v.html ?? "", css: v.css ?? "", js: v.js ?? "" })
  goHome(router, v.task_type, v.task_display)
}

async function remove() {
  const v = current.value
  if (!v) return
  try {
    await Submission.delete(v.id)
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "删除失败，请重试")
    return
  }
  message.success("已删除")
  if (versions.value.length > 1) {
    await loadVersions()
    const t = tasks.value.find((x) => x.task_id === v.task_id)
    if (t) t.submit_count = versions.value.length
  } else {
    // 这道题一次都不剩了
    tasks.value = tasks.value.filter((x) => x.task_id !== v.task_id)
    taskId.value = groups.value[0]?.items[0]?.task_id ?? null
  }
}

onMounted(async () => {
  await loadTasks()
  loadVersions()
})
</script>

<style scoped>
.mine {
  height: 100%;
  display: flex;
  min-width: 0;
}

.tasks {
  width: 260px;
  flex: none;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--wp-line);
  background: var(--wp-surface);
  min-height: 0;
}

.tasks-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 12px 14px 6px;
}

.task-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 10px;
}

.group-label {
  padding: 10px 6px 4px;
  font-size: 12px;
  color: var(--wp-faint);
}

.task {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--wp-ink);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.task:hover {
  background: var(--wp-paper);
}

.task.on {
  background: var(--wp-brand-soft);
  color: var(--wp-brand);
}

.task-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-meta {
  font-size: 12px;
  color: var(--wp-faint);
}

.muted {
  font-size: 12px;
  color: var(--wp-muted);
}

.detail {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 10px 14px 12px;
  gap: 10px;
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.title {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kind {
  font-size: 12px;
  color: var(--wp-muted);
}

.stage {
  flex: 1;
  min-height: 0;
}

.stage :deep(.n-spin-content) {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.versions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ver {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border: 1px solid var(--wp-line);
  border-radius: 6px;
  background: var(--wp-surface);
  color: var(--wp-ink);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.ver:hover {
  border-color: var(--wp-brand);
}

.ver.on {
  border-color: var(--wp-brand);
  background: var(--wp-brand-soft);
  color: var(--wp-brand);
}

.ver-score {
  font: 12px var(--wp-font-mono);
  color: var(--wp-muted);
}

.best {
  padding: 0 5px;
  border-radius: 3px;
  font-size: 11px;
  line-height: 18px;
  color: var(--wp-brand);
  background: var(--wp-brand-soft);
}

.ver.on .best {
  background: var(--wp-surface);
}

.frame {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--wp-line);
  border-radius: 8px;
  overflow: hidden;
}

.frame iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}

.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
</style>
