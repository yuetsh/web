<template>
  <main class="challenge-home">
    <header class="head">
      <div>
        <h2>挑战</h2>
        <p class="sub">
          用提示词让 AI 做出题目要求的网页。已完成 {{ doneCount }} / {{ challenges.length }}
        </p>
      </div>
      <n-radio-group v-model:value="filter" size="small">
        <n-radio-button value="all">全部</n-radio-button>
        <n-radio-button value="todo">未做</n-radio-button>
        <n-radio-button value="done">已交</n-radio-button>
      </n-radio-group>
    </header>

    <n-spin :show="loading">
      <n-empty
        v-if="!loading && !visible.length"
        :description="challenges.length ? '没有符合条件的挑战' : '暂无挑战，敬请期待'"
        style="margin-top: 72px"
      />
      <ol v-else class="list">
        <li v-for="item in visible" :key="item.display">
          <router-link
            class="row"
            :to="{ name: 'home-challenge', params: { display: item.display } }"
          >
            <span class="num">{{ item.display }}</span>
            <span class="main">
              <span class="title">{{ item.title }}</span>
              <span class="author">出题人：{{ item.author_name || "未设置" }}</span>
            </span>
            <span class="score">{{ item.score }} 分</span>
            <span :class="['state', { done: item.submitted }]">
              <template v-if="item.submitted">
                <Icon icon="lucide:check" :width="14" /> 已交
              </template>
              <template v-else>未做</template>
            </span>
          </router-link>
        </li>
      </ol>
    </n-spin>
  </main>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { Icon } from "../icons"
import { Challenge } from "../api"
import { taskId, taskTab } from "../store/task"
import { TASK_TYPE } from "../utils/const"
import type { ChallengeSlim } from "../utils/type"

const challenges = ref<ChallengeSlim[]>([])
const loading = ref(true)
const filter = ref<"all" | "todo" | "done">("all")

const doneCount = computed(() => challenges.value.filter((c) => c.submitted).length)
const visible = computed(() =>
  challenges.value.filter((c) =>
    filter.value === "todo" ? !c.submitted : filter.value === "done" ? c.submitted : true,
  ),
)

onMounted(async () => {
  taskTab.value = TASK_TYPE.Challenge
  taskId.value = 0
  try {
    challenges.value = await Challenge.listDisplay()
  } finally {
    loading.value = false
  }
})
</script>
<style scoped>
.challenge-home {
  max-width: 880px;
  margin: 0 auto;
  padding: 28px 20px 48px;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

h2 {
  margin: 0;
  font-size: 22px;
}

.sub {
  margin: 4px 0 0;
  color: var(--wp-muted);
  font-size: 13px;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--wp-line);
  border-radius: 10px;
  background: var(--wp-surface);
  overflow: hidden;
}

.list li + li {
  border-top: 1px solid var(--wp-line);
}

.row {
  display: grid;
  grid-template-columns: 44px 1fr auto 72px;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  color: var(--wp-ink);
  text-decoration: none;
}

.row:hover {
  background: var(--wp-paper);
}

.row:focus-visible {
  outline: 2px solid var(--wp-brand);
  outline-offset: -2px;
}

.num {
  font: 600 15px var(--wp-font-mono);
  color: var(--wp-faint);
  font-variant-numeric: tabular-nums;
}

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.title {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.author {
  font-size: 12px;
  color: var(--wp-muted);
}

.score {
  font: 13px var(--wp-font-mono);
  color: var(--wp-warn);
}

.state {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  font-size: 13px;
  color: var(--wp-faint);
}

.state.done {
  color: var(--wp-brand);
  font-weight: 600;
}
</style>
