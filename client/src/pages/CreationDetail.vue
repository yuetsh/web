<template>
  <div class="creation-layout">
    <div class="creation-sider">
      <n-tabs v-model:value="activeTab" type="line" class="left-tabs">
        <template #prefix>
          <n-button text @click="back" style="margin: 0 8px">
            <Icon :width="20" icon="pepicons-pencil:arrow-left" />
          </n-button>
        </template>
        <template #suffix>
          <n-flex style="margin: 0 8px">
            <n-tooltip trigger="hover">
              <template #trigger>
                <n-button text :loading="savingCode" @click="saveCode(true)">
                  <Icon :width="16" icon="lucide:save" />
                </n-button>
              </template>
              保存当前作品
            </n-tooltip>
          </n-flex>
        </template>
        <n-tab-pane name="topic" tab="我的主题" display-directive="show">
          <div class="topic-pane">
            <n-form-item label="主题名称" :show-feedback="false">
              <n-input
                v-model:value="title"
                placeholder="给你的主题起个名字"
                maxlength="100"
              />
            </n-form-item>
            <n-form-item
              label="主题描述"
              :show-feedback="false"
              style="margin-top: 12px"
            >
              <n-input
                v-model:value="content"
                type="textarea"
                :autosize="{ minRows: 8 }"
                placeholder="想做一个什么样的页面？有哪些颜色、布局、交互？"
              />
            </n-form-item>
            <n-flex style="margin-top: 16px">
              <n-button
                :loading="savingTopic"
                :disabled="!title.trim()"
                @click="saveTopic"
              >
                保存主题
              </n-button>
              <n-button
                type="primary"
                :disabled="!content.trim() || streaming"
                @click="generate"
              >
                用这个主题生成
              </n-button>
            </n-flex>
            <n-text depth="3" class="topic-hint">
              自由创作只属于你自己，不会进入提交记录和评分。
            </n-text>
          </div>
        </n-tab-pane>
        <n-tab-pane name="chat" tab="AI 对话" display-directive="show">
          <PromptPanel :allow-submit="false" @deleted="historyRefreshKey++" />
        </n-tab-pane>
        <n-tab-pane name="history" tab="历史对话" display-directive="show">
          <PromptHistoryPanel
            :task-id="taskId"
            :active="activeTab === 'history'"
            :refresh-key="historyRefreshKey"
            @select="previewHistoryItem"
            @deleted="removeMessagePair"
          />
        </n-tab-pane>
      </n-tabs>
    </div>
    <div class="creation-content">
      <Preview
        :html="html"
        :css="css"
        :js="js"
        show-code-button
        clearable
        @showCode="showCode = true"
        @clear="clearAll"
      />
    </div>
  </div>
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
import { onMounted, onUnmounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { useMessage } from "naive-ui"
import { Icon } from "@iconify/vue"
import PromptPanel from "../components/ai/PromptPanel.vue"
import PromptHistoryPanel from "../components/ai/PromptHistoryPanel.vue"
import Preview from "../components/editor/Preview.vue"
import { Creation } from "../api"
import { html, css, js } from "../store/editors"
import {
  connectPrompt,
  disconnectPrompt,
  removeMessagePair,
  sendPrompt,
  setOnCodeComplete,
  streaming,
} from "../store/prompt"
import { closeGuidance } from "../store/guidance"

const route = useRoute()
const router = useRouter()
const message = useMessage()

const display = Number(route.params.display)
const activeTab = ref("topic")
const taskId = ref(0)
const title = ref("")
const content = ref("")
const showCode = ref(false)
const savingTopic = ref(false)
const savingCode = ref(false)
const historyRefreshKey = ref(0)

watch(streaming, (val) => {
  if (val) activeTab.value = "chat"
})

async function load() {
  const data = await Creation.get(display)
  if (disposed) return
  taskId.value = data.task_id
  title.value = data.title
  content.value = data.content
  html.value = data.html
  css.value = data.css
  js.value = data.js
  connectPrompt(data.task_id)
  setOnCodeComplete(() => saveCode())
}

async function saveTopic() {
  if (!title.value.trim()) return
  savingTopic.value = true
  try {
    await Creation.update(display, {
      title: title.value.trim(),
      content: content.value,
    })
    message.success("主题已保存")
  } catch {
    message.error("保存失败，请重试")
  } finally {
    savingTopic.value = false
  }
}

async function saveCode(notify = false) {
  savingCode.value = true
  try {
    await Creation.saveCode(display, {
      html: html.value,
      css: css.value,
      js: js.value,
    })
    if (notify) message.success("作品已保存")
  } catch {
    if (notify) message.error("保存失败，请重试")
  } finally {
    savingCode.value = false
  }
}

function generate() {
  const text = content.value.trim()
  if (!text || streaming.value) return
  activeTab.value = "chat"
  sendPrompt(text)
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
  router.push({ name: "creation-list" })
}

// 加载还没完成就离开页面时，不要再建立连接
let disposed = false

onMounted(load)
onUnmounted(() => {
  disposed = true
  disconnectPrompt()
  closeGuidance()
})
</script>

<style scoped>
.creation-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.creation-sider {
  width: 40%;
  height: 100%;
  overflow: hidden;
  border-right: 1px solid var(--n-border-color, #efeff5);
  flex-shrink: 0;
}

.creation-content {
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

.topic-pane {
  padding: 12px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
}

.topic-hint {
  display: block;
  margin-top: 12px;
  font-size: 12px;
}
</style>
