<template>
  <div class="subs">
    <main class="list">
      <div class="toolbar">
        <n-input
          v-model:value="query.username"
          size="small"
          clearable
          placeholder="搜索学生"
          style="width: 150px"
        >
          <template #prefix><Icon icon="lucide:search" :width="14" /></template>
        </n-input>
        <n-radio-group v-model:value="query.task_type" size="small">
          <n-radio-button value="">全部</n-radio-button>
          <n-radio-button value="tutorial">教程</n-radio-button>
          <n-radio-button value="challenge">挑战</n-radio-button>
        </n-radio-group>
        <n-select
          v-model:value="query.zone"
          size="small"
          clearable
          placeholder="得分分区"
          :options="zoneOptions"
          style="width: 110px"
        />
        <n-select
          v-model:value="query.ordering"
          size="small"
          :options="orderOptions"
          style="width: 130px"
        />
        <n-checkbox v-model:checked="query.grouped" size="small">每人每题只看最新一次</n-checkbox>
        <span class="spacer"></span>
        <span class="muted">共 {{ count }} 条</span>
        <n-tooltip>
          <template #trigger>
            <n-button size="small" quaternary :loading="loading" @click="load">
              <template #icon><Icon icon="lucide:refresh-cw" /></template>
            </n-button>
          </template>
          刷新
        </n-tooltip>
      </div>

      <n-data-table
        class="table"
        size="small"
        flex-height
        :loading="loading"
        :columns="columns"
        :data="data"
        :row-key="(row: SubmissionOut) => row.id"
        :row-props="rowProps"
        :row-class-name="(row: SubmissionOut) => (row.id === selectedId ? 'row-active' : '')"
      />

      <n-flex justify="end">
        <n-pagination
          v-model:page="query.page"
          :page-size="PAGE_SIZE"
          :item-count="count"
          size="small"
        />
      </n-flex>
    </main>

    <aside v-if="selectedId" class="detail">
      <ReviewPanel
        :submission-id="selectedId"
        can-delete
        @close="selectedId = null"
        @changed="applyPatch"
        @deleted="onDeleted"
      />
    </aside>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { watchDebounced } from "@vueuse/core"
import type { DataTableColumn } from "naive-ui"
import { Icon } from "../icons"
import { Submission } from "../api"
import ReviewPanel from "../components/review/ReviewPanel.vue"
import { TASK_TYPE } from "../utils/const"
import { parseTime } from "../utils/helper"
import type { FlagType, SubmissionOut } from "../utils/type"

// 全站提交列表，留给超管查某个学生、处理有问题的提交；平时批改用“批改”页
const PAGE_SIZE = 20

const route = useRoute()
const router = useRouter()

const data = ref<SubmissionOut[]>([])
const count = ref(0)
const loading = ref(false)
const selectedId = ref<string | null>(null)

const query = reactive({
  page: Number(route.params.page) || 1,
  username: typeof route.query.username === "string" ? route.query.username : "",
  task_type: "" as "" | "tutorial" | "challenge",
  zone: null as string | null,
  ordering: "-created",
  grouped: true,
})

// 得分分区（按得分高低和评分人数分的三档，见 server/src/services/score.ts）
const ZONES: Record<string, string> = { featured: "优秀", pending: "待定", low: "待提高" }
const zoneOptions = Object.entries(ZONES).map(([value, label]) => ({ label, value }))
const orderOptions = [
  { label: "最新的在前", value: "-created" },
  { label: "得分从高到低", value: "-score" },
  { label: "得分从低到高", value: "score" },
]

const columns: DataTableColumn<SubmissionOut>[] = [
  {
    title: "时间",
    key: "created",
    width: 100,
    render: (row) => h("span", { class: "mono muted" }, parseTime(row.created, "MM-DD HH:mm")),
  },
  { title: "学生", key: "username", width: 120, ellipsis: { tooltip: true } },
  {
    title: "任务",
    key: "task_title",
    ellipsis: { tooltip: true },
    render: (row) => [
      h("span", { class: "muted" }, row.task_type === TASK_TYPE.Tutorial ? "教程 " : "挑战 "),
      `${row.task_display}. ${row.task_title}`,
    ],
  },
  {
    title: "得分",
    key: "score",
    width: 70,
    align: "right",
    render: (row) =>
      row.score > 0
        ? h("span", { class: "mono" }, row.score.toFixed(2))
        : h("span", { class: "muted" }, "未评"),
  },
  {
    title: "分区",
    key: "zone",
    width: 70,
    render: (row) => (row.zone ? h("span", { class: `zone z-${row.zone}` }, ZONES[row.zone]) : null),
  },
  {
    title: "共交",
    key: "submit_count",
    width: 60,
    align: "right",
    render: (row) => h("span", { class: "mono muted" }, `${row.submit_count} 次`),
  },
]

function rowProps(row: SubmissionOut) {
  return {
    style: { cursor: "pointer" },
    onClick: () => (selectedId.value = row.id),
  }
}

// 快速翻页时只用最后一次请求的结果
let seq = 0

async function load() {
  const s = ++seq
  loading.value = true
  try {
    const res = await Submission.list({
      page: query.page,
      page_size: PAGE_SIZE,
      username: query.username || undefined,
      task_type: query.task_type || undefined,
      zone: query.zone,
      ordering: query.ordering,
      grouped: query.grouped,
    })
    if (s !== seq) return
    data.value = res.items
    count.value = res.count
  } finally {
    if (s === seq) loading.value = false
  }
}

function applyPatch(patch: { id: string; my_score?: number; score?: number; flag?: FlagType }) {
  const row = data.value.find((d) => d.id === patch.id)
  if (row) Object.assign(row, patch)
}

function onDeleted() {
  selectedId.value = null
  load()
}

// 换了筛选条件就回到第一页
function reset() {
  if (query.page !== 1) query.page = 1
  else load()
}

watch(
  () => query.page,
  (page) => {
    load()
    router.push({ params: { page } })
  },
)
// 浏览器前进 / 后退时，页码跟着地址栏走
watch(
  () => route.params.page,
  (v) => {
    const page = Number(v) || 1
    if (page !== query.page) query.page = page
  },
)
watch(() => [query.task_type, query.zone, query.ordering, query.grouped], reset)
watchDebounced(() => query.username, reset, { debounce: 500, maxWait: 1000 })

onMounted(load)
</script>

<style scoped>
.subs {
  height: 100%;
  display: flex;
  min-width: 0;
}

.list {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;
}

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.spacer {
  flex: 1;
}

.table {
  flex: 1;
  min-height: 0;
}

.table :deep(.row-active td) {
  background: var(--wp-brand-soft) !important;
}

.table :deep(.mono) {
  font-family: var(--wp-font-mono);
}

.muted,
.table :deep(.muted) {
  font-size: 12px;
  color: var(--wp-muted);
}

.table :deep(.zone) {
  font-size: 12px;
}

.table :deep(.z-featured) {
  color: var(--wp-brand);
}

.table :deep(.z-low) {
  color: var(--wp-warn);
}

.table :deep(.z-pending) {
  color: var(--wp-muted);
}

.detail {
  width: 440px;
  flex: none;
  border-left: 1px solid var(--wp-line);
  min-height: 0;
}
</style>
