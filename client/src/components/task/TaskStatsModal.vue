<template>
  <n-modal
    :show="show"
    @update:show="$emit('update:show', $event)"
    preset="card"
    style="width: 90vw; max-width: 760px"
    :bordered="false"
  >
    <template #header>
      <div class="head">
        <b>课堂总结</b>
        <span v-if="title" class="task-title">{{ title }}</span>
      </div>
    </template>
    <template #header-extra>
      <n-select
        :value="classname"
        :options="classOptions"
        size="small"
        @update:value="selectClass"
        style="width: 140px; margin-right: 12px"
      />
    </template>

    <n-flex v-if="!stats" justify="center" style="padding: 60px">
      <n-spin />
    </n-flex>

    <n-spin v-else :show="loading">
      <div class="body">
        <!-- 关键数字 -->
        <div class="kpis">
          <div class="kpi wide">
            <div class="kpi-label">已交</div>
            <div class="kpi-value">
              {{ stats.submitted_count }}<small> / {{ total }} 人</small>
              <span class="pct">{{ pct(stats.submitted_count, total) }}</span>
            </div>
            <div class="bar">
              <span :style="{ width: pct(stats.submitted_count, total) }"></span>
            </div>
          </div>
          <div class="kpi">
            <div class="kpi-label">平均分</div>
            <div class="kpi-value">{{ stats.average_score?.toFixed(1) ?? "—" }}</div>
            <div class="kpi-note">每人最新一版</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">改过再交</div>
            <div class="kpi-value">{{ pct(multiSubmit, stats.submitted_count) }}</div>
            <div class="kpi-note">交了 2 次及以上</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">待讲评</div>
            <div class="kpi-value">{{ stats.present_count }}<small> 份</small></div>
            <div class="kpi-note">已加入课上展示</div>
          </div>
        </div>

        <div class="grid">
          <!-- 未交 -->
          <section>
            <h4>
              <i class="dot bad"></i>未交
              <span class="count">{{ stats.unsubmitted_count }} 人</span>
            </h4>
            <div class="names">
              <template v-for="g in unsubmittedGroups" :key="g.classname">
                <div v-if="isAll" class="class-label">{{ g.classname || "未分班" }}</div>
                <div class="chips">
                  <span v-for="n in g.names" :key="n" class="chip">{{ n }}</span>
                </div>
              </template>
              <div v-if="!stats.unsubmitted_count" class="empty">都交了</div>
            </div>
          </section>

          <!-- 交了没人评 -->
          <section>
            <h4>
              <i class="dot warn"></i>交了但还没人评
              <span class="count">{{ stats.unrated_count }} 人</span>
            </h4>
            <div class="names">
              <template v-for="g in unratedGroups" :key="g.classname">
                <div v-if="isAll" class="class-label">{{ g.classname || "未分班" }}</div>
                <div class="chips">
                  <span v-for="n in g.names" :key="n" class="chip">{{ n }}</span>
                </div>
              </template>
              <div v-if="!stats.unrated_count" class="empty">
                {{ stats.submitted_count ? "每份作品都有人评过" : "还没有人交" }}
              </div>
            </div>
          </section>

          <!-- 交了几次 -->
          <section>
            <h4>交了几次</h4>
            <div v-if="stats.submitted_count" class="hist">
              <template v-for="b in buckets" :key="b.label">
                <span class="hist-label">{{ b.label }}</span>
                <span class="hist-bar">
                  <span :style="{ width: pct(b.value, maxBucket) }"></span>
                </span>
                <span class="hist-value">{{ b.value }}</span>
              </template>
            </div>
            <div v-else class="empty">还没有人交</div>
          </section>

          <!-- 高分作品 -->
          <section>
            <h4>高分作品<span class="count">每人最高的一版</span></h4>
            <div v-if="stats.top_scored.length" class="top">
              <button
                v-for="(item, i) in stats.top_scored"
                :key="item.submission_id"
                class="top-row"
                @click="openSubmission(item)"
              >
                <span class="rank">{{ i + 1 }}</span>
                <span class="top-name">
                  {{ shortName(item.username, item.classname) }}
                  <small v-if="isAll">{{ item.classname }}</small>
                </span>
                <span class="top-score">{{ item.score.toFixed(1) }}</span>
                <Icon icon="lucide:chevron-right" :width="14" class="go" />
              </button>
            </div>
            <div v-else class="empty">还没有打过分的作品</div>
          </section>

          <!-- 怎么问的 AI -->
          <section class="span">
            <h4>
              怎么问的 AI
              <span class="count">每人最新一版 · {{ stats.prompts.with_chain }} 份有提示词记录</span>
            </h4>
            <div v-if="stats.prompts.with_chain" class="prompt">
              <div class="facts">
                <div><b>{{ stats.prompts.avg_rounds }}</b>平均几轮</div>
                <div><b>{{ pct(stats.prompts.one_round, stats.prompts.with_chain) }}</b>一轮就交</div>
                <div><b>{{ pct(stats.prompts.external, stats.prompts.with_chain) }}</b>最后一版用外部 AI</div>
                <div><b>{{ pct(stats.prompts.used_guidance, stats.prompts.with_chain) }}</b>问过怎么写提示词</div>
              </div>
              <div class="hist">
                <template v-for="(n, i) in stats.prompts.levels" :key="i">
                  <span class="hist-label">{{ levelLabel(i + 1) }}</span>
                  <span class="hist-bar">
                    <span :style="{ width: pct(n, maxLevel) }"></span>
                  </span>
                  <span class="hist-value">{{ n }}</span>
                </template>
              </div>
            </div>
            <div v-else class="empty">
              {{ stats.submitted_count ? "都是直接交的代码，没有提示词记录" : "还没有人交" }}
            </div>
          </section>
        </div>
      </div>
    </n-spin>

    <template v-if="!inReview" #footer>
      <n-flex justify="end">
        <n-button type="primary" icon-placement="right" @click="openReview">
          去批改{{ isAll ? "" : " " + classname + " 班" }}
          <template #icon><Icon icon="lucide:arrow-right" /></template>
        </n-button>
      </n-flex>
    </template>
  </n-modal>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from "vue"
import { useRouter } from "vue-router"
import { Icon } from "../../icons"
import { Submission } from "../../api"
import { levelLabel } from "../../utils/helper"
import type { TaskStatsOut, TopScoredItem, UserTag } from "../../utils/type"

// 老师下课前看的这道题的总结：默认看批改页正在看的班
const props = defineProps<{
  taskId: number
  show: boolean
  title?: string
  // 在批改页里打开：不显示“去批改”，点高分作品直接在批改页里打开
  inReview?: boolean
  // 批改页正在看的班级（“__all__” 是全部班级）；不传就用记住的
  initialClass?: string | null
}>()
const emit = defineEmits<{
  "update:show": [v: boolean]
  open: [submissionId: string, classname: string]
}>()

// 和批改页共用“当前班级”
const ALL = "__all__"
const CLASS_KEY = "review-class"

const router = useRouter()
const stats = ref<TaskStatsOut | null>(null)
const loading = ref(false)
const classname = ref<string>(ALL)
const isAll = computed(() => classname.value === ALL)

const classOptions = computed(() => [
  { label: "全部班级", value: ALL },
  ...(stats.value?.classes ?? []).map((c) => ({ label: `${c} 班`, value: c })),
])

const total = computed(
  () => (stats.value?.submitted_count ?? 0) + (stats.value?.unsubmitted_count ?? 0),
)
const multiSubmit = computed(() => {
  const d = stats.value?.submission_count_distribution
  return d ? d.count_2 + d.count_3 + d.count_4_plus : 0
})
const buckets = computed(() => {
  const d = stats.value?.submission_count_distribution
  if (!d) return []
  return [
    { label: "1 次", value: d.count_1 },
    { label: "2 次", value: d.count_2 },
    { label: "3 次", value: d.count_3 },
    { label: "4 次+", value: d.count_4_plus },
  ]
})
const maxBucket = computed(() => Math.max(...buckets.value.map((b) => b.value)))
const maxLevel = computed(() => Math.max(0, ...(stats.value?.prompts.levels ?? [])))

const unsubmittedGroups = computed(() => byClass(stats.value?.unsubmitted_users ?? []))
const unratedGroups = computed(() => byClass(stats.value?.unrated_users ?? []))

function byClass(users: UserTag[]) {
  const groups = new Map<string, string[]>()
  for (const u of users) {
    const names = groups.get(u.classname) ?? []
    names.push(shortName(u.username, u.classname))
    groups.set(u.classname, names)
  }
  // 没分班的（测试账号等）放最后
  return [...groups]
    .sort(([a], [b]) => Number(a === "") - Number(b === "") || (a < b ? -1 : 1))
    .map(([classname, names]) => ({ classname, names }))
}

// 账号是“web + 班级 + 名字”，班级已经单独显示了
function shortName(username: string, classname: string) {
  const prefix = "web" + classname
  return username.startsWith(prefix) ? username.slice(prefix.length) : username
}

function pct(value: number, of: number) {
  return of ? Math.round((value / of) * 100) + "%" : "0%"
}

async function load() {
  loading.value = true
  try {
    stats.value = await Submission.getStats(props.taskId, isAll.value ? undefined : classname.value)
  } finally {
    loading.value = false
  }
}

function selectClass(c: string) {
  classname.value = c
  try {
    localStorage.setItem(CLASS_KEY, c)
  } catch {}
  load()
}

watch(
  () => props.show,
  async (open) => {
    if (!open || !props.taskId) return
    let saved: string | null = props.initialClass ?? null
    try {
      saved ||= localStorage.getItem(CLASS_KEY)
    } catch {}
    classname.value = saved || ALL
    await load()
    // 记住的班级已经没有学生了
    if (!isAll.value && !stats.value?.classes.includes(classname.value)) {
      classname.value = ALL
      await load()
    }
  },
)

function openInNewTab(query: Record<string, string>) {
  const { href } = router.resolve({ name: "review", query })
  window.open(href, "_blank")
}

function openSubmission(item: TopScoredItem) {
  if (props.inReview) {
    emit("open", item.submission_id, item.classname)
    return
  }
  openInNewTab({
    class: isAll.value ? item.classname : classname.value,
    task: String(props.taskId),
    sub: item.submission_id,
  })
}

function openReview() {
  openInNewTab({ class: classname.value, task: String(props.taskId) })
}
</script>

<style scoped>
.head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.task-title {
  font-size: 13px;
  font-weight: 400;
  color: var(--wp-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.body {
  max-height: 64vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.kpis {
  display: grid;
  grid-template-columns: 1.6fr 1fr 1fr 1fr;
  border: 1px solid var(--wp-line);
  border-radius: 8px;
  overflow: hidden;
}

.kpi {
  padding: 12px 14px;
  min-width: 0;
}

.kpi + .kpi {
  border-left: 1px solid var(--wp-line);
}

.kpi.wide {
  background: var(--wp-brand-soft);
}

.kpi-label {
  font-size: 12px;
  color: var(--wp-muted);
}

.kpi-value {
  margin-top: 2px;
  font: 600 22px/1.2 var(--wp-font-mono);
  color: var(--wp-ink);
}

.kpi-value small {
  font: 400 13px var(--wp-font-sans);
  color: var(--wp-muted);
}

.kpi.wide .kpi-value {
  color: var(--wp-brand);
}

.pct {
  float: right;
  font-size: 14px;
  font-weight: 400;
  color: var(--wp-muted);
  line-height: 26px;
}

.kpi-note {
  margin-top: 4px;
  font-size: 11px;
  color: var(--wp-faint);
}

.bar {
  margin-top: 8px;
  height: 6px;
  border-radius: 3px;
  background: var(--wp-surface);
  overflow: hidden;
}

.bar span {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--wp-brand);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px 20px;
}

section {
  min-width: 0;
}

h4 {
  margin: 0 0 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--wp-ink);
}

.count {
  margin-left: auto;
  font-size: 12px;
  font-weight: 400;
  color: var(--wp-muted);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.dot.bad {
  background: var(--wp-bad);
}

.dot.warn {
  background: var(--wp-warn);
}

.names {
  max-height: 150px;
  overflow-y: auto;
}

.class-label {
  margin: 6px 0 4px;
  font-size: 11px;
  color: var(--wp-faint);
}

.class-label:first-child {
  margin-top: 0;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chip {
  padding: 1px 8px;
  border: 1px solid var(--wp-line);
  border-radius: 4px;
  font-size: 12px;
  line-height: 20px;
  color: var(--wp-ink);
  background: var(--wp-paper);
}

.empty {
  font-size: 12px;
  color: var(--wp-faint);
}

.hist {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 6px 10px;
}

.hist-label {
  font-size: 12px;
  color: var(--wp-muted);
}

.hist-bar {
  height: 10px;
  border-radius: 2px;
  background: var(--wp-paper);
  overflow: hidden;
}

.hist-bar span {
  display: block;
  height: 100%;
  background: var(--wp-brand);
}

.hist-value {
  min-width: 2ch;
  text-align: right;
  font: 12px var(--wp-font-mono);
  color: var(--wp-ink);
}

.top {
  display: flex;
  flex-direction: column;
}

.top-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--wp-ink);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.top-row:hover {
  background: var(--wp-paper);
}

.rank {
  width: 16px;
  font: 12px var(--wp-font-mono);
  color: var(--wp-faint);
  text-align: center;
}

.top-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.top-name small {
  margin-left: 4px;
  color: var(--wp-faint);
}

.top-score {
  font: 600 13px var(--wp-font-mono);
  color: var(--wp-brand);
}

.go {
  color: var(--wp-faint);
}

.span {
  grid-column: 1 / -1;
}

.prompt {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
  align-content: start;
  font-size: 12px;
  color: var(--wp-muted);
}

.facts b {
  display: block;
  font: 600 18px/1.3 var(--wp-font-mono);
  color: var(--wp-ink);
}
</style>
