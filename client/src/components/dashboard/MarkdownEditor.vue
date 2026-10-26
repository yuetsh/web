<template>
  <MdEditor v-bind="props" v-model="modelValue" @upload-img="uploadImg" />
</template>
<script lang="ts" setup>
import { MdEditor } from "md-editor-v3"
//@ts-ignore
import "md-editor-v3/lib/style.css"
import { Helper } from "../../api"
import { useMessage } from "naive-ui"

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
