<template>
  <n-modal
    :show="isOpen"
    preset="card"
    title="帮我把要求写清楚"
    style="width: min(640px, 92vw)"
    :mask-closable="!streaming"
    @update:show="onModalClose"
  >
    <p class="intro">
      AI 会看看你的要求哪里还不够清楚，给你提建议。照着建议改好下面的要求，再让它看看；
      觉得可以了就点“用这段生成网页”。
    </p>

    <div ref="messagesRef" class="messages">
      <div v-for="(msg, i) in messages" :key="msg.id ?? i" :class="['msg', msg.role]">
        <div class="who">
          {{ msg.role === "user" ? `你的要求 · 第 ${versionOf(i)} 版` : "AI 的建议" }}
        </div>
        <div class="content markdown-body" v-html="renderMarkdown(msg.content)"></div>
      </div>

      <div v-if="streaming" class="msg assistant">
        <div class="who">AI 的建议</div>
        <div v-if="!displayStreamingContent" class="typing">
          <span></span><span></span><span></span>
        </div>
        <div
          v-else
          class="content markdown-body"
          v-html="renderMarkdown(displayStreamingContent)"
        ></div>
      </div>
    </div>

    <div v-if="isReady" class="ready">
      <Icon icon="lucide:check-circle" :width="16" />
      AI 觉得要求已经写清楚了，可以生成网页了
    </div>

    <div class="draft">
      <div class="draft-label">你的要求</div>
      <n-input
        v-model:value="draftPrompt"
        type="textarea"
        :autosize="{ minRows: 3, maxRows: 6 }"
        placeholder="按 AI 的建议把要求改得更具体：要什么内容、什么颜色和布局、点了以后会怎样……"
        :disabled="streaming"
        @keydown.enter.exact.prevent="send"
      />
      <n-flex justify="space-between" align="center" class="draft-actions">
        <n-flex align="center" :size="8">
          <n-button v-if="streaming" size="small" @click="stopGuidance">停止</n-button>
          <n-button
            v-else
            size="small"
            :disabled="!draftPrompt.trim() || !connected || draftPrompt.trim() === lastSent"
            @click="send"
          >
            让 AI 再看看
          </n-button>
          <span class="muted">Enter 发送，Shift + Enter 换行</span>
        </n-flex>
        <n-button
          :type="isReady ? 'primary' : 'default'"
          :disabled="!draftPrompt.trim() || streaming"
          @click="generate"
        >
          <template #icon><Icon icon="lucide:play" :width="14" /></template>
          用这段生成网页
        </n-button>
      </n-flex>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue"
import { Icon } from "../../icons"
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

// 第几版要求：只数学生发的
function versionOf(index: number) {
  return messages.value.slice(0, index + 1).filter((m) => m.role === "user").length
}

// 没改过就不用再发一遍
const lastSent = computed(
  () => [...messages.value].reverse().find((m) => m.role === "user")?.content.trim() ?? "",
)

const displayStreamingContent = computed(() =>
  streamingContent.value.replace(/^\[READY\]\n?/, "")
)

function send() {
  const text = draftPrompt.value.trim()
  if (!text || streaming.value || text === lastSent.value) return
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
.intro {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--wp-muted);
}

.messages {
  min-height: 120px;
  max-height: 45vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}

.who {
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--wp-muted);
}

.msg.assistant .who {
  color: var(--wp-brand);
}

.content {
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--wp-ink);
}

.msg.user .content {
  border: 1px solid var(--wp-line);
  background: var(--wp-paper);
}

.msg.assistant .content {
  border-left: 3px solid var(--wp-brand);
  border-radius: 0 8px 8px 0;
  background: var(--wp-brand-soft);
}

.content :deep(p) {
  margin: 0 0 6px;
}

.content :deep(:last-child) {
  margin-bottom: 0;
}

.ready {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--wp-brand);
  background: var(--wp-brand-soft);
}

.draft {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--wp-line);
}

.draft-label {
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
}

.draft-actions {
  margin-top: 8px;
}

.muted {
  font-size: 12px;
  color: var(--wp-faint);
}

.typing {
  display: flex;
  gap: 5px;
  padding: 10px 12px;
}

.typing span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--wp-brand);
  animation: bounce 1.4s ease-in-out infinite;
}

.typing span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing span:nth-child(3) {
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
