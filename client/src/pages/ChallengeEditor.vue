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
              item.display === challenge.display
                ? 'rgba(24, 160, 80, 0.1)'
                : '',
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
              <n-tag size="small" type="warning">{{ item.score }}分</n-tag>
              <n-tag size="small">出题人 {{ item.author_name || "未设置" }}</n-tag>
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
              v-model:value="challenge.display"
            />
          </n-form-item>

          <n-form-item label="标题" label-placement="left">
            <n-input v-model:value="challenge.title" />
          </n-form-item>

          <n-form-item label="分数" label-placement="left">
            <n-input-number
              style="width: 100px"
              v-model:value="challenge.score"
              :min="0"
            />
          </n-form-item>

          <n-form-item label="公开" label-placement="left">
            <n-switch v-model:value="challenge.is_public" />
          </n-form-item>
          <n-form-item label="出题人" label-placement="left">
            <n-text depth="3">{{ challenge.author_name || "未设置" }}</n-text>
          </n-form-item>
          <n-form-item label-placement="left">
            <n-button type="primary" @click="submit" :disabled="!canSubmit">
              提交
            </n-button>
          </n-form-item>
        </n-form>
        <n-flex>
          <TaskAssetManager
            v-if="challenge.display"
            task-type="challenge"
            :display="challenge.display"
          />
          <n-button
            v-if="challenge.display"
            size="small"
            @click="showExampleModal = true"
          >
            示例代码
          </n-button>
        </n-flex>
        <MarkdownEditor
          style="height: calc(100vh - 100px)"
          v-model="challenge.content"
        />
      </n-flex>
    </n-gi>
  </n-grid>

  <n-modal
    v-model:show="showExampleModal"
    preset="card"
    title="示例代码（点击「看示例」时显示效果）"
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
import { Challenge } from "../api"
import type { ChallengeSlim } from "../utils/type"
import { useDialog, useMessage } from "naive-ui"
import MarkdownEditor from "../components/dashboard/MarkdownEditor.vue"
import TaskAssetManager from "../components/task/TaskAssetManager.vue"

const route = useRoute()
const router = useRouter()
const message = useMessage()
const confirm = useDialog()

const list = ref<ChallengeSlim[]>([])
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
    challenge.example_html = null
    challenge.example_css = null
    challenge.example_js = null
    return
  }
  const split = splitHtml(val)
  splitResult.value = split
  challenge.example_html = split.html || null
  challenge.example_css = split.css || null
  challenge.example_js = split.js || null
})

watch(showExampleModal, (visible) => {
  if (!visible) return
  const parts: string[] = []
  if (challenge.example_css) parts.push(`<style>\n${challenge.example_css}\n</style>`)
  if (challenge.example_html) parts.push(challenge.example_html)
  if (challenge.example_js) parts.push(`<script>\n${challenge.example_js}\n<\/script>`)
  rawCode.value = parts.join("\n\n")
})
const challenge = reactive({
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

const canSubmit = computed(
  () => challenge.display && challenge.title && challenge.content,
)
async function getContent() {
  list.value = await Challenge.list()
  const display = Number(route.params.display)
  const target = list.value.find((item) => item.display === display)
  if (target) {
    show(display)
  } else if (list.value.length > 0) {
    show(list.value[0].display)
  }
}

function createNew() {
  challenge.display = list.value[list.value.length - 1]?.display ?? 0 + 1
  challenge.title = ""
  challenge.content = ""
  challenge.score = 0
  challenge.is_public = false
  challenge.author_name = ""
  challenge.example_html = null
  challenge.example_css = null
  challenge.example_js = null
}

async function submit() {
  try {
    await Challenge.createOrUpdate(challenge)
    message.success("提交成功")
    challenge.display = 0
    challenge.title = ""
    challenge.content = ""
    challenge.score = 0
    challenge.is_public = false
    challenge.author_name = ""
    challenge.example_html = null
    challenge.example_css = null
    challenge.example_js = null
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
      await Challenge.remove(display)
      message.success("删除成功")
      getContent()
    },
  })
}

async function show(display: number) {
  router.push({ name: "challenge-editor", params: { display } })
  const item = await Challenge.get(display)
  challenge.display = item.display
  challenge.title = item.title
  challenge.content = item.content
  challenge.score = item.score
  challenge.is_public = item.is_public
  challenge.author_name = item.author_name ?? ""
  challenge.example_html = item.example_html ?? null
  challenge.example_css = item.example_css ?? null
  challenge.example_js = item.example_js ?? null
}

async function togglePublic(display: number) {
  const data = await Challenge.togglePublic(display)
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
