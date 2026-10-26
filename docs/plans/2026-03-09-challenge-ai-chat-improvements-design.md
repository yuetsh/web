# 挑战 AI 对话改进设计文档

**日期：** 2026-03-09

## 背景

挑战页面有 AI 对话功能（思维链），目前存在两个问题：
1. AI 回复中的代码块占用大量空间，影响对话可读性
2. 用户需要手动点击"提交作品"，导致中间过程的代码版本无法被记录

## 需求

1. **AI 消息中的代码块默认折叠**，用户可点击展开查看
2. **AI 生成代码后自动静默提交**，每轮生成代码的回复都触发一次提交，保留手动提交按钮

## 方案

### 需求一：代码块折叠

**修改文件：** `client/src/components/PromptPanel.vue`

- 在 `renderMarkdown()` 中使用自定义 marked renderer，覆盖 `code` 渲染逻辑
- 代码块输出为原生 `<details>/<summary>` HTML，summary 显示语言名称
- 流式输出的 `streamingContent` 使用相同 renderer
- 加 scoped CSS 美化折叠组件样式

```html
<details class="code-block">
  <summary>查看代码（javascript）</summary>
  <pre><code class="hljs language-javascript">...</code></pre>
</details>
```

### 需求二：自动提交

**修改文件：** `client/src/store/prompt.ts`、`client/src/pages/ChallengeHome.vue`

**prompt.ts：**
- 暴露 `onCodeComplete: ((code: {...}) => void) | null` 回调
- `complete` 事件中，当 `data.code` 存在时调用该回调

**ChallengeHome.vue：**
- `loadChallenge()` 中注册 `onCodeComplete` 回调，执行静默提交（不显示 loading，失败不弹提示）
- `onUnmounted` 中将 `onCodeComplete` 置为 `null`
- 保留现有手动"提交作品"按钮

## 影响范围

- `client/src/components/PromptPanel.vue`：代码块折叠渲染
- `client/src/store/prompt.ts`：新增 `onCodeComplete` 回调
- `client/src/pages/ChallengeHome.vue`：注册回调、自动提交逻辑
