<template>
  <main class="creation-home">
    <n-flex
      justify="space-between"
      align="flex-end"
      style="margin-bottom: 32px"
    >
      <div>
        <n-h2 style="margin: 0">自由创作</n-h2>
        <n-text depth="3">自己定一个主题，和 AI 一起把它做出来</n-text>
      </div>
      <n-button type="primary" @click="openCreate">
        <template #icon>
          <Icon icon="lucide:plus" :width="16" />
        </template>
        新建主题
      </n-button>
    </n-flex>

    <n-spin :show="loading">
      <n-empty
        v-if="!loading && !creations.length"
        description="还没有创作，点右上角新建一个主题吧"
        style="margin-top: 72px"
      />
      <div v-else class="card-grid">
        <n-card
          v-for="item in creations"
          :key="item.display"
          class="creation-card"
          hoverable
          @click="open(item)"
        >
          <template #header>
            <n-ellipsis style="max-width: 100%">{{ item.title }}</n-ellipsis>
          </template>
          <template #header-extra>
            <n-flex :size="4" align="center">
              <n-tag v-if="item.has_code" type="success" size="small">
                已有作品
              </n-tag>
              <n-button text @click.stop="remove(item)">
                <Icon icon="lucide:trash-2" :width="15" />
              </n-button>
            </n-flex>
          </template>
          <n-ellipsis :line-clamp="2" class="creation-desc">
            {{ item.content || "还没写主题描述" }}
          </n-ellipsis>
          <template #footer>
            <n-text depth="3" style="font-size: 12px">
              更新于 {{ formatTime(item.modified) }}
            </n-text>
          </template>
        </n-card>
      </div>
    </n-spin>

    <n-modal
      v-model:show="showCreate"
      preset="card"
      title="新建主题"
      style="width: 520px"
    >
      <n-form>
        <n-form-item label="主题名称">
          <n-input
            v-model:value="form.title"
            placeholder="例如：我的番茄钟"
            maxlength="100"
            show-count
          />
        </n-form-item>
        <n-form-item label="主题描述（可以之后再补充）">
          <n-input
            v-model:value="form.content"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 8 }"
            placeholder="想做一个什么样的页面？有哪些颜色、布局、交互？"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-flex justify="flex-end">
          <n-button @click="showCreate = false">取消</n-button>
          <n-button
            type="primary"
            :loading="creating"
            :disabled="!form.title.trim()"
            @click="submit"
          >
            创建并开始
          </n-button>
        </n-flex>
      </template>
    </n-modal>
  </main>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue"
import { useRouter } from "vue-router"
import { useDialog, useMessage } from "naive-ui"
import { Icon } from "../icons"
import { Creation } from "../api"
import type { CreationSlim } from "../utils/type"

const router = useRouter()
const message = useMessage()
const dialog = useDialog()

const loading = ref(true)
const creating = ref(false)
const showCreate = ref(false)
const creations = ref<CreationSlim[]>([])
const form = reactive({ title: "", content: "" })

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function open(item: CreationSlim) {
  router.push({ name: "creation", params: { display: item.display } })
}

function openCreate() {
  form.title = ""
  form.content = ""
  showCreate.value = true
}

async function submit() {
  const title = form.title.trim()
  if (!title) return
  creating.value = true
  try {
    const created = await Creation.create({ title, content: form.content })
    showCreate.value = false
    router.push({ name: "creation", params: { display: created.display } })
  } catch {
    message.error("创建失败，请重试")
  } finally {
    creating.value = false
  }
}

function remove(item: CreationSlim) {
  dialog.warning({
    title: "删除主题",
    content: `确定删除「${item.title}」吗？和它相关的对话也会一起删除。`,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      try {
        await Creation.remove(item.display)
        creations.value = creations.value.filter(
          (c) => c.display !== item.display,
        )
        message.success("已删除")
      } catch {
        message.error("删除失败，请重试")
      }
    },
  })
}

onMounted(async () => {
  try {
    creations.value = await Creation.listMine()
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.creation-home {
  max-width: 1180px;
  margin: 0 auto;
  padding: 32px 20px 48px;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

.creation-card {
  cursor: pointer;
}

.creation-desc {
  font-size: 13px;
  color: #666;
}
</style>
