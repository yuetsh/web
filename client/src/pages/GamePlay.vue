<template>
  <main class="game-play">
    <n-button text class="back" @click="$router.push({ name: 'game-home' })">
      <Icon icon="lucide:arrow-left" :width="16" /> 游戏大厅
    </n-button>

    <n-spin :show="!game && !failed">
      <n-result v-if="failed" status="404" title="游戏不存在或已下架" style="padding: 60px 0">
        <template #footer>
          <n-button @click="$router.push({ name: 'game-home' })">回游戏大厅</n-button>
        </template>
      </n-result>

      <div v-else-if="game" class="layout">
        <section class="stage">
          <div v-if="game.status !== 'listed'" :class="['notice', game.status]">
            <template v-if="game.status === 'taken_down'">
              已被老师下架，只有作者和老师看得到：{{ game.takedown_reason }}
              <span v-if="game.appeal_at">（作者已申请重新上架）</span>
            </template>
            <template v-else>还没发布，只有作者和老师看得到</template>
          </div>

          <GameFrame ref="frame" :code="game.code" empty-text="还没有发布的版本" @message="onGameMessage" />

          <div class="title-row">
            <h2>{{ game.title }}</h2>
            <span v-for="b in game.badges" :key="b.key" class="badge">
              <Icon icon="lucide:award" :width="13" />{{ b.label }}
            </span>
          </div>
          <div class="meta">
            <span>作者 <b>{{ game.author }}</b></span>
            <span v-if="game.latest_version">第 {{ game.latest_version }} 版</span>
            <span>{{ game.play_count }} 人玩过</span>
            <span v-for="t in game.tags" :key="t" class="tag">{{ label(t) }}</span>
          </div>
          <p v-if="game.content" class="content">{{ game.content }}</p>

          <n-flex class="actions">
            <n-button size="small" @click="restart">
              <template #icon><Icon icon="lucide:refresh-cw" /></template>
              重新开始
            </n-button>
            <n-button v-if="canReplay" size="small" @click="showReplay = true">
              <template #icon><Icon icon="lucide:film" /></template>
              制作过程
            </n-button>
            <n-button
              v-if="game.is_owner"
              size="small"
              type="primary"
              @click="$router.push({ name: 'game-edit', params: { display } })"
            >
              <template #icon><Icon icon="lucide:edit" /></template>
              接着改
            </n-button>
            <n-button v-if="!game.is_owner && !roleStaff" size="small" quaternary @click="openReport">
              <template #icon><Icon icon="lucide:flag" /></template>
              举报
            </n-button>
          </n-flex>

          <div v-if="roleStaff" class="teacher">
            <b>老师</b>
            <n-button v-if="game.status === 'taken_down'" size="small" type="primary" @click="restore">
              恢复上架
            </n-button>
            <n-button v-else size="small" type="error" ghost @click="openTakedown">下架</n-button>
            <n-button v-if="game.status === 'listed'" size="small" @click="toggleFeatured">
              {{ game.featured ? "取消推荐" : "推荐到首页" }}
            </n-button>
            <n-button
              v-for="(name, key) in TEACHER_BADGES"
              :key="key"
              size="small"
              :disabled="game.badges.some((b) => b.key === key)"
              @click="award(key)"
            >
              颁发“{{ name }}”
            </n-button>
          </div>

          <div v-if="game.releases.length" class="releases">
            <h3>更新记录</h3>
            <ol>
              <li v-for="r in game.releases" :key="r.version">
                <span class="v">v{{ r.version }}</span>
                <span class="notes">{{ r.notes || "（没写更新说明）" }}</span>
                <span class="r-rating">
                  <template v-if="r.rating !== null">★ {{ r.rating.toFixed(1) }}</template>
                  <template v-else-if="r.rating_count">{{ r.rating_count }} 人评分</template>
                </span>
                <span class="time">{{ parseTime(r.created, "M月D日") }}</span>
              </li>
            </ol>
          </div>
        </section>

        <aside class="side">
          <div class="box score">
            <div class="avg">
              <template v-if="game.rating !== null">
                <span class="big">{{ game.rating.toFixed(1) }}</span>
                <n-rate :value="game.rating" readonly allow-half size="small" />
              </template>
              <span v-else class="pending">还在收集评分</span>
            </div>
            <div class="muted">最新版 {{ game.rating_count }} 人评分{{ game.rating_count < 3 ? "，满 3 人显示分数" : "" }}</div>
          </div>

          <div v-if="game.status === 'listed' && !game.is_owner" class="box">
            <h3>{{ game.my_rating ? "我的评分（可以改）" : "给这一版打分" }}</h3>
            <template v-if="canRate">
              <n-rate v-model:value="stars" />
              <n-input
                v-model:value="comment"
                type="textarea"
                :autosize="{ minRows: 2, maxRows: 4 }"
                maxlength="100"
                show-count
                placeholder="说一句给作者：哪里好玩、哪里可以改（可以不写，会显示你的名字）"
                style="margin-top: 8px"
              />
              <n-button
                type="primary"
                size="small"
                block
                :disabled="!stars"
                :loading="rating"
                style="margin-top: 8px"
                @click="rate"
              >
                {{ game.my_rating ? "更新评分" : "提交评分" }}
              </n-button>
            </template>
            <p v-else class="muted">
              玩满 30 秒就可以打分了<template v-if="playSeconds">（已玩 {{ playSeconds }} 秒）</template>
            </p>
          </div>

          <div class="box">
            <h3>大家说（{{ commentCount }}）</h3>
            <p v-if="!comments.length" class="muted">还没有留言</p>
            <ul class="comments">
              <li v-for="c in comments" :key="c.id">
                <div class="c-head">
                  <b>{{ c.username }}</b>
                  <span v-if="c.stars" class="c-stars">★{{ c.stars }}</span>
                  <span class="time">{{ parseTime(c.created, "M月D日") }}</span>
                </div>
                <div class="c-text">{{ c.comment ?? "（没写留言）" }}</div>
                <div class="c-actions">
                  <button
                    v-if="c.comment"
                    :class="['helpful', { on: c.helped }]"
                    :disabled="c.mine"
                    :title="c.mine ? '不能给自己点' : '这条留言有用'"
                    @click="toggleHelpful(c)"
                  >
                    <Icon icon="lucide:thumbs-up" :width="12" /> 有用 {{ c.helpful_count || "" }}
                  </button>
                  <n-popconfirm v-if="roleStaff && c.comment" @positive-click="deleteComment(c)">
                    <template #trigger>
                      <button class="helpful danger">删除留言</button>
                    </template>
                    删除这条留言？星级会保留，删掉的文字会记进操作记录
                  </n-popconfirm>
                </div>
              </li>
            </ul>
            <n-button v-if="comments.length < commentCount" size="small" block quaternary @click="moreComments">
              更多留言
            </n-button>
          </div>
        </aside>
      </div>
    </n-spin>

    <GameReplayModal v-if="game" v-model:show="showReplay" :display="display" :title="game.title" />

    <n-modal
      v-model:show="showReason"
      preset="card"
      :title="reasonMode === 'report' ? '举报这个游戏' : '下架这个游戏'"
      style="width: 460px; max-width: calc(100vw - 32px)"
    >
      <n-input
        v-model:value="reason"
        type="textarea"
        :autosize="{ minRows: 3, maxRows: 5 }"
        maxlength="200"
        show-count
        :placeholder="reasonMode === 'report' ? '哪里不合适？老师会看到' : '下架原因，作者会看到'"
      />
      <template #footer>
        <n-flex justify="flex-end">
          <n-button @click="showReason = false">取消</n-button>
          <n-button
            :type="reasonMode === 'report' ? 'primary' : 'error'"
            :disabled="!reason.trim()"
            :loading="sendingReason"
            @click="submitReason"
          >
            {{ reasonMode === "report" ? "举报" : "下架" }}
          </n-button>
        </n-flex>
      </template>
    </n-modal>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from "vue"
import { useRoute } from "vue-router"
import { useMessage } from "naive-ui"
import { Icon } from "../icons"
import { Game } from "../api"
import GameFrame from "../components/game/GameFrame.vue"
import GameReplayModal from "../components/game/GameReplayModal.vue"
import { useGameTags } from "../composables/useGameTags"
import { parseTime } from "../utils/helper"
import { roleStaff } from "../store/user"
import type { GameDetail, GameRating } from "../utils/type"

const TEACHER_BADGES = { creative: "最有创意", "best-update": "最佳更新" } as const
// 玩满这么久才算玩过（后端只记人数，靠这里计时）
const PLAY_SECONDS = 30

const route = useRoute()
const message = useMessage()
const { label } = useGameTags()
const frame = useTemplateRef<{ restart: () => void }>("frame")

const display = Number(route.params.display)
const game = ref<GameDetail | null>(null)
const failed = ref(false)
const showReplay = ref(false)

const canReplay = computed(
  () => !!game.value && (game.value.is_owner || roleStaff.value || game.value.replay_public),
)

async function load() {
  try {
    game.value = await Game.get(display)
    stars.value = game.value.my_rating?.stars ?? 0
    comment.value = game.value.my_rating?.comment ?? ""
  } catch {
    failed.value = true
  }
}

function restart() {
  frame.value?.restart()
}

// ── 玩满 30 秒算一个玩家：从点了“点击开始”算起，切到别的标签页时不计 ──

const playSeconds = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

function onGameMessage(msg: { type: string }) {
  if (msg.type !== "started" || timer || !game.value || game.value.played || game.value.is_owner) return
  timer = setInterval(async () => {
    if (document.hidden) return
    playSeconds.value++
    if (playSeconds.value < PLAY_SECONDS) return
    stopTimer()
    try {
      const res = await Game.play(display)
      if (game.value) {
        game.value.played = true
        game.value.play_count = res.play_count
      }
    } catch {
      // 记不上也不影响玩
    }
  }, 1000)
}

function stopTimer() {
  if (timer) clearInterval(timer)
  timer = null
}

onUnmounted(stopTimer)

// ── 评分 ──

const stars = ref(0)
const comment = ref("")
const rating = ref(false)
const canRate = computed(() => !!game.value?.played)

async function rate() {
  if (!stars.value) return
  rating.value = true
  try {
    const res = await Game.rate(display, { stars: stars.value, comment: comment.value.trim() || undefined })
    if (game.value) {
      game.value.my_rating = { stars: res.stars, comment: res.comment }
      game.value.rating = res.rating
      game.value.rating_count = res.rating_count
    }
    message.success("谢谢你的评分")
    loadComments(true)
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "评分失败，请重试")
  } finally {
    rating.value = false
  }
}

// ── 留言 ──

const comments = ref<GameRating[]>([])
const commentCount = ref(0)
let commentPage = 1

async function loadComments(reset = false) {
  if (reset) commentPage = 1
  const res = await Game.ratings(display, { page: commentPage, page_size: 10 })
  comments.value = reset ? res.items : [...comments.value, ...res.items]
  commentCount.value = res.count
}

function moreComments() {
  commentPage++
  loadComments()
}

async function toggleHelpful(c: GameRating) {
  try {
    const res = await Game.toggleHelpful(c.id)
    c.helped = res.helped
    c.helpful_count = res.helpful_count
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "操作失败")
  }
}

async function deleteComment(c: GameRating) {
  try {
    await Game.deleteComment(c.id)
    message.success("留言已删除")
    loadComments(true)
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "删除失败")
  }
}

// ── 举报 / 下架（都要写原因） ──

const showReason = ref(false)
const reasonMode = ref<"report" | "takedown">("report")
const reason = ref("")
const sendingReason = ref(false)

function openReport() {
  reasonMode.value = "report"
  reason.value = ""
  showReason.value = true
}

function openTakedown() {
  reasonMode.value = "takedown"
  reason.value = ""
  showReason.value = true
}

async function submitReason() {
  sendingReason.value = true
  try {
    if (reasonMode.value === "report") {
      await Game.report(display, reason.value.trim())
      message.success("已举报，老师会看到")
    } else {
      await Game.takedown(display, reason.value.trim())
      message.success("已下架")
      await load()
    }
    showReason.value = false
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "操作失败，请重试")
  } finally {
    sendingReason.value = false
  }
}

// ── 老师 ──

async function restore() {
  try {
    await Game.restore(display)
    message.success("已恢复")
    await load()
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "操作失败")
  }
}

async function toggleFeatured() {
  if (!game.value) return
  try {
    await Game.setFeatured(display, !game.value.featured)
    game.value.featured = !game.value.featured
    message.success(game.value.featured ? "已推荐到首页" : "已取消推荐")
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "操作失败")
  }
}

async function award(badge: "creative" | "best-update") {
  try {
    const res = await Game.awardBadge(display, badge)
    message.success(res.message)
    await load()
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "操作失败")
  }
}

onMounted(() => {
  load()
  loadComments(true).catch(() => {})
})
</script>

<style scoped>
.game-play {
  max-width: 1240px;
  margin: 0 auto;
  padding: 16px 20px 48px;
}

.back {
  font-size: 13px;
  color: var(--wp-muted);
  margin-bottom: 12px;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 24px;
  align-items: start;
}

@media (max-width: 960px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}

.notice {
  margin-bottom: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  background: var(--wp-paper);
  color: var(--wp-muted);
}

.notice.taken_down {
  background: var(--wp-bad-soft);
  color: var(--wp-bad);
}

.title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

h2 {
  margin: 0;
  font-size: 22px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--wp-warn-soft);
  color: var(--wp-warn);
  font-size: 12px;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  margin-top: 6px;
  font-size: 13px;
  color: var(--wp-muted);
}

.tag {
  padding: 0 8px;
  border-radius: 4px;
  background: var(--wp-paper);
  font-size: 12px;
}

.content {
  margin: 10px 0 0;
  white-space: pre-wrap;
  font-size: 14px;
}

.actions {
  margin-top: 12px;
}

.teacher {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding: 10px 12px;
  border: 1px dashed var(--wp-line);
  border-radius: 8px;
  font-size: 13px;
}

.releases {
  margin-top: 20px;
}

h3 {
  margin: 0 0 8px;
  font-size: 15px;
}

.releases ol {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--wp-line);
  border-radius: 8px;
  background: var(--wp-surface);
}

.releases li {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: baseline;
  padding: 8px 12px;
  font-size: 13px;
}

.releases li + li {
  border-top: 1px solid var(--wp-line);
}

.v {
  font: 600 13px var(--wp-font-mono);
  color: var(--wp-brand);
}

.r-rating {
  color: var(--wp-warn);
}

.time {
  font: 12px var(--wp-font-mono);
  color: var(--wp-faint);
}

.side {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.box {
  padding: 14px;
  border: 1px solid var(--wp-line);
  border-radius: 10px;
  background: var(--wp-surface);
}

.score {
  text-align: center;
}

.avg {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.big {
  font-size: 32px;
  font-weight: 700;
  color: var(--wp-warn);
}

.pending {
  font-size: 16px;
  color: var(--wp-muted);
}

.muted {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--wp-muted);
}

.comments {
  list-style: none;
  margin: 0;
  padding: 0;
}

.comments li {
  padding: 8px 0;
}

.comments li + li {
  border-top: 1px solid var(--wp-line);
}

.c-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
}

.c-stars {
  color: var(--wp-warn);
  font-size: 12px;
}

.c-head .time {
  margin-left: auto;
}

.c-text {
  margin-top: 2px;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
}

.c-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.helpful {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 6px;
  border: 1px solid var(--wp-line);
  border-radius: 999px;
  background: var(--wp-surface);
  color: var(--wp-muted);
  font: inherit;
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;
}

.helpful:disabled {
  cursor: default;
  opacity: 0.6;
}

.helpful.on {
  border-color: var(--wp-brand);
  color: var(--wp-brand);
}

.helpful.danger:hover {
  border-color: var(--wp-bad);
  color: var(--wp-bad);
}

.helpful:focus-visible {
  outline: 2px solid var(--wp-brand);
}
</style>
