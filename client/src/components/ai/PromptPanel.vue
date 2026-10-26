<template>
  <div class="prompt-panel">
    <div class="messages" ref="messagesRef">
      <div
        v-for="(pair, pi) in pairs"
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
        <div class="message user">
          <div class="message-role">我</div>
          <div
            class="message-content"
            v-html="renderContent(pair.userMsg)"
          ></div>
        </div>

        <!-- Assistant message -->
        <div v-if="pair.assistantMsg" class="message assistant">
          <div class="message-role">AI</div>
          <div
            class="message-content"
            v-html="renderContent(pair.assistantMsg)"
          ></div>
          <div
            v-if="allowSubmit && hasCode(pair.assistantMsg)"
            class="message-actions"
          >
            <n-button
              size="tiny"
              :disabled="pair.assistantMsg.submitted"
              :loading="submittingId === pair.assistantMsg.id"
              @click="submitVersion(pair.assistantMsg)"
            >
              {{ pair.assistantMsg.submitted ? "已提交" : "提交此版本" }}
            </n-button>
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
        <n-button
          secondary
          :disabled="!input.trim() || !connected || !currentTaskId || streaming"
          style="flex-shrink: 0"
          title="调教提示词"
          aria-label="调教提示词"
          @click="startGuidance"
        >
          <template #icon>
            <Icon icon="lucide:lightbulb" :width="16" />
          </template>
        </n-button>
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
import { Icon } from "@iconify/vue"
import GuidancePanel from "./GuidancePanel.vue"
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
  markMessageSubmitted,
} from "../../store/prompt"
import { Prompt, Submission } from "../../api"
import { renderMarkdown } from "../../utils/markdown"

const { allowSubmit = true } = defineProps<{ allowSubmit?: boolean }>()

const emit = defineEmits<{ deleted: []; submitted: [] }>()

const input = ref("")
const messagesRef = ref<HTMLElement>()
const naiveMessage = useMessage()

const modelOptions = [
  { label: "豆包", value: "doubao-seed-2-0-lite-260215" },
  { label: "DeepSeek", value: "deepseek-v4-flash" },
  { label: "DeepSeek(思考)", value: "deepseek-v4-flash-thinking" },
]
const selectedModel = useStorage("prompt-model", "deepseek-v4-flash")

// Group messages into user+assistant pairs
const submittingId = ref<number | null>(null)

const pairs = computed(() => {
  const result: Array<{
    userMsg: { role: string; content: string; id?: number }
    assistantMsg: {
      role: string
      content: string
      id?: number
      code?: any
      submitted?: boolean
    } | null
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

async function submitVersion(msg: {
  id?: number
  code?: { html: string | null; css: string | null; js: string | null }
}) {
  if (!msg.id || !msg.code || !currentTaskId.value) return
  submittingId.value = msg.id
  try {
    await Submission.create(
      currentTaskId.value,
      {
        html: msg.code.html ?? "",
        css: msg.code.css ?? "",
        js: msg.code.js ?? "",
      },
      msg.id,
    )
    markMessageSubmitted(msg.id)
    naiveMessage.success("提交成功")
    emit("submitted")
  } catch {
    naiveMessage.error("提交失败，请重试")
  } finally {
    submittingId.value = null
  }
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

function send() {
  const text = input.value.trim()
  if (!text || streaming.value) return
  sendPrompt(text, selectedModel.value)
  input.value = ""
}

function startGuidance() {
  const text = input.value.trim()
  if (!text || !currentTaskId.value) return
  openGuidance(currentTaskId.value, text)
}

function onGuidanceGenerate(finalPrompt: string) {
  sendPrompt(finalPrompt, selectedModel.value)
  input.value = ""
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
  color: #18a058;
}

.message-content {
  font-size: 14px;
  line-height: 1.6;
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
  background: #18a058;
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
