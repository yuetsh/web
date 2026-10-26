<template>
  <Workbench
    ref="wb"
    kind="creation"
    :task-id="taskId"
    :title="title || '自由创作'"
    back-label="返回我的创作"
    :back-to="{ name: 'creation-list' }"
    brief-label="我的主题"
    :save-work="saveWork"
  >
    <template #brief>
      <div class="topic">
        <n-form-item label="主题名称" :show-feedback="false">
          <n-input
            v-model:value="title"
            placeholder="给你的主题起个名字"
            maxlength="100"
          />
        </n-form-item>
        <n-form-item label="主题描述" :show-feedback="false" style="margin-top: 10px">
          <n-input
            v-model:value="content"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 10 }"
            placeholder="想做一个什么样的页面？有哪些颜色、布局、交互？"
          />
        </n-form-item>
        <n-flex style="margin-top: 12px">
          <n-button
            size="small"
            :loading="savingTopic"
            :disabled="!title.trim()"
            @click="saveTopic"
          >
            保存主题
          </n-button>
          <n-button
            size="small"
            type="primary"
            :disabled="!content.trim() || streaming"
            @click="generate"
          >
            用这个主题生成
          </n-button>
        </n-flex>
        <n-text depth="3" class="hint">
          自由创作只属于你自己，不会进入提交记录和评分。
        </n-text>
      </div>
    </template>
  </Workbench>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, useTemplateRef } from "vue"
import { useRoute } from "vue-router"
import { useMessage } from "naive-ui"
import Workbench from "../components/workbench/Workbench.vue"
import { Creation } from "../api"
import { streaming } from "../store/prompt"
import type { Code } from "../utils/code"

const route = useRoute()
const message = useMessage()
const wb = useTemplateRef<InstanceType<typeof Workbench>>("wb")

const display = Number(route.params.display)
const taskId = ref(0)
const title = ref("")
const content = ref("")
const savingTopic = ref(false)

// 加载还没完成就离开页面时，不要再改状态
let disposed = false

async function load() {
  const data = await Creation.get(display)
  if (disposed) return
  title.value = data.title
  content.value = data.content
  taskId.value = data.task_id
  // 本地没有存着修改到一半的代码，就用服务器上保存的作品
  if (!wb.value?.restored) {
    wb.value?.setCode({ html: data.html, css: data.css, js: data.js })
  }
}

async function saveWork(code: Code) {
  await Creation.saveCode(display, code)
}

async function saveTopic() {
  if (!title.value.trim()) return
  savingTopic.value = true
  try {
    await Creation.update(display, {
      title: title.value.trim(),
      content: content.value,
    })
    message.success("主题已保存")
  } catch {
    message.error("保存失败，请重试")
  } finally {
    savingTopic.value = false
  }
}

function generate() {
  const text = content.value.trim()
  if (!text || streaming.value) return
  wb.value?.send(text)
}

onMounted(load)
onUnmounted(() => {
  disposed = true
})
</script>

<style scoped>
.topic {
  padding: 12px;
}

.hint {
  display: block;
  margin-top: 10px;
  font-size: 12px;
}
</style>
