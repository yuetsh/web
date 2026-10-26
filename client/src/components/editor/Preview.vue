<template>
  <n-flex align="center" justify="space-between" class="title">
    <div>
      <n-text class="titleText">预览</n-text>
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
    <iframe class="iframe" :srcdoc="previewContent"></iframe>
  </div>
</template>
<script lang="ts" setup>
import { watchDebounced } from "@vueuse/core"
import { computed, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { Submission } from "../../api"
import { submission } from "../../store/submission"
import { useMessage } from "naive-ui"
import { Icon } from "@iconify/vue"
import copy from "copy-text-to-clipboard"
import { buildPreviewDocument } from "../../utils/previewDocument"

interface Props {
  html: string
  css: string
  js: string
  assetBaseUrl?: string
  submissionId?: string
  showCodeButton?: boolean
  clearable?: boolean
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

function getContent() {
  return buildPreviewDocument({
    html: props.html,
    css: props.css,
    js: props.js,
    assetBaseUrl: props.assetBaseUrl,
  })
}

function preview() {
  previewContent.value = getContent()
}

function download() {
  const content = getContent()
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
    newTab.document.open()
    newTab.document.write(getContent())
    newTab.document.close()
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
</script>
<style scoped>
.title {
  height: 43px;
  padding: 0 20px;
  border-bottom: 1px solid rgb(239, 239, 245);
  box-sizing: border-box;
}

.titleText {
  font-size: 16px;
}

.iframe-wrapper {
  width: 100%;
  height: 100%;
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
