<template>
  <div class="container" v-if="taskTab === TASK_TYPE.Challenge">
    <n-empty v-if="!challenges.length">暂无挑战，敬请期待</n-empty>
    <n-flex v-else vertical :size="12">
      <n-card
        v-for="item in challenges"
        :key="item.display"
        hoverable
        :class="['challenge-card', { submitted: item.submitted }]"
        @click="select(item)"
      >
        <template #header>
          <n-flex align="center" :size="6">
            <span v-if="item.submitted" class="check-icon">✓</span>
            <span :class="{ 'submitted-title': item.submitted }">{{
              item.title
            }}</span>
          </n-flex>
        </template>
        <template #header-extra>
          <n-flex :size="6">
            <n-tag type="warning" size="small">{{ item.score }} 分</n-tag>
            <n-tag v-if="item.pass_score != null" size="small"
              >及格 {{ item.pass_score }} 分</n-tag
            >
          </n-flex>
        </template>
        <n-text depth="3" class="challenge-author">
          出题人：{{ item.author_name || "未设置" }}
        </n-text>
      </n-card>
    </n-flex>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted } from "vue"
import { useRouter } from "vue-router"
import { Challenge } from "../../api"
import { taskTab } from "../../store/task"
import { TASK_TYPE } from "../../utils/const"
import type { ChallengeSlim } from "../../utils/type"

const router = useRouter()
const challenges = ref<ChallengeSlim[]>([])

function select(item: ChallengeSlim) {
  router.push({ name: "home-challenge", params: { display: item.display } })
}

onMounted(async () => {
  challenges.value = await Challenge.listDisplay()
})
</script>
<style scoped>
.container {
  padding: 16px;
  overflow: auto;
}

.challenge-card {
  cursor: pointer;
}

.challenge-card.submitted {
  background-color: #f6ffed;
  border-color: #b7eb8f;
}

.check-icon {
  color: #52c41a;
  font-size: 14px;
  font-weight: bold;
}

.submitted-title {
  color: #888;
}

.challenge-author {
  display: block;
  font-size: 13px;
}
</style>
