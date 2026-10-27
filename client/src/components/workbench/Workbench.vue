<template>
  <n-split
    class="workbench"
    :default-size="0.38"
    min="360px"
    :max="0.62"
  >
    <template #1>
      <div class="left">
        <div class="left-head">
          <n-tooltip>
            <template #trigger>
              <n-button text @click="$router.push(backTo)">
                <Icon icon="lucide:arrow-left" :width="18" />
              </n-button>
            </template>
            {{ backLabel }}
          </n-tooltip>
          <span class="title">{{ title }}</span>
          <slot name="badges" />
          <span class="spacer"></span>
          <slot name="tools" />
        </div>
        <div v-if="$slots.brief" class="brief">
          <button class="brief-toggle" @click="briefOpen = !briefOpen">
            <b>{{ briefLabel }}</b>
            <span>{{ briefOpen ? "收起" : "展开" }}</span>
          </button>
          <div v-show="briefOpen" class="brief-body">
            <slot name="brief" />
          </div>
        </div>
        <PromptPanel
          class="chat"
          :before-send="beforeSend"
          :rating="kind === 'challenge'"
          @deleted="historyKey++"
        />
      </div>
    </template>
    <template #2>
      <div class="right">
        <div class="right-body">
          <div v-if="mode === 'preview'" class="preview-only">
            <Preview
              :html="code.html"
              :css="code.css"
              :js="code.js"
              :asset-base-url="assetBaseUrl"
              :storage-task-id="taskId"
            >
              <template #title>
                <n-radio-group v-model:value="mode" size="small">
                  <n-radio-button value="preview">预览</n-radio-button>
                  <n-radio-button value="code">代码</n-radio-button>
                </n-radio-group>
              </template>
            </Preview>
          </div>
          <n-split v-else direction="vertical" :default-size="0.55" min="160px" max="0.8">
            <template #1>
              <CodeTabs :code="code">
                <template #prefix>
                  <n-radio-group v-model:value="mode" size="small" class="mode">
                    <n-radio-button value="preview">预览</n-radio-button>
                    <n-radio-button value="code">代码</n-radio-button>
                  </n-radio-group>
                </template>
                <template #suffix>
                  <n-button quaternary size="small" @click="format">整理代码</n-button>
                  <n-button quaternary size="small" @click="showPaste = true">
                    粘贴外部代码
                  </n-button>
                  <n-button quaternary size="small" @click="clear">清空</n-button>
                </template>
              </CodeTabs>
            </template>
            <template #2>
              <div class="preview-only">
                <Preview
                  :html="code.html"
                  :css="code.css"
                  :js="code.js"
                  :asset-base-url="assetBaseUrl"
                  :storage-task-id="taskId"
                />
              </div>
            </template>
          </n-split>
        </div>
        <VersionBar
          :kind="kind"
          :versions="versions"
          :selected-id="selectedId"
          :modified="modified"
          :can-submit="canSubmit"
          :busy="busy"
          @select="select"
          @submit="submit"
          @history="openHistory"
        />
      </div>
    </template>
  </n-split>
  <PasteCodeModal v-model:show="showPaste" :on-save="savePasted" />
  <SubmitModal
    v-model:show="showSubmit"
    :title="submitTitle"
    :has-earlier="submitHasEarlier"
    :on-submit="submitChallenge"
  />
  <n-drawer v-model:show="showHistory" :width="420" placement="right">
    <n-drawer-content title="全部历史" :native-scrollbar="false" body-content-style="padding: 0">
      <PromptHistoryPanel
        :task-id="taskId"
        :active="showHistory"
        :asset-base-url="assetBaseUrl"
        :refresh-key="historyKey"
        @select="adopt"
        @deleted="removeMessagePair"
      />
    </n-drawer-content>
  </n-drawer>
</template>
<script lang="ts" setup>
import { computed, h, onUnmounted, ref, toRef, watch } from "vue"
import { useStorage } from "@vueuse/core"
import type { RouteLocationRaw } from "vue-router"
import { NCode, useDialog, useMessage } from "naive-ui"
import { Icon } from "../../icons"
import PromptPanel from "../ai/PromptPanel.vue"
import PromptHistoryPanel from "../ai/PromptHistoryPanel.vue"
import Preview from "../editor/Preview.vue"
import CodeTabs from "./CodeTabs.vue"
import VersionBar, { type VersionItem } from "./VersionBar.vue"
import PasteCodeModal from "./PasteCodeModal.vue"
import SubmitModal from "./SubmitModal.vue"
import { Prompt, Submission } from "../../api"
import { useTaskCode } from "../../composables/useTaskCode"
import {
  addVersionPair,
  connectPrompt,
  disconnectPrompt,
  markMessageSubmitted,
  messages,
  removeMessagePair,
  sendPrompt,
  setCodeSink,
} from "../../store/prompt"
import { closeGuidance } from "../../store/guidance"
import { authed } from "../../store/user"
import {
  emptyCode,
  formatCode,
  isEmptyCode,
  sameCode,
  type Code,
} from "../../utils/code"

// 挑战和自由创作共用的工作台：左边题目 + AI 对话，右边预览 / 代码，底部是版本条。
// 每轮 AI 回复、每次手改或粘贴外部代码都是一个版本；挑战由学生自己点“交这一版”提交
const props = defineProps<{
  kind: "challenge" | "creation"
  // 任务还没加载完时是 0
  taskId: number
  title: string
  backLabel: string
  backTo: RouteLocationRaw
  briefLabel?: string
  assetBaseUrl?: string
  // 自由创作：保存作品（AI 生成完也会自动保存）
  saveWork?: (code: Code) => Promise<void>
}>()

const message = useMessage()
const dialog = useDialog()

const { code, restored } = useTaskCode(toRef(props, "taskId"))
const mode = ref<"preview" | "code">("preview")
const selectedId = ref<number | null>(null)
const busy = ref(false)
const briefOpen = ref(true)
const showPaste = ref(false)
const showSubmit = ref(false)
const showHistory = ref(false)
const historyKey = ref(0)

type CodeOut = { html: string | null; css: string | null; js: string | null }
const normalize = (c: CodeOut): Code => ({
  html: c.html ?? "",
  css: c.css ?? "",
  js: c.js ?? "",
})

const versionMessages = computed(() =>
  messages.value.filter(
    (m) => m.role === "assistant" && m.id && m.code && (m.code.html || m.code.css || m.code.js),
  ),
)

const versions = computed<VersionItem[]>(() =>
  versionMessages.value.map((m, i) => ({
    id: m.id!,
    n: i + 1,
    source: m.source ?? "conversation",
    submitted: !!m.submitted,
  })),
)

function versionCode(id: number | null): Code | null {
  const m = versionMessages.value.find((v) => v.id === id)
  return m?.code ? normalize(m.code) : null
}

const modified = computed(() => {
  const base = versionCode(selectedId.value)
  return base ? !sameCode(code, base) : !isEmptyCode(code)
})

const canSubmit = computed(() => !!props.taskId && !isEmptyCode(code))

function matchVersion(): number | null {
  const hit = [...versionMessages.value]
    .reverse()
    .find((m) => sameCode(code, normalize(m.code!)))
  return hit?.id ?? null
}

// 连上时：本地存着这个任务的代码就继续用它，否则打开最新一版。AI 生成完：换成新代码
function onCode(c: CodeOut, id: number, reason: "init" | "complete") {
  if (reason === "init" && restored.value) {
    selectedId.value = matchVersion() ?? id
    return
  }
  Object.assign(code, normalize(c))
  selectedId.value = id
  if (reason === "complete" && props.kind === "creation") {
    props.saveWork?.({ ...code }).catch(() => {})
  }
}

watch(
  () => props.taskId,
  (id) => {
    if (!id || !authed.value) return
    setCodeSink(onCode)
    connectPrompt(id)
  },
  { immediate: true },
)

onUnmounted(() => {
  disconnectPrompt()
  closeGuidance()
})

// 打开时已经有对话的，题目默认收起，给对话留地方
let briefDecided = false
watch(
  () => messages.value.length,
  (n) => {
    if (briefDecided || !n) return
    briefDecided = true
    briefOpen.value = false
  },
)

async function saveAsVersion(prompt?: string): Promise<number> {
  const res = await Prompt.saveVersion(props.taskId, { ...code }, prompt)
  addVersionPair(prompt || "（手动修改了代码）", res.source, res.message_id, { ...code })
  selectedId.value = res.message_id
  historyKey.value++
  return res.message_id
}

// 发给 AI 之前，先把还没存的手改存成版本，AI 才会在手改后的代码上继续改
async function beforeSend() {
  briefOpen.value = false
  briefDecided = true
  if (!modified.value || isEmptyCode(code)) return
  try {
    await saveAsVersion()
    message.info("已把你的修改存为新版本，AI 会在它的基础上改")
  } catch {
    message.error("保存你的修改失败，AI 会在上一版的基础上改")
  }
}

function select(id: number) {
  const apply = () => {
    const c = versionCode(id)
    if (!c) return
    Object.assign(code, c)
    selectedId.value = id
  }
  if (!modified.value) return apply()
  dialog.warning({
    title: "放弃当前修改？",
    content: "当前的修改还没有存成版本，切换后会丢失。想留着的话，可以先点“交当前修改”或发给 AI。",
    positiveText: "放弃并切换",
    negativeText: "取消",
    onPositiveClick: apply,
  })
}

// 从“全部历史”里选了一份代码
function adopt(c: Code) {
  Object.assign(code, c)
  selectedId.value = matchVersion()
  showHistory.value = false
}

function openHistory() {
  historyKey.value++
  showHistory.value = true
}

async function submit() {
  if (props.kind === "challenge") {
    showSubmit.value = true
    return
  }
  busy.value = true
  try {
    await props.saveWork?.({ ...code })
    message.success("作品已保存")
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "保存失败，请重试")
  } finally {
    busy.value = false
  }
}

const submitTitle = computed(() => {
  if (modified.value || !selectedId.value) return "交当前修改"
  const n = versions.value.find((v) => v.id === selectedId.value)?.n
  return n ? `交 v${n}` : "交这一版"
})

// 要交的这一版之前还有版本（当前修改会存成新的一版）
const submitHasEarlier = computed(() => {
  if (modified.value || !selectedId.value) return versions.value.length > 0
  return (versions.value.find((v) => v.id === selectedId.value)?.n ?? 1) > 1
})

// 挑战：先在弹框里写一句反思（可以不写）再交；出错时抛出去，弹框不关
async function submitChallenge(reflection: string) {
  busy.value = true
  try {
    const id =
      modified.value || !selectedId.value ? await saveAsVersion() : selectedId.value
    await Submission.create(props.taskId, { ...code }, id, reflection)
    markMessageSubmitted(id)
    const n = versions.value.find((v) => v.id === id)?.n
    message.success(n ? `已提交 v${n}` : "已提交")
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "提交失败，请重试")
    throw err
  } finally {
    busy.value = false
  }
}

async function savePasted(prompt: string, c: Code) {
  Object.assign(code, c)
  try {
    await saveAsVersion(prompt)
    message.success("已存为新版本")
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "保存失败，请重试")
    throw err
  }
}

async function format() {
  try {
    Object.assign(code, await formatCode({ ...code }))
  } catch (err: any) {
    dialog.error({
      title: "整理失败，代码里可能有语法错误",
      content: () => h(NCode, { code: err.message }),
      style: { width: "auto" },
    })
  }
}

function clear() {
  dialog.warning({
    title: "清空代码？",
    content: "只清空编辑器里的代码，已经存下的版本不受影响。",
    positiveText: "清空",
    negativeText: "取消",
    onPositiveClick: () => {
      Object.assign(code, emptyCode())
    },
  })
}

// 和 PromptPanel 里的模型选择是同一个存储
const model = useStorage("prompt-model", "deepseek-flash")

defineExpose({
  // 页面自己发提示词（自由创作的“用这个主题生成”）
  async send(text: string) {
    await beforeSend()
    sendPrompt(text, model.value)
  },
  // 页面用来放入示例代码，或自由创作从服务器读到的作品
  setCode(c: Code) {
    Object.assign(code, c)
    selectedId.value = matchVersion()
  },
  restored,
})
</script>
<style scoped>
.workbench {
  height: 100%;
}

.left,
.right {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--wp-surface);
}

.left {
  border-right: 1px solid var(--wp-line);
}

.left-head {
  height: 43px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid var(--wp-line);
}

.title {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.spacer {
  flex: 1;
}

.brief {
  flex: none;
  border-bottom: 1px solid var(--wp-line);
}

.brief-toggle {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border: 0;
  background: var(--wp-paper);
  color: var(--wp-ink);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.brief-toggle span {
  color: var(--wp-muted);
  font-size: 12px;
}

.brief-toggle:focus-visible {
  outline: 2px solid var(--wp-brand);
  outline-offset: -2px;
}

.brief-body {
  max-height: 42vh;
  overflow-y: auto;
}

.chat {
  flex: 1;
  min-height: 0;
}

.right-body {
  flex: 1;
  min-height: 0;
}

.preview-only {
  height: 100%;
}

.mode {
  margin: 0 8px;
}
</style>
