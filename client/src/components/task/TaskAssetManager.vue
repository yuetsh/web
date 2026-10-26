<template>
  <n-flex vertical>
    <n-button size="small" @click="showUpload = true">图片素材</n-button>
    <n-flex v-if="assets.length" wrap>
      <n-card
        v-for="asset in assets"
        :key="asset.name"
        size="small"
        style="width: 120px"
      >
        <template #cover>
          <n-image
            :src="asset.url"
            style="width: 100%; height: 100px; object-fit: contain"
          />
        </template>
        <n-flex align="center" justify="space-between">
          <n-text style="font-size: 12px; word-break: break-all">
            {{ asset.name }}
          </n-text>
          <n-button
            size="tiny"
            quaternary
            type="error"
            @click="remove(asset.name)"
          >
            <template #icon>
              <Icon icon="material-symbols:close-rounded" />
            </template>
          </n-button>
        </n-flex>
      </n-card>
    </n-flex>

    <n-modal
      v-model:show="showUpload"
      preset="card"
      title="上传素材"
      style="width: 400px"
    >
      <n-form>
        <n-form-item label="文件名（如 1.png）">
          <n-input v-model:value="uploadName" placeholder="1.png" />
        </n-form-item>
        <n-form-item label="选择文件">
          <n-upload :max="1" @change="onFileChange" :default-upload="false">
            <n-button>选择文件</n-button>
          </n-upload>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-flex justify="end">
          <n-button @click="showUpload = false">取消</n-button>
          <n-button
            type="primary"
            :disabled="!uploadName || !uploadFile"
            :loading="uploading"
            @click="upload"
          >
            上传
          </n-button>
        </n-flex>
      </template>
    </n-modal>
  </n-flex>
</template>

<script lang="ts" setup>
import { ref, watch } from "vue"
import { Icon } from "@iconify/vue"
import { useMessage } from "naive-ui"
import type { UploadFileInfo } from "naive-ui"
import { TaskAssets } from "../../api"
import type { TaskAsset } from "../../utils/type"

const props = defineProps<{
  taskType: "challenge" | "tutorial"
  display: number
}>()

const message = useMessage()
const assets = ref<TaskAsset[]>([])
const showUpload = ref(false)
const uploadName = ref("")
const uploadFile = ref<File | null>(null)
const uploading = ref(false)

async function load() {
  if (!props.display) return
  try {
    assets.value =
      props.taskType === "challenge"
        ? await TaskAssets.listChallenge(props.display)
        : await TaskAssets.listTutorial(props.display)
  } catch {
    assets.value = []
  }
}

function onFileChange({ file }: { file: UploadFileInfo }) {
  if (file.status === "pending") {
    uploadFile.value = file.file ?? null
  }
}

async function upload() {
  if (!uploadName.value || !uploadFile.value) return
  uploading.value = true
  try {
    const asset =
      props.taskType === "challenge"
        ? await TaskAssets.uploadChallenge(
            props.display,
            uploadName.value,
            uploadFile.value,
          )
        : await TaskAssets.uploadTutorial(
            props.display,
            uploadName.value,
            uploadFile.value,
          )
    const idx = assets.value.findIndex((a) => a.name === asset.name)
    if (idx >= 0) assets.value[idx] = asset
    else assets.value.push(asset)
    message.success(`${asset.name} 上传成功`)
    showUpload.value = false
    uploadName.value = ""
    uploadFile.value = null
  } catch (err: any) {
    message.error(err?.response?.data?.detail ?? "上传失败")
  } finally {
    uploading.value = false
  }
}

async function remove(name: string) {
  try {
    props.taskType === "challenge"
      ? await TaskAssets.deleteChallenge(props.display, name)
      : await TaskAssets.deleteTutorial(props.display, name)
    assets.value = assets.value.filter((a) => a.name !== name)
    message.success("删除成功")
  } catch (err: any) {
    message.error(err?.response?.data?.detail ?? "删除失败")
  }
}

watch(() => props.display, load, { immediate: true })
</script>
