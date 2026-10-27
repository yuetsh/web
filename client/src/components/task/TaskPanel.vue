<template>
  <div class="container">
    <n-flex align="center" justify="space-between" class="title" :wrap="false">
      <n-flex align="center" :wrap="false">
        <span class="panel-name">教程</span>
        <template v-if="!hideNav">
          <n-tooltip>
            <template #trigger>
              <n-button text @click="prev()" :disabled="prevDisabled()">
                <Icon :width="18" icon="lucide:arrow-left" />
              </n-button>
            </template>
            上一节
          </n-tooltip>
          <span v-if="progressText" class="progress-text">
            {{ progressText }}
          </span>
          <n-tooltip>
            <template #trigger>
              <n-button text @click="next()" :disabled="nextDisabled()">
                <Icon :width="18" icon="lucide:arrow-right" />
              </n-button>
            </template>
            下一节
          </n-tooltip>
        </template>
      </n-flex>
      <n-flex align="center" :wrap="false">
        <n-button
          v-if="tutorialAssets.length && taskTab === TASK_TYPE.Tutorial"
          size="small"
          quaternary
          @click="showAssets = true"
        >
          <template #icon><Icon icon="lucide:image" /></template>
          素材
        </n-button>
        <n-button
          v-if="authed && taskTab === TASK_TYPE.Tutorial && taskId"
          size="small"
          quaternary
          @click="showPeers = true"
        >
          作品
        </n-button>
        <n-button v-if="roleSuper" size="small" quaternary @click="edit">
          <template #icon><Icon icon="lucide:edit" /></template>
          编辑
        </n-button>
        <n-tooltip>
          <template #trigger>
            <n-button text @click="$emit('hide')">
              <Icon :width="18" icon="lucide:x" />
            </n-button>
          </template>
          收起教程，编辑器占满屏幕
        </n-tooltip>
      </n-flex>
    </n-flex>
    <TutorialContent />
  </div>
  <PeersDrawer
    v-model:show="showPeers"
    :task-id="taskId"
    :asset-base-url="`/media/tasks/tutorial/${step}/`"
  />
  <n-modal
    v-model:show="showAssets"
    preset="card"
    title="图片素材"
    style="width: 570px"
  >
    <n-flex wrap>
      <n-card
        v-for="asset in tutorialAssets"
        :key="asset.name"
        :title="asset.name"
        size="small"
        style="width: 120px"
      >
        <template #cover>
          <n-image
            :src="asset.url"
            style="width: 100%; height: 100px; object-fit: contain"
          />
        </template>
      </n-card>
    </n-flex>
  </n-modal>
</template>
<script lang="ts" setup>
import { Icon } from "../../icons"
import { computed, ref, watch } from "vue"
import {
  step,
  tutorialIds,
  prev,
  next,
  prevDisabled,
  nextDisabled,
} from "../../store/tutorial"
import { authed, roleSuper } from "../../store/user"
import PeersDrawer from "../review/PeersDrawer.vue"
import { taskTab, taskId, challengeDisplay } from "../../store/task"
import { useRoute, useRouter } from "vue-router"
import { TASK_TYPE } from "../../utils/const"
import { TaskAssets } from "../../api"
import type { TaskAsset } from "../../utils/type"
import TutorialContent from "./TutorialContent.vue"

const tutorialAssets = ref<TaskAsset[]>([])
const showAssets = ref(false)
const showPeers = ref(false)

async function loadTutorialAssets(display: number) {
  if (!display) {
    tutorialAssets.value = []
    return
  }
  try {
    tutorialAssets.value = await TaskAssets.listTutorial(display)
  } catch {
    tutorialAssets.value = []
  }
}

watch(step, loadTutorialAssets, { immediate: true })

const route = useRoute()
const router = useRouter()

// 路由同步：初始执行 + watch 响应 SPA 内部导航
// 这个面板只用在教程页（挑战有自己的页面）
function syncRoute(routeName: string) {
  taskTab.value = TASK_TYPE.Tutorial
  if (routeName.startsWith("home-tutorial") && route.params.display) {
    step.value = Number(route.params.display)
  }
}
syncRoute(route.name as string)
// 只换了 display（比如浏览器后退到上一节教程）也要同步
watch(
  () => [route.name as string, route.params.display] as const,
  ([name]) => syncRoute(name),
)

defineEmits(["hide"])

const hideNav = computed(() => tutorialIds.value.length <= 1)

const progressText = computed(() => {
  const ids = tutorialIds.value
  if (!ids.length) return ""
  const i = ids.indexOf(step.value)
  return i === -1 ? "" : `${i + 1} / ${ids.length}`
})

function edit() {
  const name =
    taskTab.value === TASK_TYPE.Tutorial
      ? "tutorial-editor"
      : "challenge-editor"
  const display =
    taskTab.value === TASK_TYPE.Tutorial ? step.value : challengeDisplay.value
  router.push({ name, params: { display } })
}
</script>
<style scoped>
.container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.title {
  height: 43px;
  padding: 0 12px 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--wp-line);
  background: var(--wp-surface);
  box-sizing: border-box;
}

.panel-name {
  font-weight: 600;
  color: var(--wp-ink);
}

.progress-text {
  font-size: 12px;
  color: var(--wp-faint);
  font-family: var(--wp-font-mono);
  min-width: 36px;
  text-align: center;
  user-select: none;
}
</style>
