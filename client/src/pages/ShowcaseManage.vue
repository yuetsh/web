<template>
  <n-layout has-sider style="height: 100%;">
    <n-layout-sider
      :width="260"
      bordered
      content-style="overflow: auto; height: 100%;"
      style="background: #fafafa;"
    >
      <n-flex class="panel-header" justify="space-between" align="center">
        <n-text strong>奖项</n-text>
        <n-button size="small" secondary title="新建奖项" @click="startCreate">
          <template #icon>
            <Icon icon="lucide:plus" :width="15" />
          </template>
        </n-button>
      </n-flex>

      <n-spin :show="awardsLoading">
        <n-empty
          v-if="!awardsLoading && awards.length === 0"
          description="暂无奖项"
          size="small"
          style="margin-top: 40px;"
        />
        <button
          v-for="award in awards"
          :key="award.id"
          type="button"
          :class="[
            'award-row',
            { active: currentAwardId === award.id && !creating },
          ]"
          @click="selectAward(award)"
        >
          <n-ellipsis style="flex: 1; min-width: 0; font-size: 14px; font-weight: 500;">
            {{ award.name }}
          </n-ellipsis>
          <n-flex align="center" :size="6" style="flex-shrink: 0; color: #777; font-size: 12px;">
            <n-tag v-if="!award.is_active" size="small">停用</n-tag>
            <span>{{ award.item_count }} 件</span>
          </n-flex>
        </button>
      </n-spin>
    </n-layout-sider>

    <n-layout content-style="padding: 12px; overflow: auto; height: 100%; box-sizing: border-box;">
      <n-form
        :model="awardDraft"
        label-placement="left"
        label-width="82"
        style="max-width: 1100px;"
      >
        <n-grid :cols="4" :x-gap="12" :y-gap="8" responsive="screen">
          <n-form-item-gi :span="2" label="名称">
            <n-input v-model:value="awardDraft.name" placeholder="奖项名称" />
          </n-form-item-gi>
          <n-form-item-gi label="排序">
            <n-input-number
              v-model:value="awardDraft.sort_order"
              :show-button="false"
              style="width: 120px;"
            />
          </n-form-item-gi>
          <n-form-item-gi label="启用">
            <n-switch v-model:value="awardDraft.is_active" />
          </n-form-item-gi>
          <n-form-item-gi :span="2" label="简介">
            <n-input
              v-model:value="awardDraft.description"
              placeholder="可留空"
            />
          </n-form-item-gi>
          <n-form-item-gi label="作品排序">
            <n-select
              v-model:value="awardDraft.item_ordering"
              :options="orderingOptions"
            />
          </n-form-item-gi>
          <n-form-item-gi>
            <n-flex justify="end" style="width: 100%;">
              <n-button
                type="primary"
                :disabled="!canSaveAward"
                :loading="savingAward"
                @click="saveAward"
              >
                <template #icon>
                  <Icon icon="lucide:save" :width="15" />
                </template>
                保存
              </n-button>
              <n-button
                v-if="currentAwardId && !creating"
                tertiary
                type="error"
                :loading="deletingAward"
                @click="deleteCurrentAward"
              >
                <template #icon>
                  <Icon icon="lucide:trash-2" :width="15" />
                </template>
              </n-button>
            </n-flex>
          </n-form-item-gi>
        </n-grid>
      </n-form>

      <n-divider />

      <n-flex justify="space-between" align="center" style="margin-bottom: 10px;">
        <n-text strong>已授奖作品</n-text>
        <n-flex align="center">
          <n-button
            size="small"
            type="primary"
            secondary
            :disabled="!currentAwardId || creating"
            @click="openAddWorkModal"
          >
            <template #icon>
              <Icon icon="lucide:plus" :width="15" />
            </template>
            添加作品
          </n-button>
          <n-button
            size="small"
            secondary
            title="刷新"
            :disabled="!currentAwardId || creating"
            :loading="itemsLoading"
            @click="loadAwardItems"
          >
            <template #icon>
              <Icon icon="lucide:refresh-cw" :width="15" />
            </template>
          </n-button>
        </n-flex>
      </n-flex>
      <n-data-table
        size="small"
        striped
        :columns="itemColumns"
        :data="awardItems"
        :loading="itemsLoading"
        :row-key="(row: AwardItemManageOut) => row.id"
        style="max-width: 1100px;"
      />
    </n-layout>
  </n-layout>

  <n-modal
    v-model:show="addWorkModalVisible"
    preset="card"
    title="添加作品"
    style="width: min(640px, calc(100vw - 32px));"
  >
    <n-flex vertical :size="12">
      <n-input-group>
        <n-input
          v-model:value="lookupSubmissionId"
          clearable
          placeholder="提交 ID"
          @keyup.enter="findSubmissionForAward"
        />
        <n-button
          type="primary"
          :disabled="!lookupSubmissionId.trim()"
          :loading="lookupLoading"
          @click="findSubmissionForAward"
        >
          <template #icon>
            <Icon icon="lucide:search" :width="15" />
          </template>
          查找
        </n-button>
      </n-input-group>

      <n-alert v-if="lookupError" type="error">
        {{ lookupError }}
      </n-alert>

      <n-flex v-if="submissionCandidate" vertical :size="12">
        <n-descriptions :column="2" size="small" bordered>
          <n-descriptions-item label="提交者">
            {{ submissionCandidate.username }}
          </n-descriptions-item>
          <n-descriptions-item label="任务">
            {{ submissionCandidate.task_title }}
          </n-descriptions-item>
          <n-descriptions-item label="得分">
            {{
              submissionCandidate.score > 0
                ? submissionCandidate.score.toFixed(2)
                : "-"
            }}
          </n-descriptions-item>
          <n-descriptions-item label="浏览">
            {{ submissionCandidate.view_count }}
          </n-descriptions-item>
          <n-descriptions-item label="提示词">
            <n-tag
              size="small"
              :type="
                submissionCandidate.has_prompt_chain ? 'success' : 'default'
              "
            >
              {{ submissionCandidate.has_prompt_chain ? "有" : "无" }}
            </n-tag>
          </n-descriptions-item>
          <n-descriptions-item label="状态">
            <n-tag
              size="small"
              :type="candidateAlreadyAwarded ? 'default' : 'info'"
            >
              {{ candidateAlreadyAwarded ? "已添加" : "可添加" }}
            </n-tag>
          </n-descriptions-item>
        </n-descriptions>
        <n-flex justify="end" style="width: 100%;">
          <n-button secondary @click="clearSubmissionLookup">清空</n-button>
          <n-button
            type="primary"
            :disabled="candidateAlreadyAwarded"
            :loading="addingCandidate"
            @click="addCandidateToAward"
          >
            <template #icon>
              <Icon
                :icon="candidateAlreadyAwarded ? 'lucide:check' : 'lucide:plus'"
                :width="15"
              />
            </template>
            {{ candidateAlreadyAwarded ? "已添加" : "添加到奖项" }}
          </n-button>
        </n-flex>
      </n-flex>
    </n-flex>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from "vue"
import {
  NButton,
  NButtonGroup,
  NInputNumber,
  NTag,
  useMessage,
  type DataTableColumn,
} from "naive-ui"
import { Icon } from "@iconify/vue"
import { Showcase } from "../api"
import type {
  AwardItemManageOut,
  AwardManageIn,
  AwardManageOut,
  ItemOrdering,
  ShowcaseSubmissionLookupOut,
} from "../utils/type"

const message = useMessage()

const awards = ref<AwardManageOut[]>([])
const awardItems = ref<AwardItemManageOut[]>([])
const currentAwardId = ref<number | null>(null)
const creating = ref(false)
const awardsLoading = ref(false)
const itemsLoading = ref(false)
const savingAward = ref(false)
const deletingAward = ref(false)
const updatingItemIds = ref(new Set<number>())
const refreshingItemIds = ref(new Set<number>())
const addWorkModalVisible = ref(false)
const lookupSubmissionId = ref("")
const lookupLoading = ref(false)
const lookupError = ref("")
const submissionCandidate = ref<ShowcaseSubmissionLookupOut | null>(null)
const addingCandidate = ref(false)

const awardDraft = reactive<AwardManageIn>(defaultAward())

const orderingOptions: { label: string; value: ItemOrdering }[] = [
  { label: "手动排序", value: "manual" },
  { label: "授奖时间", value: "awarded_at" },
  { label: "评分", value: "score" },
  { label: "浏览量", value: "view_count" },
]

const canSaveAward = computed(() => awardDraft.name.trim().length > 0)
const awardedSubmissionIds = computed(
  () => new Set(awardItems.value.map((item) => item.submission_id)),
)
const candidateAlreadyAwarded = computed(
  () =>
    !!submissionCandidate.value &&
    awardedSubmissionIds.value.has(submissionCandidate.value.submission_id),
)
const nextSortOrder = computed(() => {
  if (awardItems.value.length === 0) return 0
  return Math.max(...awardItems.value.map((item) => item.sort_order)) + 1
})

const itemColumns: DataTableColumn<AwardItemManageOut>[] = [
  {
    title: "排序",
    key: "sort_order",
    width: 92,
    render: (row) =>
      h(NInputNumber, {
        value: row.sort_order,
        min: 0,
        size: "small",
        showButton: false,
        class: "table-number-input",
        loading: updatingItemIds.value.has(row.id),
        "onUpdate:value": (value: number | null) =>
          updateItemOrder(row, value ?? 0),
      }),
  },
  {
    title: "提交者",
    key: "username",
    width: 180,
  },
  {
    title: "任务",
    key: "task_title",
    minWidth: 180,
  },
  {
    title: "得分",
    key: "score",
    width: 72,
    render: (row) => (row.score > 0 ? row.score.toFixed(2) : "-"),
  },
  {
    title: "浏览",
    key: "view_count",
    width: 72,
  },
  {
    title: "提示词",
    key: "has_prompt_chain",
    width: 88,
    render: (row) =>
      h(
        NTag,
        { size: "small", type: row.has_prompt_chain ? "success" : "default" },
        { default: () => (row.has_prompt_chain ? "有" : "无") },
      ),
  },
  {
    title: "状态",
    key: "is_stale",
    width: 96,
    render: (row) =>
      row.is_stale
        ? h(NTag, { size: "small", type: "warning" }, { default: () => "有新提交" })
        : null,
  },
  {
    title: "",
    key: "actions",
    width: 100,
    render: (row) =>
      h(NButtonGroup, { size: "small" }, {
        default: () => [
          row.is_stale
            ? h(
                NButton,
                {
                  size: "small",
                  secondary: true,
                  type: "warning",
                  title: "切换到最新提交",
                  loading: refreshingItemIds.value.has(row.id),
                  onClick: () => refreshAwardItem(row),
                },
                { icon: () => h(Icon, { icon: "lucide:refresh-cw", width: 14 }) },
              )
            : null,
          h(
            NButton,
            {
              size: "small",
              tertiary: true,
              type: "error",
              title: "移除",
              onClick: () => removeAwardItem(row),
            },
            { icon: () => h(Icon, { icon: "lucide:trash-2", width: 15 }) },
          ),
        ],
      }),
  },
]

function defaultAward(): AwardManageIn {
  return {
    name: "",
    description: "",
    sort_order: 0,
    is_active: true,
    item_ordering: "manual",
  }
}

function assignDraft(award: AwardManageIn) {
  Object.assign(awardDraft, {
    name: award.name,
    description: award.description,
    sort_order: award.sort_order,
    is_active: award.is_active,
    item_ordering: award.item_ordering,
  })
}

function startCreate() {
  currentAwardId.value = null
  creating.value = true
  awardItems.value = []
  assignDraft(defaultAward())
}

async function loadAwards() {
  awardsLoading.value = true
  try {
    awards.value = await Showcase.listManageAwards()
  } finally {
    awardsLoading.value = false
  }
}

async function selectAward(award: AwardManageOut) {
  currentAwardId.value = award.id
  creating.value = false
  assignDraft(award)
  await loadAwardItems()
}

async function saveAward() {
  if (!canSaveAward.value) return
  const payload: AwardManageIn = {
    ...awardDraft,
    name: awardDraft.name.trim(),
    description: awardDraft.description.trim(),
  }
  savingAward.value = true
  try {
    const saved =
      currentAwardId.value && !creating.value
        ? await Showcase.updateAward(currentAwardId.value, payload)
        : await Showcase.createAward(payload)
    await loadAwards()
    const next = awards.value.find((award) => award.id === saved.id)
    if (next) await selectAward(next)
    message.success("已保存")
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "保存失败")
  } finally {
    savingAward.value = false
  }
}

async function deleteCurrentAward() {
  if (!currentAwardId.value || creating.value) return
  if (!window.confirm("确定删除这个奖项？")) return
  deletingAward.value = true
  try {
    await Showcase.deleteAward(currentAwardId.value)
    await loadAwards()
    if (awards.value.length > 0) await selectAward(awards.value[0])
    else startCreate()
    message.success("已删除")
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "删除失败")
  } finally {
    deletingAward.value = false
  }
}

async function loadAwardItems() {
  if (!currentAwardId.value || creating.value) {
    awardItems.value = []
    return
  }
  itemsLoading.value = true
  try {
    awardItems.value = await Showcase.listAwardItems(currentAwardId.value)
  } finally {
    itemsLoading.value = false
  }
}

function setUpdatingItem(id: number, loading: boolean) {
  const next = new Set(updatingItemIds.value)
  if (loading) next.add(id)
  else next.delete(id)
  updatingItemIds.value = next
}

function setRefreshingItem(id: number, loading: boolean) {
  const next = new Set(refreshingItemIds.value)
  if (loading) next.add(id)
  else next.delete(id)
  refreshingItemIds.value = next
}

async function refreshAwardItem(row: AwardItemManageOut) {
  setRefreshingItem(row.id, true)
  try {
    const updated = await Showcase.refreshAwardItem(row.id)
    const idx = awardItems.value.findIndex((item) => item.id === row.id)
    if (idx !== -1) awardItems.value[idx] = updated
    message.success("已切换到最新提交")
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "切换失败")
  } finally {
    setRefreshingItem(row.id, false)
  }
}

async function updateItemOrder(row: AwardItemManageOut, sortOrder: number) {
  if (row.sort_order === sortOrder) return
  row.sort_order = sortOrder
  setUpdatingItem(row.id, true)
  try {
    await Showcase.updateAwardItem(row.id, { sort_order: sortOrder })
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "排序更新失败")
    await loadAwardItems()
  } finally {
    setUpdatingItem(row.id, false)
  }
}

async function removeAwardItem(row: AwardItemManageOut) {
  if (!window.confirm("确定移除这个作品？")) return
  try {
    await Showcase.deleteAwardItem(row.id)
    awardItems.value = awardItems.value.filter((item) => item.id !== row.id)
    await loadAwards()
    message.success("已移除")
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "移除失败")
  }
}

function clearSubmissionLookup() {
  lookupSubmissionId.value = ""
  lookupError.value = ""
  submissionCandidate.value = null
}

function openAddWorkModal() {
  if (!currentAwardId.value || creating.value) return
  clearSubmissionLookup()
  addWorkModalVisible.value = true
}

async function findSubmissionForAward() {
  const submissionId = lookupSubmissionId.value.trim()
  if (!submissionId) return
  lookupLoading.value = true
  lookupError.value = ""
  submissionCandidate.value = null
  try {
    submissionCandidate.value =
      await Showcase.findSubmissionForAward(submissionId)
  } catch (err: any) {
    lookupError.value = err.response?.data?.detail ?? "没有找到这个提交"
  } finally {
    lookupLoading.value = false
  }
}

async function addCandidateToAward() {
  const candidate = submissionCandidate.value
  if (
    !currentAwardId.value ||
    creating.value ||
    !candidate ||
    candidateAlreadyAwarded.value
  ) {
    return
  }
  addingCandidate.value = true
  try {
    const item = await Showcase.addAwardItem(currentAwardId.value, {
      submission_id: candidate.submission_id,
      sort_order: nextSortOrder.value,
    })
    awardItems.value = [...awardItems.value, item]
    await loadAwards()
    message.success("已添加作品")
    addWorkModalVisible.value = false
    clearSubmissionLookup()
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "添加作品失败")
  } finally {
    addingCandidate.value = false
  }
}

onMounted(async () => {
  await loadAwards()
  if (awards.value.length > 0) await selectAward(awards.value[0])
  else startCreate()
})
</script>

<style scoped>
.panel-header {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 12px;
  border-bottom: 1px solid #efeff5;
  background: #fafafa;
}

.award-row {
  display: flex;
  width: 100%;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border: 0;
  border-bottom: 1px solid #f0f0f0;
  background: transparent;
  color: #333;
  cursor: pointer;
  text-align: left;
}

.award-row:hover {
  background: #f2f5f8;
}

.award-row.active {
  background: #e8f8f0;
  color: #18a058;
}

:deep(.table-number-input) {
  width: 76px;
}
</style>
