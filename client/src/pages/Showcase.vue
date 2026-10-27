<template>
  <main class="showcase">
    <header class="page-head">
      <div>
        <h2>作品展</h2>
        <p class="muted">老师从大家交的作品里挑出来的，点开能看大图和它是怎么问出来的</p>
      </div>
      <nav v-if="awards.length > 1" class="jump">
        <a v-for="a in awards" :key="a.id" :href="`#award-${a.id}`" @click.prevent="jump(a.id)">
          {{ a.name }}
        </a>
      </nav>
    </header>

    <n-spin :show="loading">
      <n-empty
        v-if="!loading && !awards.length"
        description="还没有展出的作品"
        style="margin-top: 72px"
      />

      <section v-for="(section, si) in awards" :id="`award-${section.id}`" :key="section.id">
        <div class="section-head">
          <h3>{{ section.name }}</h3>
          <span class="muted">{{ section.items.length }} 件</span>
        </div>
        <p v-if="section.description" class="desc">{{ section.description }}</p>

        <div class="grid">
          <button
            v-for="(item, ii) in section.items"
            :key="item.submission_id"
            class="card"
            @click="open(si, ii)"
          >
            <div class="thumb">
              <iframe
                :srcdoc="docOf(item)"
                :sandbox="PREVIEW_SANDBOX"
                loading="lazy"
                scrolling="no"
                tabindex="-1"
              ></iframe>
            </div>
            <div class="cap">
              <div class="who">
                <b>{{ item.username }}</b>
                <span v-if="item.score" class="score">
                  <Icon icon="lucide:star" :width="12" />{{ item.score.toFixed(1) }}
                </span>
              </div>
              <div class="task">{{ item.task_display }}. {{ item.task_title }}</div>
            </div>
          </button>
        </div>
      </section>
    </n-spin>
  </main>

  <n-modal
    :show="!!current"
    preset="card"
    style="width: 94vw; max-width: 1280px"
    :bordered="false"
    @update:show="(v: boolean) => !v && (viewing = null)"
  >
    <template #header>
      <div class="viewer-head">
        <b>{{ current?.username }}</b>
        <span class="muted">{{ current?.task_display }}. {{ current?.task_title }}</span>
      </div>
    </template>
    <template #header-extra>
      <n-flex v-if="viewing" align="center" :size="4" style="margin-right: 8px">
        <span class="muted">
          {{ viewing.item + 1 }} / {{ awards[viewing.section]?.items.length }}
        </span>
        <n-button size="small" quaternary :disabled="viewing.item === 0" @click="step(-1)">
          <template #icon><Icon icon="lucide:arrow-left" /></template>
        </n-button>
        <n-button
          size="small"
          quaternary
          :disabled="viewing.item >= (awards[viewing.section]?.items.length ?? 0) - 1"
          @click="step(1)"
        >
          <template #icon><Icon icon="lucide:arrow-right" /></template>
        </n-button>
      </n-flex>
    </template>

    <div v-if="current" class="viewer">
      <div class="big">
        <iframe :key="current.submission_id" :srcdoc="docOf(current)" :sandbox="PREVIEW_SANDBOX"></iframe>
      </div>
      <aside class="info">
        <div class="field">
          <div class="label">获奖</div>
          <div class="awards">
            <span v-for="name in awardsOf(current.submission_id)" :key="name" class="award">
              <Icon icon="lucide:award" :width="13" />{{ name }}
            </span>
          </div>
        </div>
        <div class="field">
          <div class="label">得分</div>
          <div v-if="current.score" class="mono">{{ current.score.toFixed(2) }}</div>
          <div v-else class="muted">还没有评分</div>
        </div>
        <div class="field">
          <div class="label">看过的次数</div>
          <div class="mono">{{ current.view_count }}</div>
        </div>
        <n-flex vertical :size="8" class="actions">
          <n-button v-if="current.has_prompt_chain" secondary @click="showChain = true">
            <template #icon><Icon icon="lucide:sparkles" /></template>
            看看是怎么问出来的
          </n-button>
          <n-button quaternary @click="openFull">
            <template #icon><Icon icon="lucide:maximize-2" /></template>
            全屏打开
          </n-button>
        </n-flex>
        <div class="muted hint">← → 切换，Esc 关闭</div>
      </aside>
    </div>
  </n-modal>

  <ChainModal
    v-if="current"
    v-model:show="showChain"
    :submission-id="current.submission_id"
    :title="`${current.username} · ${current.task_title}`"
    :asset-base-url="assetBase(current)"
    from-showcase
  />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import { useRouter } from "vue-router"
import { Icon } from "../icons"
import { Showcase, Submission } from "../api"
import ChainModal from "../components/submissions/ChainModal.vue"
import { buildPreviewDocument, PREVIEW_SANDBOX } from "../utils/previewDocument"
import type { AwardSection, ShowcaseItem } from "../utils/type"

const router = useRouter()
const loading = ref(true)
const awards = ref<AwardSection[]>([])
// 正在看第几个奖项的第几件
const viewing = ref<{ section: number; item: number } | null>(null)
const showChain = ref(false)

const current = computed(() =>
  viewing.value ? (awards.value[viewing.value.section]?.items[viewing.value.item] ?? null) : null,
)

const assetBase = (item: ShowcaseItem) => `/media/tasks/${item.task_type}/${item.task_display}/`

function docOf(item: ShowcaseItem) {
  return buildPreviewDocument({
    html: item.html ?? "",
    css: item.css ?? "",
    js: item.js ?? "",
    assetBaseUrl: assetBase(item),
  })
}

// 一件作品可能同时在几个奖项里
function awardsOf(submissionId: string) {
  return awards.value
    .filter((a) => a.items.some((i) => i.submission_id === submissionId))
    .map((a) => a.name)
}

function jump(id: number) {
  document.getElementById(`award-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
}

function open(section: number, item: number) {
  viewing.value = { section, item }
}

function step(d: number) {
  const v = viewing.value
  if (!v) return
  const n = awards.value[v.section]?.items.length ?? 0
  const item = v.item + d
  if (item >= 0 && item < n) viewing.value = { section: v.section, item }
}

// 每打开一件记一次浏览
const counted = new Set<string>()
watch(current, (item) => {
  if (!item || counted.has(item.submission_id)) return
  counted.add(item.submission_id)
  Submission.incrementView(item.submission_id)
    .then(() => item.view_count++)
    .catch(() => {})
})

function openFull() {
  if (!current.value) return
  const { href } = router.resolve({ name: "submission", params: { id: current.value.submission_id } })
  window.open(href, "_blank")
}

function onKey(e: KeyboardEvent) {
  if (!viewing.value || showChain.value) return
  if (e.key === "ArrowLeft") step(-1)
  else if (e.key === "ArrowRight") step(1)
}

onMounted(async () => {
  window.addEventListener("keydown", onKey)
  try {
    awards.value = await Showcase.list()
  } finally {
    loading.value = false
  }
})
onUnmounted(() => window.removeEventListener("keydown", onKey))
</script>

<style scoped>
.showcase {
  max-width: 1180px;
  margin: 0 auto;
  padding: 28px 20px 48px;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px 24px;
  margin-bottom: 24px;
}

h2 {
  margin: 0 0 4px;
  font-size: 22px;
}

.muted {
  font-size: 12px;
  font-weight: 400;
  color: var(--wp-muted);
}

.page-head .muted {
  margin: 0;
  font-size: 13px;
}

.jump {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.jump a {
  padding: 3px 10px;
  border: 1px solid var(--wp-line);
  border-radius: 999px;
  font-size: 13px;
  color: var(--wp-ink);
  text-decoration: none;
  background: var(--wp-surface);
}

.jump a:hover {
  border-color: var(--wp-brand);
  color: var(--wp-brand);
}

section {
  margin-bottom: 40px;
  scroll-margin-top: 16px;
}

.section-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

h3 {
  margin: 0;
  font-size: 17px;
}

.desc {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--wp-muted);
}

.grid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.card {
  padding: 0;
  border: 1px solid var(--wp-line);
  border-radius: 10px;
  overflow: hidden;
  background: var(--wp-surface);
  color: var(--wp-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s,
    transform 0.15s;
}

.card:hover {
  border-color: var(--wp-brand);
  transform: translateY(-2px);
}

.thumb {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-bottom: 1px solid var(--wp-line);
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

.cap {
  padding: 10px 12px 12px;
}

.who {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}

.who b {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.score {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font: 12px var(--wp-font-mono);
  color: var(--wp-warn);
}

.task {
  margin-top: 4px;
  font-size: 12px;
  color: var(--wp-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.viewer-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.viewer {
  display: grid;
  grid-template-columns: 1fr 230px;
  gap: 16px;
  height: 72vh;
}

.big {
  display: flex;
  border: 1px solid var(--wp-line);
  border-radius: 8px;
  overflow: hidden;
}

.big iframe {
  flex: 1;
  border: 0;
}

.info {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.label {
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--wp-muted);
}

.awards {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.award {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--wp-warn);
  background: var(--wp-warn-soft);
}

.mono {
  font: 15px var(--wp-font-mono);
}

.actions {
  margin-top: 4px;
}

.actions :deep(.n-button) {
  justify-content: flex-start;
}

.hint {
  margin-top: auto;
}
</style>
