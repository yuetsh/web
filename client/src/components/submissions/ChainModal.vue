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
        <span v-if="steps" class="muted">{{ steps }} 轮</span>
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
        <div class="left">
          <div v-if="showTrend" class="trend">
            <span class="muted">层级</span>
            <div class="bars">
              <button
                v-for="b in trend"
                :key="b.i"
                :class="['bar', { on: b.i === selected, none: !b.level }]"
                :style="{ height: `${b.level ? 6 + b.level * 5 : 4}px` }"
                :title="`第 ${nums[b.i]} 轮${b.level ? ' · ' + levelLabel(b.level) : ''}`"
                @click="select(b.i)"
              ></button>
            </div>
          </div>
          <ol class="rounds">
            <li
              v-for="(r, i) in rounds"
              :key="i"
              :class="['round', { on: i === selected, guide: isGuide(r) }]"
              @click="isGuide(r) || (selected = i)"
            >
              <div class="round-head">
                <span class="num">{{ nums[i] }}</span>
                <span :class="['src', `src-${r.source || 'conversation'}`]">
                  {{ sourceLabel(r.source) }}
                </span>
                <span v-if="r.prompt_level" class="level">{{ levelLabel(r.prompt_level) }}</span>
                <span v-if="repeats[i]" class="repeat" title="和前面某一轮的提问一字不差">重复提问</span>
                <span v-if="changes[i]" class="muted">{{ changes[i] }}</span>
                <span v-if="i === rounds.length - 1" class="final">交的这一版</span>
                <span v-else-if="isGuide(r)" class="muted no-code">问写提示词的建议，不生成网页</span>
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
        </div>

        <div class="stage">
          <div class="stage-head">
            <b>第 {{ nums[selected] }} 轮生成的网页</b>
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

// 引导对话（问怎么写提示词）夹在 AI 对话中间，不算轮数，也不能选中
const isGuide = (r: PromptRound) => r.source === "guidance"
const steps = computed(() => rounds.value.filter((r) => !isGuide(r)).length)
const nums = computed(() => {
  let n = 0
  return rounds.value.map((r) => (isGuide(r) ? "" : String(++n)))
})

// 层级走势：每轮 AI 对话 / 外部 AI 一根柱子，两轮以上、有标过层级才显示
const trend = computed(() =>
  rounds.value.flatMap((r, i) => (isGuide(r) ? [] : [{ i, level: r.prompt_level }])),
)
const showTrend = computed(() => trend.value.length > 1 && trend.value.some((b) => b.level))

// 和前面某一轮一字不差的提问（手改那一轮的正文都一样，不算）
const repeats = computed(() => {
  const seen = new Set<string>()
  return rounds.value.map((r) => {
    if (isGuide(r) || r.source === "edit") return false
    const key = r.question.replace(/\s+/g, " ").trim()
    const dup = seen.has(key)
    seen.add(key)
    return dup
  })
})

// 这一轮的代码比上一版改了多少行：只按行内容数，不管顺序
function codeLines(r: PromptRound) {
  return [r.html, r.css, r.js]
    .join("\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
}

function lineDiff(before: string[], after: string[]) {
  const left = new Map<string, number>()
  for (const l of before) left.set(l, (left.get(l) ?? 0) + 1)
  let added = 0
  for (const l of after) {
    const n = left.get(l) ?? 0
    if (n) left.set(l, n - 1)
    else added++
  }
  const removed = before.length - (after.length - added)
  return added || removed ? `+${added} −${removed} 行` : "代码没变"
}

const changes = computed(() => {
  let prev: string[] | null = null
  return rounds.value.map((r) => {
    if (isGuide(r) || !r.html) return ""
    const cur = codeLines(r)
    const text = prev ? lineDiff(prev, cur) : ""
    prev = cur
    return text
  })
})

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

function select(i: number) {
  selected.value = i
  nextTick(() =>
    document.querySelector(".rounds .round.on")?.scrollIntoView({ block: "nearest" }),
  )
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
  let i = selected.value + step
  while (rounds.value[i] && isGuide(rounds.value[i]!)) i += step
  if (rounds.value[i]) select(i)
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

.left {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.trend {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 0 6px 6px 2px;
  border-bottom: 1px solid var(--wp-line);
}

.bars {
  flex: 1;
  height: 38px;
  display: flex;
  align-items: flex-end;
  gap: 3px;
}

.bar {
  flex: 1;
  max-width: 22px;
  padding: 0;
  border: 0;
  border-radius: 2px 2px 0 0;
  background: var(--wp-faint);
  opacity: 0.55;
  cursor: pointer;
}

.bar.none {
  background: var(--wp-line);
  opacity: 1;
}

.bar:hover,
.bar.on {
  opacity: 1;
}

.bar.on {
  background: var(--wp-brand);
}

.rounds {
  flex: 1;
  min-height: 0;
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
.repeat,
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

.src-guidance {
  color: var(--wp-muted);
  background: var(--wp-paper);
}

.round.guide {
  border-style: dashed;
  background: transparent;
  cursor: default;
}

.round.guide:hover {
  border-color: var(--wp-line);
}

.round.guide .q {
  color: var(--wp-muted);
}

.repeat {
  color: var(--wp-warn);
  background: var(--wp-warn-soft);
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
