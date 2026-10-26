<template>
  <div class="teach">
    <nav class="sidebar">
      <template v-for="group in groups" :key="group.label">
        <div class="group-label">{{ group.label }}</div>
        <router-link
          v-for="item in group.items"
          :key="item.label"
          :to="item.route"
          :class="['nav-item', { active: item.names.includes(String($route.name)) }]"
        >
          <Icon :icon="item.icon" :width="16" />
          <span>{{ item.label }}</span>
        </router-link>
      </template>
    </nav>
    <div class="content">
      <router-view></router-view>
    </div>
  </div>
</template>
<script lang="ts" setup>
import { computed } from "vue"
import { Icon } from "../icons"
import { step } from "../store/tutorial"
import { roleSuper } from "../store/user"

// admin 只能出挑战、看提交、管作品展；其余是超管的（和后端权限一致）
const groups = computed(() =>
  [
    {
      label: "出题",
      items: [
        {
          label: "教程",
          icon: "lucide:book-open",
          route: { name: "tutorial-editor", params: { display: step.value } },
          names: ["tutorial-editor"],
          show: roleSuper.value,
        },
        {
          label: "挑战",
          icon: "lucide:swords",
          route: { name: "challenge-editor", params: { display: 0 } },
          names: ["challenge-editor"],
          show: true,
        },
      ],
    },
    {
      label: "班级",
      items: [
        {
          label: "成绩册",
          icon: "lucide:graduation-cap",
          route: { name: "gradebook" },
          names: ["gradebook"],
          show: roleSuper.value,
        },
        {
          label: "全部提交",
          icon: "lucide:list",
          route: { name: "teach-submissions", params: { page: 1 } },
          names: ["teach-submissions"],
          show: true,
        },
      ],
    },
    {
      label: "管理",
      items: [
        {
          label: "作品展",
          icon: "lucide:award",
          route: { name: "showcase-manage" },
          names: ["showcase-manage"],
          show: true,
        },
        {
          label: "用户",
          icon: "lucide:users",
          route: { name: "user-manage", params: { page: 1 } },
          names: ["user-manage"],
          show: roleSuper.value,
        },
      ],
    },
  ]
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show) }))
    .filter((g) => g.items.length),
)
</script>
<style scoped>
.teach {
  height: 100%;
  display: flex;
}

.sidebar {
  width: 148px;
  flex: none;
  padding: 8px;
  border-right: 1px solid var(--wp-line);
  background: var(--wp-surface);
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.group-label {
  padding: 12px 10px 4px;
  font-size: 12px;
  color: var(--wp-faint);
  letter-spacing: 0.04em;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 14px;
  color: var(--wp-muted);
  text-decoration: none;
}

.nav-item:hover {
  background: var(--wp-paper);
  color: var(--wp-ink);
}

.nav-item.active {
  background: var(--wp-brand-soft);
  color: var(--wp-brand);
  font-weight: 600;
}

.nav-item:focus-visible {
  outline: 2px solid var(--wp-brand);
  outline-offset: 1px;
}

.content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  background: var(--wp-surface);
}
</style>
