<template>
  <n-modal
    :show="show"
    @update:show="$emit('update:show', $event)"
    preset="card"
    title="提交统计"
    style="max-width: 660px"
    :bordered="false"
  >
    <div style="max-height: 75vh; overflow-y: auto">
      <!-- 初始加载 -->
      <template v-if="!stats && loading">
        <n-flex justify="center" style="padding: 40px">
          <n-spin size="large" />
        </n-flex>
      </template>

      <template v-else-if="stats">
        <!-- 班级筛选 -->
        <n-flex
          align="center"
          style="margin-bottom: 16px; flex-wrap: wrap; gap: 6px"
        >
          <span style="color: var(--wp-muted); font-size: 12px">班级筛选：</span>
          <n-button
            size="small"
            :type="selectedClass === null ? 'primary' : 'default'"
            @click="selectClass(null)"
            >全部</n-button
          >
          <n-button
            v-for="c in stats.classes"
            :key="c"
            size="small"
            :type="selectedClass === c ? 'primary' : 'default'"
            @click="selectClass(c)"
            >{{ c }}</n-button
          >
        </n-flex>

        <n-spin :show="loading">
          <!-- 关键指标 -->
          <div
            style="
              display: grid;
              grid-template-columns: repeat(5, 1fr);
              border: 1px solid var(--wp-line);
              border-radius: 6px;
              overflow: hidden;
              margin-bottom: 12px;
            "
          >
            <div
              v-for="(metric, i) in metrics"
              :key="metric.label"
              :style="{
                padding: '12px 8px',
                textAlign: 'center',
                borderRight: i < metrics.length - 1 ? '1px solid var(--wp-line)' : 'none',
              }"
            >
              <div
                :style="{
                  fontSize: '20px',
                  fontWeight: '700',
                  color: metric.color,
                }"
              >
                {{ metric.value }}
              </div>
              <div style="color: var(--wp-muted); font-size: 11px; margin-top: 2px">
                {{ metric.label }}
              </div>
            </div>
          </div>

          <!-- 未提交名单（可折叠） -->
          <div
            style="
              border: 1px solid var(--wp-line);
              border-radius: 6px;
              margin-bottom: 8px;
              overflow: hidden;
            "
          >
            <div
              style="
                padding: 10px 14px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                cursor: pointer;
                background: var(--wp-bad-soft);
              "
              @click="showUnsubmitted = !showUnsubmitted"
            >
              <n-flex align="center" :size="6">
                <span
                  style="
                    width: 7px;
                    height: 7px;
                    background: var(--wp-bad);
                    border-radius: 50%;
                    display: inline-block;
                  "
                ></span>
                <span style="font-weight: 600; color: var(--wp-bad); font-size: 12px"
                  >未提交（{{ stats.unsubmitted_count }}人）</span
                >
              </n-flex>
              <Icon
                :icon="
                  showUnsubmitted
                    ? 'lucide:chevron-down'
                    : 'lucide:chevron-right'
                "
                :width="14"
                style="color: var(--wp-faint)"
              />
            </div>
            <div
              v-if="showUnsubmitted"
              style="
                padding: 10px 14px;
                background: var(--wp-bad-soft);
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
              "
            >
              <n-tag
                v-for="u in stats.unsubmitted_users"
                :key="u.username"
                size="small"
                :bordered="true"
                style="border-color: var(--wp-bad-soft); background: var(--wp-surface)"
                >{{ displayName(u.username, u.classname) }}</n-tag
              >
              <span
                v-if="!stats.unsubmitted_users.length"
                style="color: var(--wp-faint); font-size: 12px"
                >暂无</span
              >
            </div>
          </div>

          <!-- 未打分名单（可折叠） -->
          <div
            style="
              border: 1px solid var(--wp-line);
              border-radius: 6px;
              margin-bottom: 12px;
              overflow: hidden;
            "
          >
            <div
              style="
                padding: 10px 14px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                cursor: pointer;
                background: var(--wp-warn-soft);
              "
              @click="showUnrated = !showUnrated"
            >
              <n-flex align="center" :size="6">
                <span
                  style="
                    width: 7px;
                    height: 7px;
                    background: var(--wp-warn);
                    border-radius: 50%;
                    display: inline-block;
                  "
                ></span>
                <span style="font-weight: 600; color: var(--wp-warn); font-size: 12px"
                  >未打分（{{ stats.unrated_count }}人）</span
                >
                <span style="font-size: 11px; color: var(--wp-faint)"
                  >— 还没给任何提交打过分</span
                >
              </n-flex>
              <Icon
                :icon="
                  showUnrated ? 'lucide:chevron-down' : 'lucide:chevron-right'
                "
                :width="14"
                style="color: var(--wp-faint)"
              />
            </div>
            <div
              v-if="showUnrated"
              style="
                padding: 10px 14px;
                background: var(--wp-warn-soft);
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
              "
            >
              <n-tag
                v-for="u in stats.unrated_users"
                :key="u.username"
                size="small"
                :bordered="true"
                style="border-color: var(--wp-warn-soft); background: var(--wp-surface)"
                >{{ displayName(u.username, u.classname) }}</n-tag
              >
              <span
                v-if="!stats.unrated_users.length"
                style="color: var(--wp-faint); font-size: 12px"
                >暂无</span
              >
            </div>
          </div>

          <!-- 提交次数分布 -->
          <div style="margin-bottom: 12px">
            <div
              style="
                font-weight: 600;
                font-size: 13px;
                margin-bottom: 8px;
                color: var(--wp-ink);
              "
            >
              提交次数分布
              <span style="font-size: 11px; color: var(--wp-faint); font-weight: 400"
                >（已提交的 {{ stats.submitted_count }} 人）</span
              >
            </div>
            <div style="display: flex; gap: 8px">
              <div
                v-for="bucket in countBuckets"
                :key="bucket.label"
                :style="{
                  flex: 1,
                  border: `1px solid ${bucket.borderColor}`,
                  borderRadius: '6px',
                  padding: '10px 8px',
                  textAlign: 'center',
                  background: bucket.bg,
                }"
              >
                <div
                  :style="{
                    fontSize: '20px',
                    fontWeight: '700',
                    color: bucket.color,
                  }"
                >
                  {{ bucket.value }}
                </div>
                <div style="color: var(--wp-faint); font-size: 11px; margin-top: 2px">
                  {{ bucket.label }}
                </div>
                <div
                  style="
                    margin-top: 8px;
                    background: var(--wp-line);
                    border-radius: 3px;
                    height: 4px;
                  "
                >
                  <div
                    :style="{
                      background: bucket.color,
                      height: '4px',
                      borderRadius: '3px',
                      width: bucketPct(bucket.value),
                    }"
                  ></div>
                </div>
                <div style="color: var(--wp-faint); font-size: 10px; margin-top: 3px">
                  {{ bucketPct(bucket.value) }}
                </div>
              </div>
            </div>
          </div>

          <!-- 人气前五 -->
          <div>
            <div
              style="
                font-weight: 600;
                font-size: 13px;
                margin-bottom: 8px;
                color: var(--wp-ink);
              "
            >
              人气前五
            </div>
            <div
              v-if="stats.top_viewed.length === 0"
              style="color: var(--wp-faint); font-size: 12px"
            >
              暂无
            </div>
            <div v-else style="display: flex; flex-direction: column; gap: 6px">
              <div
                v-for="(item, i) in stats.top_viewed"
                :key="item.submission_id"
                style="
                  display: flex;
                  align-items: center;
                  gap: 8px;
                  padding: 6px 10px;
                  border: 1px solid var(--wp-line);
                  border-radius: 6px;
                  cursor: pointer;
                  background: var(--wp-paper);
                "
                @click="viewSubmission(item.submission_id)"
              >
                <span
                  :style="{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background:
                      i < 3 ? ['var(--wp-warn)', 'var(--wp-muted)', 'var(--wp-warn)'][i] : 'var(--wp-line)',
                    color: 'var(--wp-surface)',
                    fontSize: '11px',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }"
                  >{{ i + 1 }}</span
                >
                <span style="flex: 1; font-size: 13px; color: var(--wp-ink)">
                  {{ displayName(item.username, item.classname) }}
                </span>
                <span style="font-size: 12px; color: var(--wp-css); font-weight: 600">
                  {{ item.view_count }} 次
                </span>
              </div>
            </div>
          </div>
        </n-spin>
      </template>
    </div>
  </n-modal>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from "vue"
import { Icon } from "../../icons"
import { useRouter } from "vue-router"
import { Submission } from "../../api"
import type { TaskStatsOut } from "../../utils/type"

const props = defineProps<{ taskId: number; show: boolean }>()
const emit = defineEmits<{ (e: "update:show", v: boolean): void }>()

const router = useRouter()
const stats = ref<TaskStatsOut | null>(null)
const loading = ref(false)
const selectedClass = ref<string | null>(null)
const showUnsubmitted = ref(false)
const showUnrated = ref(false)

async function load(classname?: string) {
  loading.value = true
  try {
    stats.value = await Submission.getStats(props.taskId, classname)
  } finally {
    loading.value = false
  }
}

function displayName(username: string, classname: string) {
  const prefix = "web" + classname
  return username.startsWith(prefix) ? username.slice(prefix.length) : username
}

function selectClass(c: string | null) {
  selectedClass.value = c
  load(c ?? undefined)
}

function viewSubmission(id: string) {
  const { href } = router.resolve({ name: "submission", params: { id } })
  window.open(href, "_blank")
}

function bucketPct(value: number) {
  const total = stats.value?.submitted_count ?? 0
  if (!total) return "0%"
  return Math.round((value / total) * 100) + "%"
}

const metrics = computed(() => {
  if (!stats.value) return []
  return [
    { label: "已提交", value: stats.value.submitted_count, color: "var(--wp-brand)" },
    { label: "未提交", value: stats.value.unsubmitted_count, color: "var(--wp-bad)" },
    {
      label: "平均分",
      value: stats.value.average_score?.toFixed(1) ?? "—",
      color: "var(--wp-css)",
    },
    { label: "未打分", value: stats.value.unrated_count, color: "var(--wp-bad)" },
  ]
})

const countBuckets = computed(() => {
  if (!stats.value) return []
  const d = stats.value.submission_count_distribution
  return [
    {
      label: "4 次+",
      value: d.count_4_plus,
      color: "var(--wp-warn)",
      bg: "var(--wp-warn-soft)",
      borderColor: "var(--wp-warn-soft)",
    },
    {
      label: "3 次",
      value: d.count_3,
      color: "var(--wp-brand)",
      bg: "var(--wp-brand-soft)",
      borderColor: "var(--wp-brand-soft)",
    },
    {
      label: "2 次",
      value: d.count_2,
      color: "var(--wp-css)",
      bg: "var(--wp-css-soft)",
      borderColor: "var(--wp-css-soft)",
    },
    {
      label: "仅 1 次",
      value: d.count_1,
      color: "var(--wp-muted)",
      bg: "var(--wp-paper)",
      borderColor: "var(--wp-line)",
    },
  ]
})

// Load when modal opens
watch(
  () => props.show,
  (val) => {
    if (val && props.taskId) {
      selectedClass.value = null
      load()
    }
  },
)
</script>
