<template>
  <n-modal
    :show="isOpen"
    preset="card"
    title="调教提示词"
    style="width: min(560px, 92vw)"
    :mask-closable="!streaming"
    @update:show="onModalClose"
  >
    <div class="guidance-body">
      <div class="guidance-messages" ref="messagesRef">
        <div
          v-for="(msg, i) in messages"
          :key="msg.id ?? i"
          class="guidance-msg"
          :class="msg.role"
        >
          <div class="msg-role">{{ msg.role === "user" ? "你" : "AI" }}</div>
          <div class="msg-content" v-html="renderMarkdown(msg.content)"></div>
        </div>

        <div v-if="streaming" class="guidance-msg assistant">
          <div class="msg-role">AI</div>
          <div v-if="!displayStreamingContent" class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
          <div
            v-else
            class="msg-content"
            v-html="renderMarkdown(displayStreamingContent)"
          ></div>
        </div>
      </div>

      <div v-if="isReady" class="ready-hint">
        <Icon icon="lucide:check-circle" :width="16" />
        提示词已优化，可以生成代码了！
      </div>

      <div class="guidance-input">
        <n-input
          v-model:value="draftPrompt"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 5 }"
          placeholder="修改你的提示词后发送..."
          :disabled="streaming"
          @keydown.enter.exact.prevent="send"
        />
        <n-flex justify="space-between" align="center" style="margin-top: 8px">
          <div>
            <n-button
              v-if="streaming"
              type="error"
              size="small"
              @click="stopGuidance"
            >
              停止
            </n-button>
            <n-button
              v-else
              size="small"
              :disabled="!draftPrompt.trim() || !connected"
              @click="send"
            >
              发送
            </n-button>
          </div>
          <n-button
            :type="isReady ? 'primary' : 'default'"
            size="small"
            :disabled="!draftPrompt.trim()"
            @click="generate"
          >
            <template #icon>
              <Icon icon="lucide:play" :width="14" />
            </template>
            生成代码
          </n-button>
        </n-flex>
      </div>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue"
import { Icon } from "@iconify/vue"
import { renderMarkdown } from "../../utils/markdown"
import {
  messages,
  streaming,
  streamingContent,
  isReady,
  isOpen,
  connected,
  initialPrompt,
  sendGuidance,
  stopGuidance,
  closeGuidance,
} from "../../store/guidance"

const emit = defineEmits<{
  generate: [prompt: string]
}>()

const draftPrompt = ref("")
const messagesRef = ref<HTMLElement>()

const displayStreamingContent = computed(() =>
  streamingContent.value.replace(/^\[READY\]\n?/, "")
)

function send() {
  const text = draftPrompt.value.trim()
  if (!text || streaming.value) return
  sendGuidance(text)
}

function generate() {
  const text = draftPrompt.value.trim()
  if (!text) return
  emit("generate", text)
  closeGuidance()
}

function onModalClose(show: boolean) {
  if (!show && !streaming.value) closeGuidance()
}

watch(isOpen, (val) => {
  if (val) draftPrompt.value = initialPrompt.value
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
.guidance-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.guidance-messages {
  min-height: 160px;
  max-height: 360px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.guidance-msg .msg-role {
  font-size: 12px;
  font-weight: bold;
  margin-bottom: 4px;
  color: #888;
}

.guidance-msg.user .msg-role {
  color: #2080f0;
}

.guidance-msg.assistant .msg-role {
  color: #18a058;
}

.guidance-msg.assistant .msg-content {
  background: #f0f7ff;
  border-left: 3px solid #2080f0;
  padding: 8px 12px;
  border-radius: 0 6px 6px 0;
  font-size: 14px;
  line-height: 1.6;
}

.guidance-msg.user .msg-content {
  font-size: 14px;
  line-height: 1.6;
  color: #333;
}

.msg-content :deep(p) {
  margin: 0;
}

.ready-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #18a058;
  font-size: 13px;
  font-weight: 500;
  padding: 6px 10px;
  background: #f0fff4;
  border-radius: 6px;
  border: 1px solid #b8e8cc;
}

.typing-indicator {
  display: flex;
  gap: 5px;
  padding: 8px 0;
}

.typing-indicator span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #2080f0;
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
    transform: translateY(-5px);
    opacity: 1;
  }
}
</style>
