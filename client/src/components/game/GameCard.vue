<template>
  <router-link class="card" :to="{ name: 'game', params: { display: game.display } }">
    <div class="cover">
      <img v-if="game.cover" :src="game.cover" :alt="game.title" loading="lazy" />
      <div v-else class="no-cover">
        <Icon icon="lucide:gamepad-2" :width="36" />
      </div>
      <span v-if="game.featured" class="featured">老师推荐</span>
      <span v-if="rank" :class="['rank', { top: rank <= 3 }]">{{ rank }}</span>
    </div>
    <div class="body">
      <div class="title">{{ game.title }}</div>
      <div class="meta">
        <span class="author">{{ game.author }}</span>
        <span v-if="game.latest_version" class="ver">v{{ game.latest_version }}</span>
      </div>
      <div class="stats">
        <span v-if="game.rating !== null" class="rating">
          <Icon icon="lucide:star" :width="13" />{{ game.rating.toFixed(1) }}
          <span class="muted">（{{ game.rating_count }} 人）</span>
        </span>
        <span v-else class="muted">还在收集评分</span>
        <span class="plays" :title="extra ? undefined : '玩过的人数'">
          <template v-if="extra">{{ extra }}</template>
          <template v-else>{{ game.play_count }} 人玩过</template>
        </span>
      </div>
      <div v-if="game.tags.length" class="tags">
        <span v-for="t in game.tags" :key="t" class="tag">{{ label(t) }}</span>
      </div>
    </div>
  </router-link>
</template>

<script setup lang="ts">
import { Icon } from "../../icons"
import { useGameTags } from "../../composables/useGameTags"
import type { GameCard } from "../../utils/type"

// 大厅和“我的游戏”里的一张游戏卡片；rank 是榜单名次，extra 替换右下角的游玩人数（榜单显示新增玩家）
defineProps<{ game: GameCard; rank?: number; extra?: string }>()
const { label } = useGameTags()
</script>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--wp-line);
  border-radius: 10px;
  background: var(--wp-surface);
  color: var(--wp-ink);
  text-decoration: none;
  overflow: hidden;
  transition: border-color 0.15s;
}

.card:hover {
  border-color: var(--wp-brand);
}

.card:focus-visible {
  outline: 2px solid var(--wp-brand);
  outline-offset: 2px;
}

.cover {
  position: relative;
  aspect-ratio: 4 / 3;
  /* 封面是游戏画面，深浅主题都用深底 */
  background: #11141c;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
  display: block;
}

.no-cover {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #5b6478;
}

.featured {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--wp-warn);
  color: #fff;
  font-size: 12px;
}

.rank {
  position: absolute;
  top: 8px;
  right: 8px;
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font: 600 13px/26px var(--wp-font-mono);
  text-align: center;
}

.rank.top {
  background: var(--wp-warn);
}

.body {
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.title {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta,
.stats {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--wp-muted);
}

.ver {
  font-family: var(--wp-font-mono);
}

.rating {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--wp-warn);
  font-weight: 600;
}

.muted {
  color: var(--wp-faint);
  font-weight: 400;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}

.tag {
  padding: 0 6px;
  border-radius: 4px;
  background: var(--wp-paper);
  color: var(--wp-muted);
  font-size: 11px;
  line-height: 18px;
}
</style>
