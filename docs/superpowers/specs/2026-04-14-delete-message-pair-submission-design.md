# 设计文档：学生删除 AI 对话轮次及关联提交

**日期：** 2026-04-14  
**状态：** 已批准

---

## 需求

学生在挑战页的「AI 对话」tab 中，可以删除某一轮对话（一问一答），同时删除该 AI 回答自动生成的提交。反向也成立：在提交列表中删除一条提交，同时删除对应的那对消息。

---

## 数据模型

**`prompt/Message` 新增字段：**

```python
submission = models.OneToOneField(
    "submission.Submission",
    null=True, blank=True,
    on_delete=models.SET_NULL,
    related_name="source_message"
)
```

- `OneToOneField`：一条 assistant message 最多对应一个提交
- `SET_NULL`：FK 层面保底，防止外部操作引发 crash
- 业务级联删除在接口层显式处理（不依赖 `CASCADE`）

需新建 migration。

---

## 后端

### Schema 变更

`api/submission/schemas.py` 中 `SubmissionIn` 新增：

```python
message_id: Optional[UUID] = None
```

### 接口变更

**`POST /submission/`（create_submission）**

创建 Submission 后，若 `payload.message_id` 不为空：
1. 查找对应的 assistant Message（`source="conversation"`，属于当前 user+task）
2. 设置 `message.submission = submission` 并保存

**`DELETE /submission/{id}`（delete_submission）**

删除 Submission 前：
1. 通过 `submission.source_message`（`related_name`）找到关联的 assistant message（若有）
2. 找到该 assistant message 在同一 conversation 中前一条 user message（按 `created` 排序取紧邻的上一条）
3. 依次删除：user message → assistant message → submission

**新增 `DELETE /prompt/messages/{message_id}/pair`**

- 鉴权：`message.conversation.user == request.user`，否则 403
- 操作：
  1. 找到 assistant message（`id=message_id`，`role="assistant"`）
  2. 找到同 conversation 中紧邻的前一条 user message
  3. 若 assistant message 有关联 submission，删除它
  4. 删除 assistant message 和 user message
- 返回 `{"deleted": true, "submission_deleted": bool}`

> **为何用 assistant message id 而非 user message id：**  
> `complete` 事件由后端发出，assistant message 在那一刻刚被保存，id 唯一确定；user message 已在之前保存，前端也持有，但以 assistant message 为锚点更自然。

### WebSocket 变更（`prompt/consumers.py`）

**`complete` 事件新增 `message_id`：**

```python
await self.send(text_data=json.dumps({
    "type": "complete",
    "code": code,
    "message_id": str(assistant_message.id),  # 新增
}))
```

**`init` 事件的消息列表每条带 `id`：**

```python
{
    "id": str(m.id),       # 新增
    "role": m.role,
    "content": m.content,
    "code": {...} if m.role == "assistant" else None,
    "created": m.created.isoformat(),
}
```

---

## 前端

### `store/prompt.ts`

`PromptMessage` 接口新增：

```typescript
id?: string        // assistant message 的后端 id，用于删除
```

`complete` 事件处理：从事件中提取 `message_id`，存入 push 进 `messages` 的那条 assistant message。

`_onCodeComplete` 回调签名扩展，传入 `messageId`：

```typescript
type OnCodeComplete = (code: { html: string | null; css: string | null; js: string | null }, messageId: string) => void
```

`init` 事件处理：将后端返回的 `id` 存入每条消息。

### `api.ts`

**`Submission.create()`** 新增可选参数：

```typescript
async create(taskId, code, messageId?: string)
// 请求体加上 message_id: messageId ?? null
```

**`Prompt` 新增方法：**

```typescript
async deleteMessagePair(messageId: string): Promise<{ deleted: boolean; submission_deleted: boolean }>
```

### `ChallengeDetail.vue`

`setOnCodeComplete` 的回调改为接收 `messageId`，并将其传给 `Submission.create()`：

```typescript
setOnCodeComplete(async (code, messageId) => {
  await Submission.create(taskId.value, { ...code }, messageId)
})
```

### `PromptPanel.vue`

**消息分组：** 将 `messages` 按 user+assistant 顺序两两分组，形成 `pairs`（computed）。不完整的末尾单条消息（仍在等待 AI 回复）不显示删除按钮。

**删除 UI：** 每个 pair 右上角显示一个垃圾桶图标（`lucide:trash-2`），hover 时显现。点击后：
1. 调用 `Prompt.deleteMessagePair(pair.assistantMessage.id)`
2. 成功后从本地 `messages` 中移除这两条

**交互细节：**
- 使用 Naive UI 的 `useMessage()` 给出成功/失败通知
- streaming 期间禁用所有删除按钮（`disabled` when `streaming`）
- 没有 `id` 的消息（历史消息加载前的边缘情况）不显示删除按钮

---

## 不在本次范围内

- 手动提交（ExternalAIPanel）产生的消息：它们以 `source="manual"` 存储，不在 PromptPanel 显示，无需处理
- 提交列表页的实时刷新：删除后消息已从后端移除，下次打开挑战页重连 WebSocket 时自然反映
- 管理员代替学生删除：本次仅限学生删自己的

---

## 文件改动清单

| 文件 | 类型 |
|------|------|
| `api/prompt/models.py` | 新增 `submission` 字段 |
| `api/prompt/migrations/0005_*.py` | 新建 migration |
| `api/prompt/api.py` | 新增 `DELETE /messages/{id}/pair` 端点 |
| `api/prompt/consumers.py` | `complete`/`init` 事件带 `message_id` |
| `api/submission/schemas.py` | `SubmissionIn` 加 `message_id` |
| `api/submission/api.py` | create 关联消息；delete 级联删消息 |
| `client/src/store/prompt.ts` | `PromptMessage` 加 `id`；回调传 `messageId` |
| `client/src/api.ts` | `Submission.create` 加 `messageId`；`Prompt.deleteMessagePair` |
| `client/src/pages/ChallengeDetail.vue` | `setOnCodeComplete` 传 `messageId` |
| `client/src/components/ai/PromptPanel.vue` | 消息分组 + 删除按钮 |
