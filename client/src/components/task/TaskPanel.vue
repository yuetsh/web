<template>
  <div class="container">
    <n-flex align="center" justify="space-between" class="title">
      <n-flex align="center">
        <Icon
          :icon="
            taskTab === TASK_TYPE.Tutorial
              ? 'twemoji:books'
              : 'twemoji:crossed-swords'
          "
          :width="20"
        ></Icon>
        <n-tabs
          style="width: 150px"
          type="segment"
          animated
          :value="taskTab"
          @update:value="changeTab"
        >
          <n-tab name="tutorial" tab="教程"></n-tab>
          <n-tab name="challenge" tab="挑战"></n-tab>
        </n-tabs>
        <template v-if="!hideNav">
          <n-button text @click="prev()" :disabled="prevDisabled()">
            <Icon :width="24" icon="pepicons-pencil:arrow-left"></Icon>
          </n-button>
          <span v-if="progressText" class="progress-text">
            {{ progressText }}
          </span>
          <n-button text @click="next()" :disabled="nextDisabled()">
            <Icon :width="24" icon="pepicons-pencil:arrow-right"></Icon>
          </n-button>
        </template>
      </n-flex>
      <n-flex>
        <n-tooltip
          v-if="tutorialAssets.length && taskTab === TASK_TYPE.Tutorial"
          trigger="hover"
        >
          <template #trigger>
            <n-button text @click="showAssets = true">
              <Icon :width="16" icon="lucide:image"></Icon>
            </n-button>
          </template>
          素材
        </n-tooltip>
        <n-tooltip v-if="authed" trigger="hover">
          <template #trigger>
            <n-button
              text
              @click="
                $router.push({ name: 'submissions', params: { page: 1 } })
              "
            >
              <Icon :width="16" icon="lucide:list"></Icon>
            </n-button>
          </template>
          提交记录
        </n-tooltip>
        <n-tooltip v-if="authed" trigger="hover">
          <template #trigger>
            <n-button text @click="$router.push({ name: 'creation-list' })">
              <Icon :width="16" icon="lucide:sparkles"></Icon>
            </n-button>
          </template>
          自由创作
        </n-tooltip>
        <n-tooltip v-if="authed" trigger="hover">
          <template #trigger>
            <n-button text @click="$router.push({ name: 'showcase' })">
              <Icon :width="16" icon="lucide:award"></Icon>
            </n-button>
          </template>
          创意工坊
        </n-tooltip>
        <n-tooltip v-if="roleSuper" trigger="hover">
          <template #trigger>
            <n-button text @click="edit">
              <Icon :width="16" icon="lucide:edit"></Icon>
            </n-button>
          </template>
          编辑
        </n-tooltip>
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button text @click="$emit('hide')">
              <Icon :width="24" icon="material-symbols:close-rounded"></Icon>
            </n-button>
          </template>
          关闭
        </n-tooltip>
      </n-flex>
    </n-flex>
    <TutorialContent v-if="taskTab === TASK_TYPE.Tutorial" />
    <ChallengeList v-else />
  </div>
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
import { Icon } from "@iconify/vue"
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
import { taskTab, taskId, challengeDisplay } from "../../store/task"
import { useRoute, useRouter } from "vue-router"
import { TASK_TYPE } from "../../utils/const"
import { TaskAssets } from "../../api"
import type { TaskAsset } from "../../utils/type"
import ChallengeList from "./ChallengeList.vue"
import TutorialContent from "./TutorialContent.vue"

const tutorialAssets = ref<TaskAsset[]>([])
const showAssets = ref(false)

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
function syncRoute(routeName: string) {
  if (routeName.startsWith("home-tutorial")) {
    taskTab.value = TASK_TYPE.Tutorial
    if (route.params.display) step.value = Number(route.params.display)
  } else if (routeName.startsWith("home-challenge")) {
    taskTab.value = TASK_TYPE.Challenge
    if (route.params.display)
      challengeDisplay.value = Number(route.params.display)
  }
}
syncRoute(route.name as string)
// 只换了 display（比如浏览器后退到上一节教程）也要同步
watch(
  () => [route.name as string, route.params.display] as const,
  ([name]) => syncRoute(name),
)

defineEmits(["hide"])

const hideNav = computed(
  () => taskTab.value !== TASK_TYPE.Tutorial || tutorialIds.value.length <= 1,
)

const progressText = computed(() => {
  const ids = tutorialIds.value
  if (!ids.length) return ""
  const i = ids.indexOf(step.value)
  return i === -1 ? "" : `${i + 1} / ${ids.length}`
})

function changeTab(v: TASK_TYPE) {
  taskId.value = 0
  taskTab.value = v
  if (v === TASK_TYPE.Tutorial) {
    router.push(
      step.value
        ? { name: "home-tutorial", params: { display: step.value } }
        : { name: "home-tutorial-list" },
    )
  } else if (v === TASK_TYPE.Challenge) {
    router.push({ name: "home-challenge-list" })
  }
}

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
  padding: 0 20px;
  flex-shrink: 0;
  border-bottom: 1px solid rgb(239, 239, 245);
  box-sizing: border-box;
}

.progress-text {
  font-size: 12px;
  color: #999;
  min-width: 36px;
  text-align: center;
  user-select: none;
}
</style>
