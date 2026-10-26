# 提示词引导功能设计文档

**日期：** 2026-05-07  
**状态：** 已审批

## 功能概述

在现有 AI 对话（PromptPanel）旁新增"调教提示词"入口，学生可选择性地进入多轮引导流程，由 AI 以苏格拉底式提问帮助其优化提示词，满意后再生成代码。原有"发送"行为完全不变。

## 用户流程

```
学生在 PromptPanel 输入框写提示词
        ↓
点"调教提示词"按钮（灯泡图标）
        ↓
GuidancePanel 弹出，携带初始提示词
        ↓
AI 分析提示词质量
  ├─ 不够好 → 返回 1-2 个启发性问题，学生修改后继续发
  └─ 够好   → 响应首部加 [READY]，"生成代码"按钮高亮
        ↓
学生点"生成代码"
        ↓
GuidancePanel 关闭，最终提示词直接通过 sendPrompt() 发送
PromptPanel 走原有 ws/prompt/<task_id>/ 生成代码（流程不变）
```

**备注：** 学生对自己的提示词有信心时，可直接点"发送"，完全跳过引导流程。

## 后端设计

### llm.py

新增 `GUIDANCE_SYSTEM_PROMPT`：

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

新增 `stream_guidance(history)` 函数（使用 `GUIDANCE_SYSTEM_PROMPT`，默认 DeepSeek 模型）。

### consumers.py

新增 `GuidanceConsumer(AsyncWebsocketConsumer)`：

- 复用 `PromptConsumer` 的连接/断开/历史加载逻辑
- `save_message` 时 `source="guidance"`
- streaming 完成后检测 `full_response` 是否以 `[READY]` 开头：
  - 是：剥离 `[READY]\n`，保存清理后内容，`complete` 事件加 `"is_ready": true`
  - 否：正常保存，`complete` 事件 `"is_ready": false`

### url.py / asgi.py

新增 WebSocket 路由：

```python
re_path(r"ws/guidance/(?P<task_id>\d+)/$", GuidanceConsumer.as_asgi())
```

### 数据库

无新 migration。引导消息使用现有 `Message` 模型，`source="guidance"`（现有字段，现有值为 `"conversation"` / `"manual"`）。同一个 `Conversation` 下，通过 `source` 区分引导轮次与代码生成轮次。

## 前端设计

### 新增：src/store/guidance.ts

状态：
- `messages` — 引导对话消息列表
- `streaming` — 是否正在流式输出
- `streamingContent` — 当前流式内容
- `connected` — WebSocket 是否已连接
- `isReady` — AI 是否判断提示词已足够好
- `isOpen` — 面板是否展开

方法：
- `openGuidance(taskId, initialPrompt)` — 建立 WebSocket，发送初始提示词
- `sendGuidance(text)` — 发送后续消息
- `stopGuidance()` — 中止当前流
- `closeGuidance()` — 关闭面板，断开 WebSocket

### 新增：src/components/ai/GuidancePanel.vue

UI 形式：`<n-modal>` 或右侧抽屉。

结构：
- **对话区**：显示引导轮次消息
  - 引导消息样式：蓝色左边框 + 灯泡图标，与普通代码生成消息视觉区分
  - streaming 指示器（与 PromptPanel 一致）
- **输入区**：学生修改提示词并继续对话，Enter 发送
- **底部按钮**："生成代码"
  - 默认：可点击但不高亮
  - `isReady === true`：高亮（primary 样式）+ 提示文字"提示词已优化，可以生成了！"

事件：
- `@generate(finalPrompt: string)` — 学生点"生成代码"时 emit，携带输入框当前内容作为最终提示词

### 改动：src/components/ai/PromptPanel.vue

- 输入框旁加"调教提示词"按钮（`lucide:lightbulb` 图标，secondary 样式）
- 点击：调用 `openGuidance(taskId, input.value)`
- 监听 `GuidancePanel` 的 `@generate` 事件：
  - 收到最终提示词 → 填入 `input.value` → 调用 `sendPrompt()` 直接发送

## 错误处理

- GuidancePanel WebSocket 断开：显示重连提示，与 PromptPanel 保持一致
- AI 服务出错：`error` 事件在引导对话中显示，不影响主对话

## 不在范围内

- 引导功能的任务级开关（全局开启）
- 引导质量的统计/分析面板（可后续迭代）
- 引导轮次上限（由 AI 自行判断，不做硬性限制）
