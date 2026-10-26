<template>
  <n-flex class="container" :wrap="false">
    <div class="sidebar">
      <div class="back-btn" @click="() => goHome($router, taskTab, step)">
        ← 返回
      </div>
      <n-divider style="margin: 8px 0" />
      <div
        v-for="item in menu"
        :key="item.label"
        :class="['nav-item', { active: $route.name === item.route.name }]"
        @click="$router.push(item.route)"
      >
        {{ item.label }}
      </div>
    </div>
    <div class="content">
      <router-view></router-view>
    </div>
  </n-flex>
</template>
<script lang="ts" setup>
import { computed } from "vue"
import { taskTab } from "../store/task"
import { step } from "../store/tutorial"
import { roleAdmin, roleSuper } from "../store/user"
import { goHome } from "../utils/helper"

const menu = computed(() =>
  [
    {
      label: "教程",
      route: { name: "tutorial-editor", params: { display: step.value } },
      show: roleSuper.value,
    },
    {
      label: "挑战",
      route: { name: "challenge-editor", params: { display: 0 } },
      show: roleAdmin.value || roleSuper.value,
    },
    {
      label: "用户",
      route: { name: "user-manage", params: { page: 1 } },
      show: roleSuper.value,
    },
    {
      label: "工坊",
      route: { name: "showcase-manage" },
      show: roleSuper.value,
    },
    {
      label: "成绩",
      route: { name: "gradebook" },
      show: roleSuper.value,
    },
    {
      label: "提交",
      route: { name: "submissions", params: { page: 1 } },
      show: roleAdmin.value || roleSuper.value,
    },
  ].filter((item) => item.show),
)
</script>
<style scoped>
.container {
  height: 100vh;
  width: 100vw;
  box-sizing: border-box;
}

.sidebar {
  width: 110px;
  min-width: 110px;
  padding: 12px 8px;
  border-right: 1px solid #efeff5;
  background: #fafafa;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.back-btn {
  padding: 7px 10px;
  font-size: 13px;
  color: #888;
  cursor: pointer;
  border-radius: 6px;
  transition:
    background-color 0.15s,
    color 0.15s;
  user-select: none;
}

.back-btn:hover {
  background-color: #f0f0f0;
  color: #444;
}

.nav-item {
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  color: #444;
  transition:
    background-color 0.15s,
    color 0.15s;
  user-select: none;
}

.nav-item:hover {
  background-color: #f0f0f0;
}

.nav-item.active {
  background-color: #e8f8f0;
  color: #18a058;
  font-weight: 500;
}

.content {
  flex: 1;
  box-sizing: border-box;
  overflow: hidden;
}
</style>
