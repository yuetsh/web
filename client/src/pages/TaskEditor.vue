<template>
  <div class="editor-page">
    <aside class="list">
      <div class="list-head">
        <b>{{ kindLabel }}</b>
        <n-button size="small" @click="createNew">
          <template #icon><Icon icon="lucide:plus" /></template>
          新建
        </n-button>
      </div>
      <div class="items">
        <div
          v-for="item in list"
          :key="item.display"
          :class="['item', { on: item.display === form.display, draft: !item.is_public }]"
          @click="show(item.display)"
        >
          <n-tooltip>
            <template #trigger>
              <n-button text @click.stop="togglePublic(item.display)">
                <Icon :icon="item.is_public ? 'lucide:globe' : 'lucide:lock'" :width="16" />
              </n-button>
            </template>
            {{ item.is_public ? "已公开，点击设为不公开" : "未公开，点击公开" }}
          </n-tooltip>
          <span class="item-title">{{ item.display }}. {{ item.title }}</span>
          <span v-if="kind === 'challenge'" class="item-score">{{ item.score }}分</span>
          <n-tooltip>
            <template #trigger>
              <n-button text class="item-del" @click.stop="remove(item.display)">
                <Icon icon="lucide:trash-2" :width="14" />
              </n-button>
            </template>
            删除
          </n-tooltip>
        </div>
      </div>
    </aside>

    <main class="form">
      <n-form inline :show-feedback="false" class="fields">
        <n-form-item label="序号" label-placement="left">
          <n-input-number style="width: 96px" v-model:value="form.display" />
        </n-form-item>
        <n-form-item label="标题" label-placement="left">
          <n-input v-model:value="form.title" style="width: 220px" />
        </n-form-item>
        <n-form-item v-if="kind === 'challenge'" label="分数" label-placement="left">
          <n-input-number style="width: 96px" v-model:value="form.score" :min="0" />
        </n-form-item>
        <n-form-item label="公开" label-placement="left">
          <n-switch v-model:value="form.is_public" />
        </n-form-item>
        <n-form-item v-if="kind === 'challenge'" label="出题人" label-placement="left">
          <n-text depth="3">{{ form.author_name || "未设置" }}</n-text>
        </n-form-item>
      </n-form>
      <n-flex align="center" class="actions">
        <n-button type="primary" :disabled="!canSave" :loading="saving" @click="save">
          保存
        </n-button>
        <TaskAssetManager v-if="form.display" :task-type="kind" :display="form.display" />
        <n-button v-if="form.display" @click="showExampleModal = true">示例代码</n-button>
        <n-text depth="3" class="hint">{{ exampleHint }}</n-text>
      </n-flex>
      <MarkdownEditor class="md" v-model="form.content" />
    </main>
  </div>

  <n-modal
    v-model:show="showExampleModal"
    preset="card"
    :title="`示例代码（${exampleHint}）`"
    style="width: 640px"
  >
    <n-input
      type="textarea"
      v-model:value="rawCode"
      placeholder="粘贴完整的网页代码，会自动拆成 HTML / CSS / JS"
      :autosize="{ minRows: 10, maxRows: 30 }"
    />
    <n-flex v-if="splitResult" style="margin-top: 8px">
      <n-tag size="small" type="success">HTML · {{ splitResult.html.length }} 字符</n-tag>
      <n-tag size="small" type="info">CSS · {{ splitResult.css.length }} 字符</n-tag>
      <n-tag size="small" type="warning">JS · {{ splitResult.js.length }} 字符</n-tag>
    </n-flex>
    <template #footer>
      <n-text depth="3">关掉窗口后点“保存”才会存下来。</n-text>
    </template>
  </n-modal>
</template>
<script lang="ts" setup>
import { computed, onMounted, reactive, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { useDialog, useMessage } from "naive-ui"
import { Icon } from "../icons"
import { Challenge, Tutorial } from "../api"
import { splitHtml, type Code } from "../utils/code"
import MarkdownEditor from "../components/dashboard/MarkdownEditor.vue"
import TaskAssetManager from "../components/task/TaskAssetManager.vue"

// 教程和挑战的出题页（以前是两个几乎一样的文件）
const props = defineProps<{ kind: "tutorial" | "challenge" }>()

const route = useRoute()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()

const api = props.kind === "tutorial" ? Tutorial : Challenge
const kindLabel = props.kind === "tutorial" ? "教程" : "挑战"
const routeName = props.kind === "tutorial" ? "tutorial-editor" : "challenge-editor"
const exampleHint =
  props.kind === "tutorial" ? "打开这一节教程时自动放进编辑器" : "学生点“放入示例代码”时使用"

interface ListItem {
  display: number
  title: string
  is_public: boolean
  score?: number
}

const list = ref<ListItem[]>([])
const saving = ref(false)
const showExampleModal = ref(false)
const rawCode = ref("")
const splitResult = ref<Code | null>(null)

const blank = () => ({
  display: 0,
  title: "",
  content: "",
  score: 0,
  is_public: false,
  author_name: "",
  example_html: null as string | null,
  example_css: null as string | null,
  example_js: null as string | null,
})
const form = reactive(blank())

const canSave = computed(() => !!(form.display && form.title && form.content))

watch(rawCode, (val) => {
  if (!val.trim()) {
    splitResult.value = null
    Object.assign(form, { example_html: null, example_css: null, example_js: null })
    return
  }
  const split = splitHtml(val)
  splitResult.value = split
  form.example_html = split.html || null
  form.example_css = split.css || null
  form.example_js = split.js || null
})

watch(showExampleModal, (visible) => {
  if (!visible) return
  const parts: string[] = []
  if (form.example_css) parts.push(`<style>\n${form.example_css}\n</style>`)
  if (form.example_html) parts.push(form.example_html)
  if (form.example_js) parts.push(`<script>\n${form.example_js}\n<\/script>`)
  rawCode.value = parts.join("\n\n")
})

async function loadList() {
  list.value = await api.list()
}

async function show(display: number) {
  router.replace({ name: routeName, params: { display } })
  const item: any = await api.get(display)
  Object.assign(form, blank(), {
    display: item.display,
    title: item.title,
    content: item.content,
    score: item.score ?? 0,
    is_public: item.is_public,
    author_name: item.author_name ?? "",
    example_html: item.example_html ?? null,
    example_css: item.example_css ?? null,
    example_js: item.example_js ?? null,
  })
}

function createNew() {
  // 列表按序号升序，新的接在最后
  Object.assign(form, blank(), {
    display: (list.value[list.value.length - 1]?.display ?? 0) + 1,
  })
}

async function save() {
  saving.value = true
  try {
    const res = await api.createOrUpdate(form as any)
    message.success(res?.message ?? "已保存")
    await loadList()
    // 保存后留在这一项上，方便接着改
    await show(form.display)
  } catch (error: any) {
    message.error(error.response?.data?.detail ?? "保存失败")
  } finally {
    saving.value = false
  }
}

function remove(display: number) {
  const item = list.value.find((i) => i.display === display)
  dialog.warning({
    title: `删除${kindLabel}「${item?.title ?? display}」？`,
    content: "学生在这个任务上的提交和对话也会一起删除，不能恢复。",
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      await api.remove(display)
      message.success("已删除")
      await loadList()
      if (form.display === display) {
        if (list.value.length) show(list.value[0]!.display)
        else createNew()
      }
    },
  })
}

async function togglePublic(display: number) {
  const data = await api.togglePublic(display)
  message.success(data.message)
  const item = list.value.find((i) => i.display === display)
  if (item) item.is_public = !item.is_public
  if (form.display === display) form.is_public = !form.is_public
}

onMounted(async () => {
  await loadList()
  const display = Number(route.params.display)
  if (list.value.some((item) => item.display === display)) show(display)
  else if (list.value.length) show(list.value[0]!.display)
  else createNew()
})
</script>
<style scoped>
.editor-page {
  height: 100%;
  display: flex;
  min-width: 0;
}

.list {
  width: 280px;
  flex: none;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--wp-line);
  min-height: 0;
}

.list-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--wp-line);
}

.items {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
}

.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.item:hover {
  background: var(--wp-paper);
}

.item.on {
  background: var(--wp-brand-soft);
  color: var(--wp-brand);
}

.item.draft .item-title {
  color: var(--wp-muted);
}

.item-title {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-score {
  font: 12px var(--wp-font-mono);
  color: var(--wp-warn);
}

.item-del {
  opacity: 0;
}

.item:hover .item-del,
.item-del:focus-visible {
  opacity: 1;
}

.form {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  min-height: 0;
}

.fields {
  flex-wrap: wrap;
  row-gap: 8px;
}

.hint {
  font-size: 12px;
}

.md {
  flex: 1;
  min-height: 0;
}
</style>
