<template>
  <main class="game-mine">
    <header class="head">
      <div>
        <n-button text class="back" @click="$router.push({ name: 'game-home' })">
          <Icon icon="lucide:arrow-left" :width="16" /> 游戏大厅
        </n-button>
        <h2>我的游戏</h2>
        <p class="sub">和 AI 一起做，满意了就发布到大厅；看大家的评分和留言，再接着改</p>
      </div>
      <n-button type="primary" @click="showCreate = true">
        <template #icon><Icon icon="lucide:plus" /></template>
        做一个游戏
      </n-button>
    </header>

    <n-spin :show="loading">
      <div v-if="!loading && !games.length" class="empty">
        <p>还没有游戏。想玩什么样的游戏，就做一个出来吧</p>
        <n-button type="primary" @click="showCreate = true">做第一个游戏</n-button>
      </div>
      <ol v-else class="list">
        <li v-for="g in games" :key="g.display" class="row">
          <router-link class="thumb" :to="{ name: 'game-edit', params: { display: g.display } }">
            <img v-if="g.cover" :src="g.cover" :alt="g.title" />
            <Icon v-else icon="lucide:gamepad-2" :width="24" />
          </router-link>
          <div class="main">
            <router-link class="title" :to="{ name: 'game-edit', params: { display: g.display } }">
              {{ g.title }}
            </router-link>
            <div class="meta">
              <span :class="['status', g.status]">{{ STATUS[g.status] }}</span>
              <span v-if="g.latest_version">已发布到 v{{ g.latest_version }}</span>
              <template v-if="g.latest_version">
                <span v-if="g.rating !== null">★ {{ g.rating.toFixed(1) }}（{{ g.rating_count }} 人）</span>
                <span v-else>还没有评分</span>
                <span>{{ g.play_count }} 人玩过</span>
              </template>
              <span class="time">{{ parseTime(g.modified, "M月D日 HH:mm") }}</span>
            </div>
            <div v-if="g.status === 'taken_down'" class="down">
              被老师下架：{{ g.takedown_reason }}
              <span v-if="g.appeal_at">（已申请重新上架）</span>
            </div>
          </div>
          <n-flex class="actions" :wrap="false">
            <n-button
              v-if="g.status === 'listed'"
              size="small"
              quaternary
              @click="$router.push({ name: 'game', params: { display: g.display } })"
            >
              去大厅看看
            </n-button>
            <n-button
              size="small"
              @click="$router.push({ name: 'game-edit', params: { display: g.display } })"
            >
              接着做
            </n-button>
            <n-button size="small" quaternary class="del" title="删除" @click="remove(g)">
              <Icon icon="lucide:trash-2" :width="15" />
            </n-button>
          </n-flex>
        </li>
      </ol>
    </n-spin>

    <GameCreateModal v-model:show="showCreate" />
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue"
import { useDialog, useMessage } from "naive-ui"
import { Icon } from "../icons"
import { Game } from "../api"
import GameCreateModal from "../components/game/GameCreateModal.vue"
import { parseTime } from "../utils/helper"
import type { GameStatus, MyGame } from "../utils/type"

const STATUS: Record<GameStatus, string> = {
  draft: "还没发布",
  listed: "在大厅里",
  taken_down: "已下架",
}

const dialog = useDialog()
const message = useMessage()
const loading = ref(true)
const games = ref<MyGame[]>([])
const showCreate = ref(false)

async function load() {
  loading.value = true
  try {
    games.value = await Game.mine()
  } finally {
    loading.value = false
  }
}

// 发布过的游戏删掉后，版本、评分、留言都没了，要说清楚再确认
function remove(g: MyGame) {
  const published = g.latest_version > 0
  dialog.warning({
    title: `删除「${g.title}」？`,
    content: published
      ? `它已经发布了 ${g.latest_version} 个版本。删除后，所有版本、大家的评分和留言、和 AI 的对话都会一起删掉，不能恢复。`
      : "和 AI 的对话、所有版本都会一起删掉，不能恢复。",
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      try {
        await Game.remove(g.display)
        games.value = games.value.filter((x) => x.display !== g.display)
        message.success("已删除")
      } catch (err: any) {
        message.error(err.response?.data?.detail ?? "删除失败，请重试")
      }
    },
  })
}

onMounted(load)
</script>

<style scoped>
.game-mine {
  max-width: 920px;
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

.back {
  font-size: 13px;
  color: var(--wp-muted);
  margin-bottom: 6px;
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

.empty {
  padding: 40px 24px;
  border: 1px dashed var(--wp-line);
  border-radius: 10px;
  background: var(--wp-surface);
  text-align: center;
}

.empty p {
  margin: 0 0 14px;
  color: var(--wp-muted);
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

.row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  padding: 12px 16px;
}

.row + .row {
  border-top: 1px solid var(--wp-line);
}

.thumb {
  width: 96px;
  aspect-ratio: 4 / 3;
  border-radius: 6px;
  /* 封面是游戏画面，深浅主题都用深底 */
  background: #11141c;
  color: #5b6478;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.main {
  min-width: 0;
}

.title {
  font-weight: 600;
  color: var(--wp-ink);
  text-decoration: none;
}

.title:hover {
  color: var(--wp-brand);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--wp-muted);
}

.status {
  font-weight: 600;
}

.status.listed {
  color: var(--wp-brand);
}

.status.draft {
  color: var(--wp-faint);
}

.status.taken_down {
  color: var(--wp-bad);
}

.time {
  font-family: var(--wp-font-mono);
}

.down {
  margin-top: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--wp-bad-soft);
  color: var(--wp-bad);
  font-size: 12px;
}

.del {
  color: var(--wp-faint);
}

.del:hover {
  color: var(--wp-bad);
}

@media (max-width: 640px) {
  .row {
    grid-template-columns: 72px minmax(0, 1fr);
  }

  .thumb {
    width: 72px;
  }

  .actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
}
</style>
