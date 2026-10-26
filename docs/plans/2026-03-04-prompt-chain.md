# Prompt Chain Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an AI-powered prompt chain system where students interact with a built-in AI to generate web pages for challenges, and the full prompt history is recorded and viewable.

**Architecture:** New `prompt` Django app replaces the stub `chat` app. An `AsyncWebsocketConsumer` handles real-time AI conversation via WebSocket, calling a domestic LLM API (OpenAI-compatible). The frontend adds a `PromptPanel` chat UI and a `ChallengeHome` layout that replaces editors with the AI conversation panel in challenge mode.

**Tech Stack:** Django Channels (async consumer), `openai` Python SDK (for OpenAI-compatible domestic LLM APIs like DeepSeek/Qwen), Vue 3 composables for WebSocket state management.

---

### Task 1: Create `prompt` Django app with models

**Files:**
- Create: `api/prompt/__init__.py`
- Create: `api/prompt/apps.py`
- Create: `api/prompt/models.py`
- Create: `api/prompt/admin.py`
- Modify: `api/api/settings.py` — add `"prompt"` to INSTALLED_APPS

**Step 1: Create the app directory and files**

```bash
cd /home/xuyue/Projects/webpreview/api
mkdir -p prompt
touch prompt/__init__.py
```

**Step 2: Write `prompt/apps.py`**

```python
from django.apps import AppConfig


class PromptConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "prompt"
    verbose_name = "Prompt"
```

**Step 3: Write `prompt/models.py`**

```python
import uuid
from django.db import models
from django_extensions.db.models import TimeStampedModel
from account.models import User
from task.models import Task


class Conversation(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="conversations")
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="conversations")
    is_active = models.BooleanField(default=True, verbose_name="是否活跃")

    class Meta:
        ordering = ("-created",)

    def __str__(self):
        return f"{self.user.username} - {self.task.title}"


class Message(models.Model):
    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name="messages"
    )
    role = models.CharField(max_length=10)  # "user" or "assistant"
    content = models.TextField()
    code_html = models.TextField(null=True, blank=True)
    code_css = models.TextField(null=True, blank=True)
    code_js = models.TextField(null=True, blank=True)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created",)

    def __str__(self):
        return f"[{self.role}] {self.content[:50]}"
```

**Step 4: Write `prompt/admin.py`**

```python
from django.contrib import admin
from .models import Conversation, Message


class MessageInline(admin.TabularInline):
    model = Message
    extra = 0
    readonly_fields = ("role", "content", "code_html", "code_css", "code_js", "created")


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ("user", "task", "is_active", "created")
    list_filter = ("is_active",)
    inlines = [MessageInline]
```

**Step 5: Add `"prompt"` to INSTALLED_APPS in `api/api/settings.py`**

Find the `INSTALLED_APPS` list and add `"prompt"` after `"chat"` (or replace `"chat"`). Keep `"chat"` for now until migration is done.

**Step 6: Run migrations**

```bash
cd /home/xuyue/Projects/webpreview/api
uv run manage.py makemigrations prompt
uv run manage.py migrate
```

**Step 7: Commit**

```bash
git add api/prompt/
git commit -m "feat: add prompt app with Conversation and Message models"
```

---

### Task 2: Add `conversation` FK to Submission model

**Files:**
- Modify: `api/submission/models.py` — add `conversation` field
- Modify: `api/submission/schemas.py` — add `conversation_id` to input/output
- Modify: `api/submission/api.py` — wire `conversation_id` on create

**Step 1: Add field to `api/submission/models.py`**

Add this import at the top:
```python
from prompt.models import Conversation
```

Add this field to the `Submission` class, after the `js` field:
```python
    conversation = models.ForeignKey(
        Conversation, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="submissions", verbose_name="对话"
    )
```

**Step 2: Update `api/submission/schemas.py`**

Add to `SubmissionIn`:
```python
    conversation_id: Optional[UUID] = None
```

Add to the `SubmissionOut` schema and the `list`/`get` static methods:
```python
    conversation_id: Optional[UUID] = None
```

In `SubmissionOut.list()`, add:
```python
    "conversation_id": submission.conversation_id,
```

In `SubmissionOut.get()`, add:
```python
    "conversation_id": submission.conversation_id,
```

**Step 3: Update `api/submission/api.py` `create_submission`**

```python
@router.post("/")
@login_required
def create_submission(request, payload: SubmissionIn):
    task = get_object_or_404(Task, id=payload.task_id)
    conversation = None
    if payload.conversation_id:
        from prompt.models import Conversation
        conversation = get_object_or_404(
            Conversation, id=payload.conversation_id, user=request.user
        )
        conversation.is_active = False
        conversation.save(update_fields=["is_active"])
    Submission.objects.create(
        user=request.user, task=task,
        html=payload.html, css=payload.css, js=payload.js,
        conversation=conversation,
    )
```

**Step 4: Run migrations**

```bash
cd /home/xuyue/Projects/webpreview/api
uv run manage.py makemigrations submission
uv run manage.py migrate
```

**Step 5: Commit**

```bash
git add api/submission/
git commit -m "feat: link Submission to Conversation via FK"
```

---

### Task 3: Add `openai` dependency for LLM API calls

**Files:**
- Modify: `api/pyproject.toml` — add `openai` dependency
- Create: `api/prompt/llm.py` — LLM client helper

**Step 1: Add dependency**

```bash
cd /home/xuyue/Projects/webpreview/api
uv add openai
```

**Step 2: Add LLM config to `api/api/settings.py`**

Add at the bottom of settings:
```python
# LLM Configuration
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.deepseek.com")
LLM_MODEL = os.environ.get("LLM_MODEL", "deepseek-chat")
```

**Step 3: Write `api/prompt/llm.py`**

```python
import re
from django.conf import settings
from openai import AsyncOpenAI


client = AsyncOpenAI(
    api_key=settings.LLM_API_KEY,
    base_url=settings.LLM_BASE_URL,
)

SYSTEM_PROMPT = """你是一个网页生成助手。根据用户的需求描述，生成 HTML、CSS 和 JavaScript 代码。

规则：
1. 始终使用三个独立的代码块返回代码，分别用 ```html、```css、```js 标记
2. HTML 代码只需要 body 内的内容，不需要完整的 HTML 文档结构
3. CSS 和 JS 可以为空，但仍然需要返回空的代码块
4. 用中文回复，先简要说明你做了什么，然后给出代码
5. 在已有代码基础上修改时，返回完整的修改后代码，不要只返回片段"""


def build_messages(task_content: str, history: list[dict]) -> list[dict]:
    """Build the message list for the LLM API call."""
    system = SYSTEM_PROMPT + f"\n\n当前挑战任务要求：\n{task_content}"
    messages = [{"role": "system", "content": system}]
    messages.extend(history)
    return messages


async def stream_chat(task_content: str, history: list[dict]):
    """Stream chat completion from the LLM. Yields content chunks."""
    messages = build_messages(task_content, history)
    stream = await client.chat.completions.create(
        model=settings.LLM_MODEL,
        messages=messages,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content


def extract_code(text: str) -> dict:
    """Extract HTML, CSS, JS code blocks from AI response text."""
    result = {"html": None, "css": None, "js": None}
    pattern = r"```(html|css|js|javascript)\s*\n(.*?)```"
    matches = re.findall(pattern, text, re.DOTALL)
    for lang, code in matches:
        lang = lang.lower()
        if lang == "javascript":
            lang = "js"
        if lang in result:
            result[lang] = code.strip()
    return result
```

**Step 4: Commit**

```bash
git add api/pyproject.toml api/uv.lock api/prompt/llm.py api/api/settings.py
git commit -m "feat: add LLM client with streaming support and code extraction"
```

---

### Task 4: Implement WebSocket consumer

**Files:**
- Create: `api/prompt/consumers.py`
- Create: `api/prompt/url.py`
- Modify: `api/api/asgi.py` — update WebSocket routing

**Step 1: Write `api/prompt/consumers.py`**

```python
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import Conversation, Message
from .llm import stream_chat, extract_code


class PromptConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope["user"]
        if self.user.is_anonymous:
            await self.close()
            return

        self.task_id = int(self.scope["url_route"]["kwargs"]["task_id"])
        await self.accept()

        # Load or create conversation, send history
        self.conversation = await self.get_or_create_conversation()
        history = await self.get_history()
        await self.send(text_data=json.dumps({
            "type": "init",
            "conversation_id": str(self.conversation.id),
            "messages": history,
        }))

    async def disconnect(self, close_code):
        pass

    async def receive(self, text_data):
        data = json.loads(text_data)
        msg_type = data.get("type", "message")

        if msg_type == "new_conversation":
            self.conversation = await self.create_conversation()
            await self.send(text_data=json.dumps({
                "type": "init",
                "conversation_id": str(self.conversation.id),
                "messages": [],
            }))
            return

        prompt = data.get("content", "").strip()
        if not prompt:
            return

        # Save user message
        await self.save_message("user", prompt)

        # Build history for LLM
        history = await self.get_history_for_llm()
        task_content = await self.get_task_content()

        # Stream AI response
        full_response = ""
        try:
            async for chunk in stream_chat(task_content, history):
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

        # Extract code and save assistant message
        code = extract_code(full_response)
        await self.save_message("assistant", full_response, code)

        # Send completion with extracted code
        await self.send(text_data=json.dumps({
            "type": "complete",
            "code": code,
        }))

    @database_sync_to_async
    def get_or_create_conversation(self):
        conv = Conversation.objects.filter(
            user=self.user, task_id=self.task_id, is_active=True
        ).first()
        if not conv:
            conv = Conversation.objects.create(user=self.user, task_id=self.task_id)
        return conv

    @database_sync_to_async
    def create_conversation(self):
        # Deactivate old conversations for this user+task
        Conversation.objects.filter(
            user=self.user, task_id=self.task_id, is_active=True
        ).update(is_active=False)
        return Conversation.objects.create(user=self.user, task_id=self.task_id)

    @database_sync_to_async
    def save_message(self, role, content, code=None):
        return Message.objects.create(
            conversation=self.conversation,
            role=role,
            content=content,
            code_html=code.get("html") if code else None,
            code_css=code.get("css") if code else None,
            code_js=code.get("js") if code else None,
        )

    @database_sync_to_async
    def get_history(self):
        messages = self.conversation.messages.all()
        return [
            {
                "role": m.role,
                "content": m.content,
                "code": {
                    "html": m.code_html,
                    "css": m.code_css,
                    "js": m.code_js,
                } if m.role == "assistant" else None,
                "created": m.created.isoformat(),
            }
            for m in messages
        ]

    @database_sync_to_async
    def get_history_for_llm(self):
        messages = self.conversation.messages.all()
        return [{"role": m.role, "content": m.content} for m in messages]

    @database_sync_to_async
    def get_task_content(self):
        from task.models import Task
        task = Task.objects.get(id=self.task_id)
        return task.content
```

**Step 2: Write `api/prompt/url.py`**

```python
from django.urls import path
from .consumers import PromptConsumer

websocket_urlpatterns = [
    path("ws/prompt/<int:task_id>/", PromptConsumer.as_asgi()),
]
```

**Step 3: Update `api/api/asgi.py`**

Replace the import and routing:

```python
"""
ASGI config for api project.
"""

import os

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from channels.security.websocket import AllowedHostsOriginValidator

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "api.settings")

from prompt.url import websocket_urlpatterns

application = ProtocolTypeRouter(
    {
        "http": get_asgi_application(),
        "websocket": AllowedHostsOriginValidator(
            AuthMiddlewareStack(URLRouter(websocket_urlpatterns))
        ),
    }
)
```

**Step 4: Commit**

```bash
git add api/prompt/consumers.py api/prompt/url.py api/api/asgi.py
git commit -m "feat: add PromptConsumer with streaming AI and code extraction"
```

---

### Task 5: Create REST API for prompt history

**Files:**
- Create: `api/prompt/schemas.py`
- Create: `api/prompt/api.py`
- Modify: `api/api/urls.py` — register prompt router

**Step 1: Write `api/prompt/schemas.py`**

```python
from typing import Optional
from uuid import UUID
from ninja import Schema


class MessageOut(Schema):
    id: int
    role: str
    content: str
    code_html: Optional[str] = None
    code_css: Optional[str] = None
    code_js: Optional[str] = None
    created: str


class ConversationOut(Schema):
    id: UUID
    user_id: int
    username: str
    task_id: int
    task_title: str
    is_active: bool
    message_count: int
    created: str

    @staticmethod
    def from_conv(conv):
        return {
            "id": conv.id,
            "user_id": conv.user_id,
            "username": conv.user.username,
            "task_id": conv.task_id,
            "task_title": conv.task.title,
            "is_active": conv.is_active,
            "message_count": conv.messages.count(),
            "created": conv.created.isoformat(),
        }
```

**Step 2: Write `api/prompt/api.py`**

```python
from typing import List
from uuid import UUID
from ninja import Router
from django.shortcuts import get_object_or_404
from django.contrib.auth.decorators import login_required

from .models import Conversation, Message
from .schemas import ConversationOut, MessageOut

router = Router()


@router.get("/conversations/", response=List[ConversationOut])
@login_required
def list_conversations(request, task_id: int = None, user_id: int = None):
    convs = Conversation.objects.select_related("user", "task")
    # Normal users can only see their own
    if request.user.role == "normal":
        convs = convs.filter(user=request.user)
    elif user_id:
        convs = convs.filter(user_id=user_id)
    if task_id:
        convs = convs.filter(task_id=task_id)
    return [ConversationOut.from_conv(c) for c in convs]


@router.get("/conversations/{conversation_id}/messages/", response=List[MessageOut])
@login_required
def list_messages(request, conversation_id: UUID):
    conv = get_object_or_404(Conversation, id=conversation_id)
    # Normal users can only see their own
    if request.user.role == "normal" and conv.user != request.user:
        return []
    messages = conv.messages.all()
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "code_html": m.code_html,
            "code_css": m.code_css,
            "code_js": m.code_js,
            "created": m.created.isoformat(),
        }
        for m in messages
    ]
```

**Step 3: Update `api/api/urls.py`**

Add the prompt router:

```python
api.add_router("prompt/", "prompt.api.router")
```

**Step 4: Commit**

```bash
git add api/prompt/schemas.py api/prompt/api.py api/api/urls.py
git commit -m "feat: add REST API for prompt conversation history"
```

---

### Task 6: Add LLM env vars and update docker-compose

**Files:**
- Modify: `docker-compose.yaml` — add LLM env vars to api service
- Create/Modify: `.env.example` — document new env vars

**Step 1: Add env vars to `docker-compose.yaml`**

In the `api` service `environment` section, add:
```yaml
      - LLM_API_KEY=${LLM_API_KEY}
      - LLM_BASE_URL=${LLM_BASE_URL:-https://api.deepseek.com}
      - LLM_MODEL=${LLM_MODEL:-deepseek-chat}
```

**Step 2: Add to `.env` file (local)**

```
LLM_API_KEY=your-api-key-here
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
```

**Step 3: Commit**

```bash
git add docker-compose.yaml
git commit -m "feat: add LLM configuration env vars"
```

---

### Task 7: Frontend — Create prompt store and WebSocket client

**Files:**
- Create: `client/src/store/prompt.ts`
- Modify: `client/src/utils/const.ts` — add WS URL constant
- Modify: `client/src/utils/type.ts` — add prompt types (if it exists)

**Step 1: Add WebSocket base URL to `client/src/utils/const.ts`**

Add after the existing constants:
```typescript
export const WS_BASE_URL = import.meta.env.PUBLIC_WS_URL || `ws://${window.location.host}`
```

**Step 2: Write `client/src/store/prompt.ts`**

```typescript
import { ref, reactive } from "vue"
import { WS_BASE_URL } from "../utils/const"
import { html, css, js } from "./editors"

export interface PromptMessage {
  role: "user" | "assistant"
  content: string
  code?: { html: string | null; css: string | null; js: string | null }
  created?: string
}

export const messages = ref<PromptMessage[]>([])
export const conversationId = ref<string>("")
export const connected = ref(false)
export const streaming = ref(false)
export const streamingContent = ref("")

let ws: WebSocket | null = null

export function connectPrompt(taskId: number) {
  if (ws) ws.close()

  ws = new WebSocket(`${WS_BASE_URL}/ws/prompt/${taskId}/`)

  ws.onopen = () => {
    connected.value = true
  }

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)

    if (data.type === "init") {
      conversationId.value = data.conversation_id
      messages.value = data.messages || []
      // Apply code from last assistant message if exists
      const lastAssistant = [...messages.value]
        .reverse()
        .find((m) => m.role === "assistant" && m.code)
      if (lastAssistant?.code) {
        applyCode(lastAssistant.code)
      }
    } else if (data.type === "stream") {
      streaming.value = true
      streamingContent.value += data.content
    } else if (data.type === "complete") {
      streaming.value = false
      // Push the full assistant message
      messages.value.push({
        role: "assistant",
        content: streamingContent.value,
        code: data.code,
      })
      streamingContent.value = ""
      // Apply code to editors
      if (data.code) {
        applyCode(data.code)
      }
    } else if (data.type === "error") {
      streaming.value = false
      streamingContent.value = ""
      messages.value.push({
        role: "assistant",
        content: data.content,
      })
    }
  }

  ws.onclose = () => {
    connected.value = false
  }
}

export function disconnectPrompt() {
  if (ws) {
    ws.close()
    ws = null
  }
  messages.value = []
  conversationId.value = ""
  connected.value = false
  streaming.value = false
  streamingContent.value = ""
}

export function sendPrompt(content: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  messages.value.push({ role: "user", content })
  ws.send(JSON.stringify({ type: "message", content }))
}

export function newConversation() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: "new_conversation" }))
}

function applyCode(code: { html: string | null; css: string | null; js: string | null }) {
  if (code.html !== null) html.value = code.html
  if (code.css !== null) css.value = code.css
  if (code.js !== null) js.value = code.js
}
```

**Step 3: Commit**

```bash
git add client/src/store/prompt.ts client/src/utils/const.ts
git commit -m "feat: add prompt store with WebSocket client and editor integration"
```

---

### Task 8: Frontend — Create PromptPanel component

**Files:**
- Create: `client/src/components/PromptPanel.vue`

**Step 1: Write `client/src/components/PromptPanel.vue`**

```vue
<template>
  <div class="prompt-panel">
    <div class="messages" ref="messagesRef">
      <div v-for="(msg, i) in messages" :key="i" :class="['message', msg.role]">
        <div class="message-role">{{ msg.role === 'user' ? '我' : 'AI' }}</div>
        <div class="message-content" v-html="renderContent(msg)"></div>
      </div>
      <div v-if="streaming" class="message assistant">
        <div class="message-role">AI</div>
        <div class="message-content" v-html="renderMarkdown(streamingContent)"></div>
      </div>
    </div>
    <div class="input-area">
      <n-input
        v-model:value="input"
        type="textarea"
        :autosize="{ minRows: 1, maxRows: 4 }"
        placeholder="描述你想要的网页效果..."
        :disabled="streaming"
        @keydown.enter.exact.prevent="send"
      />
      <n-flex justify="space-between" align="center" style="margin-top: 8px">
        <n-button text size="small" @click="newConversation" :disabled="streaming">
          新对话
        </n-button>
        <n-button
          type="primary"
          :loading="streaming"
          :disabled="!input.trim() || streaming"
          @click="send"
        >
          发送
        </n-button>
      </n-flex>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue"
import { marked } from "marked"
import {
  messages,
  streaming,
  streamingContent,
  sendPrompt,
  newConversation,
} from "../store/prompt"

const input = ref("")
const messagesRef = ref<HTMLElement>()

function send() {
  const text = input.value.trim()
  if (!text || streaming.value) return
  sendPrompt(text)
  input.value = ""
}

function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string
}

function renderContent(msg: { role: string; content: string }): string {
  return renderMarkdown(msg.content)
}

// Auto-scroll to bottom on new messages
watch(
  [() => messages.value.length, streamingContent],
  () => {
    nextTick(() => {
      if (messagesRef.value) {
        messagesRef.value.scrollTop = messagesRef.value.scrollHeight
      }
    })
  }
)
</script>

<style scoped>
.prompt-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.message {
  margin-bottom: 16px;
}

.message-role {
  font-size: 12px;
  font-weight: bold;
  margin-bottom: 4px;
  color: #666;
}

.message.user .message-role {
  color: #2080f0;
}

.message.assistant .message-role {
  color: #18a058;
}

.message-content {
  font-size: 14px;
  line-height: 1.6;
}

.message-content :deep(pre) {
  background: #f5f5f5;
  padding: 8px 12px;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 13px;
}

.input-area {
  padding: 12px;
  border-top: 1px solid #e0e0e0;
}
</style>
```

**Step 2: Commit**

```bash
git add client/src/components/PromptPanel.vue
git commit -m "feat: add PromptPanel component with chat UI"
```

---

### Task 9: Frontend — Create ChallengeHome layout

**Files:**
- Create: `client/src/pages/ChallengeHome.vue`

**Step 1: Write `client/src/pages/ChallengeHome.vue`**

This page replaces `Home.vue` when in challenge mode with a selected challenge.

```vue
<template>
  <n-split :size="leftSize" min="350px" max="700px">
    <template #1>
      <div class="left-panel">
        <n-split direction="vertical" :size="topSize" min="100px">
          <template #1>
            <div class="challenge-desc">
              <n-flex align="center" style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0">
                <n-button text @click="back">
                  <Icon :width="20" icon="pepicons-pencil:arrow-left" />
                </n-button>
                <span style="font-weight: bold">{{ challengeTitle }}</span>
              </n-flex>
              <div class="markdown-body" style="padding: 12px" v-html="challengeContent" />
            </div>
          </template>
          <template #2>
            <PromptPanel />
          </template>
        </n-split>
      </div>
    </template>
    <template #2>
      <div class="right-panel">
        <Preview :html="html" :css="css" :js="js" />
        <n-flex class="toolbar" align="center" :size="8">
          <n-button secondary @click="showCode = true">查看代码</n-button>
          <n-button
            type="primary"
            :disabled="!conversationId"
            :loading="submitLoading"
            @click="submit"
          >
            提交作品
          </n-button>
        </n-flex>
      </div>
    </template>
  </n-split>
  <n-modal v-model:show="showCode" preset="card" title="代码" style="width: 700px">
    <n-tabs type="line">
      <n-tab-pane name="html" tab="HTML">
        <n-code :code="html" language="html" />
      </n-tab-pane>
      <n-tab-pane name="css" tab="CSS">
        <n-code :code="css" language="css" />
      </n-tab-pane>
      <n-tab-pane name="js" tab="JS">
        <n-code :code="js" language="javascript" />
      </n-tab-pane>
    </n-tabs>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue"
import { useRoute, useRouter } from "vue-router"
import { Icon } from "@iconify/vue"
import { marked } from "marked"
import PromptPanel from "../components/PromptPanel.vue"
import Preview from "../components/Preview.vue"
import { Challenge, Submission } from "../api"
import { html, css, js } from "../store/editors"
import { taskId } from "../store/task"
import { connectPrompt, disconnectPrompt, conversationId } from "../store/prompt"

const route = useRoute()
const router = useRouter()

const leftSize = ref(0.4)
const topSize = ref(0.35)
const challengeTitle = ref("")
const challengeContent = ref("")
const showCode = ref(false)
const submitLoading = ref(false)

async function loadChallenge() {
  const display = Number(route.params.display)
  const data = await Challenge.get(display)
  taskId.value = data.task_ptr
  challengeTitle.value = `#${data.display} ${data.title}`
  challengeContent.value = await marked.parse(data.content, { async: true })
  connectPrompt(data.task_ptr)
}

function back() {
  disconnectPrompt()
  router.push({ name: "home-challenge-list" })
}

async function submit() {
  if (!conversationId.value) return
  submitLoading.value = true
  try {
    await Submission.create(taskId.value, {
      html: html.value,
      css: css.value,
      js: js.value,
      conversationId: conversationId.value,
    })
    window.$message?.success("提交成功")
  } finally {
    submitLoading.value = false
  }
}

onMounted(loadChallenge)
onUnmounted(disconnectPrompt)
</script>

<style scoped>
.left-panel {
  height: 100%;
  overflow: hidden;
}

.challenge-desc {
  height: 100%;
  overflow-y: auto;
}

.right-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.toolbar {
  padding: 8px 12px;
  border-top: 1px solid #e0e0e0;
  justify-content: flex-end;
}
</style>
```

**Step 2: Commit**

```bash
git add client/src/pages/ChallengeHome.vue
git commit -m "feat: add ChallengeHome page with AI conversation and preview layout"
```

---

### Task 10: Frontend — Update router and API client

**Files:**
- Modify: `client/src/router.ts` — add ChallengeHome route
- Modify: `client/src/api.ts` — add `conversation_id` to Submission.create, add Prompt API

**Step 1: Update `client/src/router.ts`**

Add the ChallengeHome import and change the challenge/:display route:

```typescript
const ChallengeHome = () => import("./pages/ChallengeHome.vue")
```

Change the route for `home-challenge` from using `Home` to `ChallengeHome`:
```typescript
{ path: "/challenge/:display", name: "home-challenge", component: ChallengeHome },
```

Keep all other routes unchanged.

**Step 2: Update `client/src/api.ts`**

Update `Submission.create` to accept `conversationId`:
```typescript
  async create(taskId: number, data: { html: string; css: string; js: string; conversationId?: string }) {
    return http.post("/submission/", {
      task_id: taskId,
      html: data.html,
      css: data.css,
      js: data.js,
      conversation_id: data.conversationId || null,
    })
  },
```

Add a new `Prompt` export:
```typescript
export const Prompt = {
  async listConversations(taskId?: number, userId?: number) {
    const params: any = {}
    if (taskId) params.task_id = taskId
    if (userId) params.user_id = userId
    return (await http.get("/prompt/conversations/", { params })).data
  },
  async getMessages(conversationId: string) {
    return (await http.get(`/prompt/conversations/${conversationId}/messages/`)).data
  },
}
```

**Step 3: Commit**

```bash
git add client/src/router.ts client/src/api.ts
git commit -m "feat: update router for ChallengeHome and add prompt API client"
```

---

### Task 11: Frontend — Add prompt chain viewer to Submissions page

**Files:**
- Modify: `client/src/pages/Submissions.vue` — add "查看思维链" button and modal

**Step 1: Study `Submissions.vue` current structure**

Read the file to understand current table columns and layout.

**Step 2: Add prompt chain viewer**

Add a new column to the submissions table:
```typescript
{
  title: "思维链",
  key: "conversation_id",
  render(row) {
    if (!row.conversation_id) return "-"
    return h(NButton, { text: true, type: "primary", onClick: () => showChain(row.conversation_id) }, () => "查看")
  }
}
```

Add a modal that displays the prompt chain conversation:
```vue
<n-modal v-model:show="chainVisible" preset="card" title="Prompt 思维链" style="width: 700px; max-height: 80vh">
  <div v-for="msg in chainMessages" :key="msg.id" style="margin-bottom: 16px">
    <div style="font-weight: bold; color: msg.role === 'user' ? '#2080f0' : '#18a058'">
      {{ msg.role === 'user' ? '学生' : 'AI' }}
    </div>
    <div v-html="renderMarkdown(msg.content)" />
  </div>
</n-modal>
```

Add the `showChain` function that calls `Prompt.getMessages(conversationId)`.

**Step 3: Commit**

```bash
git add client/src/pages/Submissions.vue
git commit -m "feat: add prompt chain viewer to submissions page"
```

---

### Task 12: Remove old `chat` app

**Files:**
- Delete: `api/chat/` directory
- Modify: `api/api/settings.py` — remove `"chat"` from INSTALLED_APPS

**Step 1: Remove `chat` from INSTALLED_APPS**

Edit `api/api/settings.py`, remove `"chat"` from the `INSTALLED_APPS` list.

**Step 2: Delete `api/chat/` directory**

```bash
rm -rf /home/xuyue/Projects/webpreview/api/chat/
```

**Step 3: Run migrations to clean up**

```bash
cd /home/xuyue/Projects/webpreview/api
uv run manage.py migrate
```

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove old chat app, replaced by prompt"
```

---

### Task 13: Update Caddyfile for WebSocket routing

**Files:**
- Check: `Caddyfile` — verify `ws*` routing already covers `ws/prompt/`

**Step 1: Read `Caddyfile` and verify**

The existing Caddyfile routes `/ws*` to the backend. Since the new WebSocket path is `ws/prompt/{task_id}/`, it should already be covered. Verify and update if needed.

**Step 2: Commit (only if changed)**

---

### Task 14: End-to-end manual testing

**Step 1: Set up LLM API key**

Add `LLM_API_KEY` to `.env` with a valid API key for the chosen provider.

**Step 2: Run backend**

```bash
cd /home/xuyue/Projects/webpreview/api
uv run manage.py migrate
uv run manage.py runserver
```

**Step 3: Run frontend**

```bash
cd /home/xuyue/Projects/webpreview/client
npm run start
```

**Step 4: Test flow**

1. Login as a student
2. Go to challenge list, click a challenge
3. Verify ChallengeHome layout loads (challenge desc top-left, prompt panel bottom-left, preview right)
4. Type a prompt, verify AI streams response and code fills preview
5. Send follow-up prompts, verify conversation history
6. Click "提交作品", verify submission includes conversation_id
7. Go to Submissions page, verify "查看思维链" button shows the prompt history
8. Login as teacher (admin/super), verify can view student conversations
