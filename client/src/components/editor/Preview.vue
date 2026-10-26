<template>
  <n-flex align="center" justify="space-between" class="title">
    <div>
      <slot name="title"><n-text class="titleText">预览</n-text></slot>
      <n-text v-if="!!submission.id" depth="3">
        ({{ submission.view_count || 0 }})
      </n-text>
    </div>
    <n-flex>
      <n-tooltip>
        <template #trigger>
          <n-button quaternary @click="cycleLayout">
            <template #icon>
              <Icon :icon="layoutIcon" />
            </template>
          </n-button>
        </template>
        {{ layoutLabel }}
      </n-tooltip>
      <n-button quaternary @click="download" :disabled="!showDL">下载</n-button>
      <n-button quaternary @click="open">全屏</n-button>
      <n-button quaternary v-if="props.clearable" @click="clear">清空</n-button>
      <n-button
        quaternary
        v-if="props.showCodeButton"
        @click="emits('showCode')"
      >
        代码
      </n-button>
      <n-button quaternary v-if="props.submissionId" @click="copyLink">
        链接
      </n-button>
      <n-flex v-if="!!submission.id" align="center">
        <n-button quaternary @click="emits('showCode')">代码</n-button>
        <n-popover v-if="submission.my_score === 0">
          <template #trigger>
            <n-button secondary type="primary">打分</n-button>
          </template>
          <n-rate :size="30" @update:value="updateScore" />
        </n-popover>
      </n-flex>
    </n-flex>
  </n-flex>
  <div class="iframe-wrapper" :style="iframeWrapperStyle">
    <iframe
      ref="frame"
      class="iframe"
      :sandbox="PREVIEW_SANDBOX"
      :srcdoc="previewContent"
    ></iframe>
  </div>
</template>
<script lang="ts" setup>
import { watchDebounced } from "@vueuse/core"
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from "vue"
import { useRouter } from "vue-router"
import { Submission } from "../../api"
import { submission } from "../../store/submission"
import { useMessage } from "naive-ui"
import { Icon } from "../../icons"
import copy from "copy-text-to-clipboard"
import {
  buildPreviewDocument,
  PREVIEW_SANDBOX,
} from "../../utils/previewDocument"
import {
  listenPreviewStorage,
  loadPreviewStorage,
} from "../../utils/previewStorage"
import { user } from "../../store/user"

interface Props {
  html: string
  css: string
  js: string
  assetBaseUrl?: string
  submissionId?: string
  showCodeButton?: boolean
  clearable?: boolean
  // 自己的编辑器传当前任务 id：代码里的 localStorage 按“用户 + 任务”存下来，刷新后还在
  storageTaskId?: number
}

const props = defineProps<Props>()
const emits = defineEmits(["afterScore", "showCode", "clear"])

type Layout = "desktop" | "mobile" | "tablet"
const layouts: Layout[] = ["desktop", "mobile", "tablet"]
const layoutConfig: Record<
  Layout,
  { icon: string; label: string; width: string }
> = {
  desktop: {
    icon: "material-symbols:desktop-windows-outline",
    label: "桌面",
    width: "100%",
  },
  mobile: {
    icon: "material-symbols:smartphone-outline",
    label: "移动端 (375px)",
    width: "375px",
  },
  tablet: {
    icon: "material-symbols:tablet-outline",
    label: "平板 (768px)",
    width: "768px",
  },
}
const layoutIndex = ref(0)
const layoutIcon = computed(
  () => layoutConfig[layouts[layoutIndex.value]!].icon,
)
const layoutLabel = computed(
  () => layoutConfig[layouts[layoutIndex.value]!].label,
)
const iframeWrapperStyle = computed(() => ({
  maxWidth: layoutConfig[layouts[layoutIndex.value]!].width,
}))
function cycleLayout() {
  layoutIndex.value = (layoutIndex.value + 1) % layouts.length
}

const message = useMessage()
const router = useRouter()

const showDL = computed(() => props.html || props.css || props.js)
const previewContent = ref("")

const frame = useTemplateRef<HTMLIFrameElement>("frame")
const storageScope = () =>
  props.storageTaskId ? `${user.username}:${props.storageTaskId}` : ""

function getContent(forDownload = false) {
  const scope = storageScope()
  return buildPreviewDocument({
    html: props.html,
    css: props.css,
    js: props.js,
    assetBaseUrl: props.assetBaseUrl,
    storage: forDownload ? false : scope ? loadPreviewStorage(scope) : undefined,
  })
}

function preview() {
  previewContent.value = getContent()
}

function download() {
  const content = getContent(true)
  const blob = new Blob([content], { type: "text/html" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "index.html"
  a.click()
  URL.revokeObjectURL(url)
}

function open() {
  if (props.submissionId) {
    const data = router.resolve({
      name: "submission",
      params: { id: props.submissionId },
    })
    window.open(data.href, "_blank")
  } else {
    const newTab = window.open("about:blank", "_blank")
    if (!newTab) return
    // 新标签页和本站同源，代码要放进带 sandbox 的 iframe 里跑
    const doc = newTab.document
    doc.open()
    doc.write(
      `<!DOCTYPE html><title>预览</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style><iframe sandbox="${PREVIEW_SANDBOX}"></iframe>`,
    )
    doc.close()
    const tabFrame = doc.querySelector("iframe")!
    // 全屏页里的写入也存到同一个地方
    listenPreviewStorage(newTab, () => tabFrame, storageScope)
    tabFrame.srcdoc = getContent()
  }
}

function clear() {
  emits("clear")
}

function copyLink() {
  copy(`${document.location.origin}/submission/${props.submissionId}`)
  message.success("该提交的链接已复制")
}

async function updateScore(score: number) {
  try {
    const res = await Submission.updateScore(submission.value.id, score)
    message.success(res.message)
    submission.value.my_score = score
    emits("afterScore")
  } catch (err: any) {
    message.error(err.response.data.detail)
  }
}

watchDebounced(
  () => [props.html, props.css, props.js, props.assetBaseUrl],
  preview,
  {
    debounce: 500,
    maxWait: 1000,
  },
)
onMounted(preview)
onUnmounted(listenPreviewStorage(window, () => frame.value, storageScope))
</script>
<style scoped>
.title {
  height: 43px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid var(--wp-line);
  background: var(--wp-surface);
  box-sizing: border-box;
  flex-wrap: nowrap !important;
}

.titleText {
  font-size: 16px;
}

.iframe-wrapper {
  width: 100%;
  /* 减去上面标题栏的高度，否则底部 43px 会被裁掉 */
  height: calc(100% - 43px);
  margin: 0 auto;
  transition: max-width 0.3s ease;
  overflow: hidden;
}

.iframe {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
}
</style>
