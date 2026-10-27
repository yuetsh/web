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
        <template v-if="!streamingContent">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
          <div class="streaming-hint">
            AI 正在构思… 已 {{ elapsedText }}<template v-if="elapsed >= 20">，复杂的网页要想一两分钟</template>
          </div>
        </template>
        <template v-else>
          <div
            v-if="streamParts.prose"
            class="message-content"
            v-html="renderMarkdown(streamParts.prose)"
          ></div>
          <div v-if="streamParts.lines >= 0" class="code-progress">
            <Icon icon="lucide:sparkles" :width="14" />
            正在写网页… 已写 {{ streamParts.lines }} 行
          </div>
          <div v-else class="streaming-hint">AI 正在回复…</div>
        </template>
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
          placeholder="用你自己的话说说想做成什么样…"
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
import { ref, watch, nextTick, computed, onUnmounted } from "vue"
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
  streamStartedAt,
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

// 学生只关心成品：AI 回复里的代码块不在对话里展开（右边“代码”里能看），只说写了多少行。
// 按 ``` 切开，奇数段是代码；段数是偶数说明最后一个代码块还没写完
function splitCode(text: string) {
  const parts = text.split("```")
  const prose = parts.filter((_, i) => i % 2 === 0).join("\n\n").trim()
  const code = parts.filter((_, i) => i % 2 === 1)
  const lines = code.reduce((n, c) => n + c.split("\n").length - 1, 0)
  return { prose, lines: code.length ? lines : -1 }
}

const streamParts = computed(() => splitCode(streamingContent.value))

function renderContent(msg: { role: string; content: string }): string {
  if (msg.role !== "assistant") return renderMarkdown(msg.content)
  const { prose, lines } = splitCode(msg.content)
  const note = lines >= 0 ? `<p class="code-note">网页代码 ${lines} 行，在右边“代码”里看</p>` : ""
  return renderMarkdown(prose) + note
}

// 等 AI 的计时：每秒刷新一次
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
watch(
  streaming,
  (on) => {
    clearInterval(ticker)
    now.value = Date.now()
    if (on) ticker = setInterval(() => (now.value = Date.now()), 1000)
  },
  { immediate: true },
)
onUnmounted(() => clearInterval(ticker))

const elapsed = computed(() =>
  streamStartedAt.value ? Math.max(0, Math.floor((now.value - streamStartedAt.value) / 1000)) : 0,
)
const elapsedText = computed(() => {
  const s = elapsed.value
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`
})

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
  color: var(--wp-muted);
}

.message.user .message-role {
  color: var(--wp-css);
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
  background: var(--wp-paper);
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

.code-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--wp-muted);
}

.message-content :deep(.code-note) {
  font-size: 12px;
  color: var(--wp-muted);
}

.streaming-hint {
  font-size: 11px;
  color: var(--wp-faint);
  margin-top: 4px;
  animation: pulse 1.5s ease-in-out infinite;
}

.input-area {
  flex-shrink: 0;
  padding: 12px;
  border-top: 1px solid var(--wp-line);
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
  border: 1px solid var(--wp-line);
  border-radius: 4px;
  padding: 3px 6px;
  cursor: pointer;
  color: var(--wp-faint);
  line-height: 1;
  transition:
    color 0.15s,
    border-color 0.15s;
}

.pair-delete-btn:hover {
  color: var(--wp-bad);
  border-color: var(--wp-bad);
}

.message-pair.has-delete:hover .pair-delete-btn {
  display: inline-flex;
  align-items: center;
}
</style>
