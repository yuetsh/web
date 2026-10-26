<template>
  <div class="prompt-panel">
    <div class="messages" ref="messagesRef">
      <div
        v-for="pair in pairs"
        :key="pair.assistantMsg?.id ?? 'user-' + pair.index"
        class="message-pair"
        :class="{ 'has-delete': pair.assistantMsg?.id && !streaming }"
      >
        <!-- Delete button: only shown on hover when pair has assistant id and not streaming -->
        <button
          v-if="pair.assistantMsg?.id && !streaming"
          class="pair-delete-btn"
          @click="deletePair(pair.assistantMsg!.id!)"
          title="删除这轮对话及关联提交"
        >
          <Icon icon="lucide:trash-2" :width="14" />
        </button>

        <!-- User message -->
        <div v-if="pair.userMsg.source === 'edit'" class="message note">
          你手动修改了代码
        </div>
        <div v-else class="message user">
          <div class="message-role">
            我<span v-if="pair.userMsg.source === 'manual'" class="role-tag">
              用外部 AI</span
            >
          </div>
          <div
            class="message-content"
            v-html="renderContent(pair.userMsg)"
          ></div>
        </div>

        <!-- Assistant message -->
        <div v-if="pair.assistantMsg" class="message assistant">
          <template v-if="pair.assistantMsg.source === 'conversation' || !pair.assistantMsg.source">
            <div class="message-role">AI</div>
            <div
              class="message-content"
              v-html="renderContent(pair.assistantMsg)"
            ></div>
          </template>
          <div v-if="versionOf(pair.assistantMsg)" class="version-line">
            <span class="version-chip">v{{ versionOf(pair.assistantMsg) }}</span>
            <span v-if="pair.assistantMsg.submitted">已提交</span>
          </div>
        </div>
      </div>

      <!-- Streaming indicator -->
      <div v-if="streaming" class="message assistant">
        <div class="message-role">AI</div>
        <div v-if="!streamingContent" class="typing-indicator">
          <span></span><span></span><span></span>
        </div>
        <div
          v-else
          class="message-content"
          v-html="renderMarkdown(streamingContent)"
        ></div>
        <div class="streaming-hint">AI 正在生成中…</div>
      </div>
      <RatingCard v-if="rating" :active="streaming" />
    </div>
    <GuidancePanel @generate="onGuidanceGenerate" />
    <div class="input-area">
      <n-flex
        class="prompt-input-row"
        align="flex-start"
        :wrap="false"
        :size="8"
      >
        <n-input
          v-model:value="input"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 4 }"
          placeholder="描述你想要的网页效果..."
          :disabled="streaming"
          style="flex: 1; min-width: 0"
          @keydown.enter.exact.prevent="send"
        />
        <n-tooltip>
          <template #trigger>
            <n-button
              secondary
              :disabled="!input.trim() || !connected || !currentTaskId || streaming"
              style="flex-shrink: 0"
              @click="startGuidance"
            >
              <template #icon>
                <Icon icon="lucide:lightbulb" :width="16" />
              </template>
              帮我写清楚
            </n-button>
          </template>
          AI 教练会问你几个问题，帮你把想要的效果描述清楚
        </n-tooltip>
      </n-flex>
      <n-flex justify="flex-end" align="center" style="margin-top: 8px">
        <n-select
          v-model:value="selectedModel"
          :options="modelOptions"
          style="width: 150px"
          :disabled="streaming"
        />
        <n-button v-if="streaming" type="error" @click="stopPrompt">
          停止
        </n-button>
        <n-button
          v-else
          type="primary"
          :disabled="!input.trim() || !connected"
          @click="send"
        >
          发送
        </n-button>
      </n-flex>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from "vue"
import { useStorage } from "@vueuse/core"
import { useMessage } from "naive-ui"
import { Icon } from "../../icons"
import GuidancePanel from "./GuidancePanel.vue"
import RatingCard from "../workbench/RatingCard.vue"
import { openGuidance } from "../../store/guidance"
import {
  messages,
  streaming,
  streamingContent,
  connected,
  sendPrompt,
  stopPrompt,
  currentTaskId,
  removeMessagePair,
  type PromptMessage,
} from "../../store/prompt"
import { Prompt } from "../../api"
import { renderMarkdown } from "../../utils/markdown"

const props = defineProps<{
  // 发送前调用：工作台用它把还没存的手改先存成版本，AI 才会在手改后的代码上继续改
  beforeSend?: () => Promise<void>
  // AI 生成时在对话里显示同学作品让学生打分（挑战页才有）
  rating?: boolean
}>()

const emit = defineEmits<{ deleted: [] }>()

const input = ref("")
const messagesRef = ref<HTMLElement>()
const naiveMessage = useMessage()

const modelOptions = [
  { label: "豆包", value: "doubao-seed-2-1-lite-260915" },
  { label: "DeepSeek", value: "deepseek-flash" },
]
const selectedModel = useStorage("prompt-model", "deepseek-flash")
// 浏览器里可能还存着改版前的模型名
if (!modelOptions.some((o) => o.value === selectedModel.value)) {
  selectedModel.value = "deepseek-flash"
}

// Group messages into user+assistant pairs

const pairs = computed(() => {
  const result: Array<{
    userMsg: PromptMessage
    assistantMsg: PromptMessage | null
    index: number
  }> = []
  const msgs = messages.value
  let i = 0
  while (i < msgs.length) {
    if (msgs[i].role === "user") {
      const assistantMsg =
        msgs[i + 1]?.role === "assistant" ? msgs[i + 1] : null
      result.push({ userMsg: msgs[i], assistantMsg, index: i })
      i += assistantMsg ? 2 : 1
    } else {
      i++
    }
  }
  return result
})

function hasCode(msg: { code?: any } | null): boolean {
  if (!msg?.code) return false
  return !!(msg.code.html || msg.code.css || msg.code.js)
}

// 带代码的 AI 回复就是一个版本，按出现顺序编号（和工作台底部的版本条一致）
const versionNumbers = computed(() => {
  const map = new Map<number, number>()
  for (const m of messages.value) {
    if (m.role === "assistant" && m.id && hasCode(m)) map.set(m.id, map.size + 1)
  }
  return map
})

function versionOf(msg: { id?: number }) {
  return msg.id ? versionNumbers.value.get(msg.id) : undefined
}

async function deletePair(assistantMsgId: number) {
  try {
    await Prompt.deleteMessagePair(assistantMsgId)
    removeMessagePair(assistantMsgId)
    naiveMessage.success("已删除")
    emit("deleted")
  } catch (error: any) {
    naiveMessage.error(error.response?.data?.detail ?? "删除失败，请重试")
  }
}

async function send() {
  const text = input.value.trim()
  if (!text || streaming.value) return
  input.value = ""
  await props.beforeSend?.()
  sendPrompt(text, selectedModel.value)
}

function startGuidance() {
  const text = input.value.trim()
  if (!text || !currentTaskId.value) return
  openGuidance(currentTaskId.value, text)
}

async function onGuidanceGenerate(finalPrompt: string) {
  input.value = ""
  await props.beforeSend?.()
  sendPrompt(finalPrompt, selectedModel.value)
}

function renderContent(msg: { role: string; content: string }): string {
  return renderMarkdown(msg.content)
}

watch([() => messages.value.length, streamingContent], () => {
  nextTick(() => {
    if (messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight
    }
  })
})
</script>

<style scoped>
.prompt-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.message {
  margin-bottom: 16px;
}

.message-role {
  font-size: 12px;
  font-weight: bold;
  margin-bottom: 4px;
  color: #666;
}

.message.user .message-role {
  color: #2080f0;
}

.message.assistant .message-role {
  color: var(--wp-brand);
}

.message-content {
  font-size: 14px;
  line-height: 1.6;
}

/* 手改代码这类不是对话的一行说明 */
.message.note {
  font-size: 12px;
  color: var(--wp-muted);
  text-align: center;
}

.role-tag {
  margin-left: 6px;
  font-weight: normal;
  color: var(--wp-muted);
}

.version-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--wp-muted);
}

.version-chip {
  padding: 0 7px;
  border: 1px solid var(--wp-brand);
  border-radius: 4px;
  color: var(--wp-brand);
  font: 600 12px/18px var(--wp-font-mono);
}

.message-content :deep(pre) {
  background: #f5f5f5;
  padding: 8px 12px;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 13px;
}

.message-actions {
  margin-top: 6px;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

.typing-indicator {
  display: flex;
  gap: 5px;
  padding: 8px 0;
}

.typing-indicator span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--wp-brand);
  animation: bounce 1.4s ease-in-out infinite;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes bounce {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-6px);
    opacity: 1;
  }
}

.streaming-hint {
  font-size: 11px;
  color: #aaa;
  margin-top: 4px;
  animation: pulse 1.5s ease-in-out infinite;
}

.input-area {
  flex-shrink: 0;
  padding: 12px;
  border-top: 1px solid #e0e0e0;
}

.message-pair {
  position: relative;
  margin-bottom: 4px;
}

.message-pair .message {
  margin-bottom: 16px;
}

.pair-delete-btn {
  display: none;
  position: absolute;
  top: 0;
  right: 0;
  background: none;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 3px 6px;
  cursor: pointer;
  color: #bbb;
  line-height: 1;
  transition:
    color 0.15s,
    border-color 0.15s;
}

.pair-delete-btn:hover {
  color: #e03e3e;
  border-color: #e03e3e;
}

.message-pair.has-delete:hover .pair-delete-btn {
  display: inline-flex;
  align-items: center;
}
</style>
