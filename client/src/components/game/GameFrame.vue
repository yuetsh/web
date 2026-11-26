<template>
  <div class="frame-box">
    <iframe
      v-if="doc"
      ref="frame"
      :key="frameKey"
      class="frame"
      :sandbox="PREVIEW_SANDBOX"
      :srcdoc="doc"
      title="游戏"
    ></iframe>
    <div v-else class="empty">{{ emptyText }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue"
import { PREVIEW_SANDBOX, buildPreviewDocument } from "../../utils/previewDocument"
import type { GameCode } from "../../utils/type"

// 只用来玩的游戏画面（游戏页、成长回放）：没有编辑器，固定 4:3。
// runtime.js 发来的消息（started / error …）转成 message 事件
const props = defineProps<{ code: GameCode | null; emptyText?: string }>()
const emit = defineEmits<{ message: [msg: { type: string; message?: string; dataUrl?: string }] }>()

const frame = useTemplateRef<HTMLIFrameElement>("frame")
const frameKey = ref(0)

const doc = computed(() => {
  const c = props.code
  if (!c || !(c.html || c.css || c.js)) return ""
  return buildPreviewDocument({ html: c.html ?? "", css: c.css ?? "", js: c.js ?? "", game: true })
})

// 代码变了换一个新的 iframe（同一个 iframe 改 srcdoc 会进浏览器历史）
watch(doc, () => frameKey.value++)

function onMessage(e: MessageEvent) {
  if (!frame.value || e.source !== frame.value.contentWindow) return
  const d = e.data
  if (d && d.source === "wp-game" && typeof d.type === "string") emit("message", d)
}

onMounted(() => window.addEventListener("message", onMessage))
onUnmounted(() => window.removeEventListener("message", onMessage))

defineExpose({
  // 重新开始：换一个新的 iframe
  restart() {
    frameKey.value++
  },
})
</script>

<style scoped>
.frame-box {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  /* 游戏画面，深浅主题都用深底 */
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}

.frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}

.empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8a93a6;
  font-size: 14px;
}
</style>
