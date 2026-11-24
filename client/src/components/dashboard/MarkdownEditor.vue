<template>
  <MdEditor
    v-bind="props"
    v-model="modelValue"
    :theme="isDark ? 'dark' : 'light'"
    code-theme="github"
    no-mermaid
    no-katex
    no-echarts
    :toolbars-exclude="['mermaid', 'katex', 'fullscreen', 'github']"
    @upload-img="uploadImg"
  />
</template>
<script lang="ts" setup>
import { MdEditor, config } from "md-editor-v3"
//@ts-ignore
import "md-editor-v3/lib/style.css"
import hljs from "highlight.js/lib/common"
import * as prettier from "prettier/standalone"
import * as prettierMarkdown from "prettier/plugins/markdown"
import Cropper from "cropperjs"
//@ts-ignore
import "cropperjs/dist/cropper.min.css"
//@ts-ignore
import githubCss from "highlight.js/styles/github.min.css?url"
//@ts-ignore
import githubDarkCss from "highlight.js/styles/github-dark.min.css?url"
import { Helper } from "../../api"
import { useMessage } from "naive-ui"
import { isDark } from "../../store/theme"

// md-editor 默认从 unpkg.com 现拉代码高亮、prettier 等，机房学生机、老师机出不了外网就全挂。
// 用打包进来的；公式、mermaid、echarts 学生那边的 marked 本来就不渲染，编辑器里也关掉。
// 浏览器全屏（screenfull）同理去掉，页面内全屏（pageFullscreen）不依赖外部脚本。
config({
  editorExtensions: {
    highlight: {
      instance: hljs,
      css: { github: { light: githubCss, dark: githubDarkCss } },
    },
    prettier: {
      prettierInstance: prettier,
      parserMarkdownInstance: prettierMarkdown,
    },
    // 图片「裁剪上传」用；编辑器一打开就会去拉，不给就是 unpkg
    cropper: { instance: Cropper },
  },
})

const message = useMessage()

const modelValue = defineModel<string>()

const props = defineProps()

const uploadImg = async (files: File[], callback: (urls: string[]) => void) => {
  try {
    const res = await Promise.all(
      files.map(async (file) => {
        const path = await Helper.upload(file)
        if (!path) {
          message.error("图片上传失败")
          return ""
        }
        return path
      }),
    )
    callback(res.filter((url) => url !== ""))
  } catch (err) {
    message.error("图片上传失败")
    callback([])
  }
}
</script>
