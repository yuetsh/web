# 删除 AI 对话轮次及关联提交 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学生可以在 AI 对话界面删除某一轮对话（一问一答），同时删除该 AI 回答自动生成的提交；反向亦然——从提交列表删提交时，同时删除关联的那对消息。

**Architecture:** 在 `prompt.Message`（assistant 消息）上加一个可空的 `OneToOneField` 指向 `submission.Submission`，在提交创建时由前端传入 `message_id` 完成关联。两个方向的级联删除都在接口层显式处理。前端在 PromptPanel 的每个对话轮次上显示删除按钮，点击后同时移除本地消息状态。

**Tech Stack:** Django Ninja, Django Channels (AsyncWebsocketConsumer), Vue 3, TypeScript, Naive UI

---

## 文件改动清单

| 文件 | 改动类型 |
|------|----------|
| `api/prompt/models.py` | 修改：新增 `submission` 字段 |
| `api/prompt/migrations/0005_message_add_submission_fk.py` | 新建 migration |
| `api/prompt/consumers.py` | 修改：`complete`/`init` 事件带 `message_id` |
| `api/prompt/api.py` | 修改：新增 `DELETE /messages/{message_id}/pair` 端点 |
| `api/prompt/tests.py` | 新建：后端接口测试 |
| `api/submission/schemas.py` | 修改：`SubmissionIn` 加 `message_id` |
| `api/submission/api.py` | 修改：create 关联消息；delete 级联删消息对 |
| `client/src/store/prompt.ts` | 修改：`PromptMessage` 加 `id`；回调传 `messageId` |
| `client/src/api.ts` | 修改：`Submission.create` 加 `messageId`；新增 `Prompt.deleteMessagePair` |
| `client/src/pages/ChallengeDetail.vue` | 修改：`setOnCodeComplete` 传 `messageId` |
| `client/src/components/ai/PromptPanel.vue` | 修改：消息分组 + 删除按钮 |

---

## Task 1：Message 模型添加 submission 外键

**Files:**
- Modify: `api/prompt/models.py`
- Create: `api/prompt/migrations/0005_message_add_submission_fk.py`（由 makemigrations 生成）

- [ ] **Step 1: 修改 `api/prompt/models.py`，添加 `submission` 字段**

  在 `Message` 类中，`prompt_level` 字段之后添加：

  ```python
  # api/prompt/models.py
  from django.db import models
  from django_extensions.db.models import TimeStampedModel
  from account.models import User
  from task.models import Task
  import uuid


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
      role = models.CharField(max_length=10)
      source = models.CharField(max_length=12, default="conversation")
      content = models.TextField()
      code_html = models.TextField(null=True, blank=True)
      code_css = models.TextField(null=True, blank=True)
      code_js = models.TextField(null=True, blank=True)
      created = models.DateTimeField(auto_now_add=True)
      prompt_level = models.IntegerField(
          null=True, blank=True, default=None, db_index=True, verbose_name="提示词层级"
      )
      submission = models.OneToOneField(
          "submission.Submission",
          null=True,
          blank=True,
          on_delete=models.SET_NULL,
          related_name="source_message",
      )

      class Meta:
          ordering = ("created",)

      def __str__(self):
          return f"[{self.role}] {self.content[:50]}"
  ```

- [ ] **Step 2: 生成 migration**

  ```bash
  cd api && uv run manage.py makemigrations prompt --name message_add_submission_fk
  ```

  预期输出：
  ```
  Migrations for 'prompt':
    prompt/migrations/0005_message_add_submission_fk.py
      - Add field submission to message
  ```

- [ ] **Step 3: 运行 migration**

  ```bash
  uv run manage.py migrate
  ```

  预期输出：末行包含 `Applying prompt.0005_message_add_submission_fk... OK`

---

## Task 2：WebSocket Consumer 发送 message_id

**Files:**
- Modify: `api/prompt/consumers.py`

- [ ] **Step 1: 修改 `consumers.py`，`save_message` 返回 Message 对象，`complete` 事件带 `message_id`，`init` 历史消息带 `id`**

  完整替换 `api/prompt/consumers.py`：

  ```python
  import json
  from channels.generic.websocket import AsyncWebsocketConsumer
  from channels.db import database_sync_to_async
  from django.db.models import Count
  from .models import Conversation, Message
  from .llm import stream_chat, extract_code


  class PromptConsumer(AsyncWebsocketConsumer):
      async def connect(self):
          self.user = self.scope["user"]
          if self.user.is_anonymous:
              await self.close()
              return

          self.task_id = int(self.scope["url_route"]["kwargs"]["task_id"])
          self.current_user_message = None
          await self.accept()

          self.conversation = await self.get_or_create_conversation()
          history = await self.get_history()
          await self.send(text_data=json.dumps({
              "type": "init",
              "conversation_id": str(self.conversation.id),
              "messages": history,
          }))

      async def disconnect(self, close_code):
          if self.current_user_message:
              await self.delete_message(self.current_user_message)
              self.current_user_message = None

      async def receive(self, text_data):
          data = json.loads(text_data)
          msg_type = data.get("type", "message")

          if msg_type == "new_conversation":
              return

          prompt = data.get("content", "").strip()
          model = data.get("model", "")
          if not prompt:
              return

          self.current_user_message = await self.save_message("user", prompt)

          try:
              history = await self.get_history_for_llm()

              full_response = ""
              try:
                  async for chunk in stream_chat(history, model=model):
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

              code = extract_code(full_response)
              assistant_msg = await self.save_message("assistant", full_response, code)
              self.current_user_message = None

              await self.send(text_data=json.dumps({
                  "type": "complete",
                  "code": code,
                  "message_id": assistant_msg.id,  # 新增
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
          messages = self.conversation.messages.filter(source="conversation")
          return [
              {
                  "id": m.id,  # 新增
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
          messages = self.conversation.messages.filter(source="conversation")
          return [{"role": m.role, "content": m.content} for m in messages]
  ```

- [ ] **Step 2: 启动后端，手动验证 WebSocket `complete` 事件包含 `message_id`**

  ```bash
  cd api && uv run manage.py runserver
  ```

  在浏览器打开挑战页，发送一条 AI 消息，在 DevTools Network → WS 帧中确认 `complete` 事件有 `message_id` 整数字段，`init` 事件每条消息有 `id` 字段。

---

## Task 3：Submission 创建时关联 message

**Files:**
- Modify: `api/submission/schemas.py`
- Modify: `api/submission/api.py`
- Create: `api/prompt/tests.py`

- [ ] **Step 1: 在 `SubmissionIn` 里加 `message_id`**

  修改 `api/submission/schemas.py`，在 `SubmissionIn` 末尾添加一行：

  ```python
  class SubmissionIn(Schema):
      task_id: int
      html: Optional[str] = None
      css: Optional[str] = None
      js: Optional[str] = None
      prompt: Optional[str] = None
      message_id: Optional[int] = None  # 新增：关联的 assistant message pk
  ```

- [ ] **Step 2: 写失败测试**

  新建 `api/prompt/tests.py`：

  ```python
  from django.test import TestCase
  from django.contrib.auth import get_user_model
  from task.models import Task
  from submission.models import Submission
  from prompt.models import Conversation, Message

  User = get_user_model()


  def _make_user(username="student1"):
      return User.objects.create_user(username=username, password="pw")


  def _make_task():
      return Task.objects.create(
          title="Test Task", task_type="challenge", display=1, content=""
      )


  class SubmissionMessageLinkTest(TestCase):
      def setUp(self):
          self.client.login(username="student1", password="pw")
          self.user = _make_user("student1")
          self.task = _make_task()
          self.conv = Conversation.objects.create(user=self.user, task=self.task)
          self.user_msg = Message.objects.create(
              conversation=self.conv, role="user", content="帮我做个按钮"
          )
          self.asst_msg = Message.objects.create(
              conversation=self.conv, role="assistant", content="好的",
              code_html="<button>OK</button>", code_css="", code_js=""
          )

      def test_create_submission_links_message(self):
          """POST /submission/ with message_id links the assistant message"""
          self.client.force_login(self.user)
          resp = self.client.post(
              "/api/submission/",
              data={
                  "task_id": self.task.id,
                  "html": "<button>OK</button>",
                  "css": "",
                  "js": "",
                  "message_id": self.asst_msg.id,
              },
              content_type="application/json",
          )
          self.assertEqual(resp.status_code, 200)
          self.asst_msg.refresh_from_db()
          sub = Submission.objects.filter(user=self.user, task=self.task).first()
          self.assertIsNotNone(sub)
          self.assertEqual(self.asst_msg.submission, sub)

      def test_create_submission_without_message_id(self):
          """POST /submission/ without message_id still works"""
          self.client.force_login(self.user)
          resp = self.client.post(
              "/api/submission/",
              data={"task_id": self.task.id, "html": "<p>hi</p>", "css": "", "js": ""},
              content_type="application/json",
          )
          self.assertEqual(resp.status_code, 200)
  ```

- [ ] **Step 3: 运行测试，确认失败**

  ```bash
  cd api && uv run manage.py test prompt.tests.SubmissionMessageLinkTest -v 2
  ```

  预期：`test_create_submission_links_message` FAIL（`asst_msg.submission` 仍为 None）

- [ ] **Step 4: 修改 `create_submission` 关联消息**

  在 `api/submission/api.py` 的 `create_submission` 函数末尾，`Submission.objects.create(...)` 之后添加关联逻辑：

  ```python
  @router.post("/")
  @login_required
  def create_submission(request, payload: SubmissionIn):
      task = get_object_or_404(Task, id=payload.task_id)

      if payload.prompt:
          conversation = (
              Conversation.objects.filter(user=request.user, task=task)
              .annotate(msg_count=Count("messages"))
              .order_by("-msg_count", "-created")
              .first()
          )
          if not conversation:
              conversation = Conversation.objects.create(
                  user=request.user, task=task, is_active=False
              )
          Message.objects.create(
              conversation=conversation, role="user", content=payload.prompt, source="manual"
          )
          Message.objects.create(
              conversation=conversation,
              role="assistant",
              content="",
              code_html=payload.html,
              code_css=payload.css,
              code_js=payload.js,
              source="manual",
          )
          from .classifier import classify_conversation_messages
          threading.Thread(target=classify_conversation_messages, args=(conversation.id,), daemon=True).start()
      else:
          conversation = (
              Conversation.objects.filter(user=request.user, task=task)
              .annotate(msg_count=Count("messages"))
              .order_by("-msg_count", "-created")
              .first()
          )
          if conversation:
              from .classifier import classify_conversation_messages
              threading.Thread(target=classify_conversation_messages, args=(conversation.id,), daemon=True).start()

      submission = Submission.objects.create(
          user=request.user,
          task=task,
          html=payload.html,
          css=payload.css,
          js=payload.js,
      )

      # 关联 assistant message（若前端传入了 message_id）
      if payload.message_id:
          from prompt.models import Message as PromptMessage
          try:
              msg = PromptMessage.objects.get(
                  id=payload.message_id,
                  role="assistant",
                  conversation__user=request.user,
              )
              msg.submission = submission
              msg.save(update_fields=["submission"])
          except PromptMessage.DoesNotExist:
              pass  # message_id 无效时静默忽略，提交本身已创建
  ```

  > 注意：`from prompt.models import Message as PromptMessage` 用别名是因为 `submission/api.py` 顶部已从 `prompt.models` 导入了 `Conversation` 和 `Message`。确认文件顶部已有 `from prompt.models import Conversation, Message`（`api.py` 第 10 行）——无需重复导入，直接用 `Message` 即可。实际写代码时检查顶部 import，若已有就直接用 `Message`。

- [ ] **Step 5: 运行测试，确认通过**

  ```bash
  cd api && uv run manage.py test prompt.tests.SubmissionMessageLinkTest -v 2
  ```

  预期：2 tests PASS

---

## Task 4：删除提交时级联删除关联消息对

**Files:**
- Modify: `api/submission/api.py`
- Modify: `api/prompt/tests.py`

- [ ] **Step 1: 写失败测试**

  在 `api/prompt/tests.py` 末尾追加：

  ```python
  class DeleteSubmissionCascadeTest(TestCase):
      def setUp(self):
          self.user = _make_user("student2")
          self.task = _make_task()
          self.conv = Conversation.objects.create(user=self.user, task=self.task)
          self.user_msg = Message.objects.create(
              conversation=self.conv, role="user", content="问题"
          )
          self.asst_msg = Message.objects.create(
              conversation=self.conv, role="assistant", content="回答",
              code_html="<p>hi</p>", code_css="", code_js=""
          )
          self.sub = Submission.objects.create(
              user=self.user, task=self.task, html="<p>hi</p>", css="", js=""
          )
          self.asst_msg.submission = self.sub
          self.asst_msg.save(update_fields=["submission"])

      def test_delete_submission_also_deletes_message_pair(self):
          """DELETE /submission/{id} deletes linked user+assistant messages"""
          self.client.force_login(self.user)
          resp = self.client.delete(f"/api/submission/{self.sub.id}")
          self.assertEqual(resp.status_code, 200)
          self.assertFalse(Submission.objects.filter(id=self.sub.id).exists())
          self.assertFalse(Message.objects.filter(id=self.asst_msg.id).exists())
          self.assertFalse(Message.objects.filter(id=self.user_msg.id).exists())

      def test_delete_submission_without_linked_message(self):
          """DELETE /submission/{id} works even with no linked message"""
          sub2 = Submission.objects.create(
              user=self.user, task=self.task, html="", css="", js=""
          )
          self.client.force_login(self.user)
          resp = self.client.delete(f"/api/submission/{sub2.id}")
          self.assertEqual(resp.status_code, 200)
          self.assertFalse(Submission.objects.filter(id=sub2.id).exists())
  ```

- [ ] **Step 2: 运行测试，确认失败**

  ```bash
  cd api && uv run manage.py test prompt.tests.DeleteSubmissionCascadeTest -v 2
  ```

  预期：`test_delete_submission_also_deletes_message_pair` FAIL（消息未被删除）

- [ ] **Step 3: 修改 `delete_submission` 端点**

  将 `api/submission/api.py` 中 `delete_submission` 函数替换为：

  ```python
  @router.delete("/{submission_id}")
  @login_required
  def delete_submission(request, submission_id: UUID):
      submission = get_object_or_404(Submission, id=submission_id)
      if submission.user != request.user:
          raise HttpError(403, "只能删除自己的提交")

      # 找到关联的 assistant message 及其前一条 user message，一并删除
      asst_msg = Message.objects.filter(submission=submission).first()
      if asst_msg:
          user_msg = (
              Message.objects.filter(
                  conversation=asst_msg.conversation,
                  created__lt=asst_msg.created,
                  role="user",
              )
              .order_by("-created")
              .first()
          )
          if user_msg:
              user_msg.delete()
          asst_msg.delete()

      submission.delete()
      return {"message": "删除成功"}
  ```

  同时确认文件顶部已导入 `Message`——当前第 10 行有 `from prompt.models import Conversation, Message`，无需额外修改。

- [ ] **Step 4: 运行测试，确认通过**

  ```bash
  cd api && uv run manage.py test prompt.tests.DeleteSubmissionCascadeTest -v 2
  ```

  预期：2 tests PASS

---

## Task 5：新增「删除消息对」接口

**Files:**
- Modify: `api/prompt/api.py`
- Modify: `api/prompt/tests.py`

- [ ] **Step 1: 写失败测试**

  在 `api/prompt/tests.py` 末尾追加：

  ```python
  class DeleteMessagePairTest(TestCase):
      def setUp(self):
          self.user = _make_user("student3")
          self.task = _make_task()
          self.conv = Conversation.objects.create(user=self.user, task=self.task)
          self.user_msg = Message.objects.create(
              conversation=self.conv, role="user", content="问题"
          )
          self.asst_msg = Message.objects.create(
              conversation=self.conv, role="assistant", content="回答",
              code_html="<p>ok</p>", code_css="", code_js=""
          )
          self.sub = Submission.objects.create(
              user=self.user, task=self.task, html="<p>ok</p>", css="", js=""
          )
          self.asst_msg.submission = self.sub
          self.asst_msg.save(update_fields=["submission"])

      def test_delete_message_pair_also_deletes_submission(self):
          self.client.force_login(self.user)
          resp = self.client.delete(f"/api/prompt/messages/{self.asst_msg.id}/pair")
          self.assertEqual(resp.status_code, 200)
          self.assertFalse(Message.objects.filter(id=self.asst_msg.id).exists())
          self.assertFalse(Message.objects.filter(id=self.user_msg.id).exists())
          self.assertFalse(Submission.objects.filter(id=self.sub.id).exists())
          data = resp.json()
          self.assertTrue(data["deleted"])
          self.assertTrue(data["submission_deleted"])

      def test_delete_message_pair_without_submission(self):
          asst2 = Message.objects.create(
              conversation=self.conv, role="assistant", content="另一条"
          )
          user2 = Message.objects.create(
              conversation=self.conv, role="user", content="另一问"
          )
          # 确保 asst2.created > user2.created（auto_now_add 按创建顺序）
          self.client.force_login(self.user)
          resp = self.client.delete(f"/api/prompt/messages/{asst2.id}/pair")
          self.assertEqual(resp.status_code, 200)
          data = resp.json()
          self.assertFalse(data["submission_deleted"])

      def test_delete_message_pair_forbidden_for_other_user(self):
          other = _make_user("other")
          self.client.force_login(other)
          resp = self.client.delete(f"/api/prompt/messages/{self.asst_msg.id}/pair")
          self.assertEqual(resp.status_code, 403)
  ```

- [ ] **Step 2: 运行测试，确认失败**

  ```bash
  cd api && uv run manage.py test prompt.tests.DeleteMessagePairTest -v 2
  ```

  预期：全部 FAIL（端点不存在，返回 404）

- [ ] **Step 3: 在 `api/prompt/api.py` 末尾添加新端点**

  ```python
  @router.delete("/messages/{message_id}/pair")
  @login_required
  def delete_message_pair(request, message_id: int):
      """
      删除一对消息（该 assistant message + 前一条 user message）及关联提交。
      只有消息所属对话的拥有者才能操作。
      """
      asst_msg = get_object_or_404(Message, id=message_id, role="assistant")

      if asst_msg.conversation.user != request.user:
          raise HttpError(403, "只能删除自己的消息")

      # 找前一条 user message
      user_msg = (
          Message.objects.filter(
              conversation=asst_msg.conversation,
              created__lt=asst_msg.created,
              role="user",
          )
          .order_by("-created")
          .first()
      )

      # 删关联提交
      submission_deleted = False
      if asst_msg.submission_id:
          try:
              asst_msg.submission.delete()
              submission_deleted = True
          except Exception:
              pass

      if user_msg:
          user_msg.delete()
      asst_msg.delete()

      return {"deleted": True, "submission_deleted": submission_deleted}
  ```

  > `asst_msg.submission` 在 `Submission` 被 `SET_NULL` 规则处理前需先删除——因为我们调用 `asst_msg.submission.delete()` 会触发 `Submission` 的删除，而 `Submission` 删除不再会尝试删 `asst_msg`（此时 `asst_msg` 还在，`SET_NULL` 会把它的 `submission` 字段置 null，但我们马上就要删它所以无妨）。

- [ ] **Step 4: 运行全部测试**

  ```bash
  cd api && uv run manage.py test prompt.tests -v 2
  ```

  预期：所有测试 PASS

---

## Task 6：前端 store 和 API 客户端

**Files:**
- Modify: `client/src/store/prompt.ts`
- Modify: `client/src/api.ts`

- [ ] **Step 1: 修改 `client/src/store/prompt.ts`**

  完整替换文件内容：

  ```typescript
  import { ref } from "vue"
  import { WS_BASE_URL } from "../utils/const"
  import { html, css, js } from "./editors"

  export interface PromptMessage {
    role: "user" | "assistant"
    content: string
    id?: number          // assistant message 的后端 pk（用于删除）
    code?: { html: string | null; css: string | null; js: string | null }
    created?: string
  }

  export const messages = ref<PromptMessage[]>([])
  export const conversationId = ref<string>("")
  export const connected = ref(false)
  export const streaming = ref(false)
  export const streamingContent = ref("")
  let _onCodeComplete:
    | ((
        code: { html: string | null; css: string | null; js: string | null },
        messageId: number
      ) => void)
    | null = null

  export function setOnCodeComplete(fn: typeof _onCodeComplete) {
    _onCodeComplete = fn
  }

  let ws: WebSocket | null = null
  let _currentTaskId = 0

  export function connectPrompt(taskId: number) {
    _currentTaskId = taskId
    if (ws) ws.close()

    ws = new WebSocket(`${WS_BASE_URL}/ws/prompt/${taskId}/`)

    ws.onopen = () => {
      connected.value = true
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)

      if (data.type === "init") {
        streaming.value = false
        streamingContent.value = ""
        const alreadyLoaded = conversationId.value === data.conversation_id
        conversationId.value = data.conversation_id
        if (!alreadyLoaded) {
          messages.value = data.messages || []
          const lastAssistant = [...messages.value]
            .reverse()
            .find((m) => m.role === "assistant" && m.code)
          if (lastAssistant?.code) {
            applyCode(lastAssistant.code)
          }
        }
      } else if (data.type === "stream") {
        streaming.value = true
        streamingContent.value += data.content
      } else if (data.type === "complete") {
        streaming.value = false
        messages.value.push({
          role: "assistant",
          content: streamingContent.value,
          id: data.message_id,       // 新增
          code: data.code,
        })
        streamingContent.value = ""
        if (data.code) {
          applyCode(data.code)
          if (_onCodeComplete) {
            _onCodeComplete(data.code, data.message_id)  // 新增 messageId 参数
          }
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
    _onCodeComplete = null
  }

  export function sendPrompt(content: string, model: string = "") {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    streaming.value = true
    messages.value.push({ role: "user", content })
    ws.send(JSON.stringify({ type: "message", content, model }))
  }

  export function stopPrompt() {
    if (
      messages.value.length > 0 &&
      messages.value[messages.value.length - 1].role === "user"
    ) {
      messages.value.pop()
    }
    streaming.value = false
    streamingContent.value = ""
    if (_currentTaskId) {
      connectPrompt(_currentTaskId)
    }
  }

  function applyCode(code: {
    html: string | null
    css: string | null
    js: string | null
  }) {
    if (code.html !== null) html.value = code.html
    if (code.css !== null) css.value = code.css
    if (code.js !== null) js.value = code.js
  }
  ```

- [ ] **Step 2: 修改 `client/src/api.ts`**

  **修改 `Submission.create`：** 加 `messageId` 可选参数：

  ```typescript
  async create(
    taskId: number,
    code: {
      html?: string
      css?: string
      js?: string
      prompt?: string
    },
    messageId?: number,   // 新增
  ) {
    const { prompt, ...rest } = code
    const data = {
      task_id: taskId,
      ...rest,
      prompt: prompt || null,
      message_id: messageId ?? null,   // 新增
    }
    const res = await http.post("/submission/", data)
    return res.data
  },
  ```

  **在 `Prompt` 对象末尾新增 `deleteMessagePair`：**

  ```typescript
  export const Prompt = {
    async listConversations(taskId?: number, userId?: number) {
      const params: Record<string, number> = {}
      if (taskId) params.task_id = taskId
      if (userId) params.user_id = userId
      return (await http.get("/prompt/conversations/", { params })).data
    },

    async getMessages(conversationId: string): Promise<PromptMessage[]> {
      return (
        await http.get<PromptMessage[]>(
          `/prompt/conversations/${conversationId}/messages/`,
        )
      ).data
    },

    async getMessagesByUserTask(
      taskId: number,
      userId: number,
    ): Promise<PromptMessage[]> {
      const convs = await this.listConversations(taskId, userId)
      if (!convs.length) return []
      return this.getMessages(convs[0].id)
    },

    async deleteMessagePair(
      messageId: number,
    ): Promise<{ deleted: boolean; submission_deleted: boolean }> {
      const res = await http.delete(`/prompt/messages/${messageId}/pair`)
      return res.data
    },
  }
  ```

  > `api.ts` 顶部已有 `import type { ..., PromptMessage, ... } from "./utils/type"`，确认 `PromptMessage` 类型也在 `type.ts` 中——若没有，`store/prompt.ts` 里的接口定义已够用，`api.ts` 的方法签名用 `any` 或直接不加返回类型注解都可以。

- [ ] **Step 3: 确认 TypeScript 无报错**

  ```bash
  cd client && npm run build 2>&1 | head -30
  ```

  预期：构建成功，无 TS 错误

---

## Task 7：ChallengeDetail.vue 传递 messageId

**Files:**
- Modify: `client/src/pages/ChallengeDetail.vue`

- [ ] **Step 1: 修改 `setOnCodeComplete` 回调，接收并传递 `messageId`**

  找到 `ChallengeDetail.vue` 中 `setOnCodeComplete` 的调用（约第 186 行），将：

  ```typescript
  setOnCodeComplete(async (code) => {
    try {
      await Submission.create(taskId.value, {
        html: code.html ?? "",
        css: code.css ?? "",
        js: code.js ?? "",
      })
      message.success("已自动提交本次对话生成的代码")
    } catch {
      // 静默失败，不打扰用户
    }
  })
  ```

  替换为：

  ```typescript
  setOnCodeComplete(async (code, messageId) => {
    try {
      await Submission.create(
        taskId.value,
        {
          html: code.html ?? "",
          css: code.css ?? "",
          js: code.js ?? "",
        },
        messageId,
      )
      message.success("已自动提交本次对话生成的代码")
    } catch {
      // 静默失败，不打扰用户
    }
  })
  ```

- [ ] **Step 2: 确认构建无报错**

  ```bash
  cd client && npm run build 2>&1 | head -30
  ```

---

## Task 8：PromptPanel.vue 添加删除按钮

**Files:**
- Modify: `client/src/components/ai/PromptPanel.vue`

- [ ] **Step 1: 修改 `<script setup>` 部分**

  将 `<script setup>` 中的 `import` 和逻辑替换为：

  ```typescript
  import { ref, watch, nextTick, computed } from "vue"
  import { useStorage } from "@vueuse/core"
  import { marked, Renderer } from "marked"
  import { useMessage } from "naive-ui"
  import { Icon } from "@iconify/vue"
  import {
    messages,
    streaming,
    streamingContent,
    connected,
    sendPrompt,
    stopPrompt,
  } from "../../store/prompt"
  import { Prompt } from "../../api"

  const input = ref("")
  const messagesRef = ref<HTMLElement>()
  const naiveMessage = useMessage()

  const modelOptions = [
    { label: "豆包", value: "doubao-seed-2-0-lite-260215" },
    { label: "DeepSeek", value: "deepseek-chat" },
  ]
  const selectedModel = useStorage("prompt-model", "deepseek-chat")

  // 将消息列表分组为 [{user, assistant}] 对
  const pairs = computed(() => {
    const result: Array<{
      userMsg: { role: string; content: string; id?: number }
      assistantMsg: { role: string; content: string; id?: number; code?: any } | null
      index: number
    }> = []
    const msgs = messages.value
    let i = 0
    while (i < msgs.length) {
      if (msgs[i].role === "user") {
        const assistantMsg = msgs[i + 1]?.role === "assistant" ? msgs[i + 1] : null
        result.push({ userMsg: msgs[i], assistantMsg, index: i })
        i += assistantMsg ? 2 : 1
      } else {
        i++
      }
    }
    return result
  })

  async function deletePair(assistantMsgId: number, pairIndex: number) {
    try {
      await Prompt.deleteMessagePair(assistantMsgId)
      // 从本地 messages 中移除这两条（user + assistant）
      const idx = pairs.value[pairIndex].index
      messages.value.splice(idx, 2)
      naiveMessage.success("已删除")
    } catch {
      naiveMessage.error("删除失败，请重试")
    }
  }

  function send() {
    const text = input.value.trim()
    if (!text || streaming.value) return
    sendPrompt(text, selectedModel.value)
    input.value = ""
  }

  const renderer = new Renderer()
  renderer.code = function ({ lang }: { text: string; lang?: string }) {
    const label = lang ? lang.toUpperCase() : "CODE"
    const colors: Record<
      string,
      { bg: string; fg: string; dot: string; border: string; shimmer: string }
    > = {
      html: {
        bg: "#f0fff4",
        fg: "#18a058",
        dot: "#18a058",
        border: "#b8e8cc",
        shimmer: "#f0fff4, #e0f7ea, #f0fff4",
      },
      css: {
        bg: "#f0f0ff",
        fg: "#6060d0",
        dot: "#6060d0",
        border: "#d0d0f0",
        shimmer: "#f0f0ff, #e8e8fa, #f0f0ff",
      },
      js: {
        bg: "#fffbf0",
        fg: "#c0960a",
        dot: "#c0960a",
        border: "#f0e0b0",
        shimmer: "#fffbf0, #fff5e0, #fffbf0",
      },
      javascript: {
        bg: "#fffbf0",
        fg: "#c0960a",
        dot: "#c0960a",
        border: "#f0e0b0",
        shimmer: "#fffbf0, #fff5e0, #fffbf0",
      },
    }
    const c = colors[(lang ?? "").toLowerCase()] ?? {
      bg: "#f0f7ff",
      fg: "#2080f0",
      dot: "#2080f0",
      border: "#e0eaf5",
      shimmer: "#f0f7ff, #e8f4f8, #f0f7ff",
    }
    return `<div class="code-placeholder" style="background: linear-gradient(90deg, ${c.shimmer}); background-size: 200% 100%; border-color: ${c.border}"><span class="code-placeholder-dot" style="background: ${c.dot}"></span><span class="code-placeholder-label" style="color: ${c.fg}; background: ${c.fg}18">${label}</span><span class="code-placeholder-text">代码正在生成中，结束后会自动应用到预览区</span></div>`
  }

  function renderMarkdown(text: string): string {
    return marked.parse(text, { renderer }) as string
  }

  function renderContent(msg: { role: string; content: string }): string {
    return renderMarkdown(msg.content)
  }

  watch([() => messages.value.length, streamingContent], () => {
    nextTick(() => {
      if (messagesRef.value) {
        messagesRef.value.scrollTop = messagesRef.value.scrollHeight
      }
    })
  })
  ```

- [ ] **Step 2: 替换 `<template>` 部分**

  将整个 `<template>` 替换为：

  ```html
  <template>
    <div class="prompt-panel">
      <div class="messages" ref="messagesRef">
        <div
          v-for="(pair, pi) in pairs"
          :key="pi"
          class="message-pair"
          :class="{ 'has-delete': pair.assistantMsg?.id && !streaming }"
        >
          <!-- 删除按钮（只在有完整 assistant message id 且非流式时显示） -->
          <button
            v-if="pair.assistantMsg?.id && !streaming"
            class="pair-delete-btn"
            @click="deletePair(pair.assistantMsg!.id!, pi)"
            title="删除这轮对话及关联提交"
          >
            <Icon icon="lucide:trash-2" :width="14" />
          </button>

          <!-- User message -->
          <div class="message user">
            <div class="message-role">我</div>
            <div class="message-content" v-html="renderContent(pair.userMsg)"></div>
          </div>

          <!-- Assistant message -->
          <div v-if="pair.assistantMsg" class="message assistant">
            <div class="message-role">AI</div>
            <div class="message-content" v-html="renderContent(pair.assistantMsg)"></div>
          </div>
        </div>

        <!-- Streaming message -->
        <div v-if="streaming" class="message assistant">
          <div class="message-role">AI</div>
          <div v-if="!streamingContent" class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
          <div
            v-else
            class="message-content"
            v-html="renderMarkdown(streamingContent)"
          ></div>
          <div class="streaming-hint">AI 正在思考中…</div>
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
        <n-flex justify="flex-end" align="center" style="margin-top: 8px">
          <n-select
            v-model:value="selectedModel"
            :options="modelOptions"
            style="width: 120px"
            :disabled="streaming"
          />
          <n-button v-if="streaming" type="error" @click="stopPrompt">
            停止
          </n-button>
          <n-button
            v-else
            type="primary"
            :disabled="!input.trim() || !connected"
            @click="send"
          >
            发送
          </n-button>
        </n-flex>
      </div>
    </div>
  </template>
  ```

- [ ] **Step 3: 在 `<style scoped>` 中追加删除按钮样式**

  在原有 `</style>` 之前追加：

  ```css
  .message-pair {
    position: relative;
    margin-bottom: 4px;
  }

  .message-pair .message {
    margin-bottom: 16px;
  }

  .pair-delete-btn {
    display: none;
    position: absolute;
    top: 0;
    right: 0;
    background: none;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 3px 6px;
    cursor: pointer;
    color: #bbb;
    line-height: 1;
    transition: color 0.15s, border-color 0.15s;
  }

  .pair-delete-btn:hover {
    color: #e03e3e;
    border-color: #e03e3e;
  }

  .message-pair.has-delete:hover .pair-delete-btn {
    display: inline-flex;
    align-items: center;
  }
  ```

- [ ] **Step 4: 启动前端 dev server 并手动验证**

  ```bash
  cd client && npm run start
  ```

  验证流程：
  1. 打开挑战页，发送一条 AI 消息，等待 AI 回复完成
  2. hover 到该对话轮次右上角，确认出现垃圾桶图标
  3. 点击删除，确认：消息消失、弹出「已删除」提示
  4. 刷新页面，确认该轮消息不再出现（已从后端删除）
  5. 进入「我的提交」列表，确认该次自动提交已被删除
  6. 在提交列表中删除另一条 AI 生成的提交，回到挑战页重连，确认对应消息对也消失

- [ ] **Step 5: 运行后端全量测试**

  ```bash
  cd api && uv run manage.py test prompt.tests -v 2
  ```

  预期：所有测试 PASS
