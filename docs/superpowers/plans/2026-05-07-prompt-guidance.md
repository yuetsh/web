# Prompt Guidance Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "调教提示词" lightbulb button to PromptPanel that opens a modal where the AI coaches students to improve their prompt before generating code.

**Architecture:** New `GuidanceConsumer` WebSocket at `ws/guidance/<task_id>/` handles coaching conversations, saving messages with `source="guidance"` to the existing DB. Frontend adds `store/guidance.ts` (mirrors `store/prompt.ts` pattern) and `GuidancePanel.vue` (Naive UI modal). `PromptPanel.vue` gets a lightbulb button and wires the generate event.

**Tech Stack:** Django Channels (AsyncWebsocketConsumer), OpenAI-compatible streaming API, Vue 3, Naive UI, TypeScript

---

## File Map

**Create:**
- `client/src/store/guidance.ts` — WebSocket state for guidance sessions
- `client/src/components/ai/GuidancePanel.vue` — Guidance coaching modal

**Modify:**
- `api/prompt/llm.py` — Add `GUIDANCE_SYSTEM_PROMPT`, `parse_guidance_response()`, `stream_guidance()`
- `api/prompt/tests.py` — Add unit tests for `parse_guidance_response`
- `api/prompt/consumers.py` — Add `GuidanceConsumer`, update import
- `api/prompt/url.py` — Register `ws/guidance/<task_id>/`
- `client/src/store/prompt.ts` — Export `currentTaskId` ref
- `client/src/components/ai/PromptPanel.vue` — Add lightbulb button + GuidancePanel

---

### Task 1: Backend — Guidance LLM helpers

**Files:**
- Modify: `api/prompt/llm.py`
- Test: `api/prompt/tests.py`

- [ ] **Step 1: Write failing tests for `parse_guidance_response`**

Add at the bottom of `api/prompt/tests.py`:

```python
from prompt.llm import parse_guidance_response


class ParseGuidanceResponseTest(TestCase):
    def test_ready_prefix_with_newline_stripped(self):
        content, is_ready = parse_guidance_response("[READY]\n很好，可以生成了！")
        self.assertEqual(content, "很好，可以生成了！")
        self.assertTrue(is_ready)

    def test_ready_prefix_without_newline_stripped(self):
        content, is_ready = parse_guidance_response("[READY]很好，可以生成了！")
        self.assertEqual(content, "很好，可以生成了！")
        self.assertTrue(is_ready)

    def test_no_ready_prefix_unchanged(self):
        content, is_ready = parse_guidance_response("你的提示词不够具体，请问...")
        self.assertEqual(content, "你的提示词不够具体，请问...")
        self.assertFalse(is_ready)

    def test_empty_string(self):
        content, is_ready = parse_guidance_response("")
        self.assertEqual(content, "")
        self.assertFalse(is_ready)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd api && uv run python manage.py test prompt.tests.ParseGuidanceResponseTest -v 2
```

Expected: `ImportError: cannot import name 'parse_guidance_response' from 'prompt.llm'`

- [ ] **Step 3: Add guidance helpers to `api/prompt/llm.py`**

Add `GUIDANCE_SYSTEM_PROMPT` after the existing `SYSTEM_PROMPT` block (before `DEFAULT_MODEL = "deepseek-v4-flash"`):

```python
GUIDANCE_SYSTEM_PROMPT = """你是一个提示词写作教练，帮助学生写出清晰、具体的网页需求描述。

判断标准——满足以下条件视为"够好"：
- 有明确主题（例如：登录页、计时器、商品卡片列表）
- 至少包含以下一项具体描述：颜色/布局/风格、交互行为（按钮点击、动画等）、页面内容（文字、数量、图标）

判断为"不够好"的典型情况：
- 目标太泛，如"做一个好看的页面"
- 只有主题，完全没有任何视觉、交互或内容描述

规则：
1. 如果提示词不够好，用 1-2 个启发性问题引导学生补充细节，不要直接给出答案
2. 如果提示词已经够好，以 [READY] 开头回复，简短夸奖学生并说明可以生成了
3. 用中文回复，语气鼓励，简洁明了
4. 不要生成任何代码"""
```

Add `parse_guidance_response` and `stream_guidance` after the existing `extract_code` function:

```python
def parse_guidance_response(full_response: str) -> tuple[str, bool]:
    if full_response.startswith("[READY]"):
        return full_response[len("[READY]"):].lstrip("\n"), True
    return full_response, False


async def stream_guidance(history: list[dict]):
    """Stream guidance coaching response. Yields content chunks."""
    messages = [{"role": "system", "content": GUIDANCE_SYSTEM_PROMPT}]
    messages.extend(history)
    client, model = _get_client("")
    async with client as c:
        stream = await c.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta
            if delta.content:
                yield delta.content
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd api && uv run python manage.py test prompt.tests.ParseGuidanceResponseTest -v 2
```

Expected: `Ran 4 tests in ...s OK`

- [ ] **Step 5: Commit**

```bash
git -C /home/xuyue/Projects/webpreview add api/prompt/llm.py api/prompt/tests.py
git -C /home/xuyue/Projects/webpreview commit -m "feat: add guidance LLM helpers and system prompt"
```

---

### Task 2: Backend — GuidanceConsumer

**Files:**
- Modify: `api/prompt/consumers.py`

- [ ] **Step 1: Update import at top of `consumers.py`**

Change:
```python
from .llm import stream_chat, extract_code
```
To:
```python
from .llm import stream_chat, extract_code, stream_guidance, parse_guidance_response
```

- [ ] **Step 2: Add `GuidanceConsumer` at the bottom of `consumers.py`**

```python
class GuidanceConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope["user"]
        if self.user.is_anonymous:
            await self.close()
            return

        self.task_id = int(self.scope["url_route"]["kwargs"]["task_id"])
        self.current_user_message = None
        self.session_messages = []  # in-memory LLM context, resets each WS connection
        await self.accept()

        self.conversation = await self.get_or_create_conversation()
        await self.send(text_data=json.dumps({"type": "init", "messages": []}))

    async def disconnect(self, close_code):
        if self.current_user_message:
            await self.delete_message(self.current_user_message)
            self.current_user_message = None

    async def receive(self, text_data):
        data = json.loads(text_data)
        prompt = data.get("content", "").strip()
        if not prompt:
            return

        self.current_user_message = await self.save_message("user", prompt)
        self.session_messages.append({"role": "user", "content": prompt})

        try:
            full_response = ""
            try:
                async for chunk in stream_guidance(self.session_messages):
                    full_response += chunk
                    await self.send(text_data=json.dumps({
                        "type": "stream",
                        "content": chunk,
                    }))
            except Exception as e:
                await self.send(text_data=json.dumps({
                    "type": "error",
                    "content": f"AI 服务出错：{str(e)}",
                }))
                return

            clean_response, is_ready = parse_guidance_response(full_response)
            self.session_messages.append({"role": "assistant", "content": clean_response})
            assistant_msg = await self.save_message("assistant", clean_response)
            self.current_user_message = None

            await self.send(text_data=json.dumps({
                "type": "complete",
                "message_id": assistant_msg.id,
                "is_ready": is_ready,
            }))

        finally:
            if self.current_user_message:
                await self.delete_message(self.current_user_message)
                self.current_user_message = None

    @database_sync_to_async
    def get_or_create_conversation(self):
        conv = (
            Conversation.objects.filter(user=self.user, task_id=self.task_id)
            .annotate(msg_count=Count("messages"))
            .order_by("-msg_count", "-created")
            .first()
        )
        if not conv:
            conv = Conversation.objects.create(user=self.user, task_id=self.task_id)
        return conv

    @database_sync_to_async
    def delete_message(self, message):
        message.delete()

    @database_sync_to_async
    def save_message(self, role, content):
        return Message.objects.create(
            conversation=self.conversation,
            role=role,
            source="guidance",
            content=content,
        )
```

- [ ] **Step 3: Verify Django imports are clean**

```bash
cd api && uv run python manage.py check
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 4: Commit**

```bash
git -C /home/xuyue/Projects/webpreview add api/prompt/consumers.py
git -C /home/xuyue/Projects/webpreview commit -m "feat: add GuidanceConsumer WebSocket handler"
```

---

### Task 3: Backend — Register WebSocket route

**Files:**
- Modify: `api/prompt/url.py`

- [ ] **Step 1: Replace content of `api/prompt/url.py`**

```python
from django.urls import path
from .consumers import PromptConsumer, GuidanceConsumer

websocket_urlpatterns = [
    path("ws/prompt/<int:task_id>/", PromptConsumer.as_asgi()),
    path("ws/guidance/<int:task_id>/", GuidanceConsumer.as_asgi()),
]
```

- [ ] **Step 2: Verify routing is clean**

```bash
cd api && uv run python manage.py check
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 3: Run the full test suite**

```bash
cd api && uv run python manage.py test prompt -v 2
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git -C /home/xuyue/Projects/webpreview add api/prompt/url.py
git -C /home/xuyue/Projects/webpreview commit -m "feat: register ws/guidance/<task_id>/ WebSocket route"
```

---

### Task 4: Frontend — Export `currentTaskId` from prompt store

**Files:**
- Modify: `client/src/store/prompt.ts`

- [ ] **Step 1: Add exported `currentTaskId` ref**

After this line in `client/src/store/prompt.ts`:
```typescript
export const streamingContent = ref("")
```

Add:
```typescript
export const currentTaskId = ref(0)
```

- [ ] **Step 2: Keep it in sync in `connectPrompt`**

In `connectPrompt`, after `_currentTaskId = taskId`, add:
```typescript
currentTaskId.value = taskId
```

- [ ] **Step 3: Commit**

```bash
git -C /home/xuyue/Projects/webpreview add client/src/store/prompt.ts
git -C /home/xuyue/Projects/webpreview commit -m "feat: export currentTaskId from prompt store"
```

---

### Task 5: Frontend — Guidance store

**Files:**
- Create: `client/src/store/guidance.ts`

- [ ] **Step 1: Create `client/src/store/guidance.ts`**

```typescript
import { ref } from "vue"
import { WS_BASE_URL } from "../utils/const"

export interface GuidanceMessage {
  role: "user" | "assistant"
  content: string
  id?: number
}

export const messages = ref<GuidanceMessage[]>([])
export const connected = ref(false)
export const streaming = ref(false)
export const streamingContent = ref("")
export const isReady = ref(false)
export const isOpen = ref(false)
export const initialPrompt = ref("")

let ws: WebSocket | null = null
let _taskId = 0

function _setupHandlers(socket: WebSocket) {
  socket.onopen = () => {
    connected.value = true
    if (initialPrompt.value) {
      _send(initialPrompt.value)
    }
  }
  socket.onmessage = (event) => {
    const data = JSON.parse(event.data)
    if (data.type === "init") {
      streaming.value = false
      streamingContent.value = ""
    } else if (data.type === "stream") {
      streaming.value = true
      streamingContent.value += data.content
    } else if (data.type === "complete") {
      streaming.value = false
      const content = streamingContent.value.replace(/^\[READY\]\n?/, "")
      messages.value.push({ role: "assistant", content, id: data.message_id })
      streamingContent.value = ""
      if (data.is_ready) isReady.value = true
    } else if (data.type === "error") {
      streaming.value = false
      streamingContent.value = ""
      messages.value.push({ role: "assistant", content: data.content })
    }
  }
  socket.onclose = () => {
    connected.value = false
  }
}

function _send(content: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  streaming.value = true
  messages.value.push({ role: "user", content })
  ws.send(JSON.stringify({ type: "message", content }))
}

export function openGuidance(taskId: number, prompt: string) {
  _taskId = taskId
  initialPrompt.value = prompt
  messages.value = []
  isReady.value = false
  streamingContent.value = ""
  isOpen.value = true

  if (ws) ws.close()
  ws = new WebSocket(`${WS_BASE_URL}/ws/guidance/${taskId}/`)
  _setupHandlers(ws)
}

export function sendGuidance(content: string) {
  _send(content)
}

export function stopGuidance() {
  if (
    messages.value.length > 0 &&
    messages.value[messages.value.length - 1].role === "user"
  ) {
    messages.value.pop()
  }
  streaming.value = false
  streamingContent.value = ""
  if (_taskId) {
    if (ws) ws.close()
    ws = new WebSocket(`${WS_BASE_URL}/ws/guidance/${_taskId}/`)
    initialPrompt.value = ""  // don't re-send on reconnect
    _setupHandlers(ws)
  }
}

export function closeGuidance() {
  if (ws) {
    ws.close()
    ws = null
  }
  isOpen.value = false
  messages.value = []
  isReady.value = false
  connected.value = false
  streaming.value = false
  streamingContent.value = ""
  initialPrompt.value = ""
  _taskId = 0
}
```

- [ ] **Step 2: Commit**

```bash
git -C /home/xuyue/Projects/webpreview add client/src/store/guidance.ts
git -C /home/xuyue/Projects/webpreview commit -m "feat: add guidance WebSocket store"
```

---

### Task 6: Frontend — GuidancePanel component

**Files:**
- Create: `client/src/components/ai/GuidancePanel.vue`

- [ ] **Step 1: Create `client/src/components/ai/GuidancePanel.vue`**

```vue
<template>
  <n-modal
    :show="isOpen"
    preset="card"
    title="调教提示词"
    style="width: 560px"
    :mask-closable="!streaming"
    @update:show="onModalClose"
  >
    <div class="guidance-body">
      <div class="guidance-messages" ref="messagesRef">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="guidance-msg"
          :class="msg.role"
        >
          <div class="msg-role">{{ msg.role === "user" ? "你" : "AI" }}</div>
          <div class="msg-content" v-html="renderMarkdown(msg.content)"></div>
        </div>

        <div v-if="streaming" class="guidance-msg assistant">
          <div class="msg-role">AI 教练</div>
          <div v-if="!displayStreamingContent" class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
          <div
            v-else
            class="msg-content"
            v-html="renderMarkdown(displayStreamingContent)"
          ></div>
        </div>
      </div>

      <div v-if="isReady" class="ready-hint">
        <Icon icon="lucide:check-circle" :width="16" />
        提示词已优化，可以生成代码了！
      </div>

      <div class="guidance-input">
        <n-input
          v-model:value="draftPrompt"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 5 }"
          placeholder="修改你的提示词后发送..."
          :disabled="streaming"
          @keydown.enter.exact.prevent="send"
        />
        <n-flex justify="space-between" align="center" style="margin-top: 8px">
          <div>
            <n-button
              v-if="streaming"
              type="error"
              size="small"
              @click="stopGuidance"
            >
              停止
            </n-button>
            <n-button
              v-else
              size="small"
              :disabled="!draftPrompt.trim() || !connected"
              @click="send"
            >
              发送
            </n-button>
          </div>
          <n-button
            :type="isReady ? 'primary' : 'default'"
            size="small"
            :disabled="!draftPrompt.trim()"
            @click="generate"
          >
            <template #icon>
              <Icon icon="lucide:play" :width="14" />
            </template>
            生成代码
          </n-button>
        </n-flex>
      </div>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue"
import { marked } from "marked"
import { Icon } from "@iconify/vue"
import {
  messages,
  streaming,
  streamingContent,
  isReady,
  isOpen,
  connected,
  initialPrompt,
  sendGuidance,
  stopGuidance,
  closeGuidance,
} from "../../store/guidance"

const emit = defineEmits<{
  generate: [prompt: string]
}>()

const draftPrompt = ref("")
const messagesRef = ref<HTMLElement>()

const displayStreamingContent = computed(() =>
  streamingContent.value.replace(/^\[READY\]\n?/, "")
)

function renderMarkdown(text: string): string {
  return marked.parse(text) as string
}

function send() {
  const text = draftPrompt.value.trim()
  if (!text || streaming.value) return
  sendGuidance(text)
}

function generate() {
  const text = draftPrompt.value.trim()
  if (!text) return
  emit("generate", text)
  closeGuidance()
}

function onModalClose(show: boolean) {
  if (!show && !streaming.value) closeGuidance()
}

// Pre-fill draft when panel opens
watch(isOpen, (val) => {
  if (val) draftPrompt.value = initialPrompt.value
})

watch([() => messages.value.length, streamingContent], () => {
  nextTick(() => {
    if (messagesRef.value)
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  })
})
</script>

<style scoped>
.guidance-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.guidance-messages {
  min-height: 160px;
  max-height: 360px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.guidance-msg .msg-role {
  font-size: 12px;
  font-weight: bold;
  margin-bottom: 4px;
  color: #888;
}

.guidance-msg.user .msg-role { color: #2080f0; }
.guidance-msg.assistant .msg-role { color: #18a058; }

.guidance-msg.assistant .msg-content {
  background: #f0f7ff;
  border-left: 3px solid #2080f0;
  padding: 8px 12px;
  border-radius: 0 6px 6px 0;
  font-size: 14px;
  line-height: 1.6;
}

.guidance-msg.user .msg-content {
  font-size: 14px;
  line-height: 1.6;
  color: #333;
}

.ready-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #18a058;
  font-size: 13px;
  font-weight: 500;
  padding: 6px 10px;
  background: #f0fff4;
  border-radius: 6px;
  border: 1px solid #b8e8cc;
}

.typing-indicator {
  display: flex;
  gap: 5px;
  padding: 8px 0;
}

.typing-indicator span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #2080f0;
  animation: bounce 1.4s ease-in-out infinite;
}

.typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
.typing-indicator span:nth-child(3) { animation-delay: 0.4s; }

@keyframes bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-5px); opacity: 1; }
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /home/xuyue/Projects/webpreview add client/src/components/ai/GuidancePanel.vue
git -C /home/xuyue/Projects/webpreview commit -m "feat: add GuidancePanel coaching modal component"
```

---

### Task 7: Frontend — Wire GuidancePanel into PromptPanel

**Files:**
- Modify: `client/src/components/ai/PromptPanel.vue`

- [ ] **Step 1: Add imports to `<script setup>` in `PromptPanel.vue`**

Add this new import line after the other import statements:

```typescript
import GuidancePanel from "./GuidancePanel.vue"
import { openGuidance } from "../../store/guidance"
```

In the existing `import { messages, streaming, ... } from "../../store/prompt"` line, add `currentTaskId` to the list:

```typescript
import {
  messages,
  streaming,
  streamingContent,
  connected,
  sendPrompt,
  stopPrompt,
  currentTaskId,
} from "../../store/prompt"
```

- [ ] **Step 2: Add `startGuidance` and `onGuidanceGenerate` functions**

Add after the `send` function:

```typescript
function startGuidance() {
  if (!input.value.trim()) return
  openGuidance(currentTaskId.value, input.value)
}

function onGuidanceGenerate(finalPrompt: string) {
  sendPrompt(finalPrompt, selectedModel.value)
  input.value = ""
}
```

- [ ] **Step 3: Add GuidancePanel to template and lightbulb button to input area**

In the template, add `<GuidancePanel @generate="onGuidanceGenerate" />` just before `<div class="input-area">`:

```html
    <GuidancePanel @generate="onGuidanceGenerate" />
    <div class="input-area">
```

In the `<n-flex>` inside `.input-area`, add the lightbulb button before the model selector. Replace:

```html
      <n-flex justify="flex-end" align="center" style="margin-top: 8px">
        <n-select
```

With:

```html
      <n-flex justify="flex-end" align="center" style="margin-top: 8px">
        <n-button
          secondary
          :disabled="!input.trim()"
          title="调教提示词"
          @click="startGuidance"
        >
          <template #icon>
            <Icon icon="lucide:lightbulb" :width="16" />
          </template>
        </n-button>
        <n-select
```

- [ ] **Step 4: Verify build**

```bash
cd client && npm run build 2>&1 | tail -30
```

Expected: Build succeeds, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git -C /home/xuyue/Projects/webpreview add client/src/components/ai/PromptPanel.vue
git -C /home/xuyue/Projects/webpreview commit -m "feat: integrate GuidancePanel into PromptPanel"
```

---

## Manual Smoke Test

After all tasks complete, start both servers and test the full flow:

```bash
# Terminal 1
cd api && uv run manage.py runserver

# Terminal 2
cd client && npm run start
```

1. Open a Challenge page
2. Type a vague prompt like "做一个好看的页面" in the input
3. Click the lightbulb button — guidance modal should open and AI should respond with guiding questions
4. Revise the prompt to include specific details
5. AI should respond with `[READY]` prefix (stripped) and the "生成代码" button should highlight green
6. Click "生成代码" — modal closes, code is generated in the main panel
7. Verify guidance messages are saved in Django admin under `prompt > Messages` with `source=guidance`
