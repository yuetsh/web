<template>
  <n-modal
    :show="show"
    preset="card"
    style="width: 92vw; max-width: 1280px"
    :bordered="false"
    @update:show="emit('update:show', $event)"
  >
    <template #header>
      <div class="head">
        <b>提示词</b>
        <span v-if="rounds.length" class="muted">{{ rounds.length }} 轮</span>
        <span v-if="title" class="muted title">{{ title }}</span>
      </div>
    </template>
    <template #header-extra>
      <n-popover trigger="click" placement="bottom-end">
        <template #trigger>
          <n-button size="small" quaternary style="margin-right: 8px">
            <template #icon><Icon icon="lucide:info" /></template>
            L1–L6 是什么
          </n-button>
        </template>
        <div class="levels">
          <div class="levels-note">按布鲁姆认知层级给每次提问打的标签，越高越需要思考：</div>
          <div v-for="(l, n) in PROMPT_LEVELS" :key="n">
            <b>L{{ n }} {{ l.name }}</b>：{{ l.desc }}
          </div>
        </div>
      </n-popover>
    </template>

    <n-spin :show="loading">
      <n-empty
        v-if="!loading && !rounds.length"
        description="这份提交没有关联的提示词"
        style="padding: 80px 0"
      />
      <div v-else class="body">
        <ol class="rounds">
          <li
            v-for="(r, i) in rounds"
            :key="i"
            :class="['round', { on: i === selected }]"
            @click="selected = i"
          >
            <div class="round-head">
              <span class="num">{{ i + 1 }}</span>
              <span :class="['src', `src-${r.source || 'conversation'}`]">
                {{ sourceLabel(r.source) }}
              </span>
              <span v-if="r.prompt_level" class="level">{{ levelLabel(r.prompt_level) }}</span>
              <span v-if="i === rounds.length - 1" class="final">交的这一版</span>
              <span v-else-if="!r.html" class="muted no-code">没有网页</span>
            </div>
            <div
              :class="['q', 'markdown-body', { clamp: isLong(r.question) && !expanded.has(i) }]"
              v-html="renderMarkdown(r.question)"
            ></div>
            <button v-if="isLong(r.question)" class="more" @click.stop="toggle(i)">
              {{ expanded.has(i) ? "收起" : "展开全部" }}
            </button>
          </li>
        </ol>

        <div class="stage">
          <div class="stage-head">
            <b>第 {{ selected + 1 }} 轮生成的网页</b>
            <span class="muted">↑ ↓ 切换</span>
          </div>
          <div class="frame">
            <iframe
              v-if="doc"
              :key="selected"
              :sandbox="PREVIEW_SANDBOX"
              :srcdoc="doc"
            ></iframe>
            <n-empty v-else description="这一轮没有生成网页" style="margin: auto" />
          </div>
        </div>
      </div>
    </n-spin>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue"
import { Icon } from "../../icons"
import { Showcase, Submission } from "../../api"
import { renderMarkdown } from "../../utils/markdown"
import { levelLabel, PROMPT_LEVELS, sourceLabel } from "../../utils/helper"
import { buildPreviewDocument, PREVIEW_SANDBOX } from "../../utils/previewDocument"
import type { PromptRound } from "../../utils/type"

// 一份提交是怎么一轮一轮问出来的：左边每轮的提问，右边这一轮生成的网页
const props = defineProps<{
  show: boolean
  submissionId: string
  // 例如“张三 · 个人名片”
  title?: string
  // 题目素材的地址，网页里的图片要用
  assetBaseUrl?: string
  // 作品展里的作品走作品展的接口（不用是老师或作者本人）
  fromShowcase?: boolean
}>()
const emit = defineEmits<{ "update:show": [value: boolean] }>()

const loading = ref(false)
const rounds = ref<PromptRound[]>([])
const selected = ref(0)
const expanded = ref(new Set<number>())

const doc = computed(() => {
  const r = rounds.value[selected.value]
  if (!r?.html) return ""
  return buildPreviewDocument({
    html: r.html,
    css: r.css ?? "",
    js: r.js ?? "",
    assetBaseUrl: props.assetBaseUrl,
  })
})

function isLong(text: string) {
  return text.length > 200 || text.split(/\r?\n/).length > 4
}

function toggle(i: number) {
  const next = new Set(expanded.value)
  if (!next.delete(i)) next.add(i)
  expanded.value = next
}

let seq = 0
async function load() {
  const s = ++seq
  loading.value = true
  rounds.value = []
  expanded.value = new Set()
  try {
    const data = props.fromShowcase
      ? await Showcase.getPromptChain(props.submissionId)
      : await Submission.getPromptChain(props.submissionId)
    if (s !== seq) return
    rounds.value = data
    // 默认看交的那一版
    selected.value = Math.max(0, data.length - 1)
    await nextTick()
    document.querySelector(".rounds .round.on")?.scrollIntoView({ block: "nearest" })
  } catch {
    if (s === seq) rounds.value = []
  } finally {
    if (s === seq) loading.value = false
  }
}

// 在捕获阶段接管按键：弹框开着时，批改页的 Esc / J / K、批改面板的 1–5 / P 都不能触发
function onKey(e: KeyboardEvent) {
  if (!props.show) return
  e.stopPropagation()
  if (e.key === "Escape") {
    emit("update:show", false)
    return
  }
  const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0
  if (!step || !rounds.value.length) return
  e.preventDefault()
  selected.value = Math.min(rounds.value.length - 1, Math.max(0, selected.value + step))
  nextTick(() =>
    document.querySelector(".rounds .round.on")?.scrollIntoView({ block: "nearest" }),
  )
}

watch(
  () => [props.show, props.submissionId] as const,
  ([visible]) => {
    if (visible) {
      load()
      window.addEventListener("keydown", onKey, true)
    } else {
      window.removeEventListener("keydown", onKey, true)
    }
  },
  { immediate: true },
)
onUnmounted(() => window.removeEventListener("keydown", onKey, true))
</script>

<style scoped>
.head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.muted {
  font-size: 12px;
  font-weight: 400;
  color: var(--wp-muted);
}

.levels {
  font-size: 13px;
  line-height: 1.9;
}

.levels-note {
  color: var(--wp-muted);
}

.body {
  display: grid;
  grid-template-columns: minmax(300px, 2fr) 3fr;
  gap: 16px;
  height: 72vh;
}

.rounds {
  margin: 0;
  padding: 0 6px 0 0;
  list-style: none;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.round {
  padding: 8px 10px;
  border: 1px solid var(--wp-line);
  border-radius: 8px;
  background: var(--wp-surface);
  cursor: pointer;
}

.round:hover {
  border-color: var(--wp-faint);
}

.round.on {
  border-color: var(--wp-brand);
  background: var(--wp-brand-soft);
}

.round-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 12px;
}

.num {
  min-width: 18px;
  font: 600 12px var(--wp-font-mono);
  color: var(--wp-muted);
}

.round.on .num {
  color: var(--wp-brand);
}

.src,
.level,
.final {
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

.final {
  margin-left: auto;
  color: var(--wp-brand);
  font-weight: 600;
}

.no-code {
  margin-left: auto;
}

.q {
  background: transparent;
  color: var(--wp-ink);
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.q.clamp {
  max-height: 84px;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(#000 55%, transparent);
  mask-image: linear-gradient(#000 55%, transparent);
}

.q :deep(p),
.q :deep(ul),
.q :deep(ol),
.q :deep(pre),
.q :deep(blockquote) {
  margin: 0 0 6px;
}

.q :deep(:last-child) {
  margin-bottom: 0;
}

.q :deep(pre) {
  padding: 6px 8px;
  font-size: 12px;
}

.q :deep(code) {
  white-space: pre-wrap;
}

.more {
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--wp-brand);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.stage {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stage-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 13px;
}

.frame {
  flex: 1;
  min-height: 0;
  display: flex;
  border: 1px solid var(--wp-line);
  border-radius: 8px;
  overflow: hidden;
}

.frame iframe {
  flex: 1;
  border: 0;
}
</style>
