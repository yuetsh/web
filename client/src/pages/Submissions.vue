<template>
  <n-split
    class="container"
    direction="horizontal"
    :default-size="0.5"
    :min="0.2"
    :max="0.8"
  >
    <template #1>
      <n-flex
        vertical
        style="height: 100%; padding-right: 10px; overflow: hidden"
      >
        <n-flex align="center" justify="end">
            <n-select
              :value="query.flag"
              style="width: 100px"
              clearable
              placeholder="标记"
              :options="flagFilterOptions"
              @update:value="handleFlagSelect"
            />
            <n-select
              v-model:value="query.zone"
              style="width: 100px"
              clearable
              placeholder="从夯到拉"
              :options="[
                { label: '夯爆了', value: 'featured' },
                { label: 'NPC', value: 'pending' },
                { label: '拉完了', value: 'low' },
              ]"
            />
            <n-input
              style="width: 120px"
              v-model:value="query.username"
              clearable
            />
            <n-pagination
              v-model:page="query.page"
              :page-size="10"
              :item-count="count"
              simple
            />
            <n-button
              secondary
              style="padding: 0 10px"
              title="刷新"
              @click="init"
            >
              <Icon :width="16" icon="lucide:refresh-cw" />
            </n-button>
        </n-flex>
        <n-data-table
          flex-height
          striped
          :columns="columns"
          :data="data"
          :row-key="(row: SubmissionOut) => row.id"
          :expanded-row-keys="expandedKeys"
          @update:expanded-row-keys="handleExpand"
          :row-props="rowProps"
          :row-class-name="rowClassName"
          style="flex: 1; min-height: 0"
        />
      </n-flex>
    </template>
    <template #2>
      <div style="height: 100%; padding-left: 10px">
        <Preview
          v-if="submission.id"
          :html="html"
          :css="css"
          :js="js"
          :submission-id="submission.id"
          @after-score="afterScore"
          @show-code="codeModal = true"
        />
      </div>
    </template>
  </n-split>

  <CodeModal
    v-model:show="codeModal"
    :html="html"
    :css="css"
    :js="js"
    @copy-to-editor="copyToEditor"
  />

  <ChainModal
    v-model:show="chainModal"
    :submission-id="chainSubmissionId"
    :username="chainUsername"
  />
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, reactive, ref, watch } from "vue"
import { NButton, NDataTable, NTag, useMessage, type DataTableColumn } from "naive-ui"
import { Icon } from "@iconify/vue"
import { Submission } from "../api"
import type { SubmissionOut, FlagType } from "../utils/type"
import { parseTime } from "../utils/helper"
import { goHome } from "../utils/helper"
import { TASK_TYPE } from "../utils/const"
import { watchDebounced } from "@vueuse/core"
import { useRouter, useRoute } from "vue-router"

import Preview from "../components/editor/Preview.vue"
import TaskTitle from "../components/submissions/TaskTitle.vue"
import CodeModal from "../components/submissions/CodeModal.vue"
import ChainModal from "../components/submissions/ChainModal.vue"
import FlagCell from "../components/submissions/FlagCell.vue"
import ExpandedSubTable from "../components/submissions/ExpandedSubTable.vue"

import { submission } from "../store/submission"
import { taskTab, challengeDisplay } from "../store/task"
import { step } from "../store/tutorial"
import { html as eHtml, css as eCss, js as eJs } from "../store/editors"
import { roleAdmin, roleSuper, user } from "../store/user"

const route = useRoute()
const router = useRouter()
const message = useMessage()

// 列表数据
const data = ref<SubmissionOut[]>([])
const count = ref(0)
const query = reactive({
  page: Number(route.params.page),
  username: (Array.isArray(route.query.username)
    ? ""
    : (route.query.username ?? "")) as string,
  flag: null as string | null,
  zone: null as string | null,
})

// 当前选中提交的代码
const html = computed(() => submission.value.html)
const css = computed(() => submission.value.css)
const js = computed(() => submission.value.js)

// Modal 状态
const codeModal = ref(false)
const chainModal = ref(false)
const chainSubmissionId = ref<string>("")
const chainUsername = ref<string>("")

// 展开行
const expandedKeys = ref<string[]>([])
const expandedData = reactive(new Map<string, SubmissionOut[]>())
const expandedLoading = reactive(new Set<string>())

// 管理员判断
const isAdmin = computed(() => roleAdmin.value || roleSuper.value)

// Flag 过滤选项
const flagFilterOptions = computed(() => {
  const opts = [
    { label: "红旗", value: "red" },
    { label: "蓝旗", value: "blue" },
    { label: "绿旗", value: "green" },
    { label: "黄旗", value: "yellow" },
    { label: "全部", value: "any" },
  ]
  if (isAdmin.value) opts.push({ label: "清除", value: "_clear_all" })
  return opts
})

function handleFlagSelect(value: string | null) {
  if (value === "_clear_all") {
    clearAllFlags()
    return
  }
  query.flag = value
}

async function updateFlag(row: SubmissionOut, flag: FlagType) {
  await Submission.updateFlag(row.id, flag)
  row.flag = flag
}

async function clearAllFlags() {
  await Submission.clearAllFlags()
  data.value = data.value.map((d) => ({ ...d, flag: null }))
  query.flag = null
}

function showChain(submissionId: string, username: string) {
  chainSubmissionId.value = submissionId
  chainUsername.value = username
  chainModal.value = true
}

// 表格列定义
const columns: DataTableColumn<SubmissionOut>[] = [
  {
    type: "expand",
    expandable: () => true,
    renderExpand: (row) =>
      h(ExpandedSubTable, {
        row,
        items: expandedData.get(row.id),
        loading: expandedLoading.has(row.id),
        onSelect: (id) => getSubmissionByID(id),
        onDelete: (r, parentId) => handleDelete(r, parentId),
        "onShow-chain": (submissionId, username) =>
          showChain(submissionId, username),
      }),
  },
  {
    title: "",
    key: "flag",
    width: 50,
    render: (row) =>
      h(FlagCell, {
        flag: row.flag ?? null,
        isAdmin: isAdmin.value,
        "onUpdate:flag": (flag: FlagType) => updateFlag(row, flag),
      }),
  },
  {
    title: "",
    key: "zone",
    width: 42,
    render: (row) => {
      const map: Record<
        string,
        { label: string; type: "success" | "default" | "warning" }
      > = {
        featured: { label: "夯", type: "success" },
        pending: { label: "N", type: "default" },
        low: { label: "拉", type: "warning" },
      }
      if (!row.zone || !map[row.zone]) return null
      const { label, type } = map[row.zone]
      return h(NTag, { size: "small", round: true, type }, () => label)
    },
  },
  {
    title: "时间",
    key: "created",
    width: 110,
    render: (row) => parseTime(row.created, "YYYY-MM-DD HH:mm:ss"),
  },
  {
    title: "提交者",
    key: "user",
    width: 80,
    render: (row) => row.username,
  },
  {
    title: "任务",
    key: "task_title",
    render: (row) => h(TaskTitle, { submission: row }),
  },
  {
    title: "得分",
    key: "score",
    width: 70,
    render: (row) => {
      const myScore = row.my_score > 0 ? String(row.my_score) : "-"
      const avgScore = row.score > 0 ? row.score.toFixed(2) : "-"
      return h(
        "div",
        { style: { display: "flex", gap: "6px", alignItems: "baseline" } },
        [
          h("span", avgScore),
          h("span", { style: { fontSize: "11px", color: "#999" } }, myScore),
        ],
      )
    },
  },
  {
    title: "次数",
    key: "submit_count",
    width: 60,
    render: (row) => row.submit_count || "-",
  },
  {
    title: "浏览",
    key: "view_count",
    width: 60,
    render: (row) => row.view_count || "-",
  },
]

async function handleExpand(keys: (string | number)[]) {
  const strKeys = keys.map(String)
  const newKey = strKeys.find((k) => !expandedKeys.value.includes(k))
  expandedKeys.value = strKeys
  if (newKey) {
    const row = data.value.find((d) => d.id === newKey)
    if (row && !expandedData.has(newKey)) {
      expandedLoading.add(newKey)
      try {
        const items = await Submission.listByUserTask(row.userid, row.task_id)
        expandedData.set(newKey, items)
      } finally {
        expandedLoading.delete(newKey)
      }
    }
  }
}

async function handleDelete(row: SubmissionOut, parentId: string) {
  try {
    await Submission.delete(row.id)
  } catch (error: any) {
    message.error(error.response?.data?.detail ?? "删除失败，请重试")
    return
  }
  const items = expandedData.get(parentId)
  if (items)
    expandedData.set(
      parentId,
      items.filter((d) => d.id !== row.id),
    )
  if (submission.value.id === row.id) submission.value.id = ""
  const res = await Submission.list(query)
  data.value = res.items
  count.value = res.count
}

function rowProps(row: SubmissionOut) {
  return {
    style: { cursor: "pointer" },
    onClick: () => {
      getSubmissionByID(row.id)
      handleExpand(
        expandedKeys.value.includes(row.id)
          ? expandedKeys.value.filter((k) => k !== row.id)
          : [...expandedKeys.value, row.id],
      )
    },
  }
}

function rowClassName(row: SubmissionOut) {
  return submission.value.id === row.id ? "row-active" : ""
}

async function init() {
  expandedKeys.value = []
  expandedData.clear()
  const res = await Submission.list(query)
  data.value = res.items
  count.value = res.count
}

async function getSubmissionByID(id: string) {
  submission.value = await Submission.get(id)
}

function afterScore() {
  data.value = data.value.map((d) => {
    if (d.id === submission.value.id) d.my_score = submission.value.my_score
    return d
  })
}

function copyToEditor() {
  eHtml.value = html.value
  eCss.value = css.value
  eJs.value = js.value
  goHome(router, submission.value.task_type, submission.value.task_display)
}

watch(
  () => query.page,
  (v) => {
    init()
    router.push({ params: { page: v } })
  },
)
watchDebounced(
  () => query.username,
  () => {
    query.page = 1
    init()
  },
  { debounce: 500, maxWait: 1000 },
)
watch(
  () => query.flag,
  () => {
    query.page = 1
    init()
  },
)
watch(
  () => query.zone,
  () => {
    query.page = 1
    init()
  },
)

onMounted(init)
onUnmounted(() => {
  submission.value = {
    id: "",
    userid: 0,
    username: "",
    task_id: 0,
    task_display: 0,
    task_title: "",
    task_type: TASK_TYPE.Tutorial,
    score: 0,
    my_score: 0,
    html: "",
    css: "",
    js: "",
    submit_count: 0,
    view_count: 0,
    created: new Date(),
    modified: new Date(),
  }
})
</script>

<style scoped>
.container {
  padding: 10px;
  box-sizing: border-box;
  width: 100%;
}

:deep(.row-active td) {
  background-color: rgba(24, 160, 80, 0.1) !important;
}
</style>
