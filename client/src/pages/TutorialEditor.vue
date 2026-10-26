<template>
  <n-grid x-gap="10" :cols="8">
    <n-gi :span="2" class="col">
      <n-flex vertical class="list">
        <n-card
          v-for="item in list"
          :key="item.display"
          @click="show(item.display)"
          class="card"
          :header-style="{
            backgroundColor:
              item.display === tutorial.display ? 'rgba(24, 160, 80, 0.1)' : '',
          }"
          :embedded="!item.is_public"
        >
          <template #header>
            <n-flex align="center">
              <n-button text @click.stop="togglePublic(item.display)">
                <Icon
                  width="24"
                  :icon="
                    item.is_public
                      ? 'twemoji:check-mark-button'
                      : 'twemoji:locked'
                  "
                ></Icon>
              </n-button>
              <span>【{{ item.display }}】{{ item.title }}</span>
            </n-flex>
          </template>
          <template #header-extra>
            <n-button text type="default" @click="remove(item.display)">
              <Icon width="20" icon="material-symbols:close-rounded"></Icon>
            </n-button>
          </template>
        </n-card>
        <n-button @click="createNew">新建</n-button>
      </n-flex>
    </n-gi>

    <n-gi :span="6" class="col">
      <n-flex vertical>
        <n-form inline :show-feedback="false">
          <n-form-item label="序号" label-placement="left">
            <n-input-number
              style="width: 100px"
              v-model:value="tutorial.display"
            />
          </n-form-item>

          <n-form-item label="标题" label-placement="left">
            <n-input v-model:value="tutorial.title" />
          </n-form-item>

          <n-form-item label="公开" label-placement="left">
            <n-switch v-model:value="tutorial.is_public" />
          </n-form-item>
          <n-form-item label-placement="left">
            <n-button type="primary" @click="submit" :disabled="!canSubmit">
              提交
            </n-button>
          </n-form-item>
        </n-form>
        <n-flex>
          <TaskAssetManager
            v-if="tutorial.display"
            task-type="tutorial"
            :display="tutorial.display"
          />
          <n-button
            v-if="tutorial.display"
            size="small"
            @click="showExampleModal = true"
          >
            示例代码
          </n-button>
        </n-flex>
        <MarkdownEditor
          style="height: calc(100vh - 100px)"
          v-model="tutorial.content"
        />
      </n-flex>
    </n-gi>
  </n-grid>

  <n-modal
    v-model:show="showExampleModal"
    preset="card"
    title="示例代码（加载教程时自动填入编辑器）"
    style="width: 640px"
  >
    <n-input
      type="textarea"
      v-model:value="rawCode"
      placeholder="粘贴完整的前端代码，自动拆分为 HTML / CSS / JS..."
      :autosize="{ minRows: 10, maxRows: 30 }"
    />
    <n-flex v-if="splitResult" style="margin-top: 8px">
      <n-tag size="small" type="success">HTML · {{ splitResult.html.length }} 字符</n-tag>
      <n-tag size="small" type="info">CSS · {{ splitResult.css.length }} 字符</n-tag>
      <n-tag size="small" type="warning">JS · {{ splitResult.js.length }} 字符</n-tag>
    </n-flex>
  </n-modal>
</template>
<script lang="ts" setup>
import { computed, onMounted, reactive, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { Icon } from "@iconify/vue"
import { Tutorial } from "../api"
import type { TutorialSlim } from "../utils/type"
import { useDialog, useMessage } from "naive-ui"
import MarkdownEditor from "../components/dashboard/MarkdownEditor.vue"
import TaskAssetManager from "../components/task/TaskAssetManager.vue"

const route = useRoute()
const router = useRouter()
const message = useMessage()
const confirm = useDialog()

const list = ref<TutorialSlim[]>([])
const showExampleModal = ref(false)
const rawCode = ref("")
const splitResult = ref<{ html: string; css: string; js: string } | null>(null)

function splitHtml(raw: string) {
  let result = raw
  const cssBlocks: string[] = []
  const jsBlocks: string[] = []
  result = result.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, c) => {
    cssBlocks.push(c.trim())
    return ""
  })
  result = result.replace(
    /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi,
    (_, c) => {
      jsBlocks.push(c.trim())
      return ""
    },
  )
  return {
    html: result.trim(),
    css: cssBlocks.join("\n\n"),
    js: jsBlocks.join("\n\n"),
  }
}

watch(rawCode, (val) => {
  if (!val.trim()) {
    splitResult.value = null
    tutorial.example_html = null
    tutorial.example_css = null
    tutorial.example_js = null
    return
  }
  const split = splitHtml(val)
  splitResult.value = split
  tutorial.example_html = split.html || null
  tutorial.example_css = split.css || null
  tutorial.example_js = split.js || null
})

watch(showExampleModal, (visible) => {
  if (!visible) return
  const parts: string[] = []
  if (tutorial.example_css) parts.push(`<style>\n${tutorial.example_css}\n</style>`)
  if (tutorial.example_html) parts.push(tutorial.example_html)
  if (tutorial.example_js) parts.push(`<script>\n${tutorial.example_js}\n<\/script>`)
  rawCode.value = parts.join("\n\n")
})
const tutorial = reactive({
  display: 0,
  title: "",
  content: "",
  is_public: false,
  example_html: null as string | null,
  example_css: null as string | null,
  example_js: null as string | null,
})

const canSubmit = computed(
  () => tutorial.display && tutorial.title && tutorial.content,
)
async function getContent() {
  list.value = await Tutorial.list()
  const display = Number(route.params.display)
  const target = list.value.find((item) => item.display === display)
  if (target) {
    show(display)
  } else if (list.value.length > 0) {
    show(list.value[0]!.display)
  }
}

function createNew() {
  tutorial.display = list.value[list.value.length - 1]?.display ?? 0 + 1
  tutorial.title = ""
  tutorial.content = ""
  tutorial.is_public = false
  tutorial.example_html = null
  tutorial.example_css = null
  tutorial.example_js = null
}

async function submit() {
  try {
    await Tutorial.createOrUpdate(tutorial)
    message.success("提交成功")
    tutorial.display = 0
    tutorial.title = ""
    tutorial.content = ""
    tutorial.is_public = false
    tutorial.example_html = null
    tutorial.example_css = null
    tutorial.example_js = null
    await getContent()
  } catch (error: any) {
    message.error(error.response.data.detail)
  }
}

async function remove(display: number) {
  confirm.warning({
    title: "警告",
    content: "你确定要删除吗？",
    positiveText: "确定",
    negativeText: "取消",
    onPositiveClick: async () => {
      await Tutorial.remove(display)
      message.success("删除成功")
      getContent()
    },
  })
}

async function show(display: number) {
  router.push({ name: "tutorial-editor", params: { display } })
  const item = await Tutorial.get(display)
  tutorial.display = item.display
  tutorial.title = item.title
  tutorial.content = item.content
  tutorial.is_public = item.is_public
  tutorial.example_html = item.example_html ?? null
  tutorial.example_css = item.example_css ?? null
  tutorial.example_js = item.example_js ?? null
}

async function togglePublic(display: number) {
  const data = await Tutorial.togglePublic(display)
  message.success(data.message)
  list.value = list.value.map((item) => {
    if (item.display === display) item.is_public = !item.is_public
    return item
  })
}

onMounted(getContent)
</script>
<style scoped>
.list {
  overflow: auto;
  height: calc(100vh - 20px);
}

.col {
  padding-top: 10px;
}

.card {
  cursor: pointer;
}

.editor {
  height: calc(100vh - 200px);
}
</style>
