# Prompt Chain Feature Design

## Overview

在挑战模式下，学生通过平台内置 AI 对话生成网页代码，平台记录完整的 prompt 链条（思维链），提交时代码与 prompt 链条一起关联。老师和学生都能回看思维过程。

## 技术方案

WebSocket 实时对话（基于现有 Django Channels + Redis 基础设施），流式输出 AI 回复。调用国内大模型 API（如深度求索、通义千问）。

## 数据模型

### 新增 `prompt` app（替代现有 `chat` app）

**Conversation**
- `id`: UUIDField (PK)
- `user`: FK → User
- `task`: FK → Task（关联的挑战任务）
- `is_active`: BooleanField（提交后锁定为 False）
- `created` / `modified`: 时间戳

**Message**
- `id`: AutoField (PK)
- `conversation`: FK → Conversation
- `role`: CharField（"user" | "assistant"）
- `content`: TextField（消息文本）
- `code_html`: TextField nullable（AI 回复中提取的 HTML）
- `code_css`: TextField nullable（AI 回复中提取的 CSS）
- `code_js`: TextField nullable（AI 回复中提取的 JS）
- `created`: 时间戳

### 修改 Submission 模型

- 新增 `conversation`: FK → Conversation nullable

## 后端设计

### WebSocket Consumer (`prompt/consumers.py`)

路由：`ws/prompt/{task_id}/`

**连接流程：**
1. 验证用户已登录
2. 查找该用户+任务的活跃 Conversation，没有则创建
3. 推送历史消息恢复上下文

**消息处理：**
1. 收到学生 prompt → 存入 Message (role=user)
2. 组装上下文：系统 prompt + 挑战描述 + 历史消息 → 调用大模型 API
3. 流式接收 AI 回复 → 逐片段推送（打字机效果）
4. 回复完成 → 提取代码块 → 存入 Message (role=assistant, 含 code 字段)
5. 推送 `code_update` 事件 → 前端自动填入编辑器并刷新预览

**系统 prompt：**
- 角色：网页生成助手
- 要求用 ```html / ```css / ```js 格式返回代码
- 注入当前挑战任务描述作为上下文

### REST API (`prompt/api.py`)

- `GET /api/prompt/conversations/?task_id=X` — 当前用户的对话列表
- `GET /api/prompt/conversation/{id}/messages/` — 完整消息历史
- `POST /api/prompt/conversations/new?task_id=X` — 新建对话
- 老师端：`GET /api/prompt/conversations/?user_id=X&task_id=Y` — 查看学生对话

## 前端设计

### 挑战模式新布局

```
┌─────────────────────────┬──────────────────────────┐
│  挑战描述 (Markdown)     │                          │
│  ────────────────────   │                          │
│                         │      预览 (iframe)        │
│  AI 对话区域             │                          │
│  ┌───────────────────┐  │                          │
│  │ 用户: 做一个...     │  │                          │
│  │ AI: 好的...        │  │     [查看代码] 按钮       │
│  └───────────────────┘  │                          │
│  [输入 prompt...]  [发送]│                          │
└─────────────────────────┴──────────────────────────┘
```

- 左侧上方：挑战任务描述（复用 Challenge 组件）
- 左侧下方：AI 对话面板，可拖拽调整比例
- 右侧：预览 iframe 占满，右上角"查看代码"按钮弹窗查看代码
- 教程模式保持现有布局不变

### 新增组件

- `PromptPanel.vue` — AI 对话面板（消息列表 + 输入框 + 发送按钮）
- `ChallengeHome.vue` — 挑战模式布局容器

### 提交流程

- 提交时附带 `conversation_id`，关联当前对话
- 提交后对话锁定，学生可新建对话重新开始

### 查看 prompt 链条

- Submissions 页面新增"查看思维链"按钮
- 点击展开完整 prompt 对话历史（只读）
- 老师可按学生、按挑战筛选查看所有对话记录

## 影响范围

### 新增
- `prompt/` Django app（models, consumers, api, schemas）
- `PromptPanel.vue`, `ChallengeHome.vue` 前端组件
- `prompt` store（WebSocket 连接管理、消息状态）

### 修改
- `submission/models.py` — 新增 conversation FK
- `submission/schemas.py` — 提交 schema 新增 conversation_id
- `api/urls.py` — 注册 prompt router
- `api/asgi.py` — 更新 WebSocket 路由
- `Home.vue` — 挑战模式下切换到新布局
- `Submissions.vue` / `Preview.vue` — 新增查看 prompt 链条入口

### 删除
- `chat/` app（被 `prompt/` 替代）
