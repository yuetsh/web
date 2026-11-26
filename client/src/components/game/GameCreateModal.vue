<template>
  <n-modal
    :show="show"
    preset="card"
    title="做一个新游戏"
    style="width: 560px; max-width: calc(100vw - 32px)"
    @update:show="emit('update:show', $event)"
  >
    <n-form>
      <n-form-item label="游戏名称">
        <n-input
          v-model:value="form.title"
          placeholder="例如：小猫接鱼"
          maxlength="50"
          show-count
          @keydown.enter.prevent="submit"
        />
      </n-form-item>
      <n-form-item label="想做一个什么样的游戏？（可以之后再补充）">
        <n-input
          v-model:value="form.content"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 6 }"
          placeholder="谁是主角？怎么操作？怎么得分、怎么算赢？"
        />
      </n-form-item>
    </n-form>
    <div class="ideas">
      <span class="ideas-label">没想好？试试这些：</span>
      <button v-for="idea in IDEAS" :key="idea.title" class="idea" @click="pick(idea)">
        {{ idea.title }}
      </button>
    </div>
    <template #footer>
      <n-flex justify="flex-end">
        <n-button @click="emit('update:show', false)">取消</n-button>
        <n-button type="primary" :loading="creating" :disabled="!form.title.trim()" @click="submit">
          创建并开始
        </n-button>
      </n-flex>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from "vue"
import { useRouter } from "vue-router"
import { useMessage } from "naive-ui"
import { Game } from "../../api"

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ "update:show": [value: boolean] }>()

const router = useRouter()
const message = useMessage()
const creating = ref(false)
const form = reactive({ title: "", content: "" })

// 几类容易做好的游戏（和 AI 提示词里建议的一致）
const IDEAS = [
  { title: "接东西", content: "小人在下面左右移动，接住掉下来的金币，碰到炸弹扣一颗心" },
  { title: "跳平台", content: "方向键左右走、上键跳，跳上平台吃金币，走到红旗就过关" },
  { title: "太空射击", content: "战机在下面左右移动、空格射击，打掉从上面飞来的敌机" },
  { title: "走迷宫", content: "方向键在迷宫里走，走到终点就赢，记录用了多少秒" },
  { title: "躲避", content: "小人躲开从四面飞来的刺球，坚持得越久分越高" },
  { title: "跑酷", content: "小人一直往右跑，空格跳过地刺和木箱，跑得越远分越高" },
  { title: "双人对战", content: "两个小人在同一个键盘上抢金币，一个用 WASD、一个用方向键，先抢到 10 个的赢" },
]

watch(
  () => props.show,
  (open) => {
    if (open) Object.assign(form, { title: "", content: "" })
  },
)

function pick(idea: { title: string; content: string }) {
  form.title ||= idea.title
  form.content = idea.content
}

async function submit() {
  if (!form.title.trim() || creating.value) return
  creating.value = true
  try {
    const g = await Game.create({ title: form.title.trim(), content: form.content.trim() })
    emit("update:show", false)
    router.push({ name: "game-edit", params: { display: g.display } })
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "创建失败，请重试")
  } finally {
    creating.value = false
  }
}
</script>

<style scoped>
.ideas {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.ideas-label {
  font-size: 12px;
  color: var(--wp-muted);
}

.idea {
  padding: 2px 10px;
  border: 1px solid var(--wp-line);
  border-radius: 999px;
  background: var(--wp-surface);
  color: var(--wp-ink);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.idea:hover {
  border-color: var(--wp-brand);
  color: var(--wp-brand);
}

.idea:focus-visible {
  outline: 2px solid var(--wp-brand);
  outline-offset: 1px;
}
</style>
