<template>
  <n-flex
    vertical
    :size="12"
    style="height: 100%; min-width: 0; box-sizing: border-box; padding: 10px 10px 10px 0; overflow: hidden;"
  >
    <n-flex class="toolbar" align="center" justify="space-between" style="flex-shrink: 0;">
      <n-flex align="center" :size="8" wrap style="min-width: 0;">
        <n-select
          v-model:value="query.classname"
          class="class-select"
          :options="classOptions"
          placeholder="班级"
          :loading="classesLoading"
        />
        <n-select
          v-model:value="query.task_type"
          class="type-select"
          :options="taskTypeOptions"
        />
        <n-input
          v-model:value="query.username"
          class="search-input"
          clearable
          placeholder="学生搜索"
        />
        <n-switch v-model:value="query.include_all_tasks">
          <template #checked>全部有提交任务</template>
          <template #unchecked>只看计入任务</template>
        </n-switch>
      </n-flex>
      <n-flex align="center" :size="8">
        <n-button
          secondary
          title="刷新"
          :disabled="!query.classname"
          :loading="loading"
          @click="loadGradebook"
        >
          <template #icon>
            <Icon icon="lucide:refresh-cw" :width="15" />
          </template>
        </n-button>
        <n-button
          type="primary"
          secondary
          :disabled="!query.classname || !gradebook"
          :loading="exporting"
          @click="exportCsv"
        >
          <template #icon>
            <Icon icon="lucide:download" :width="15" />
          </template>
          导出 CSV
        </n-button>
      </n-flex>
    </n-flex>

    <n-alert v-if="loadError" type="error" closable @close="loadError = ''">
      {{ loadError }}
    </n-alert>

    <n-flex v-if="gradebook" align="center" :size="8" style="flex-shrink: 0;">
      <n-tag size="small">学生 {{ gradebook.student_count }}</n-tag>
      <n-tag size="small">任务 {{ gradebook.task_count }}</n-tag>
      <n-tag size="small" type="success">
        计入 {{ gradebook.included_task_count }}
      </n-tag>
      <n-tag size="small">
        覆盖门槛 {{ gradebook.coverage_threshold_count }} 人
      </n-tag>
    </n-flex>

    <n-data-table
      size="small"
      striped
      flex-height
      :loading="loading"
      :columns="columns"
      :data="rows"
      :row-key="(row: GradebookRow) => row.user_id"
      :scroll-x="scrollX"
      style="flex: 1; min-height: 0;"
    />
  </n-flex>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from "vue"
import { Icon } from "@iconify/vue"
import { watchDebounced } from "@vueuse/core"
import {
  NButton,
  NTag,
  NText,
  useMessage,
  type DataTableColumn,
} from "naive-ui"
import { useRouter } from "vue-router"
import { Account, Gradebook } from "../api"
import { displayGradebookStudentName } from "../utils/gradebook"
import type {
  GradebookCell,
  GradebookOut,
  GradebookQuery,
  GradebookRow,
  GradebookTask,
  GradebookTaskType,
} from "../utils/type"

const router = useRouter()
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

const taskTypeOptions: { label: string; value: GradebookTaskType | "" }[] = [
  { label: "全部", value: "" },
  { label: "教程", value: "tutorial" },
  { label: "挑战", value: "challenge" },
]

const classOptions = computed(() =>
  classes.value.map((classname) => ({ label: classname, value: classname })),
)
const rows = computed(() => gradebook.value?.rows ?? [])
const scrollX = computed(() => 1040 + (gradebook.value?.tasks.length ?? 0) * 96)

function formatScore(value: number | null) {
  if (value === null) return "-"
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function taskTitle(task: GradebookTask) {
  const typeLabel = task.task_type === "tutorial" ? "教程" : "挑战"
  return `${typeLabel}${task.display}`
}

function openSubmission(cell: GradebookCell) {
  if (!cell.submitted || !cell.submission_id) return
  const { href } = router.resolve({
    name: "submission",
    params: { id: cell.submission_id },
  })
  window.open(href, "_blank")
}

function gradeTagType(grade: string) {
  if (grade === "A") return "success"
  if (grade === "B") return "info"
  if (grade === "C") return "default"
  return "warning"
}

function renderTaskHeader(task: GradebookTask) {
  return h("div", { class: ["task-header", { muted: !task.included }] }, [
    h("div", { class: "task-title", title: task.title }, taskTitle(task)),
    h("div", { class: "task-meta" }, [
      h("span", `${Math.round(task.coverage * 100)}%`),
      task.included
        ? null
        : h(NTag, { size: "tiny", round: false }, { default: () => "未计入" }),
    ]),
  ])
}

function renderScore(row: GradebookRow, task: GradebookTask) {
  const cell = row.scores[task.id]
  if (!cell || !cell.submitted) {
    return h(
      NText,
      { class: "missing-cell", type: "error" },
      { default: () => "缺交" },
    )
  }
  return h(
    NButton,
    {
      text: true,
      type: task.included ? "primary" : "default",
      class: ["score-link", { muted: !task.included }],
      onClick: (event: MouseEvent) => {
        event.stopPropagation()
        openSubmission(cell)
      },
    },
    { default: () => formatScore(cell.score) },
  )
}

function renderMissingCount(value: number) {
  if (value <= 0) return "0"
  return h(NText, { type: "error" }, { default: () => String(value) })
}

const columns = computed<DataTableColumn<GradebookRow>[]>(() => {
  const tasks = gradebook.value?.tasks ?? []
  return [
    {
      title: "排名",
      key: "rank",
      width: 60,
      fixed: "left",
    },
    {
      title: "平时等级",
      key: "grade",
      width: 80,
      fixed: "left",
      render: (row) =>
        h(
          NTag,
          { size: "small", type: gradeTagType(row.grade) },
          { default: () => row.grade },
        ),
    },
    {
      title: "考核等级",
      key: "assessment_grade",
      width: 80,
      fixed: "left",
      render: (row) =>
        h(
          NTag,
          { size: "small", type: gradeTagType(row.assessment_grade) },
          { default: () => row.assessment_grade },
        ),
    },
    {
      title: "考核分数",
      key: "assessment_score",
      width: 80,
      fixed: "left",
      render: (row) => row.assessment_score,
    },
    {
      title: "学生",
      key: "username",
      width: 80,
      fixed: "left",
      render: (row) => {
        const studentName = displayGradebookStudentName(row)
        return h(NText, { title: studentName }, { default: () => studentName })
      },
    },
    ...tasks.map((task) => ({
      title: () => renderTaskHeader(task),
      key: `task-${task.id}`,
      width: 96,
      align: "center" as const,
      className: task.included ? "" : "excluded-task-column",
      render: (row: GradebookRow) => renderScore(row, task),
    })),
    {
      title: "教程合计",
      key: "tutorial_total",
      width: 92,
      fixed: "right",
      render: (row) => formatScore(row.tutorial_total),
    },
    {
      title: "挑战合计",
      key: "challenge_total",
      width: 92,
      fixed: "right",
      render: (row) => formatScore(row.challenge_total),
    },
    {
      title: "总分",
      key: "total_score",
      width: 82,
      fixed: "right",
      render: (row) => formatScore(row.total_score),
    },
    {
      title: "平均",
      key: "average_score",
      width: 82,
      fixed: "right",
      render: (row) => formatScore(row.average_score),
    },
    {
      title: "已交",
      key: "submitted_task_count",
      width: 70,
      fixed: "right",
    },
    {
      title: "缺交",
      key: "missing_task_count",
      width: 70,
      fixed: "right",
      render: (row) => renderMissingCount(row.missing_task_count),
    },
  ]
})

async function loadClasses() {
  classesLoading.value = true
  try {
    classes.value = await Account.listClasses()
    if (!query.classname && classes.value.length > 0) {
      query.classname = classes.value[0]
    }
  } finally {
    classesLoading.value = false
  }
}

async function loadGradebook() {
  if (!query.classname) {
    gradebook.value = null
    return
  }
  loading.value = true
  loadError.value = ""
  try {
    gradebook.value = await Gradebook.get(query)
    classes.value = gradebook.value.classes
  } catch (err: any) {
    loadError.value = err.response?.data?.detail ?? "成绩册加载失败"
  } finally {
    loading.value = false
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
  () => [query.classname, query.task_type, query.include_all_tasks],
  () => loadGradebook(),
)

watchDebounced(
  () => query.username,
  () => loadGradebook(),
  { debounce: 400, maxWait: 1000 },
)

onMounted(async () => {
  await loadClasses()
  await loadGradebook()
})
</script>

<style scoped>
.class-select {
  width: 150px;
}

.type-select {
  width: 112px;
}

.search-input {
  width: 160px;
}

.task-header {
  min-width: 0;
  line-height: 1.2;
}

.task-header.muted {
  color: #888;
}

.task-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.task-meta {
  display: flex;
  min-height: 18px;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 2px;
  color: #999;
  font-size: 11px;
}

.missing-cell {
  color: #d03050;
  font-size: 12px;
}

.score-link.muted {
  color: #777;
}

:deep(.excluded-task-column) {
  background: #fafafa;
}

@media (max-width: 720px) {
  .toolbar {
    align-items: flex-start;
  }

  .class-select,
  .type-select,
  .search-input {
    width: 100%;
  }
}
</style>
