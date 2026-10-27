<template>
  <div class="review">
    <aside v-show="!fullDetail" class="tasks">
      <n-select
        v-model:value="classname"
        :options="classOptions"
        placeholder="选择班级"
        size="small"
      />
      <div v-if="classname" class="task-list">
        <template v-for="group in taskGroups" :key="group.label">
          <div class="group-label">{{ group.label }}</div>
          <button
            v-for="t in group.items"
            :key="t.id"
            :class="['task', { on: t.id === taskId }]"
            @click="taskId = t.id"
          >
            <span class="task-title">{{ t.display }}. {{ t.title }}</span>
            <span class="task-count">{{ progressOf(t.id) }}</span>
            <span class="bar"><span :style="{ width: percentOf(t.id) + '%' }"></span></span>
          </button>
        </template>
      </div>
      <n-empty v-else description="先选一个班级" size="small" style="margin-top: 40px" />
    </aside>

    <main v-show="!fullDetail" class="wall">
      <template v-if="task && classname">
        <div class="wall-head">
          <div class="wall-title">
            <b>{{ task.display }}. {{ task.title }}</b>
            <span class="chip">已交 {{ submittedCount }} / {{ students.length }}</span>
            <span v-if="unratedCount" class="chip warn">我未评 {{ unratedCount }}</span>
          </div>
          <n-flex :size="8" align="center" :wrap="false">
            <n-radio-group v-model:value="filter" size="small">
              <n-radio-button value="all">全部</n-radio-button>
              <n-radio-button value="unrated">我未评</n-radio-button>
              <n-radio-button value="missing">未交</n-radio-button>
              <n-radio-button value="present">课上展示</n-radio-button>
            </n-radio-group>
            <n-button
              type="primary"
              size="small"
              :disabled="!presentList.length"
              @click="startPresent"
            >
              开始讲评（{{ presentList.length }}）
            </n-button>
            <n-button size="small" @click="showStats = true">
              <template #icon><Icon icon="lucide:bar-chart-2" /></template>
              课堂总结
            </n-button>
            <n-tooltip>
              <template #trigger>
                <n-button size="small" quaternary @click="loadWall">
                  <Icon icon="lucide:refresh-cw" />
                </n-button>
              </template>
              刷新
            </n-tooltip>
          </n-flex>
        </div>
        <n-spin :show="loadingWall" class="grid-wrap">
          <template v-for="g in groups" :key="g.name">
          <div v-if="g.name" class="group-head">
            <b>{{ g.name }} 班</b>
            <span>已交 {{ g.submitted }} / {{ g.total }}</span>
            <span v-if="g.collapsed">· 这个班还没有人交，已收起</span>
          </div>
          <div v-if="!g.collapsed" class="grid">
            <button
              v-for="s in g.items"
              :key="s.user_id"
              :class="['card', { sel: s.submission?.id === selectedId, missing: !s.submission }]"
              :disabled="!s.submission"
              @click="s.submission && openDetail(s.submission.id)"
            >
              <div class="thumb">
                <iframe
                  v-if="s.submission"
                  :key="s.submission.id"
                  :sandbox="PREVIEW_SANDBOX"
                  :srcdoc="docOf(s)"
                  loading="lazy"
                  tabindex="-1"
                ></iframe>
                <span v-else>未交</span>
              </div>
              <div class="cap">
                <b>{{ s.username }}</b>
                <span v-if="!s.submission" class="state grey">未交</span>
                <span v-else-if="!s.submission.my_score" class="state warn">我未评</span>
                <span v-else class="state mono">{{ s.submission.my_score }} 分</span>
              </div>
              <span v-if="s.submission?.flag === 'present'" class="present">讲评</span>
            </button>
          </div>
          </template>
          <n-empty
            v-if="!loadingWall && !visible.length"
            description="没有符合条件的学生"
            style="margin-top: 60px"
          />
        </n-spin>
      </template>
      <n-empty v-else description="选一个班级和任务开始批改" style="margin-top: 120px" />
    </main>

    <aside v-if="selectedId" :class="['detail', { full: fullDetail }]">
      <ReviewPanel
        :submission-id="selectedId"
        :wide="fullDetail"
        can-widen
        @toggle-wide="bigPreview = !bigPreview"
        :nav="{ prev: neighbor(-1) !== null, next: neighbor(1) !== null }"
        @prev="move(-1)"
        @next="move(1)"
        @close="closeDetail"
        @changed="applyPatch"
      />
    </aside>
  </div>

  <TaskStatsModal
    v-if="task"
    v-model:show="showStats"
    :task-id="task.id"
    :title="`${task.display}. ${task.title}`"
    :initial-class="classname"
    in-review
    @open="openFromStats"
  />

  <div v-if="presenting" class="present-mode">
    <div class="present-head">
      <b>{{ presentList[presentIndex]?.username }}</b>
      <span>{{ presentIndex + 1 }} / {{ presentList.length }} · ← → 切换，Esc 退出</span>
      <button class="exit" @click="presenting = false">退出讲评</button>
    </div>
    <iframe
      v-if="presentList[presentIndex]"
      :sandbox="PREVIEW_SANDBOX"
      :key="presentIndex"
      :srcdoc="docOf(presentList[presentIndex]!)"
    ></iframe>
  </div>
</template>
<script lang="ts" setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { useStorage } from "@vueuse/core"
import { Icon } from "../icons"
import ReviewPanel from "../components/review/ReviewPanel.vue"
import TaskStatsModal from "../components/task/TaskStatsModal.vue"
import { Review } from "../api"
import { buildPreviewDocument, PREVIEW_SANDBOX } from "../utils/previewDocument"
import type { FlagType, ReviewOptions, ReviewProgress, ReviewStudent } from "../utils/type"

// 老师批改：选班级、选任务，看全班的作品墙，点开右侧详情打分
const route = useRoute()
const router = useRouter()

const options = ref<ReviewOptions>({ classes: [], tasks: [] })
const progress = ref<ReviewProgress | null>(null)
const students = ref<ReviewStudent[]>([])
const loadingWall = ref(false)
const classname = ref<string | null>((route.query.class as string) || null)
const taskId = ref<number | null>(route.query.task ? Number(route.query.task) : null)
const filter = ref<"all" | "unrated" | "missing" | "present">("all")
// 打开的作品放在地址栏（?sub=），浏览器“后退”就能回到作品墙
const selectedId = ref<string | null>((route.query.sub as string) || null)
watch(
  () => route.query.sub,
  (v) => {
    selectedId.value = (v as string) || null
  },
)
// 是不是从作品墙点开的（点开时记了一步历史，关闭时退回那一步）
let pushedDetail = false

function openDetail(id: string) {
  pushedDetail = true
  router.push({ query: { ...route.query, sub: id } })
}

// 课堂总结里点了高分作品：在这里打开；那个学生不在当前班就先切过去
const showStats = ref(false)
async function openFromStats(id: string, cls: string) {
  showStats.value = false
  if (classname.value !== ALL && classname.value !== cls) {
    classname.value = cls
    // 先让地址栏变成新班级（切班的 watch 也会这么改），关掉作品时“后退”才回到这个班
    await nextTick()
    await router.replace({ query: { class: cls, task: taskId.value ?? undefined } })
  }
  pushedDetail = true
  router.push({ query: { class: classname.value ?? undefined, task: taskId.value ?? undefined, sub: id } })
}

function closeDetail() {
  if (pushedDetail) {
    pushedDetail = false
    router.back()
  } else {
    const { sub: _, ...rest } = route.query
    router.replace({ query: rest })
  }
}
const presenting = ref(false)
// 点开作品默认用大图（预览占满中间），老师也可以切回旁边的小面板；记住选择
const bigPreview = useStorage("review-big-preview", true)
const fullDetail = computed(() => !!selectedId.value && bigPreview.value)
const presentIndex = ref(0)

// 全部班级：一道题全校的作品放在一面墙上，按班级分组
const ALL = "__all__"
const classOptions = computed(() => [
  { label: "全部班级", value: ALL },
  ...options.value.classes.map((c) => ({ label: `${c} 班`, value: c })),
])
const classParam = () => (classname.value === ALL ? undefined : classname.value ?? undefined)
const task = computed(() => options.value.tasks.find((t) => t.id === taskId.value))
const taskGroups = computed(() => [
  { label: "教程", items: options.value.tasks.filter((t) => t.task_type === "tutorial") },
  { label: "挑战", items: options.value.tasks.filter((t) => t.task_type === "challenge") },
])

const progressOf = (id: number) =>
  progress.value ? `${progress.value.submitted[id] ?? 0}/${progress.value.student_count}` : ""
const percentOf = (id: number) =>
  progress.value?.student_count
    ? Math.round(((progress.value.submitted[id] ?? 0) / progress.value.student_count) * 100)
    : 0

const submittedCount = computed(() => students.value.filter((s) => s.submission).length)
const unratedCount = computed(
  () => students.value.filter((s) => s.submission && !s.submission.my_score).length,
)
const visible = computed(() =>
  students.value.filter((s) => {
    if (filter.value === "unrated") return s.submission && !s.submission.my_score
    if (filter.value === "missing") return !s.submission
    if (filter.value === "present") return s.submission?.flag === "present"
    return true
  }),
)
const groups = computed(() => {
  if (classname.value !== ALL) {
    return [{ name: "", items: visible.value, submitted: 0, total: 0, collapsed: false }]
  }
  const map = new Map<string, ReviewStudent[]>()
  for (const s of visible.value) {
    if (!map.has(s.classname)) map.set(s.classname, [])
    map.get(s.classname)!.push(s)
  }
  return [...map].map(([name, items]) => {
    const all = students.value.filter((s) => s.classname === name)
    const submitted = all.filter((s) => s.submission).length
    // 全校一起看时，没人交的班（这道题没布置给它）只留一行标题，不然一屏都是“未交”
    return { name, items, submitted, total: all.length, collapsed: !submitted && filter.value !== "missing" }
  })
})
const presentList = computed(() => students.value.filter((s) => s.submission?.flag === "present"))

const docs = new Map<string, string>()
function docOf(s: ReviewStudent) {
  const sub = s.submission!
  let d = docs.get(sub.id)
  if (!d) {
    const t = task.value
    d = buildPreviewDocument({
      html: sub.html,
      css: sub.css,
      js: sub.js,
      // 学生代码里用相对路径引用题目素材
      assetBaseUrl: t ? `/media/tasks/${t.task_type}/${t.display}/` : undefined,
    })
    docs.set(sub.id, d)
  }
  return d
}

let wallSeq = 0
async function loadWall() {
  if (!classname.value || !taskId.value) return
  const s = ++wallSeq
  loadingWall.value = true
  try {
    const data = await Review.classWall(classParam(), taskId.value)
    if (s === wallSeq) students.value = data
  } finally {
    if (s === wallSeq) loadingWall.value = false
  }
}

async function loadProgress() {
  progress.value = null
  if (classname.value) progress.value = await Review.progress(classParam())
}

watch(classname, (c) => {
  if (c) localStorage.setItem("review-class", c)
  loadProgress()
})
watch([classname, taskId], () => {
  router.replace({ query: { class: classname.value ?? undefined, task: taskId.value ?? undefined } })
  pushedDetail = false
  filter.value = "all"
  students.value = []
  loadWall()
})

// 作品墙里有提交的学生，按当前筛选的顺序切换
function neighbor(step: number): string | null {
  const list = visible.value.filter((s) => s.submission)
  const i = list.findIndex((s) => s.submission!.id === selectedId.value)
  return list[i + step]?.submission?.id ?? null
}
// 切换学生不新增历史，免得要连按很多次后退
function move(step: number) {
  const id = neighbor(step)
  if (id) router.replace({ query: { ...route.query, sub: id } })
}

function applyPatch(p: { id: string; my_score?: number; score?: number; flag?: FlagType }) {
  const s = students.value.find((x) => x.submission?.id === p.id)?.submission
  if (!s) return
  if (p.my_score !== undefined) s.my_score = p.my_score
  if (p.score !== undefined) s.score = p.score
  if (p.flag !== undefined) s.flag = p.flag
}

function startPresent() {
  presentIndex.value = 0
  presenting.value = true
}

function onKey(e: KeyboardEvent) {
  if (presenting.value) {
    if (e.key === "Escape") presenting.value = false
    else if (e.key === "ArrowRight") presentIndex.value = Math.min(presentIndex.value + 1, presentList.value.length - 1)
    else if (e.key === "ArrowLeft") presentIndex.value = Math.max(presentIndex.value - 1, 0)
    return
  }
  const t = e.target as HTMLElement
  if (t.closest("input, textarea, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key === "Escape" && selectedId.value) closeDetail()
  // 按键盘上的位置：J 在左边是上一个，K 在右边是下一个（和面板上的左右箭头一致）
  else if (e.key === "j" || e.key === "J") move(-1)
  else if (e.key === "k" || e.key === "K") move(1)
}

onMounted(async () => {
  window.addEventListener("keydown", onKey)
  options.value = await Review.options()
  if (!classname.value) {
    const saved = localStorage.getItem("review-class")
    classname.value =
      saved && (saved === ALL || options.value.classes.includes(saved)) ? saved : null
  } else {
    loadProgress()
    loadWall()
  }
})
onUnmounted(() => window.removeEventListener("keydown", onKey))
</script>
<style scoped>
.review {
  height: 100%;
  display: flex;
  min-width: 0;
}

.tasks {
  width: 232px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-right: 1px solid var(--wp-line);
  background: var(--wp-surface);
  min-height: 0;
}

.task-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.group-label {
  padding: 8px 6px 2px;
  font-size: 12px;
  color: var(--wp-faint);
}

.task {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 8px;
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

.task-count {
  font: 12px var(--wp-font-mono);
  color: var(--wp-muted);
}

.bar {
  grid-column: 1 / -1;
  height: 3px;
  border-radius: 2px;
  background: var(--wp-line);
  overflow: hidden;
}

.bar span {
  display: block;
  height: 100%;
  background: var(--wp-brand);
}

.wall {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--wp-paper);
}

.wall-head {
  flex: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--wp-line);
  background: var(--wp-surface);
  flex-wrap: wrap;
}

.wall-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.chip {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--wp-brand-soft);
  color: var(--wp-brand);
  font-size: 12px;
  white-space: nowrap;
}

.chip.warn {
  background: var(--wp-warn-soft);
  color: var(--wp-warn);
}

.grid-wrap {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.group-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 14px 14px 0;
}

.group-head span {
  font-size: 12px;
  color: var(--wp-muted);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 12px;
  padding: 14px;
}

.card {
  position: relative;
  padding: 0;
  border: 1px solid var(--wp-line);
  border-radius: 8px;
  background: var(--wp-surface);
  overflow: hidden;
  text-align: left;
  font: inherit;
  color: var(--wp-ink);
  cursor: pointer;
}

.card:hover:not(:disabled) {
  border-color: var(--wp-brand);
}

.card.sel {
  outline: 2px solid var(--wp-brand);
  outline-offset: -1px;
}

.card:disabled {
  cursor: default;
}

.card:focus-visible {
  outline: 2px solid var(--wp-brand);
  outline-offset: 1px;
}

.thumb {
  height: 100px;
  position: relative;
  overflow: hidden;
  background: var(--wp-surface);
  display: grid;
  place-items: center;
  color: var(--wp-faint);
  font-size: 12px;
}

.missing .thumb {
  background: var(--wp-paper);
}

/* 按 4 倍大小渲染再缩小 */
.thumb iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 400%;
  height: 400%;
  border: 0;
  transform: scale(0.25);
  transform-origin: 0 0;
  pointer-events: none;
}

.cap {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  font-size: 13px;
}

.cap b {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.state {
  flex: none;
  font-size: 11px;
  padding: 0 6px;
  border-radius: 999px;
}

.state.warn {
  background: var(--wp-warn-soft);
  color: var(--wp-warn);
}

.state.grey {
  background: var(--wp-paper);
  color: var(--wp-muted);
}

.state.mono {
  font-family: var(--wp-font-mono);
  color: var(--wp-brand);
}

.present {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--wp-brand);
  color: var(--wp-surface);
  font-size: 11px;
}

.detail {
  width: 380px;
  flex: none;
  border-left: 1px solid var(--wp-line);
  min-height: 0;
}

.detail.full {
  flex: 1;
  width: auto;
  border-left: 0;
}

.present-mode {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  background: var(--wp-ink);
}

.present-head {
  height: 48px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  color: var(--wp-surface);
}

.present-head span {
  flex: 1;
  opacity: 0.7;
  font-size: 13px;
}

.exit {
  padding: 4px 12px;
  border: 1px solid var(--wp-faint);
  border-radius: 6px;
  background: transparent;
  color: var(--wp-surface);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.exit:hover {
  border-color: var(--wp-surface);
}

.present-mode iframe {
  flex: 1;
  border: 0;
}
</style>
