<template>
  <div class="gradebook">
    <div class="toolbar">
      <n-select
        v-model:value="query.classname"
        class="class-select"
        :options="classOptions"
        placeholder="班级"
        size="small"
        :loading="classesLoading"
      />
      <n-radio-group v-model:value="query.task_type" size="small">
        <n-radio-button value="">全部</n-radio-button>
        <n-radio-button value="tutorial">教程</n-radio-button>
        <n-radio-button value="challenge">挑战</n-radio-button>
      </n-radio-group>
      <n-input
        v-model:value="query.username"
        class="search-input"
        size="small"
        clearable
        placeholder="搜索学生"
      >
        <template #prefix><Icon icon="lucide:search" :width="14" /></template>
      </n-input>
      <n-checkbox v-model:checked="query.include_all_tasks" size="small">
        显示不计入的任务
      </n-checkbox>

      <span class="spacer"></span>

      <span v-if="gradebook" class="summary">
        {{ gradebook.student_count }} 人 · 计入 {{ gradebook.included_task_count }} 个任务
      </span>
      <n-popover trigger="click" placement="bottom-end" style="max-width: 340px">
        <template #trigger>
          <n-button size="small" quaternary>
            <template #icon><Icon icon="lucide:info" /></template>
            怎么算的
          </n-button>
        </template>
        <div class="rules">
          <p>
            <b>计入的任务</b>：班里至少一半人交过的任务才计入（现在是
            {{ gradebook?.coverage_threshold_count ?? "—" }} 人），灰色的列不计入。
          </p>
          <p><b>每格分数</b>：这个学生在这个任务里分数最高的一次提交，点开可以批改。</p>
          <p>
            <b>总分 / 平时等级</b>：计入任务的分数相加后排名，A 30%、B 40%、C 20%、D 5%、E 5%。
          </p>
          <p>
            <b>考核</b>：计入任务里最高三次的平均分另外排名，A 10%、B 20%、C 40%、D 20%、E 10%；
            分数在等级的分数段内按名次铺开（A 92–99、B 84–91、C 76–83、D 68–75、E 60–67）。
          </p>
        </div>
      </n-popover>
      <n-tooltip>
        <template #trigger>
          <n-button
            size="small"
            quaternary
            :disabled="!query.classname"
            :loading="loading"
            @click="loadGradebook"
          >
            <template #icon><Icon icon="lucide:refresh-cw" /></template>
          </n-button>
        </template>
        刷新
      </n-tooltip>
      <n-button
        size="small"
        secondary
        type="primary"
        :disabled="!gradebook"
        :loading="exporting"
        @click="exportCsv"
      >
        <template #icon><Icon icon="lucide:download" /></template>
        导出 CSV
      </n-button>
    </div>

    <n-alert v-if="loadError" type="error" closable @close="loadError = ''">
      {{ loadError }}
    </n-alert>

    <n-data-table
      class="table gradebook-table"
      size="small"
      flex-height
      :single-line="false"
      :loading="loading"
      :columns="columns"
      :data="rows"
      :row-key="(row: GradebookRow) => row.user_id"
      :scroll-x="scrollX"
    />
  </div>

  <n-drawer
    :show="!!reviewId"
    width="min(1180px, 92vw)"
    placement="right"
    @update:show="(v: boolean) => !v && (reviewId = null)"
  >
    <ReviewPanel
      v-if="reviewId"
      :submission-id="reviewId"
      wide
      @close="reviewId = null"
      @changed="loadGradebook"
    />
  </n-drawer>
</template>

<script setup lang="ts">
import ReviewPanel from "../components/review/ReviewPanel.vue"
import { computed, h, onMounted, reactive, ref, watch } from "vue"
import { Icon } from "../icons"
import { watchDebounced } from "@vueuse/core"
import { useMessage, type DataTableColumn } from "naive-ui"
import { Account, Gradebook } from "../api"
import { displayGradebookStudentName } from "../utils/gradebook"
import type {
  GradebookCell,
  GradebookOut,
  GradebookQuery,
  GradebookRow,
  GradebookTask,
} from "../utils/type"

// 和批改页共用“当前班级”（那边的“全部班级”在这里不适用）
const CLASS_KEY = "review-class"

const message = useMessage()
const classesLoading = ref(false)
const loading = ref(false)
const exporting = ref(false)
const loadError = ref("")
const gradebook = ref<GradebookOut | null>(null)
const classes = ref<string[]>([])

const query = reactive<GradebookQuery>({
  classname: "",
  task_type: "",
  username: "",
  include_all_tasks: false,
})

const classOptions = computed(() =>
  classes.value.map((classname) => ({ label: `${classname} 班`, value: classname })),
)
const rows = computed(() => gradebook.value?.rows ?? [])

const TASK_WIDTH = 66
const scrollX = computed(() => 380 + (gradebook.value?.tasks.length ?? 0) * TASK_WIDTH)

function formatScore(value: number | null) {
  if (value === null) return "—"
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

// 点分数：在右侧打开和批改页一样的详情，能直接打分、看提示词
const reviewId = ref<string | null>(null)
function openSubmission(cell: GradebookCell) {
  if (!cell.submitted || !cell.submission_id) return
  reviewId.value = cell.submission_id
}

function renderGrade(grade: string, extra?: string | number) {
  return h("span", { class: ["grade", `g-${grade}`] }, [
    grade,
    extra === undefined ? null : h("small", String(extra)),
  ])
}

function renderTaskHeader(task: GradebookTask) {
  const pct = Math.round(task.coverage * 100)
  const studentCount = gradebook.value?.student_count ?? 0
  return h(
    "div",
    {
      class: ["task-head", { excluded: !task.included }],
      title: `${task.display}. ${task.title}\n交了 ${task.submitted_count} / ${studentCount} 人（${pct}%）${task.included ? "" : "，不计入"}`,
    },
    [
      h("div", { class: "task-name" }, task.title),
      h("div", { class: "task-cov" }, [
        h("span", { class: "cov-bar" }, [h("span", { style: { width: pct + "%" } })]),
      ]),
    ],
  )
}

function renderScore(row: GradebookRow, task: GradebookTask) {
  const cell = row.scores[task.id]
  if (!cell?.submitted)
    return h("span", { class: ["cell", "missing", { excluded: !task.included }] }, "缺")
  return h(
    "button",
    {
      class: ["cell", "score", { unrated: cell.score === 0, excluded: !task.included }],
      title: cell.score === 0 ? "交了，还没人评分" : `${formatScore(cell.score)}，点开批改`,
      onClick: () => openSubmission(cell),
    },
    cell.score === 0 ? "未评" : cell.score.toFixed(1),
  )
}

function taskColumn(task: GradebookTask): DataTableColumn<GradebookRow> {
  return {
    title: () => renderTaskHeader(task),
    key: `task-${task.id}`,
    width: TASK_WIDTH,
    align: "center",
    className: task.included ? "" : "excluded-col",
    render: (row) => renderScore(row, task),
  }
}

const columns = computed<DataTableColumn<GradebookRow>[]>(() => {
  const tasks = gradebook.value?.tasks ?? []
  const groups = (["tutorial", "challenge"] as const)
    .map((type) => ({ type, items: tasks.filter((t) => t.task_type === type) }))
    .filter((g) => g.items.length)
  return [
    {
      title: "#",
      key: "rank",
      width: 40,
      fixed: "left",
      align: "right",
      sorter: (a, b) => a.rank - b.rank,
      render: (row) => h("span", { class: "rank" }, row.rank),
    },
    {
      title: "学生",
      key: "username",
      width: 92,
      fixed: "left",
      ellipsis: { tooltip: true },
      render: (row) => displayGradebookStudentName(row),
    },
    {
      title: "平时",
      key: "grade",
      width: 52,
      fixed: "left",
      align: "center",
      render: (row) => renderGrade(row.grade),
    },
    {
      title: "考核",
      key: "assessment_score",
      width: 72,
      fixed: "left",
      sorter: (a, b) => a.assessment_score - b.assessment_score,
      render: (row) => renderGrade(row.assessment_grade, row.assessment_score),
    },
    ...groups.map((g) => ({
      title: g.type === "tutorial" ? "教程" : "挑战",
      key: `group-${g.type}`,
      align: "center" as const,
      children: g.items.map(taskColumn),
    })),
    {
      title: "总分",
      key: "total_score",
      width: 72,
      fixed: "right",
      align: "right",
      sorter: (a, b) => a.total_score - b.total_score,
      render: (row) =>
        h(
          "span",
          {
            class: "total",
            title: `教程合计 ${formatScore(row.tutorial_total)}\n挑战合计 ${formatScore(row.challenge_total)}\n平均 ${formatScore(row.average_score)}`,
          },
          formatScore(row.total_score),
        ),
    },
    {
      title: "已交",
      key: "submitted_task_count",
      width: 64,
      fixed: "right",
      align: "right",
      sorter: (a, b) => a.missing_task_count - b.missing_task_count,
      render: (row) =>
        h(
          "span",
          {
            class: ["done", { short: row.missing_task_count > 0 }],
            title: row.missing_task_count ? `缺交 ${row.missing_task_count} 个` : "都交了",
          },
          `${row.submitted_task_count}/${row.submitted_task_count + row.missing_task_count}`,
        ),
    },
  ]
})

async function loadClasses() {
  classesLoading.value = true
  try {
    classes.value = await Account.listClasses()
    if (!query.classname && classes.value.length > 0) {
      let saved: string | null = null
      try {
        saved = localStorage.getItem(CLASS_KEY)
      } catch {}
      query.classname = saved && classes.value.includes(saved) ? saved : classes.value[0]!
    }
  } finally {
    classesLoading.value = false
  }
}

// 快速切换班级时只用最后一次请求的结果
let loadSeq = 0

async function loadGradebook() {
  const seq = ++loadSeq
  if (!query.classname) {
    gradebook.value = null
    loading.value = false
    return
  }
  loading.value = true
  loadError.value = ""
  try {
    const data = await Gradebook.get(query)
    if (seq !== loadSeq) return
    gradebook.value = data
    classes.value = data.classes
  } catch (err: any) {
    if (seq !== loadSeq) return
    loadError.value = err.response?.data?.detail ?? "成绩册加载失败"
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

async function exportCsv() {
  if (!query.classname) return
  exporting.value = true
  try {
    await Gradebook.downloadCsv(query)
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "导出失败")
  } finally {
    exporting.value = false
  }
}

watch(
  () => query.classname,
  (c) => {
    if (!c) return
    try {
      localStorage.setItem(CLASS_KEY, c)
    } catch {}
  },
)

watch(
  () => [query.classname, query.task_type, query.include_all_tasks],
  () => loadGradebook(),
)

watchDebounced(
  () => query.username,
  () => loadGradebook(),
  { debounce: 400, maxWait: 1000 },
)

onMounted(async () => {
  const before = query.classname
  await loadClasses()
  // loadClasses 选了默认班级时，上面的 watch 已经会加载
  if (query.classname === before) loadGradebook()
})
</script>

<style scoped>
.gradebook {
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;
  box-sizing: border-box;
  overflow: hidden;
}

.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.class-select {
  width: 120px;
}

.search-input {
  width: 150px;
}

.spacer {
  flex: 1;
}

.summary {
  font-size: 12px;
  color: var(--wp-muted);
}

.rules {
  font-size: 13px;
  line-height: 1.6;
}

.rules p {
  margin: 0 0 6px;
}

.rules p:last-child {
  margin: 0;
}

.table {
  flex: 1;
  min-height: 0;
}

.table :deep(.n-data-table-td) {
  padding: 4px 8px;
}

.table :deep(.n-data-table-th) {
  padding: 6px 8px;
}
</style>

<style>
/* 单元格是 render 函数画的，拿不到 scoped 属性，用表格的类名限定 */
.gradebook-table .excluded-col {
  background: var(--wp-paper);
}

.gradebook-table .rank {
  font: 12px var(--wp-font-mono);
  color: var(--wp-faint);
}

.gradebook-table .grade {
  font-weight: 700;
}

.gradebook-table .grade small {
  margin-left: 6px;
  font: 12px var(--wp-font-mono);
  color: var(--wp-muted);
}

.gradebook-table .g-A {
  color: var(--wp-brand);
}

.gradebook-table .g-B {
  color: var(--wp-css);
}

.gradebook-table .g-C {
  color: var(--wp-muted);
}

.gradebook-table .g-D {
  color: var(--wp-warn);
}

.gradebook-table .g-E {
  color: var(--wp-bad);
}

.gradebook-table .task-head {
  line-height: 1.3;
  font-weight: 400;
}

.gradebook-table .task-name {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 12px;
  color: var(--wp-ink);
  word-break: break-all;
}

.gradebook-table .task-head.excluded .task-name {
  color: var(--wp-faint);
}

.gradebook-table .task-cov {
  margin-top: 4px;
}

.gradebook-table .cov-bar {
  display: block;
  height: 3px;
  border-radius: 2px;
  background: var(--wp-line);
  overflow: hidden;
}

.gradebook-table .cov-bar span {
  display: block;
  height: 100%;
  background: var(--wp-brand);
}

.gradebook-table .task-head.excluded .cov-bar span {
  background: var(--wp-faint);
}

.gradebook-table .cell {
  font: 13px var(--wp-font-mono);
}

.gradebook-table .cell.missing {
  font: 12px var(--wp-font-sans);
  color: var(--wp-bad);
}

.gradebook-table .score {
  padding: 2px 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--wp-ink);
  cursor: pointer;
}

.gradebook-table .score:hover {
  background: var(--wp-brand-soft);
}

.gradebook-table .score.unrated {
  font: 12px var(--wp-font-sans);
  color: var(--wp-faint);
}

.gradebook-table .missing.excluded,
.gradebook-table .score.excluded {
  color: var(--wp-faint);
}

.gradebook-table .total {
  font: 600 13px var(--wp-font-mono);
  cursor: default;
}

.gradebook-table .done {
  font: 13px var(--wp-font-mono);
  color: var(--wp-muted);
}

.gradebook-table .done.short {
  color: var(--wp-bad);
}
</style>
