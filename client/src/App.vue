<script setup lang="ts">
import { dateZhCN, zhCN } from "naive-ui"
import Login from "./components/Login.vue"
import AppShell from "./components/layout/AppShell.vue"
import { onMounted } from "vue"
import { useRoute } from "vue-router"
import { loadUser } from "./store/session"
import { light, naiveOverrides } from "./theme"
import hljs from "highlight.js/lib/core"

const route = useRoute()
const themeOverrides = naiveOverrides(light)

onMounted(loadUser)
</script>

<template>
  <n-config-provider
    class="myContainer"
    :locale="zhCN"
    :date-locale="dateZhCN"
    :hljs="hljs"
    :theme-overrides="themeOverrides"
  >
    <n-modal-provider>
      <n-message-provider :max="1">
        <n-dialog-provider>
          <!-- 全屏预览这类页面不要顶栏 -->
          <router-view v-if="route.meta.bare" />
          <AppShell v-else />
          <Login />
        </n-dialog-provider>
      </n-message-provider>
    </n-modal-provider>
  </n-config-provider>
</template>
<style scoped>
.myContainer {
  height: 100vh;
  width: 100vw;
}
</style>
