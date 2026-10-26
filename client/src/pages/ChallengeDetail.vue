<template>
  <div class="challenge-layout">
    <div class="challenge-sider">
      <n-tabs v-model:value="activeTab" type="line" class="left-tabs">
        <template #prefix>
          <n-button text @click="back" style="margin: 0 8px">
            <Icon :width="20" icon="pepicons-pencil:arrow-left" />
          </n-button>
        </template>
        <template #suffix>
          <n-flex style="margin: 0 8px">
            <n-button
              v-if="roleAdmin || roleSuper"
              text
              @click="showStats = true"
            >
              <Icon :width="16" icon="lucide:bar-chart-2" />
            </n-button>
            <n-button
              v-if="authed"
              text
              @click="
                $router.push({ name: 'submissions', params: { page: 1 } })
              "
            >
              <Icon :width="16" icon="lucide:list" />
            </n-button>
            <n-button v-if="roleSuper" text @click="edit">
              <Icon :width="16" icon="lucide:edit" />
            </n-button>
          </n-flex>
        </template>
        <n-tab-pane name="desc" tab="挑战描述" display-directive="show">
          <div class="desc-pane">
            <div class="challenge-meta">
              <n-flex align="center" justify="space-between">
                <n-text depth="3">
                  出题人：{{ challengeAuthor || "未设置" }}
                </n-text>
                <n-flex align="center" size="small">
                  <n-button
                    v-if="assets.length"
                    size="small"
                    @click="showAssets = true"
                  >
                    看素材
                  </n-button>
                  <n-button
                    v-if="exampleCode"
                    size="small"
                    @click="previewExample"
                  >
                    看示例
                  </n-button>
                </n-flex>
              </n-flex>
            </div>
            <div
              class="markdown-body content no-select"
              v-html="challengeContent"
              ref="$desc"
              @copy.prevent
            />
          </div>
        </n-tab-pane>
        <n-tab-pane name="chat" tab="AI 对话" display-directive="show">
          <PromptPanel
            @deleted="historyRefreshKey++"
            @submitted="historyRefreshKey++"
          />
        </n-tab-pane>
        <n-tab-pane name="external" tab="手动提交" display-directive="show">
          <ExternalAIPanel :task-id="taskId" @submitted="historyRefreshKey++" />
        </n-tab-pane>
        <n-tab-pane name="history" tab="历史对话" display-directive="show">
          <PromptHistoryPanel
            :task-id="taskId"
            :active="activeTab === 'history'"
            :asset-base-url="assetBaseUrl"
            :refresh-key="historyRefreshKey"
            @select="previewHistoryItem"
            @deleted="removeMessagePair"
          />
        </n-tab-pane>
      </n-tabs>
    </div>
    <div class="challenge-content">
      <Preview
        :html="html"
        :css="css"
        :js="js"
        :asset-base-url="assetBaseUrl"
        show-code-button
        clearable
        @showCode="showCode = true"
        @clear="clearAll"
      />
    </div>
  </div>
  <TaskStatsModal v-model:show="showStats" :task-id="taskId" />
  <RandomRatingModal v-if="authed" />
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
  <n-modal
    v-model:show="showCode"
    preset="card"
    title="代码"
    style="width: 700px"
  >
    <n-tabs type="line">
      <n-tab-pane name="html" tab="HTML">
        <n-code :code="html" language="html" />
      </n-tab-pane>
      <n-tab-pane name="css" tab="CSS">
        <n-code :code="css" language="css" />
      </n-tab-pane>
      <n-tab-pane name="js" tab="JS">
        <n-code :code="js" language="javascript" />
      </n-tab-pane>
    </n-tabs>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed, useTemplateRef } from "vue"
import { useRoute, useRouter } from "vue-router"
import { useMessage } from "naive-ui"
import { Icon } from "@iconify/vue"
import { marked, type MarkedOptions } from "marked"
import copyFn from "copy-text-to-clipboard"
import PromptPanel from "../components/ai/PromptPanel.vue"
import ExternalAIPanel from "../components/ai/ExternalAIPanel.vue"
import PromptHistoryPanel from "../components/ai/PromptHistoryPanel.vue"
import Preview from "../components/editor/Preview.vue"
import TaskStatsModal from "../components/task/TaskStatsModal.vue"
import RandomRatingModal from "../components/ai/RandomRatingModal.vue"
import { Challenge, Submission, TaskAssets } from "../api"
import type { TaskAsset } from "../utils/type"
import { html, css, js } from "../store/editors"
import { taskId, taskTab, challengeDisplay } from "../store/task"
import { TASK_TYPE } from "../utils/const"
import { authed, roleAdmin, roleSuper } from "../store/user"
import {
  connectPrompt,
  disconnectPrompt,
  streaming,
  setOnCodeComplete,
  removeMessagePair,
  markMessageSubmitted,
} from "../store/prompt"

const route = useRoute()
const router = useRouter()
const message = useMessage()

const challengeRenderer = new marked.Renderer()
challengeRenderer.code = ({ text, lang }) => {
  const language = lang?.toLowerCase() ?? "text"
  return `<div class="codeblock-wrapper" data-lang="${language}">
  <div class="codeblock-action">
    <span class="lang">${language.toUpperCase()}</span>
    <button class="action-btn" data-action="copy">复制</button>
  </div>
  <pre><code class="language-${language}">${text}</code></pre>
</div>`
}
challengeRenderer.link = ({ href, text }) =>
  `<a href="${href}" target="_blank">${text}</a>`

function setupCodeCopy() {
  $desc.value?.addEventListener("click", (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action='copy']")
    if (!btn) return
    const wrapper = btn.closest<HTMLElement>("[data-lang]")!
    const code = wrapper.querySelector("code")?.textContent ?? ""
    copyFn(code)
    btn.textContent = "已复制"
    setTimeout(() => { btn.textContent = "复制" }, 1000)
  })
}

const activeTab = ref("desc")
const challengeContent = ref("")
const challengeAuthor = ref("")
const $desc = useTemplateRef<HTMLElement>("$desc")
const showCode = ref(false)
const showStats = ref(false)
const showAssets = ref(false)
const assets = ref<TaskAsset[]>([])
const historyRefreshKey = ref(0)
const exampleCode = ref<{ html: string; css: string; js: string } | null>(null)

const assetBaseUrl = computed(
  () => `/media/tasks/challenge/${challengeDisplay.value}/`,
)

watch(streaming, (val) => {
  if (val) activeTab.value = "chat"
})

async function loadChallenge() {
  const display = Number(route.params.display)
  taskTab.value = TASK_TYPE.Challenge
  challengeDisplay.value = display
  const [data, fetchedAssets] = await Promise.all([
    Challenge.get(display),
    TaskAssets.listChallenge(display),
  ])
  taskId.value = data.task_ptr
  challengeAuthor.value = data.author_name ?? ""
  if (data.example_html || data.example_css || data.example_js) {
    exampleCode.value = {
      html: data.example_html ?? "",
      css: data.example_css ?? "",
      js: data.example_js ?? "",
    }
  } else {
    exampleCode.value = null
  }
  challengeContent.value = await marked.parse(data.content, {
    async: true,
    renderer: challengeRenderer,
  } as MarkedOptions)
  assets.value = fetchedAssets
  if (!authed.value) return
  connectPrompt(data.task_ptr)
  setOnCodeComplete(async (code, messageId) => {
    try {
      await Submission.create(
        taskId.value,
        {
          html: code.html ?? "",
          css: code.css ?? "",
          js: code.js ?? "",
        },
        messageId,
      )
      markMessageSubmitted(messageId)
      historyRefreshKey.value++
      message.success("已自动提交本次对话生成的代码")
    } catch {
      message.error("自动提交失败，请稍后重试")
    }
  })
}

function edit() {
  router.push({
    name: "challenge-editor",
    params: { display: route.params.display },
  })
}

function previewExample() {
  if (!exampleCode.value) return
  html.value = exampleCode.value.html
  css.value = exampleCode.value.css
  js.value = exampleCode.value.js
}

function clearAll() {
  html.value = ""
  css.value = ""
  js.value = ""
}

function previewHistoryItem(code: { html: string; css: string; js: string }) {
  html.value = code.html
  css.value = code.css
  js.value = code.js
}

function back() {
  disconnectPrompt()
  taskId.value = 0
  router.push({ name: "home-challenge-list" })
}

onMounted(() => {
  setupCodeCopy()
  loadChallenge()
})
onUnmounted(disconnectPrompt)
</script>

<style scoped>
.challenge-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.challenge-sider {
  width: 40%;
  height: 100%;
  overflow: hidden;
  border-right: 1px solid var(--n-border-color, #efeff5);
  flex-shrink: 0;
}

.challenge-content {
  flex: 1;
  height: 100%;
  overflow: hidden;
}

.left-tabs {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.left-tabs :deep(.n-tabs-pane-wrapper) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.left-tabs :deep(.n-tab-pane) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}

.content {
  padding: 12px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
}

.desc-pane {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.challenge-meta {
  padding: 10px 12px;
  border-bottom: 1px solid var(--n-border-color, #efeff5);
  flex-shrink: 0;
}

.no-select {
  user-select: none;
}
</style>

<style>
.challenge-sider .codeblock-wrapper {
  padding: 1rem;
  background-color: #f6f8fa;
  border-radius: 6px;
  margin-bottom: 1rem;
  overflow: auto;
}

.challenge-sider .codeblock-wrapper pre {
  padding: 0;
  background-color: transparent;
  border-radius: 0;
  margin-bottom: 0;
  overflow: visible;
}

.challenge-sider .codeblock-wrapper pre code {
  padding: 0;
  font-size: 1rem;
  font-family: Monaco, monospace;
  user-select: text;
}

.challenge-sider .codeblock-action {
  margin-bottom: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.challenge-sider .codeblock-action .lang {
  font-size: 0.9rem;
  font-weight: bold;
}

.challenge-sider .action-btn {
  height: 28px;
  padding: 0 14px;
  font-size: 14px;
  border-radius: 3px;
  border: 1px solid #d9d9d9;
  background-color: #fff;
  color: #333;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.challenge-sider .action-btn:hover {
  border-color: #18a058;
  color: #18a058;
}
</style>
