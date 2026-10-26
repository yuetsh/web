<template>
  <div class="editors-root">
    <n-tabs
      :value="tab"
      :class="`tab-active-${tab}`"
      pane-class="pane"
      style="height: 100%"
      type="card"
      @update:value="changeTab"
    >
      <n-tab-pane name="html" tab="HTML">
        <template #tab>
          <n-flex align="center">
            <Icon :width="20" icon="skill-icons:html"></Icon>
            <span>HTML</span>
          </n-flex>
        </template>
        <Editor v-model:value="html" :font-size="size" language="html" />
      </n-tab-pane>
      <n-tab-pane name="css" tab="CSS">
        <template #tab>
          <n-flex align="center">
            <Icon :width="20" icon="skill-icons:css"></Icon>
            <span>CSS</span>
          </n-flex>
        </template>
        <Editor v-model:value="css" :font-size="size" language="css" />
      </n-tab-pane>
      <n-tab-pane name="js" tab="JS">
        <template #tab>
          <n-flex align="center">
            <Icon :width="20" icon="skill-icons:javascript"></Icon>
            <span>JS</span>
          </n-flex>
        </template>
        <Editor v-model:value="js" :font-size="size" language="js" />
      </n-tab-pane>
      <n-tab-pane name="actions" tab="选项">
        <template #tab>
          <n-flex align="center">
            <Icon :width="20" icon="skill-icons:actix-dark"></Icon>
            <span>选项</span>
          </n-flex>
        </template>
        <n-flex class="wrapper" vertical>
          <n-flex align="center">
            <span class="label">重置</span>
            <n-button @click="reset('html')">HTML</n-button>
            <n-button @click="reset('css')">CSS</n-button>
            <n-button @click="reset('js')">JS</n-button>
          </n-flex>
          <n-flex align="center">
            <span class="label">字号</span>
            <n-flex align="center">
              <span :style="{ 'font-size': size + 'px' }">{{ size }}</span>
              <n-button :disabled="size === 20" @click="changeSize(size - 2)">
                调小
              </n-button>
              <n-button :disabled="size === 40" @click="changeSize(size + 2)">
                调大
              </n-button>
            </n-flex>
          </n-flex>
          <n-flex align="center">
            <span class="label">预加载</span>
            <n-tag type="success">Normalize.css</n-tag>
          </n-flex>
        </n-flex>
      </n-tab-pane>
      <template #suffix>
        <Toolbar
          :submit-loading="submitLoading"
          @format="format"
          @submit="formatAndSubmit"
        />
      </template>
    </n-tabs>
  </div>
</template>
<script lang="ts" setup>
import { Icon } from "@iconify/vue"
import prettier from "prettier/standalone"
import * as htmlParser from "prettier/parser-html"
import * as cssParser from "prettier/parser-postcss"
import * as babelParser from "prettier/parser-babel"
import * as estreeParser from "prettier/plugins/estree"
import Editor from "./Editor.vue"
import Toolbar from "./Toolbar.vue"
import { html, css, js, tab, size, reset } from "../../store/editors"
import { taskId } from "../../store/task"
import { Submission } from "../../api"
import { NCode, useDialog, useMessage } from "naive-ui"
import { h, ref } from "vue"

const dialog = useDialog()
const message = useMessage()
const submitLoading = ref(false)

function changeTab(name: string) {
  tab.value = name
}

function changeSize(num: number) {
  size.value = num
}

async function formatCode() {
  const [htmlFormatted, cssFormatted, jsFormatted] = await Promise.all([
    prettier.format(html.value, {
      parser: "html",
      //@ts-ignore
      plugins: [htmlParser, babelParser, estreeParser, cssParser],
      tabWidth: 4,
    }),
    prettier.format(css.value, {
      parser: "css",
      plugins: [cssParser],
      tabWidth: 4,
    }),
    prettier.format(js.value, {
      parser: "babel",
      //@ts-ignore
      plugins: [babelParser, estreeParser],
      tabWidth: 2,
    }),
  ])
  html.value = htmlFormatted
  css.value = cssFormatted
  js.value = jsFormatted
}

async function format() {
  try {
    await formatCode()
  } catch (err: any) {
    dialog.error({
      title: "格式化失败",
      content: () => h(NCode, { code: err.message }),
      style: { width: "auto" },
    })
  }
}

async function doSubmit() {
  try {
    await Submission.create(taskId.value, {
      html: html.value,
      css: css.value,
      js: js.value,
    })
    message.success("提交成功")
  } catch (err) {
    message.error("提交失败")
  }
}

async function formatAndSubmit() {
  submitLoading.value = true
  try {
    await formatCode()
    await doSubmit()
  } catch (err: any) {
    dialog.warning({
      title: "代码整理失败",
      content: () => h(NCode, { code: err.message }),
      positiveText: "忽略并提交",
      negativeText: "取消",
      style: { width: "auto" },
      onPositiveClick: async () => {
        await doSubmit()
      },
    })
  } finally {
    submitLoading.value = false
  }
}
</script>
<style scoped>
.pane {
  height: 100%;
  overflow: auto;
}

.wrapper {
  padding-left: 16px;
}

.label {
  font-size: 16px;
}

:deep(.n-tabs-nav .n-tabs-tab[data-name="html"]) {
  background-color: #fff6f3 !important;
}
:deep(.n-tabs-nav .n-tabs-tab[data-name="css"]) {
  background-color: #f3f6ff !important;
}
:deep(.n-tabs-nav .n-tabs-tab[data-name="js"]) {
  background-color: #fffdf0 !important;
}

.editors-root {
  height: 100%;
}

:deep(.tab-active-html .n-tab-pane) {
  background-color: #fff6f3;
}
:deep(.tab-active-css .n-tab-pane) {
  background-color: #f3f6ff;
}
:deep(.tab-active-js .n-tab-pane) {
  background-color: #fffdf0;
}
</style>
