<template>
  <main class="creation-home">
    <header class="head">
      <div>
        <h2>自由创作</h2>
        <p class="sub">自己定一个主题，和 AI 一起把它做出来。不用交，也不打分</p>
      </div>
      <n-button type="primary" @click="openCreate()">
        <template #icon><Icon icon="lucide:plus" /></template>
        新建主题
      </n-button>
    </header>

    <n-spin :show="loading">
      <div v-if="!loading && !creations.length" class="empty">
        <p>还没有创作。不知道做什么？从这些开始：</p>
        <div class="ideas">
          <button v-for="idea in IDEAS" :key="idea.title" class="idea" @click="openCreate(idea)">
            <b>{{ idea.title }}</b>
            <span>{{ idea.content }}</span>
          </button>
        </div>
      </div>
      <ol v-else class="list">
        <li v-for="item in creations" :key="item.display">
          <router-link class="row" :to="{ name: 'creation', params: { display: item.display } }">
            <span class="main">
              <span class="title">{{ item.title }}</span>
              <span class="desc">{{ item.content || "还没写主题描述" }}</span>
            </span>
            <span :class="['state', { done: item.has_code }]">
              {{ item.has_code ? "已有作品" : "还没开始" }}
            </span>
            <span class="time">{{ formatTime(item.modified) }}</span>
            <n-popconfirm @positive-click="remove(item)">
              <template #trigger>
                <n-button text class="del" title="删除" @click.prevent.stop>
                  <Icon icon="lucide:trash-2" :width="15" />
                </n-button>
              </template>
              删除「{{ item.title }}」？和它相关的对话也会一起删掉。
            </n-popconfirm>
          </router-link>
        </li>
      </ol>
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
            ref="titleRef"
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
import { nextTick, onMounted, reactive, ref } from "vue"
import { useRouter } from "vue-router"
import { useMessage } from "naive-ui"
import { Icon } from "../icons"
import { Creation } from "../api"
import type { CreationSlim } from "../utils/type"

const router = useRouter()
const message = useMessage()

const loading = ref(true)
const creating = ref(false)
const showCreate = ref(false)
const creations = ref<CreationSlim[]>([])
const form = reactive({ title: "", content: "" })
const titleRef = ref<{ focus: () => void } | null>(null)

// 一个创作都没有时给几个主题点子，点了带进新建框
const IDEAS = [
  { title: "番茄钟", content: "25 分钟倒计时，能开始、暂停、重置，时间到了提醒我休息" },
  { title: "我的个人主页", content: "头像、自我介绍、爱好，再放几张喜欢的图片" },
  { title: "点击小游戏", content: "方块随机出现，点中加分，30 秒后显示得分" },
  { title: "今日待办", content: "能添加、勾选完成、删除待办，刷新后还在" },
]

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function openCreate(idea?: { title: string; content: string }) {
  form.title = idea?.title ?? ""
  form.content = idea?.content ?? ""
  showCreate.value = true
  nextTick(() => titleRef.value?.focus())
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

async function remove(item: CreationSlim) {
  try {
    await Creation.remove(item.display)
    creations.value = creations.value.filter((c) => c.display !== item.display)
    message.success("已删除")
  } catch {
    message.error("删除失败，请重试")
  }
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
  max-width: 880px;
  margin: 0 auto;
  padding: 28px 20px 48px;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

h2 {
  margin: 0;
  font-size: 22px;
}

.sub {
  margin: 4px 0 0;
  color: var(--wp-muted);
  font-size: 13px;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--wp-line);
  border-radius: 10px;
  background: var(--wp-surface);
  overflow: hidden;
}

.list li + li {
  border-top: 1px solid var(--wp-line);
}

.row {
  display: grid;
  grid-template-columns: 1fr auto 96px 24px;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  color: var(--wp-ink);
  text-decoration: none;
}

.row:hover {
  background: var(--wp-paper);
}

.row:focus-visible {
  outline: 2px solid var(--wp-brand);
  outline-offset: -2px;
}

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.title {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--wp-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.state {
  font-size: 12px;
  color: var(--wp-faint);
}

.state.done {
  color: var(--wp-brand);
}

.time {
  font: 12px var(--wp-font-mono);
  color: var(--wp-muted);
  text-align: right;
}

.del {
  color: var(--wp-faint);
}

.del:hover {
  color: var(--wp-bad);
}

.empty {
  padding: 28px 24px;
  border: 1px dashed var(--wp-line);
  border-radius: 10px;
  background: var(--wp-surface);
}

.empty p {
  margin: 0 0 14px;
  font-size: 14px;
  color: var(--wp-muted);
}

.ideas {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px;
}

.idea {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--wp-line);
  border-radius: 8px;
  background: var(--wp-paper);
  color: var(--wp-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.idea:hover {
  border-color: var(--wp-brand);
}

.idea b {
  font-size: 14px;
}

.idea span {
  font-size: 12px;
  line-height: 1.6;
  color: var(--wp-muted);
}
</style>
