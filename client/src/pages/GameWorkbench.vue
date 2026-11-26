<template>
  <Workbench
    ref="wb"
    kind="game"
    :task-id="taskId"
    :title="title || '我的游戏'"
    back-label="返回我的游戏"
    :back-to="{ name: 'game-mine' }"
    brief-label="我的游戏"
    :save-work="saveWork"
    :publish="openPublish"
    :released-ids="releasedIds"
  >
    <template #badges>
      <n-tag v-if="status === 'listed'" size="small" type="success" round :bordered="false">
        在大厅 · v{{ latestVersion }}
      </n-tag>
      <n-tag v-else-if="status === 'taken_down'" size="small" type="error" round :bordered="false">
        已下架
      </n-tag>
    </template>
    <template #tools>
      <!-- 下架提示放在标题栏：有对话时“我的游戏”那栏会自动收起，放在里面作者看不到 -->
      <n-popover v-if="status === 'taken_down'" trigger="click" placement="bottom-end" style="max-width: 320px">
        <template #trigger>
          <n-button size="small" type="error" secondary>下架原因</n-button>
        </template>
        <div class="down-pop">
          <div><b>老师下架了这个游戏：</b>{{ takedownReason }}</div>
          <div v-if="appealAt" class="down-note">已申请重新上架，等老师处理</div>
          <template v-else>
            <div class="down-note">改好以后发布新版本，再申请重新上架</div>
            <n-button size="small" :disabled="!latestVersion" @click="appeal">申请重新上架</n-button>
          </template>
        </div>
      </n-popover>
      <n-button
        v-if="status === 'listed'"
        size="small"
        quaternary
        @click="$router.push({ name: 'game', params: { display } })"
      >
        去游戏页
      </n-button>
    </template>
    <template #brief>
      <div class="topic">
        <div v-if="status === 'taken_down'" class="down">
          <b>游戏被老师下架了：</b>{{ takedownReason }}
          <div class="down-actions">
            <span v-if="appealAt">已申请重新上架，等老师处理</span>
            <template v-else>
              <span>改好以后发布新版本，再申请重新上架</span>
              <n-button size="tiny" :disabled="!latestVersion" @click="appeal">申请重新上架</n-button>
            </template>
          </div>
        </div>
        <n-form-item label="游戏名称" :show-feedback="false">
          <n-input v-model:value="title" placeholder="给游戏起个名字" maxlength="50" />
        </n-form-item>
        <n-form-item label="游戏介绍" :show-feedback="false" style="margin-top: 10px">
          <n-input
            v-model:value="content"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 8 }"
            placeholder="谁是主角？怎么操作？怎么得分、怎么算赢？会显示在游戏页上"
          />
        </n-form-item>
        <n-flex style="margin-top: 12px">
          <n-button size="small" :loading="savingTopic" :disabled="!title.trim()" @click="saveTopic">
            保存
          </n-button>
          <n-button
            size="small"
            type="primary"
            :disabled="!content.trim() || streaming"
            @click="generate"
          >
            按这个介绍让 AI 做
          </n-button>
        </n-flex>
        <n-text depth="3" class="hint">
          预览里先点“点击开始”再玩。觉得可以了，点右下角“发布这一版”，大家就能在大厅里玩到。
        </n-text>
      </div>
    </template>
  </Workbench>

  <n-modal
    v-model:show="showPublish"
    preset="card"
    :title="`发布第 ${latestVersion + 1} 版`"
    style="width: 600px; max-width: calc(100vw - 32px)"
    :mask-closable="!publishing"
  >
    <n-form label-placement="top">
      <n-form-item :label="latestVersion ? '这一版改了什么（玩家会看到）' : '一句话介绍（玩家会看到）'">
        <n-flex vertical style="width: 100%" :size="6">
          <n-input
            v-model:value="notes"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
            maxlength="200"
            show-count
            :placeholder="latestVersion ? '例如：加了第二关；主角跳得更高了' : '例如：用方向键接住金币，躲开炸弹'"
          />
          <n-button size="tiny" quaternary :loading="drafting" style="align-self: flex-start" @click="draftNotes">
            <template #icon><Icon icon="lucide:sparkles" /></template>
            让 AI 根据这次的改动写一句
          </n-button>
        </n-flex>
      </n-form-item>
      <n-form-item label="游戏类型（选一到两个）">
        <n-checkbox-group v-model:value="pickedTags" :max="2">
          <n-flex>
            <n-checkbox v-for="t in tags" :key="t.key" :value="t.key" :label="t.label" />
          </n-flex>
        </n-checkbox-group>
      </n-form-item>
      <n-form-item label="封面">
        <div class="cover-row">
          <div class="cover">
            <img v-if="coverPreview" :src="coverPreview" alt="封面" />
            <span v-else>还没有封面</span>
          </div>
          <n-flex vertical :size="6">
            <n-button size="small" :loading="snapping" @click="snap">
              <template #icon><Icon icon="lucide:camera" /></template>
              用预览里的当前画面
            </n-button>
            <n-text depth="3" class="small">
              预览里点“点击开始”玩几秒，会自动截一张；想换就玩到喜欢的画面再点上面的按钮
            </n-text>
          </n-flex>
        </div>
      </n-form-item>
      <n-checkbox v-model:checked="replayPublic">
        公开制作过程：同学能看到你是怎么和 AI 一步步做出来的
      </n-checkbox>
    </n-form>
    <template #footer>
      <n-flex justify="space-between" align="center">
        <n-text v-if="status === 'taken_down'" type="error" class="small">
          游戏被下架了：发布的新版本要等老师恢复后大家才能玩
        </n-text>
        <span v-else></span>
        <n-flex>
          <n-button :disabled="publishing" @click="showPublish = false">取消</n-button>
          <n-button type="primary" :loading="publishing" :disabled="!pickedTags.length" @click="confirmPublish">
            发布
          </n-button>
        </n-flex>
      </n-flex>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from "vue"
import { useRoute } from "vue-router"
import { useMessage } from "naive-ui"
import { Icon } from "../icons"
import Workbench from "../components/workbench/Workbench.vue"
import { Game } from "../api"
import { streaming } from "../store/prompt"
import { useGameTags } from "../composables/useGameTags"
import type { Code } from "../utils/code"
import type { GameStatus, GameWorkspace } from "../utils/type"

const route = useRoute()
const message = useMessage()
const wb = useTemplateRef<InstanceType<typeof Workbench>>("wb")
const { tags } = useGameTags()

const display = Number(route.params.display)
const taskId = ref(0)
const title = ref("")
const content = ref("")
const status = ref<GameStatus>("draft")
const latestVersion = ref(0)
const takedownReason = ref<string | null>(null)
const appealAt = ref<string | null>(null)
const releases = ref<GameWorkspace["releases"]>([])
const savedTags = ref<string[]>([])
const savedCover = ref<string | null>(null)
const savedReplayPublic = ref(false)
const savingTopic = ref(false)

const releasedIds = computed(() =>
  releases.value.map((r) => r.message_id).filter((id): id is number => id !== null),
)

// 加载还没完成就离开页面时，不要再改状态
let disposed = false

function apply(data: GameWorkspace) {
  title.value = data.title
  content.value = data.content
  taskId.value = data.task_id
  status.value = data.status
  latestVersion.value = data.latest_version
  takedownReason.value = data.takedown_reason
  appealAt.value = data.appeal_at
  releases.value = data.releases
  savedTags.value = data.tags
  savedCover.value = data.cover
  savedReplayPublic.value = data.replay_public
}

async function load() {
  const data = await Game.workspace(display)
  if (disposed) return
  apply(data)
  // 本地没有存着修改到一半的代码，就用服务器上保存的
  if (!wb.value?.restored) {
    wb.value?.setCode({ html: data.html, css: data.css, js: data.js })
  }
}

async function saveWork(code: Code) {
  await Game.saveCode(display, code)
}

async function saveTopic() {
  if (!title.value.trim()) return
  savingTopic.value = true
  try {
    await Game.update(display, { title: title.value.trim(), content: content.value })
    message.success("已保存")
  } catch {
    message.error("保存失败，请重试")
  } finally {
    savingTopic.value = false
  }
}

function generate() {
  const text = content.value.trim()
  if (!text || streaming.value) return
  wb.value?.send(text)
}

async function appeal() {
  try {
    await Game.appeal(display)
    appealAt.value = new Date().toISOString()
    message.success("已申请，等老师处理")
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "申请失败，请重试")
  }
}

// ── 发布 ──

const showPublish = ref(false)
const publishing = ref(false)
const drafting = ref(false)
const snapping = ref(false)
const publishMessageId = ref(0)
const notes = ref("")
const pickedTags = ref<string[]>([])
const replayPublic = ref(false)
// 这次要用的新封面（data: URL）；没有就沿用已上传的
const newCover = ref("")
const coverPreview = computed(() => newCover.value || savedCover.value)

function openPublish(messageId: number) {
  publishMessageId.value = messageId
  notes.value = ""
  pickedTags.value = [...savedTags.value]
  replayPublic.value = savedReplayPublic.value
  // 还没有封面时，用预览刚截的那张
  newCover.value = savedCover.value ? "" : (wb.value?.latestCover ?? "")
  showPublish.value = true
}

async function draftNotes() {
  drafting.value = true
  try {
    const res = await Game.notesDraft(display)
    if (res.notes) notes.value = res.notes
    else message.info("上次发布以来没有 AI 改过的地方，自己写一句吧")
  } catch {
    message.error("没写出来，自己写一句吧")
  } finally {
    drafting.value = false
  }
}

async function snap() {
  snapping.value = true
  try {
    const dataUrl = await wb.value?.requestSnapshot()
    if (dataUrl) newCover.value = dataUrl
    else message.info("先在预览里点“点击开始”，游戏跑起来才能截图")
  } finally {
    snapping.value = false
  }
}

async function confirmPublish() {
  publishing.value = true
  try {
    if (newCover.value) {
      const res = await Game.uploadCover(display, newCover.value)
      savedCover.value = res.cover
      newCover.value = ""
    }
    if (replayPublic.value !== savedReplayPublic.value) {
      await Game.setReplayPublic(display, replayPublic.value)
      savedReplayPublic.value = replayPublic.value
    }
    const res = await Game.publish(display, {
      message_id: publishMessageId.value,
      notes: notes.value.trim(),
      tags: pickedTags.value,
    })
    apply(await Game.workspace(display))
    showPublish.value = false
    if (res.status === "taken_down") {
      message.warning(`已存为第 ${res.version} 版。游戏还在下架中，改好后记得申请重新上架`)
    } else {
      message.success(`已发布第 ${res.version} 版，大家可以在大厅里玩了`)
    }
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "发布失败，请重试")
  } finally {
    publishing.value = false
  }
}

onMounted(load)
onUnmounted(() => {
  disposed = true
})
</script>

<style scoped>
.topic {
  padding: 12px;
}

.hint {
  display: block;
  margin-top: 10px;
  font-size: 12px;
}

.down {
  margin-bottom: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--wp-bad-soft);
  color: var(--wp-bad);
  font-size: 13px;
}

.down-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 12px;
}

.down-pop {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}

.down-note {
  font-size: 12px;
  color: var(--wp-muted);
}

.cover-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.cover {
  flex: none;
  width: 200px;
  aspect-ratio: 4 / 3;
  border-radius: 6px;
  /* 封面是游戏画面，深浅主题都用深底 */
  background: #11141c;
  color: #8a93a6;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  overflow: hidden;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.small {
  font-size: 12px;
}
</style>
