<template>
  <div class="game-manage">
    <header class="head">
      <h2>游戏管理</h2>
      <p class="sub">处理同学的举报、被下架和申请重新上架的游戏；下架、恢复、删留言都会记进操作记录</p>
    </header>

    <n-tabs v-model:value="tab" type="line" animated @update:value="loadTab">
      <n-tab-pane name="reports" :tab="`举报${summary.pending_reports ? `（${summary.pending_reports}）` : ''}`">
        <n-flex justify="end" style="margin-bottom: 8px">
          <n-radio-group v-model:value="reportStatus" size="small" @update:value="loadReports(1)">
            <n-radio-button value="pending">待处理</n-radio-button>
            <n-radio-button value="all">全部</n-radio-button>
          </n-radio-group>
        </n-flex>
        <n-data-table
          :columns="reportColumns"
          :data="reports"
          :loading="loading"
          :bordered="false"
          size="small"
          remote
          :pagination="reportPagination"
        />
      </n-tab-pane>

      <n-tab-pane name="takedowns" :tab="`已下架${summary.appeals ? `（${summary.appeals} 个申请）` : ''}`">
        <n-data-table :columns="takedownColumns" :data="takedowns" :loading="loading" :bordered="false" size="small" />
      </n-tab-pane>

      <n-tab-pane name="log" tab="操作记录">
        <n-data-table
          :columns="logColumns"
          :data="logs"
          :loading="loading"
          :bordered="false"
          size="small"
          remote
          :pagination="logPagination"
        />
      </n-tab-pane>
    </n-tabs>

    <n-modal
      v-model:show="showTakedown"
      preset="card"
      :title="`下架「${takedownTarget?.title ?? ''}」`"
      style="width: 460px; max-width: calc(100vw - 32px)"
    >
      <n-input
        v-model:value="takedownReason"
        type="textarea"
        :autosize="{ minRows: 3, maxRows: 5 }"
        maxlength="200"
        show-count
        placeholder="下架原因，作者会看到"
      />
      <template #footer>
        <n-flex justify="flex-end">
          <n-button @click="showTakedown = false">取消</n-button>
          <n-button type="error" :disabled="!takedownReason.trim()" @click="confirmTakedown">下架</n-button>
        </n-flex>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref } from "vue"
import { RouterLink } from "vue-router"
import { NButton, NFlex, useMessage, type DataTableColumns } from "naive-ui"
import { Game } from "../api"
import { gameSummary, refreshGameSummary } from "../store/gameSummary"
import { parseTime } from "../utils/helper"
import type { GameLogItem, GameReport, GameTakedown } from "../utils/type"

const ACTIONS: Record<string, string> = {
  take_down: "下架",
  restore: "恢复上架",
  delete_comment: "删除留言",
  feature: "推荐到首页",
  unfeature: "取消推荐",
  award_badge: "颁发徽章",
  dismiss_report: "举报不用处理",
}
const STATUS: Record<string, string> = { draft: "没发布", listed: "在大厅", taken_down: "已下架" }
const PAGE_SIZE = 20

const message = useMessage()
const summary = gameSummary
const tab = ref<"reports" | "takedowns" | "log">("reports")
const loading = ref(false)

const gameLink = (display: number | null, title: string) =>
  display
    ? h(RouterLink, { to: { name: "game", params: { display } }, target: "_blank" }, () => title)
    : title
const time = (v: string | null) => (v ? parseTime(v, "M月D日 HH:mm") : "")

// ── 举报 ──

const reportStatus = ref<"pending" | "all">("pending")
const reports = ref<GameReport[]>([])
const reportPagination = reactive({
  page: 1,
  pageSize: PAGE_SIZE,
  itemCount: 0,
  onChange: (p: number) => loadReports(p),
})

async function loadReports(page = reportPagination.page) {
  loading.value = true
  try {
    const res = await Game.reports({ status: reportStatus.value, page, page_size: PAGE_SIZE })
    reports.value = res.items
    reportPagination.page = page
    reportPagination.itemCount = res.count
  } finally {
    loading.value = false
  }
}

async function dismiss(r: GameReport) {
  await Game.resolveReport(r.id)
  message.success("已标为处理过")
  await Promise.all([loadReports(), refreshGameSummary()])
}

const reportColumns: DataTableColumns<GameReport> = [
  { title: "时间", key: "created", width: 110, render: (r) => time(r.created) },
  { title: "游戏", key: "game", render: (r) => gameLink(r.game.display, r.game.title) },
  { title: "状态", key: "status", width: 80, render: (r) => STATUS[r.game.status] },
  { title: "举报人", key: "reporter", width: 100 },
  { title: "理由", key: "reason" },
  {
    title: "",
    key: "actions",
    width: 190,
    render: (r) =>
      r.resolved_at
        ? `已处理（${time(r.resolved_at)}）`
        : h(NFlex, { size: 6, wrap: false }, () => [
            h(NButton, { size: "tiny", onClick: () => dismiss(r) }, () => "不用处理"),
            r.game.status !== "taken_down"
              ? h(
                  NButton,
                  { size: "tiny", type: "error", ghost: true, onClick: () => openTakedown(r.game) },
                  () => "下架",
                )
              : null,
          ]),
  },
]

// ── 下架 ──

const showTakedown = ref(false)
const takedownTarget = ref<{ display: number; title: string } | null>(null)
const takedownReason = ref("")

function openTakedown(g: { display: number; title: string }) {
  takedownTarget.value = g
  takedownReason.value = ""
  showTakedown.value = true
}

async function confirmTakedown() {
  if (!takedownTarget.value) return
  try {
    await Game.takedown(takedownTarget.value.display, takedownReason.value.trim())
    message.success("已下架")
    showTakedown.value = false
    await Promise.all([loadReports(), refreshGameSummary()])
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "下架失败")
  }
}

// ── 已下架和申请 ──

const takedowns = ref<GameTakedown[]>([])

async function loadTakedowns() {
  loading.value = true
  try {
    takedowns.value = await Game.takedowns()
  } finally {
    loading.value = false
  }
}

async function restore(g: GameTakedown) {
  await Game.restore(g.display)
  message.success(`「${g.title}」已恢复`)
  await Promise.all([loadTakedowns(), refreshGameSummary()])
}

const takedownColumns: DataTableColumns<GameTakedown> = [
  { title: "游戏", key: "title", render: (g) => gameLink(g.display, g.title) },
  { title: "作者", key: "author", width: 100 },
  { title: "下架原因", key: "takedown_reason" },
  {
    title: "申请重新上架",
    key: "appeal_at",
    width: 130,
    render: (g) => (g.appeal_at ? time(g.appeal_at) : "—"),
  },
  {
    title: "",
    key: "actions",
    width: 90,
    render: (g) => h(NButton, { size: "tiny", type: "primary", onClick: () => restore(g) }, () => "恢复上架"),
  },
]

// ── 操作记录 ──

const logs = ref<GameLogItem[]>([])
const logPagination = reactive({
  page: 1,
  pageSize: PAGE_SIZE,
  itemCount: 0,
  onChange: (p: number) => loadLog(p),
})

async function loadLog(page = logPagination.page) {
  loading.value = true
  try {
    const res = await Game.log({ page, page_size: PAGE_SIZE })
    logs.value = res.items
    logPagination.page = page
    logPagination.itemCount = res.count
  } finally {
    loading.value = false
  }
}

const logColumns: DataTableColumns<GameLogItem> = [
  { title: "时间", key: "created", width: 110, render: (l) => time(l.created) },
  { title: "老师", key: "actor", width: 100, render: (l) => l.actor ?? "（已删除）" },
  { title: "操作", key: "action", width: 110, render: (l) => ACTIONS[l.action] ?? l.action },
  { title: "游戏", key: "game", render: (l) => gameLink(l.game.display, l.game.title) },
  { title: "原因 / 内容", key: "reason" },
]

function loadTab(name: string) {
  if (name === "reports") loadReports(1)
  else if (name === "takedowns") loadTakedowns()
  else loadLog(1)
}

onMounted(() => {
  loadReports(1)
  refreshGameSummary()
})
</script>

<style scoped>
.game-manage {
  max-width: 1100px;
  padding: 20px 24px 40px;
}

.head {
  margin-bottom: 8px;
}

h2 {
  margin: 0;
  font-size: 20px;
}

.sub {
  margin: 4px 0 0;
  color: var(--wp-muted);
  font-size: 13px;
}
</style>
