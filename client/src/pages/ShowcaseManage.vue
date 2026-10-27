<template>
  <div class="manage">
    <aside class="awards">
      <div class="awards-head">
        <b>奖项</b>
        <n-button size="small" quaternary @click="startCreate">
          <template #icon><Icon icon="lucide:plus" /></template>
          新建
        </n-button>
      </div>
      <n-spin :show="awardsLoading" class="award-list">
        <div
          v-for="(award, i) in awards"
          :key="award.id"
          :class="['award', { on: award.id === currentAwardId && !creating }]"
          @click="selectAward(award)"
        >
          <span class="award-name">{{ award.name }}</span>
          <span v-if="!award.is_active" class="off">停用</span>
          <span class="count">{{ award.item_count }}</span>
          <span v-if="award.id === currentAwardId && !creating" class="move" @click.stop>
            <button :disabled="i === 0" title="往前排" @click="moveAward(i, -1)">
              <Icon icon="lucide:chevron-up" :width="14" />
            </button>
            <button :disabled="i === awards.length - 1" title="往后排" @click="moveAward(i, 1)">
              <Icon icon="lucide:chevron-down" :width="14" />
            </button>
          </span>
        </div>
        <n-empty
          v-if="!awardsLoading && !awards.length"
          description="还没有奖项"
          size="small"
          style="margin-top: 40px"
        />
      </n-spin>
      <p class="note">排在前面的奖项在作品展里也排在前面。</p>
    </aside>

    <main class="main">
      <div class="form">
        <div class="row">
          <n-input
            v-model:value="draft.name"
            class="name"
            placeholder="奖项名称，例如“最佳创意”"
          />
          <label class="active">
            <n-switch v-model:value="draft.is_active" />
            {{ draft.is_active ? "展出中" : "已停用" }}
          </label>
          <n-button
            type="primary"
            :disabled="!canSave"
            :loading="saving"
            @click="saveAward"
          >
            {{ creating ? "创建" : "保存" }}
          </n-button>
          <n-popconfirm v-if="!creating && currentAwardId" @positive-click="deleteAward">
            <template #trigger>
              <n-button quaternary type="error" :loading="deleting">删除奖项</n-button>
            </template>
            删除后，这个奖项下的 {{ currentAward?.item_count ?? 0 }} 件作品也会从作品展里撤下（作品本身不受影响）。
          </n-popconfirm>
        </div>
        <div class="row">
          <n-input v-model:value="draft.description" placeholder="一句话介绍（可以不填）" />
          <span class="label">作品顺序</span>
          <n-select v-model:value="draft.item_ordering" :options="orderingOptions" style="width: 140px" />
        </div>
      </div>

      <template v-if="!creating && currentAwardId">
        <div class="items-head">
          <b>作品 <span class="muted">{{ items.length }} 件</span></b>
          <span class="muted">
            在“批改”里打开学生的作品，点“加入作品展”就能加到这里
            <template v-if="currentAward?.item_ordering === 'manual'">；用 ← → 调整顺序</template>
            <template v-else>；现在按{{ orderingLabel(currentAward?.item_ordering) }}自动排序</template>
          </span>
          <span class="spacer"></span>
          <n-button size="small" quaternary @click="router.push({ name: 'review' })">
            去批改
            <template #icon><Icon icon="lucide:arrow-right" /></template>
          </n-button>
        </div>

        <n-spin :show="itemsLoading">
          <div v-if="items.length" class="grid">
            <div v-for="(item, i) in items" :key="item.id" class="card">
              <button class="thumb" title="打开看看" @click="reviewId = item.submission_id">
                <iframe
                  :srcdoc="docOf(item)"
                  :sandbox="PREVIEW_SANDBOX"
                  loading="lazy"
                  scrolling="no"
                  tabindex="-1"
                ></iframe>
                <span v-if="item.is_stale" class="stale">有新提交</span>
              </button>
              <div class="cap">
                <div class="who">
                  <b>{{ item.username }}</b>
                  <span class="score">{{ item.score ? item.score.toFixed(1) : "未评" }}</span>
                </div>
                <div class="task">{{ item.task_display }}. {{ item.task_title }}</div>
              </div>
              <div class="tools">
                <template v-if="currentAward?.item_ordering === 'manual'">
                  <n-button size="tiny" quaternary :disabled="i === 0" @click="moveItem(i, -1)">
                    <template #icon><Icon icon="lucide:arrow-left" /></template>
                  </n-button>
                  <n-button
                    size="tiny"
                    quaternary
                    :disabled="i === items.length - 1"
                    @click="moveItem(i, 1)"
                  >
                    <template #icon><Icon icon="lucide:arrow-right" /></template>
                  </n-button>
                </template>
                <n-tooltip v-if="item.is_stale">
                  <template #trigger>
                    <n-button size="tiny" quaternary type="warning" @click="refreshItem(item)">
                      换成最新的
                    </n-button>
                  </template>
                  这个学生后来又交了新的一版，换成最新交的那一版来展出
                </n-tooltip>
                <span class="spacer"></span>
                <n-popconfirm @positive-click="removeItem(item)">
                  <template #trigger>
                    <n-button size="tiny" quaternary type="error">撤下</n-button>
                  </template>
                  从这个奖项里撤下这件作品？
                </n-popconfirm>
              </div>
            </div>
          </div>
          <n-empty
            v-else-if="!itemsLoading"
            description="这个奖项还没有作品"
            style="margin-top: 60px"
          />
        </n-spin>
      </template>
      <n-empty v-else-if="creating" description="先填好名称，创建后再往里加作品" style="margin-top: 60px" />
    </main>
  </div>

  <n-drawer
    :show="!!reviewId"
    width="min(1180px, 92vw)"
    placement="right"
    @update:show="(v: boolean) => !v && (reviewId = null)"
  >
    <ReviewPanel v-if="reviewId" :submission-id="reviewId" wide @close="reviewId = null" />
  </n-drawer>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue"
import { useRouter } from "vue-router"
import { useMessage } from "naive-ui"
import { Icon } from "../icons"
import { Showcase } from "../api"
import ReviewPanel from "../components/review/ReviewPanel.vue"
import { buildPreviewDocument, PREVIEW_SANDBOX } from "../utils/previewDocument"
import type { AwardItemManageOut, AwardManageIn, AwardManageOut, ItemOrdering } from "../utils/type"

const router = useRouter()
const message = useMessage()

const awards = ref<AwardManageOut[]>([])
const items = ref<AwardItemManageOut[]>([])
const currentAwardId = ref<number | null>(null)
const creating = ref(false)
const awardsLoading = ref(false)
const itemsLoading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const reviewId = ref<string | null>(null)

const draft = reactive<AwardManageIn>(emptyAward())

const orderingOptions: { label: string; value: ItemOrdering }[] = [
  { label: "手动排序", value: "manual" },
  { label: "最新加入的在前", value: "awarded_at" },
  { label: "得分高的在前", value: "score" },
  { label: "看的人多的在前", value: "view_count" },
]
const orderingLabel = (v?: ItemOrdering) =>
  ({ awarded_at: "加入时间", score: "得分", view_count: "浏览次数", manual: "手动" })[v ?? "manual"]

const currentAward = computed(() => awards.value.find((a) => a.id === currentAwardId.value) ?? null)

// 有改动、名称不空才能保存
const canSave = computed(() => {
  if (!draft.name.trim()) return false
  const a = currentAward.value
  if (creating.value || !a) return true
  return (
    draft.name.trim() !== a.name ||
    draft.description.trim() !== a.description ||
    draft.is_active !== a.is_active ||
    draft.item_ordering !== a.item_ordering
  )
})

function emptyAward(): AwardManageIn {
  return { name: "", description: "", sort_order: 0, is_active: true, item_ordering: "manual" }
}

function fill(a: AwardManageIn) {
  Object.assign(draft, {
    name: a.name,
    description: a.description,
    sort_order: a.sort_order,
    is_active: a.is_active,
    item_ordering: a.item_ordering,
  })
}

function docOf(item: AwardItemManageOut) {
  return buildPreviewDocument({
    html: item.html ?? "",
    css: item.css ?? "",
    js: item.js ?? "",
    assetBaseUrl: `/media/tasks/${item.task_type}/${item.task_display}/`,
  })
}

const errText = (err: any, fallback: string) => err.response?.data?.detail ?? fallback

async function loadAwards() {
  awardsLoading.value = true
  try {
    awards.value = await Showcase.listManageAwards()
  } finally {
    awardsLoading.value = false
  }
}

async function loadItems() {
  if (!currentAwardId.value) return
  itemsLoading.value = true
  try {
    items.value = await Showcase.listAwardItems(currentAwardId.value)
  } finally {
    itemsLoading.value = false
  }
}

function selectAward(a: AwardManageOut) {
  if (a.id === currentAwardId.value && !creating.value) return
  currentAwardId.value = a.id
  creating.value = false
  fill(a)
  items.value = []
  loadItems()
}

function startCreate() {
  creating.value = true
  currentAwardId.value = null
  items.value = []
  // 新建的奖项排在最后
  fill({ ...emptyAward(), sort_order: Math.max(-1, ...awards.value.map((a) => a.sort_order)) + 1 })
}

async function saveAward() {
  if (!canSave.value) return
  const payload = { ...draft, name: draft.name.trim(), description: draft.description.trim() }
  const isNew = creating.value || !currentAwardId.value
  saving.value = true
  try {
    const saved = isNew
      ? await Showcase.createAward(payload)
      : await Showcase.updateAward(currentAwardId.value!, payload)
    await loadAwards()
    const next = awards.value.find((a) => a.id === saved.id)
    if (next) {
      creating.value = false
      currentAwardId.value = next.id
      fill(next)
      loadItems()
    }
    message.success(isNew ? "已创建" : "已保存")
  } catch (err) {
    message.error(errText(err, "保存失败"))
  } finally {
    saving.value = false
  }
}

async function deleteAward() {
  if (!currentAwardId.value) return
  deleting.value = true
  try {
    await Showcase.deleteAward(currentAwardId.value)
    await loadAwards()
    message.success("已删除")
    if (awards.value[0]) {
      currentAwardId.value = null
      selectAward(awards.value[0])
    } else startCreate()
  } catch (err) {
    message.error(errText(err, "删除失败"))
  } finally {
    deleting.value = false
  }
}

// 调整奖项顺序：按新的先后重新编号，只改编号变了的
async function moveAward(i: number, d: number) {
  const list = [...awards.value]
  const [a] = list.splice(i, 1)
  list.splice(i + d, 0, a!)
  try {
    await Promise.all(
      list.map((x, idx) =>
        x.sort_order === idx
          ? null
          : Showcase.updateAward(x.id, {
              name: x.name,
              description: x.description,
              sort_order: idx,
              is_active: x.is_active,
              item_ordering: x.item_ordering,
            }),
      ),
    )
  } catch (err) {
    message.error(errText(err, "调整顺序失败"))
  }
  await loadAwards()
  // 表单里的编号也要跟着变，不然接着保存会把顺序改回去
  if (currentAward.value) draft.sort_order = currentAward.value.sort_order
}

async function moveItem(i: number, d: number) {
  const list = [...items.value]
  const [x] = list.splice(i, 1)
  list.splice(i + d, 0, x!)
  items.value = list
  try {
    await Promise.all(
      list.map((it, idx) => {
        if (it.sort_order === idx) return null
        it.sort_order = idx
        return Showcase.updateAwardItem(it.id, { sort_order: idx })
      }),
    )
  } catch (err) {
    message.error(errText(err, "调整顺序失败"))
    loadItems()
  }
}

async function refreshItem(item: AwardItemManageOut) {
  try {
    const updated = await Showcase.refreshAwardItem(item.id)
    items.value = items.value.map((it) => (it.id === item.id ? updated : it))
    message.success("已换成最新交的一版")
  } catch (err) {
    message.error(errText(err, "替换失败"))
  }
}

async function removeItem(item: AwardItemManageOut) {
  try {
    await Showcase.deleteAwardItem(item.id)
    items.value = items.value.filter((it) => it.id !== item.id)
    loadAwards()
    message.success("已撤下")
  } catch (err) {
    message.error(errText(err, "撤下失败"))
  }
}

onMounted(async () => {
  await loadAwards()
  if (awards.value[0]) selectAward(awards.value[0])
  else startCreate()
})
</script>

<style scoped>
.manage {
  height: 100%;
  display: flex;
  min-width: 0;
}

.awards {
  width: 230px;
  flex: none;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--wp-line);
  background: var(--wp-surface);
  min-height: 0;
}

.awards-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 8px 6px 14px;
}

.award-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px;
}

.award {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.award:hover {
  background: var(--wp-paper);
}

.award.on {
  background: var(--wp-brand-soft);
  color: var(--wp-brand);
}

.award-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.off {
  font-size: 11px;
  color: var(--wp-faint);
}

.count {
  font: 12px var(--wp-font-mono);
  color: var(--wp-muted);
}

.move {
  display: inline-flex;
}

.move button {
  display: inline-flex;
  padding: 2px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.move button:hover:not(:disabled) {
  background: var(--wp-surface);
}

.move button:disabled {
  opacity: 0.3;
  cursor: default;
}

.note {
  margin: 0;
  padding: 10px 14px;
  font-size: 12px;
  color: var(--wp-faint);
}

.main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 14px 16px 24px;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 860px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--wp-line);
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.name :deep(input) {
  font-size: 16px;
  font-weight: 600;
}

.active {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--wp-muted);
  cursor: pointer;
}

.label {
  flex: none;
  font-size: 13px;
  color: var(--wp-muted);
}

.items-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 14px 0 12px;
}

.muted {
  font-size: 12px;
  font-weight: 400;
  color: var(--wp-muted);
}

.spacer {
  flex: 1;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}

.card {
  border: 1px solid var(--wp-line);
  border-radius: 10px;
  overflow: hidden;
  background: var(--wp-surface);
}

.thumb {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 16 / 10;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--wp-line);
  overflow: hidden;
  cursor: pointer;
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

.stale {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--wp-warn);
  background: var(--wp-warn-soft);
}

.cap {
  padding: 8px 10px 4px;
}

.who {
  display: flex;
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
  font: 12px var(--wp-font-mono);
  color: var(--wp-muted);
}

.task {
  margin-top: 2px;
  font-size: 12px;
  color: var(--wp-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tools {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px 6px;
}
</style>
