<template>
  <n-modal
    :show="show"
    preset="card"
    style="width: 92vw; max-width: 1180px"
    :bordered="false"
    @update:show="emit('update:show', $event)"
  >
    <template #header>
      <div class="head">
        <b>制作过程</b>
        <span class="muted">{{ title }} · {{ rounds.length }} 轮</span>
      </div>
    </template>
    <n-spin :show="loading">
      <n-empty v-if="!loading && !rounds.length" description="还没有和 AI 的对话" style="padding: 60px 0" />
      <div v-else class="body">
        <ol class="rounds">
          <li v-for="(r, i) in rounds" :key="i">
            <button :class="['round', { on: i === selected }]" @click="selected = i">
              <span class="no">{{ i + 1 }}</span>
              <span class="q">{{ r.question }}</span>
              <span class="badges">
                <span v-if="r.source !== 'conversation'" class="badge">{{ sourceLabel(r.source) }}</span>
                <span v-if="r.prompt_level" class="badge" :title="PROMPT_LEVELS[r.prompt_level]?.desc">
                  L{{ r.prompt_level }}
                </span>
                <span v-if="r.version" class="badge release">发布第 {{ r.version }} 版</span>
              </span>
            </button>
          </li>
        </ol>
        <div class="stage">
          <GameFrame :code="current" empty-text="这一轮没有生成代码" />
          <p class="tip">这是第 {{ selected + 1 }} 轮之后的游戏，点“点击开始”就能玩</p>
        </div>
      </div>
    </n-spin>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useMessage } from "naive-ui"
import { Game } from "../../api"
import GameFrame from "./GameFrame.vue"
import { PROMPT_LEVELS, sourceLabel } from "../../utils/helper"
import type { GameReplayRound } from "../../utils/type"

// 成长回放：一轮轮看这个游戏是怎么和 AI 做出来的；右边是那一轮之后的游戏
const props = defineProps<{ show: boolean; display: number; title: string }>()
const emit = defineEmits<{ "update:show": [value: boolean] }>()

const message = useMessage()
const loading = ref(false)
const rounds = ref<GameReplayRound[]>([])
const selected = ref(0)

// 没有代码的轮次（只问了问题），显示它之前最近一轮的代码
const current = computed(() => {
  for (let i = selected.value; i >= 0; i--) {
    const r = rounds.value[i]
    if (r && (r.html || r.css || r.js)) return r
  }
  return null
})

watch(
  () => props.show,
  async (open) => {
    if (!open) return
    loading.value = true
    try {
      rounds.value = (await Game.replay(props.display)).rounds
      selected.value = Math.max(0, rounds.value.length - 1)
    } catch (err: any) {
      message.error(err.response?.data?.detail ?? "加载失败")
      emit("update:show", false)
    } finally {
      loading.value = false
    }
  },
)
</script>

<style scoped>
.head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.muted {
  font-size: 13px;
  color: var(--wp-muted);
}

.body {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  gap: 16px;
  min-height: 420px;
}

@media (max-width: 800px) {
  .body {
    grid-template-columns: minmax(0, 1fr);
  }
}

.rounds {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 66vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.round {
  width: 100%;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 2px 8px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--wp-paper);
  color: var(--wp-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.round:hover {
  border-color: var(--wp-line);
}

.round.on {
  border-color: var(--wp-brand);
  background: var(--wp-brand-soft);
}

.round:focus-visible {
  outline: 2px solid var(--wp-brand);
}

.no {
  grid-row: span 2;
  font: 600 13px var(--wp-font-mono);
  color: var(--wp-muted);
}

.q {
  font-size: 13px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-wrap;
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.badge {
  padding: 0 6px;
  border-radius: 4px;
  background: var(--wp-surface);
  border: 1px solid var(--wp-line);
  color: var(--wp-muted);
  font-size: 11px;
  line-height: 18px;
}

.badge.release {
  border-color: var(--wp-brand);
  color: var(--wp-brand);
}

.tip {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--wp-muted);
}
</style>
