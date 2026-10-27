<template>
  <div class="history-panel">
    <div class="toolbar">
      <span class="muted">共 {{ items.length }} 轮 · 点一条就把那一版放回编辑器</span>
      <n-tooltip>
        <template #trigger>
          <n-button quaternary size="small" :loading="loading" @click="load(true)">
            <template #icon><Icon icon="lucide:refresh-cw" /></template>
          </n-button>
        </template>
        刷新
      </n-tooltip>
    </div>

    <n-spin v-if="loading && !items.length" class="state" />
    <n-empty v-else-if="!items.length" class="state" description="还没有和 AI 对话过" />
    <n-scrollbar v-else class="scroll">
      <ol class="list">
        <li
          v-for="item in newestFirst"
          :key="item.assistant_message_id"
          :class="['item', { on: selectedAssistantMessageId === item.assistant_message_id }]"
          @click="selectItem(item)"
        >
          <div class="head">
            <span class="num">{{ item.index }}</span>
            <span :class="['src', `src-${item.source || 'conversation'}`]">
              {{ sourceLabel(item.source) }}
            </span>
            <span v-if="item.prompt_level" class="level">{{ levelLabel(item.prompt_level) }}</span>
            <span v-if="item.submission_id" class="submitted">交过</span>
            <span class="time">{{ parseTime(item.created, "MM-DD HH:mm") }}</span>
            <n-popconfirm @positive-click="deleteItem(item)">
              <template #trigger>
                <n-button
                  quaternary
                  size="tiny"
                  class="del"
                  :loading="deletingId === item.assistant_message_id"
                  :disabled="deletingId !== null"
                  @click.stop
                >
                  <template #icon><Icon icon="lucide:trash-2" :width="14" /></template>
                </n-button>
              </template>
              <template v-if="item.submission_id">
                这一版交过，删掉这轮对话后交的那一份也会一起删掉（有人评过分的删不了）。
              </template>
              <template v-else>删掉这一轮对话和它生成的网页？</template>
            </n-popconfirm>
          </div>
          <div class="q markdown-body" v-html="renderMarkdown(item.prompt)"></div>
          <div class="thumb">
            <iframe
              v-if="item.hasPage"
              title="页面缩略图"
              loading="lazy"
              :sandbox="PREVIEW_SANDBOX"
              tabindex="-1"
              :srcdoc="item.previewDoc"
            ></iframe>
            <span v-else class="muted">这一轮没有生成网页</span>
          </div>
        </li>
      </ol>
    </n-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { Icon } from "../../icons"
import { useMessage } from "naive-ui"
import { renderMarkdown } from "../../utils/markdown"
import { levelLabel, sourceLabel } from "../../utils/helper"
import { Prompt } from "../../api"
import type { PromptHistoryItem } from "../../utils/type"
import { parseTime } from "../../utils/helper"
import { buildPreviewDocument, PREVIEW_SANDBOX } from "../../utils/previewDocument"

const props = defineProps<{
  taskId: number
  active: boolean
  assetBaseUrl?: string
  refreshKey?: number
}>()

const emit = defineEmits<{
  select: [code: { html: string; css: string; js: string }]
  deleted: [assistantMessageId: number]
}>()

type HistoryViewItem = PromptHistoryItem & {
  // 按时间先后的序号（从 1 开始）
  index: number
  hasPage: boolean
  previewDoc: string
}

const items = ref<HistoryViewItem[]>([])
const loading = ref(false)
const selectedAssistantMessageId = ref<number | null>(null)
const deletingId = ref<number | null>(null)
let loadedTaskId = 0
let pendingRefresh = false

const naiveMessage = useMessage()

// 最新的放最上面，序号还是按时间先后
const newestFirst = computed(() => [...items.value].reverse())

function toViewItem(item: PromptHistoryItem, i: number): HistoryViewItem {
  const html = item.code_html ?? ""
  const css = item.code_css ?? ""
  const js = item.code_js ?? ""
  return {
    ...item,
    index: i + 1,
    hasPage: !!(html.trim() || css.trim() || js.trim()),
    previewDoc: buildPreviewDocument({
      html,
      css,
      js,
      assetBaseUrl: props.assetBaseUrl,
    }),
  }
}

async function deleteItem(item: HistoryViewItem) {
  if (deletingId.value !== null) return
  deletingId.value = item.assistant_message_id
  try {
    await Prompt.deleteMessagePair(item.assistant_message_id)
    items.value = items.value
      .filter((i) => i.assistant_message_id !== item.assistant_message_id)
      .map((i, idx) => ({ ...i, index: idx + 1 }))
    if (selectedAssistantMessageId.value === item.assistant_message_id) {
      selectedAssistantMessageId.value = null
    }
    emit("deleted", item.assistant_message_id)
    naiveMessage.success("已删除")
  } catch (error: any) {
    naiveMessage.error(error.response?.data?.detail ?? "删除失败，请重试")
  } finally {
    deletingId.value = null
  }
}

function selectItem(item: HistoryViewItem) {
  selectedAssistantMessageId.value = item.assistant_message_id
  emit("select", {
    html: item.code_html ?? "",
    css: item.code_css ?? "",
    js: item.code_js ?? "",
  })
}

// 加载中又要求刷新（比如自动提交了新代码、换了任务），等这次完成后再加载一次
let reloadAfter = false

async function load(force = true) {
  if (!props.taskId) return
  if (loading.value) {
    reloadAfter = true
    return
  }
  if (!force && loadedTaskId === props.taskId) return
  loading.value = true
  try {
    const taskChanged = loadedTaskId !== props.taskId
    const data = await Prompt.listHistory(props.taskId)
    items.value = data.map((item, i) => toViewItem(item, i))
    if (
      taskChanged ||
      !items.value.some(
        (item) =>
          item.assistant_message_id === selectedAssistantMessageId.value,
      )
    ) {
      selectedAssistantMessageId.value = null
    }
    loadedTaskId = props.taskId
  } finally {
    loading.value = false
    if (reloadAfter) {
      reloadAfter = false
      load(true)
    }
  }
}

watch(
  () => [props.active, props.taskId] as const,
  ([active]) => {
    if (active) {
      if (pendingRefresh) {
        pendingRefresh = false
        load(true)
      } else {
        load(false)
      }
    }
  },
)

watch(
  () => props.refreshKey,
  () => {
    if (props.active) load(true)
    else pendingRefresh = true
  },
)

onMounted(() => {
  if (props.active) load(false)
})
</script>

<style scoped>
.history-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.toolbar {
  height: 42px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--wp-line);
}

.muted {
  font-size: 12px;
  color: var(--wp-muted);
}

.state {
  margin: auto;
}

.scroll {
  flex: 1;
  min-height: 0;
}

.list {
  margin: 0;
  padding: 12px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item {
  border: 1px solid var(--wp-line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--wp-surface);
  cursor: pointer;
}

.item:hover {
  border-color: var(--wp-faint);
}

.item.on {
  border-color: var(--wp-brand);
}

.head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 6px 4px 10px;
  font-size: 12px;
}

.num {
  min-width: 18px;
  font: 600 12px var(--wp-font-mono);
  color: var(--wp-muted);
}

.src,
.level,
.submitted {
  padding: 0 6px;
  border-radius: 4px;
  line-height: 18px;
  white-space: nowrap;
}

.src {
  color: var(--wp-css);
  background: var(--wp-css-soft);
}

.src-edit {
  color: var(--wp-js);
  background: var(--wp-js-soft);
}

.src-manual {
  color: var(--wp-html);
  background: var(--wp-html-soft);
}

.level {
  color: var(--wp-ink);
  background: var(--wp-paper);
  border: 1px solid var(--wp-line);
}

.submitted {
  color: var(--wp-brand);
  background: var(--wp-brand-soft);
}

.time {
  margin-left: auto;
  font: 12px var(--wp-font-mono);
  color: var(--wp-muted);
}

.del {
  color: var(--wp-faint);
}

.q {
  max-height: 66px;
  overflow: hidden;
  padding: 0 10px 8px;
  background: transparent;
  color: var(--wp-ink);
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
  -webkit-mask-image: linear-gradient(#000 60%, transparent);
  mask-image: linear-gradient(#000 60%, transparent);
}

.q :deep(p),
.q :deep(ul),
.q :deep(ol),
.q :deep(pre),
.q :deep(blockquote) {
  margin: 0 0 4px;
}

.q :deep(pre) {
  padding: 6px 8px;
  font-size: 12px;
}

.q :deep(code) {
  white-space: pre-wrap;
}

.thumb {
  position: relative;
  height: 140px;
  display: grid;
  place-items: center;
  border-top: 1px solid var(--wp-line);
  background: var(--wp-paper);
  overflow: hidden;
}

/* 按 2 倍大小渲染再缩小 */
.thumb iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 200%;
  height: 200%;
  border: 0;
  transform: scale(0.5);
  transform-origin: 0 0;
  pointer-events: none;
}
</style>
