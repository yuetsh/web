<template>
  <main class="game-home">
    <header class="head">
      <div>
        <h2>游戏大厅</h2>
        <p class="sub">同学们和 AI 一起做的小游戏。玩一玩、打个分，也做一个你自己想玩的</p>
      </div>
      <n-flex>
        <n-button @click="$router.push({ name: 'game-mine' })">
          <template #icon><Icon icon="lucide:gamepad-2" /></template>
          我的游戏
        </n-button>
        <n-button type="primary" @click="showCreate = true">
          <template #icon><Icon icon="lucide:plus" /></template>
          做一个游戏
        </n-button>
      </n-flex>
    </header>

    <div class="layout">
      <section class="main">
        <div class="filters">
          <div class="sections" role="tablist" aria-label="排序">
            <button
              v-for="s in SECTIONS"
              :key="s.key"
              role="tab"
              :aria-selected="section === s.key"
              :class="['pill', { on: section === s.key }]"
              @click="setSection(s.key)"
            >
              {{ s.label }}
            </button>
          </div>
          <div class="tags" aria-label="按类型筛选">
            <button :class="['tag', { on: !tag }]" @click="setTag(undefined)">全部</button>
            <button
              v-for="t in tags"
              :key="t.key"
              :class="['tag', { on: tag === t.key }]"
              @click="setTag(t.key)"
            >
              {{ t.label }}
            </button>
          </div>
        </div>

        <n-spin :show="loading">
          <div v-if="items.length" class="grid">
            <GameCard v-for="g in items" :key="g.display" :game="g" />
          </div>
          <div v-else-if="!loading" class="empty">
            <p>{{ emptyText }}</p>
            <n-button type="primary" @click="showCreate = true">做第一个</n-button>
          </div>
        </n-spin>

        <n-flex v-if="section === 'random'" justify="center" class="pager">
          <n-button @click="load">
            <template #icon><Icon icon="lucide:refresh-cw" /></template>
            换一批
          </n-button>
        </n-flex>
        <n-flex v-else-if="count > PAGE_SIZE" justify="center" class="pager">
          <n-pagination v-model:page="page" :page-size="PAGE_SIZE" :item-count="count" @update:page="load" />
        </n-flex>
      </section>

      <aside class="board">
        <div class="board-head">
          <b><Icon icon="lucide:trophy" :width="15" /> 排行榜</b>
          <n-radio-group v-model:value="period" size="small" @update:value="loadBoard">
            <n-radio-button value="week">本周</n-radio-button>
            <n-radio-button value="month">本月</n-radio-button>
          </n-radio-group>
        </div>
        <p class="board-sub">最近{{ period === "week" ? " 7 " : " 30 " }}天新增玩家最多的游戏</p>
        <ol v-if="board.length" class="board-list">
          <li v-for="g in board" :key="g.display">
            <router-link class="board-row" :to="{ name: 'game', params: { display: g.display } }">
              <span :class="['no', { top: g.rank <= 3 }]">{{ g.rank }}</span>
              <span class="board-title">{{ g.title }}</span>
              <span class="board-author">{{ g.author }}</span>
              <span class="board-n">+{{ g.new_players }}</span>
            </router-link>
          </li>
        </ol>
        <p v-else class="board-empty">还没有人上榜</p>
      </aside>
    </div>

    <GameCreateModal v-model:show="showCreate" />
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { useStorage } from "@vueuse/core"
import { Icon } from "../icons"
import { Game, type GameSection } from "../api"
import GameCard from "../components/game/GameCard.vue"
import GameCreateModal from "../components/game/GameCreateModal.vue"
import { useGameTags } from "../composables/useGameTags"
import type { GameCard as Card, GameLeaderItem } from "../utils/type"

const SECTIONS: { key: GameSection; label: string }[] = [
  { key: "hot", label: "热门" },
  { key: "featured", label: "老师推荐" },
  { key: "new", label: "新上架" },
  { key: "updated", label: "最近更新" },
  { key: "top", label: "好评" },
  { key: "random", label: "随便看看" },
]
const PAGE_SIZE = 12

const { tags } = useGameTags()
// 选的排序记在本机，下次打开还是它
const section = useStorage<GameSection>("game-hall-section", "hot")
const tag = ref<string | undefined>()
const page = ref(1)
const items = ref<Card[]>([])
const count = ref(0)
const loading = ref(true)
const showCreate = ref(false)
const period = ref<"week" | "month">("week")
const board = ref<GameLeaderItem[]>([])

const emptyText = computed(() => {
  if (tag.value) return "这一类还没有游戏"
  if (section.value === "featured") return "老师还没有推荐游戏"
  if (section.value === "top") return "还没有游戏攒够 3 个人的评分"
  return "大厅里还没有游戏"
})

async function load() {
  loading.value = true
  try {
    const res = await Game.hall({
      section: section.value,
      tag: tag.value,
      page: page.value,
      page_size: PAGE_SIZE,
    })
    items.value = res.items
    count.value = res.count
  } finally {
    loading.value = false
  }
}

async function loadBoard() {
  board.value = await Game.leaderboard(period.value)
}

function setSection(key: GameSection) {
  section.value = key
  page.value = 1
  load()
}

function setTag(key: string | undefined) {
  tag.value = key
  page.value = 1
  load()
}

onMounted(() => {
  load()
  loadBoard()
})
</script>

<style scoped>
.game-home {
  max-width: 1180px;
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

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 24px;
  align-items: start;
}

@media (max-width: 900px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}

.filters {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.sections,
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pill,
.tag {
  border: 1px solid var(--wp-line);
  background: var(--wp-surface);
  color: var(--wp-ink);
  font: inherit;
  cursor: pointer;
}

.pill {
  padding: 4px 14px;
  border-radius: 999px;
  font-size: 14px;
}

.tag {
  padding: 1px 10px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--wp-muted);
}

.pill:hover,
.tag:hover {
  border-color: var(--wp-brand);
}

.pill.on {
  background: var(--wp-brand);
  border-color: var(--wp-brand);
  color: #fff;
}

.tag.on {
  border-color: var(--wp-brand);
  background: var(--wp-brand-soft);
  color: var(--wp-brand);
}

.pill:focus-visible,
.tag:focus-visible {
  outline: 2px solid var(--wp-brand);
  outline-offset: 1px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
  min-height: 120px;
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

.pager {
  margin-top: 20px;
}

.board {
  border: 1px solid var(--wp-line);
  border-radius: 10px;
  background: var(--wp-surface);
  padding: 14px;
  position: sticky;
  top: 12px;
}

.board-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.board-head b {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.board-sub {
  margin: 6px 0 10px;
  font-size: 12px;
  color: var(--wp-muted);
}

.board-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.board-row {
  display: grid;
  grid-template-columns: 22px 1fr auto;
  grid-template-areas: "no title n" "no author n";
  column-gap: 8px;
  padding: 6px 4px;
  border-radius: 6px;
  color: var(--wp-ink);
  text-decoration: none;
}

.board-row:hover {
  background: var(--wp-paper);
}

.board-row:focus-visible {
  outline: 2px solid var(--wp-brand);
}

.no {
  grid-area: no;
  align-self: center;
  font: 600 13px var(--wp-font-mono);
  color: var(--wp-muted);
  text-align: center;
}

.no.top {
  color: var(--wp-warn);
}

.board-title {
  grid-area: title;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.board-author {
  grid-area: author;
  font-size: 12px;
  color: var(--wp-muted);
}

.board-n {
  grid-area: n;
  align-self: center;
  font: 12px var(--wp-font-mono);
  color: var(--wp-brand);
}

.board-empty {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--wp-faint);
}
</style>
