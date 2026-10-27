<template>
  <n-button @click="show = true">
    图片素材{{ assets.length ? `（${assets.length}）` : "" }}
  </n-button>

  <n-modal v-model:show="show" preset="card" title="图片素材" style="width: min(720px, 92vw)">
    <p class="hint">
      题目和学生的网页里直接写文件名就能用，例如
      <code>&lt;img src="{{ assets[0]?.name ?? "1.png" }}"&gt;</code>。
      上传同名文件会替换原来的。
    </p>

    <label
      :class="['drop', { over: dragging }]"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      <input type="file" accept="image/*" multiple hidden @change="onPick" />
      <Icon icon="lucide:image" :width="22" />
      <span v-if="uploading">正在上传…</span>
      <span v-else>点这里选图片，或者把图片拖进来（可以一次选多张）</span>
    </label>

    <div v-if="assets.length" class="grid">
      <div v-for="a in assets" :key="a.name" class="asset">
        <div class="img">
          <img :src="a.url" :alt="a.name" loading="lazy" />
        </div>
        <div class="name" :title="a.name">{{ a.name }}</div>
        <div class="tools">
          <n-button size="tiny" quaternary @click="copyName(a.name)">复制文件名</n-button>
          <n-popconfirm @positive-click="remove(a.name)">
            <template #trigger>
              <n-button size="tiny" quaternary type="error">删除</n-button>
            </template>
            删除 {{ a.name }}？用到它的网页里图片会显示不出来。
          </n-popconfirm>
        </div>
      </div>
    </div>
    <n-empty v-else description="还没有素材" style="margin: 24px 0 8px" />
  </n-modal>
</template>

<script lang="ts" setup>
import { ref, watch } from "vue"
import { useMessage } from "naive-ui"
import copy from "copy-text-to-clipboard"
import { Icon } from "../../icons"
import { TaskAssets } from "../../api"
import type { TaskAsset } from "../../utils/type"

// 出题页的图片素材：存在 /media/tasks/<类型>/<序号>/ 下，预览时那里是网页的 base 地址
const props = defineProps<{
  taskType: "challenge" | "tutorial"
  display: number
}>()

const message = useMessage()
const assets = ref<TaskAsset[]>([])
const show = ref(false)
const uploading = ref(false)
const dragging = ref(false)

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

// 和服务端的 validFilename 一样：空格换成下划线，只留字母（含中文）、数字和 - _ .
function cleanName(name: string) {
  return name.trim().replaceAll(" ", "_").replace(/[^-\p{L}\p{N}_.]/gu, "").slice(-100)
}

async function uploadAll(files: File[]) {
  const images = files.filter((f) => f.type.startsWith("image/"))
  if (images.length < files.length) message.warning("只能上传图片，其他文件跳过了")
  if (!images.length) return
  uploading.value = true
  let done = 0
  for (const file of images) {
    const name = cleanName(file.name)
    if (!name || name.startsWith(".")) {
      message.error(`文件名“${file.name}”不能用，请改个名字再传`)
      continue
    }
    try {
      const asset =
        props.taskType === "challenge"
          ? await TaskAssets.uploadChallenge(props.display, name, file)
          : await TaskAssets.uploadTutorial(props.display, name, file)
      const i = assets.value.findIndex((a) => a.name === asset.name)
      // 同名替换后浏览器可能还用着旧图的缓存
      const fresh = { ...asset, url: `${asset.url}?t=${Date.now()}` }
      if (i >= 0) assets.value[i] = fresh
      else assets.value.push(fresh)
      done++
    } catch (err: any) {
      message.error(`${name}：${err?.response?.data?.detail ?? "上传失败"}`)
    }
  }
  uploading.value = false
  if (done) message.success(`上传了 ${done} 张`)
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  uploadAll([...(input.files ?? [])])
  input.value = ""
}

function onDrop(e: DragEvent) {
  dragging.value = false
  uploadAll([...(e.dataTransfer?.files ?? [])])
}

function copyName(name: string) {
  copy(name)
  message.success(`已复制 ${name}`)
}

async function remove(name: string) {
  try {
    props.taskType === "challenge"
      ? await TaskAssets.deleteChallenge(props.display, name)
      : await TaskAssets.deleteTutorial(props.display, name)
    assets.value = assets.value.filter((a) => a.name !== name)
    message.success("已删除")
  } catch (err: any) {
    message.error(err?.response?.data?.detail ?? "删除失败")
  }
}

watch(() => props.display, load, { immediate: true })
</script>

<style scoped>
.hint {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--wp-muted);
}

.hint code {
  padding: 1px 5px;
  border-radius: 4px;
  font: 12px var(--wp-font-mono);
  color: var(--wp-ink);
  background: var(--wp-paper);
}

.drop {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 18px;
  border: 1px dashed var(--wp-line);
  border-radius: 8px;
  font-size: 13px;
  color: var(--wp-muted);
  background: var(--wp-paper);
  cursor: pointer;
}

.drop:hover,
.drop.over {
  border-color: var(--wp-brand);
  color: var(--wp-brand);
}

.grid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  max-height: 50vh;
  overflow-y: auto;
}

.asset {
  border: 1px solid var(--wp-line);
  border-radius: 8px;
  overflow: hidden;
}

.img {
  height: 100px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-bottom: 1px solid var(--wp-line);
  /* 透明图片放在浅色底上才看得出边界 */
  background: var(--wp-paper);
}

.img img {
  display: block;
  max-width: 100%;
  max-height: 100px;
}

.name {
  padding: 6px 8px 0;
  font: 12px var(--wp-font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tools {
  display: flex;
  justify-content: space-between;
  padding: 2px 4px 4px;
}
</style>
