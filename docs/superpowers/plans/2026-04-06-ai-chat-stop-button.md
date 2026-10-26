# AI Chat Stop Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stop button to the AI chat panel that cancels in-flight streaming, removes the pending messages from the UI, and ensures nothing is saved to the database or submitted.

**Architecture:** When the user clicks stop, the frontend pops the unsaved user message from the UI, resets streaming state, and closes the WebSocket. The backend's existing `disconnect()` handler deletes the in-progress user message from the DB; the assistant message and Submission are never created because `complete` is never sent.

**Tech Stack:** Vue 3, TypeScript, Naive UI, WebSocket (Django Channels)

---

## File Map

| File | Change |
|---|---|
| `client/src/store/prompt.ts` | Store `_currentTaskId`; set `streaming=true` on send; add `stopPrompt()` |
| `client/src/components/ai/PromptPanel.vue` | Import `stopPrompt`; swap Send/Stop buttons based on `streaming` |

---

### Task 1: Update `store/prompt.ts`

**Files:**
- Modify: `client/src/store/prompt.ts`

- [ ] **Step 1: Store `_currentTaskId` and set it in `connectPrompt`**

  In `client/src/store/prompt.ts`, after the line `let ws: WebSocket | null = null`, add:

  ```typescript
  let _currentTaskId = 0
  ```

  Then inside `connectPrompt(taskId: number)`, add as the very first line of the function body:

  ```typescript
  _currentTaskId = taskId
  ```

  Result — the start of `connectPrompt` becomes:
  ```typescript
  export function connectPrompt(taskId: number) {
    _currentTaskId = taskId
    if (ws) ws.close()
    // ... rest unchanged
  ```

- [ ] **Step 2: Set `streaming = true` immediately on send**

  In `sendPrompt()`, add `streaming.value = true` as the first statement before the `push`:

  ```typescript
  export function sendPrompt(content: string, model: string = "") {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    streaming.value = true
    messages.value.push({ role: "user", content })
    ws.send(JSON.stringify({ type: "message", content, model }))
  }
  ```

- [ ] **Step 3: Add `stopPrompt()` function**

  After `sendPrompt`, add:

  ```typescript
  export function stopPrompt() {
    // Remove the user message added to UI (not yet saved in DB)
    if (
      messages.value.length > 0 &&
      messages.value[messages.value.length - 1].role === "user"
    ) {
      messages.value.pop()
    }
    streaming.value = false
    streamingContent.value = ""
    // Closing triggers backend disconnect() which deletes the DB user message
    if (ws) {
      ws.close()
      ws = null
    }
    // Reconnect immediately so the next message can be sent
    if (_currentTaskId) {
      connectPrompt(_currentTaskId)
    }
  }
  ```

- [ ] **Step 4: Verify the file looks correct**

  Open `client/src/store/prompt.ts` and confirm:
  - `_currentTaskId` is declared after `let ws`
  - `connectPrompt` sets `_currentTaskId = taskId` as its first line
  - `sendPrompt` sets `streaming.value = true` before the push
  - `stopPrompt` is exported and appears between `sendPrompt` and the private `applyCode`

- [ ] **Step 5: Commit**

  ```bash
  cd /home/xuyue/Projects/webpreview
  git add client/src/store/prompt.ts
  git commit -m "feat: add stopPrompt() and track currentTaskId in prompt store"
  ```

---

### Task 2: Add Stop button to `PromptPanel.vue`

**Files:**
- Modify: `client/src/components/ai/PromptPanel.vue`

- [ ] **Step 1: Import `stopPrompt`**

  Find the import line in `<script setup>`:

  ```typescript
  import {
    messages,
    streaming,
    streamingContent,
    sendPrompt,
  } from "../../store/prompt"
  ```

  Add `stopPrompt` to the import:

  ```typescript
  import {
    messages,
    streaming,
    streamingContent,
    sendPrompt,
    stopPrompt,
  } from "../../store/prompt"
  ```

- [ ] **Step 2: Replace the send button with conditional Stop/Send buttons**

  Find the current button block in `<template>`:

  ```html
  <n-button
    type="primary"
    :loading="streaming"
    :disabled="!input.trim() || streaming"
    @click="send"
  >
    发送
  </n-button>
  ```

  Replace with:

  ```html
  <n-button
    v-if="streaming"
    type="error"
    @click="stopPrompt"
  >
    停止
  </n-button>
  <n-button
    v-else
    type="primary"
    :disabled="!input.trim()"
    @click="send"
  >
    发送
  </n-button>
  ```

- [ ] **Step 3: Verify in browser**

  Start the dev server:
  ```bash
  cd /home/xuyue/Projects/webpreview/client
  npm run start
  ```

  Open a challenge page, send a message, confirm:
  1. The **停止** button appears immediately when send is clicked (no gap)
  2. Clicking **停止** removes the user message and streaming content from the UI
  3. The **发送** button reappears and is usable for the next message
  4. A subsequent message works normally (WS reconnected)

- [ ] **Step 4: Commit**

  ```bash
  cd /home/xuyue/Projects/webpreview
  git add client/src/components/ai/PromptPanel.vue
  git commit -m "feat: show stop button during AI streaming in PromptPanel"
  ```
