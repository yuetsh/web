<template>
  <div class="shell">
    <header class="topbar">
      <router-link class="brand" :to="tutorialRoute">
        <img src="/noto--honeybee.ico" alt="" width="20" height="20" />
        <span>前端开发学习平台</span>
      </router-link>
      <nav class="nav">
        <router-link
          v-for="item in nav"
          :key="item.label"
          :to="item.to"
          :class="['nav-item', { active: item.active }]"
        >
          {{ item.label }}
        </router-link>
      </nav>
      <div class="spacer"></div>
      <template v-if="user.loaded">
        <router-link
          v-if="roleStaff"
          :to="{ name: 'dashboard' }"
          :class="['nav-item', { active: inTeach }]"
        >
          教学
        </router-link>
        <n-dropdown
          v-if="authed"
          :options="userMenu"
          trigger="click"
          @select="clickUserMenu"
        >
          <n-button quaternary class="user-btn">
            {{ user.username }}
          </n-button>
        </n-dropdown>
        <n-button v-else type="primary" size="small" @click="loginModal = true">
          登录
        </n-button>
      </template>
    </header>
    <main class="main">
      <router-view v-if="$route.matched.length" />
      <div v-else-if="user.loaded && !authed" class="signed-out">
        <p>登录后开始学习</p>
        <n-button type="primary" @click="loginModal = true">登录</n-button>
      </div>
    </main>
  </div>
</template>
<script lang="ts" setup>
import { computed } from "vue"
import { useRoute, useRouter } from "vue-router"
import { authed, roleStaff, user } from "../../store/user"
import { loginModal } from "../../store/modal"
import { step } from "../../store/tutorial"
import { logout } from "../../store/session"

const route = useRoute()
const router = useRouter()

const routeName = computed(() => String(route.name ?? ""))
const inTeach = computed(() => route.path.startsWith("/dashboard"))

const tutorialRoute = computed(() =>
  step.value
    ? { name: "home-tutorial", params: { display: step.value } }
    : { name: "home-tutorial-list" },
)

const nav = computed(() => [
  {
    label: "教程",
    to: tutorialRoute.value,
    active:
      routeName.value === "home" || routeName.value.startsWith("home-tutorial"),
  },
  {
    label: "挑战",
    to: { name: "home-challenge-list" },
    active: routeName.value.startsWith("home-challenge"),
  },
  {
    label: "自由创作",
    to: { name: "creation-list" },
    active: routeName.value.startsWith("creation"),
  },
  {
    label: "作品展",
    to: { name: "showcase" },
    active: routeName.value === "showcase",
  },
])

const userMenu = [
  { label: "我的提交", key: "submissions" },
  { type: "divider", key: "d1" },
  { label: "退出登录", key: "logout" },
]

async function clickUserMenu(key: string) {
  if (key === "submissions") {
    router.push({
      name: "submissions",
      params: { page: 1 },
      query: { username: user.username },
    })
  } else if (key === "logout") {
    await logout()
    // 留在需要登录或特定角色的页面上没有意义
    if (route.meta.auth || route.meta.role) router.push(tutorialRoute.value)
  }
}
</script>
<style scoped>
.shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--wp-paper);
}

.topbar {
  height: var(--wp-topbar-h);
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 16px;
  background: var(--wp-surface);
  border-bottom: 1px solid var(--wp-line);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: 20px;
  color: var(--wp-ink);
  font-weight: 600;
  font-size: 15px;
  text-decoration: none;
  white-space: nowrap;
}

.nav {
  display: flex;
  gap: 2px;
}

.nav-item {
  padding: 6px 12px;
  border-radius: 6px;
  color: var(--wp-muted);
  font-size: 14px;
  text-decoration: none;
  white-space: nowrap;
}

.nav-item:hover {
  color: var(--wp-ink);
  background: var(--wp-paper);
}

.nav-item.active {
  color: var(--wp-brand);
  background: var(--wp-brand-soft);
  font-weight: 600;
}

.nav-item:focus-visible,
.brand:focus-visible {
  outline: 2px solid var(--wp-brand);
  outline-offset: 2px;
}

.spacer {
  flex: 1;
}

.user-btn {
  margin-left: 4px;
}

.main {
  height: var(--wp-main-h);
  min-height: 0;
  overflow: auto;
}

.signed-out {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--wp-muted);
}
</style>
