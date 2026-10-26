# Challenge AI Chat Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 折叠 AI 对话中的代码块，并在 AI 生成代码后自动静默提交作品。

**Architecture:** 在 `PromptPanel.vue` 中用自定义 marked renderer 将代码块渲染为 `<details>/<summary>`；在 `prompt.ts` 中暴露 `onCodeComplete` 回调，`ChallengeHome.vue` 注册回调触发静默提交。

**Tech Stack:** Vue 3, TypeScript, marked (custom renderer), Naive UI, WebSocket (already in use)

---

### Task 1: 代码块折叠 — 自定义 marked renderer

**Files:**
- Modify: `client/src/components/PromptPanel.vue`

**Step 1: 在 `<script setup>` 中创建局部 marked 实例并覆盖 code renderer**

在 `PromptPanel.vue` 的 `<script setup>` 中，替换现有的 `renderMarkdown` 函数：

```ts
import { marked, Renderer } from "marked"

const renderer = new Renderer()
const _origCode = renderer.code.bind(renderer)
renderer.code = function ({ text, lang }) {
  const label = lang ? `查看代码（${lang}）` : "查看代码"
  // 对代码内容做 HTML 转义，防止 XSS
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  return `<details class="code-block"><summary>${label}</summary><pre><code class="hljs${lang ? ` language-${lang}` : ""}">${escaped}</code></pre></details>`
}

function renderMarkdown(text: string): string {
  return marked.parse(text, { renderer }) as string
}
```

注意：`marked` 已在 `main.ts` 全局配置了 `markedHighlight`，但局部 renderer 不继承全局高亮插件。代码块在聊天中默认折叠，用户主要通过预览区查看效果，折叠后不高亮可接受。若需要高亮，可在 `details` 展开后用 `hljs.highlightAll()` 触发，属于可选优化。

**Step 2: 在 `<style scoped>` 中添加折叠样式**

```css
.message-content :deep(details.code-block) {
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  margin: 6px 0;
}

.message-content :deep(details.code-block summary) {
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
  color: #666;
  user-select: none;
  background: #f5f5f5;
  border-radius: 4px;
}

.message-content :deep(details.code-block[open] summary) {
  border-bottom: 1px solid #e0e0e0;
  border-radius: 4px 4px 0 0;
}

.message-content :deep(details.code-block pre) {
  margin: 0;
  border-radius: 0 0 4px 4px;
}
```

**Step 3: 验证**

启动开发服务器 `cd client && npm run start`，打开一个挑战页面，发送一条会生成代码的提示词（如"做一个蓝色的圆形按钮"），确认：
- AI 回复中的代码块显示为折叠的 `<details>` 元素
- 点击 summary 可展开查看代码
- 流式输出时也正确折叠

**Step 4: Commit**

```bash
git add client/src/components/PromptPanel.vue
git commit -m "feat: collapse code blocks in AI chat messages"
```

---

### Task 2: 自动提交 — prompt.ts 暴露回调

**Files:**
- Modify: `client/src/store/prompt.ts`

**Step 1: 在文件顶部添加回调导出**

在 `export const streamingContent` 那行后面添加：

```ts
export let onCodeComplete: ((code: { html: string | null; css: string | null; js: string | null }) => void) | null = null
```

**Step 2: 在 `complete` 事件处理中调用回调**

找到 `} else if (data.type === "complete") {` 块，在 `applyCode(data.code)` 调用后追加：

```ts
if (data.code && onCodeComplete) {
  onCodeComplete(data.code)
}
```

完整的 `complete` 块变为：

```ts
} else if (data.type === "complete") {
  streaming.value = false
  messages.value.push({
    role: "assistant",
    content: streamingContent.value,
    code: data.code,
  })
  streamingContent.value = ""
  if (data.code) {
    applyCode(data.code)
    if (onCodeComplete) {
      onCodeComplete(data.code)
    }
  }
}
```

**Step 3: 在 `disconnectPrompt` 中清除回调**

在 `disconnectPrompt()` 函数中添加：

```ts
onCodeComplete = null
```

**Step 4: Commit**

```bash
git add client/src/store/prompt.ts
git commit -m "feat: expose onCodeComplete callback in prompt store"
```

---

### Task 3: 自动提交 — ChallengeHome.vue 注册回调

**Files:**
- Modify: `client/src/pages/ChallengeHome.vue`

**Step 1: 导入 `onCodeComplete`**

在现有 import 行中，将 `prompt` store 的导入补充 `onCodeComplete`：

```ts
import { connectPrompt, disconnectPrompt, conversationId, streaming, onCodeComplete } from "../store/prompt"
```

注意：`onCodeComplete` 是 `let` 导出的普通变量，不是 `ref`，直接赋值即可。

**Step 2: 在 `loadChallenge` 中注册静默提交回调**

在 `connectPrompt(data.task_ptr)` 调用后添加：

```ts
onCodeComplete = async () => {
  if (!conversationId.value) return
  try {
    await Submission.create(taskId.value, {
      html: html.value,
      css: css.value,
      js: js.value,
      conversationId: conversationId.value,
    })
  } catch {
    // 静默失败，不打扰用户
  }
}
```

**Step 3: 验证**

在挑战页面发送生成代码的请求，打开浏览器 Network 面板，确认：
- AI 回复完成（含代码）后，自动发出 `POST /api/submission/` 请求
- 无任何 loading 状态或弹窗
- 手动点击"提交作品"按钮仍然正常工作
- 返回挑战列表再进入，`onCodeComplete` 不会指向旧页面的 submit 函数（`disconnectPrompt` 会清除）

**Step 4: Commit**

```bash
git add client/src/pages/ChallengeHome.vue
git commit -m "feat: auto-submit on AI code generation in challenge"
```

---

## 完成标准

- [ ] AI 对话中所有代码块默认折叠，可点击展开
- [ ] 流式输出期间代码块也处于折叠状态
- [ ] 每次 AI 生成含代码的回复后，自动静默提交一次
- [ ] 自动提交失败时无任何 UI 反馈（静默）
- [ ] 手动"提交作品"按钮功能不受影响
- [ ] 离开挑战页面后回调被正确清理，不产生内存泄漏
