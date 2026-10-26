<template>
  <Workbench
    ref="wb"
    kind="challenge"
    :task-id="taskId"
    :title="title"
    back-label="返回挑战列表"
    :back-to="{ name: 'home-challenge-list' }"
    brief-label="题目"
    :asset-base-url="assetBaseUrl"
  >
    <template #badges>
      <n-tag v-if="score" size="small" :bordered="false" type="warning">
        {{ score }} 分
      </n-tag>
    </template>
    <template #tools>
      <n-button v-if="assets.length" quaternary size="small" @click="showAssets = true">
        素材
      </n-button>
      <n-tooltip v-if="roleStaff">
        <template #trigger>
          <n-button text @click="showStats = true">
            <Icon :width="16" icon="lucide:bar-chart-2" />
          </n-button>
        </template>
        本题统计
      </n-tooltip>
      <n-tooltip v-if="roleSuper">
        <template #trigger>
          <n-button text @click="edit">
            <Icon :width="16" icon="lucide:edit" />
          </n-button>
        </template>
        编辑这道题
      </n-tooltip>
    </template>
    <template #brief>
      <div class="brief">
        <n-flex align="center" justify="space-between" class="meta">
          <n-text depth="3">出题人：{{ author || "未设置" }}</n-text>
          <n-button v-if="exampleCode" size="tiny" @click="useExample">
            放入示例代码
          </n-button>
        </n-flex>
        <div
          class="markdown-body challenge-desc no-select"
          v-html="content"
          @copy.prevent
          @click="onCopyClick"
        />
      </div>
    </template>
  </Workbench>
  <TaskStatsModal v-model:show="showStats" :task-id="taskId" />
  <n-modal
    v-model:show="showAssets"
    preset="card"
    title="素材"
    style="width: 500px"
  >
    <n-grid :cols="3" :x-gap="12" :y-gap="12">
      <n-gi v-for="asset in assets" :key="asset.name">
        <n-card size="small" :title="asset.name">
          <n-image
            :src="asset.url"
            style="width: 100%; height: 100px; object-fit: contain"
          />
        </n-card>
      </n-gi>
    </n-grid>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from "vue"
import { useRoute, useRouter } from "vue-router"
import { Marked } from "marked"
import copyFn from "copy-text-to-clipboard"
import { Icon } from "../icons"
import Workbench from "../components/workbench/Workbench.vue"
import TaskStatsModal from "../components/task/TaskStatsModal.vue"
import { Challenge, TaskAssets } from "../api"
import type { TaskAsset } from "../utils/type"
import { taskId, taskTab, challengeDisplay } from "../store/task"
import { TASK_TYPE } from "../utils/const"
import { roleStaff, roleSuper } from "../store/user"
import { trustedExtensions } from "../utils/markdown"
import type { Code } from "../utils/code"

const route = useRoute()
const router = useRouter()

// 题目里的代码块带“复制”按钮；题目正文本身不让复制
const challengeMarked = new Marked(...trustedExtensions, {
  renderer: {
    code({ text, lang }) {
      const language = lang?.toLowerCase() ?? "text"
      return `<div class="codeblock-wrapper" data-lang="${language}">
  <div class="codeblock-action">
    <span class="lang">${language.toUpperCase()}</span>
    <button class="action-btn" data-action="copy">复制</button>
  </div>
  <pre><code class="language-${language}">${text}</code></pre>
</div>`
    },
    link({ href, text }) {
      return `<a href="${href}" target="_blank">${text}</a>`
    },
  },
})

const wb = useTemplateRef<InstanceType<typeof Workbench>>("wb")
const title = ref("")
const score = ref(0)
const author = ref("")
const content = ref("")
const assets = ref<TaskAsset[]>([])
const exampleCode = ref<Code | null>(null)
const showStats = ref(false)
const showAssets = ref(false)

const assetBaseUrl = computed(
  () => `/media/tasks/challenge/${challengeDisplay.value}/`,
)

// 加载还没完成就离开页面时，不要再改全局状态
let disposed = false

async function load() {
  const display = Number(route.params.display)
  taskTab.value = TASK_TYPE.Challenge
  challengeDisplay.value = display
  const [data, fetchedAssets] = await Promise.all([
    Challenge.get(display),
    TaskAssets.listChallenge(display),
  ])
  if (disposed) return
  title.value = `${data.display}. ${data.title}`
  score.value = data.score
  author.value = data.author_name ?? ""
  assets.value = fetchedAssets
  exampleCode.value =
    data.example_html || data.example_css || data.example_js
      ? {
          html: data.example_html ?? "",
          css: data.example_css ?? "",
          js: data.example_js ?? "",
        }
      : null
  content.value = await challengeMarked.parse(data.content, { async: true })
  if (disposed) return
  taskId.value = data.task_ptr
}

function useExample() {
  if (exampleCode.value) wb.value?.setCode({ ...exampleCode.value })
}

function onCopyClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action='copy']")
  if (!btn) return
  const code = btn.closest<HTMLElement>("[data-lang]")?.querySelector("code")?.textContent ?? ""
  copyFn(code)
  btn.textContent = "已复制"
  setTimeout(() => {
    btn.textContent = "复制"
  }, 1000)
}

function edit() {
  router.push({ name: "challenge-editor", params: { display: route.params.display } })
}

onMounted(load)
onUnmounted(() => {
  disposed = true
  taskId.value = 0
})
</script>

<style scoped>
.brief {
  padding: 10px 12px 12px;
}

.meta {
  margin-bottom: 8px;
  font-size: 12px;
}

.no-select {
  user-select: none;
}
</style>

<style>
.challenge-desc {
  font-size: 14px;
  background: transparent;
}

.challenge-desc .codeblock-wrapper {
  padding: 12px;
  background-color: var(--wp-paper);
  border-radius: 6px;
  margin-bottom: 12px;
  overflow: auto;
}

.challenge-desc .codeblock-wrapper pre {
  padding: 0;
  background-color: transparent;
  border-radius: 0;
  margin-bottom: 0;
  overflow: visible;
}

.challenge-desc .codeblock-wrapper pre code {
  padding: 0;
  font-size: 13px;
  font-family: var(--wp-font-mono);
  user-select: text;
}

.challenge-desc .codeblock-action {
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.challenge-desc .codeblock-action .lang {
  font: 600 12px var(--wp-font-mono);
  color: var(--wp-muted);
}

.challenge-desc .action-btn {
  height: 24px;
  padding: 0 10px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid var(--wp-line);
  background-color: var(--wp-surface);
  color: var(--wp-ink);
  cursor: pointer;
  user-select: none;
}

.challenge-desc .action-btn:hover {
  border-color: var(--wp-brand);
  color: var(--wp-brand);
}
</style>
