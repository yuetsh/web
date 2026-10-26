# Load Chat History on Challenge Entry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user opens a challenge's AI chat tab, their previous conversation messages load immediately via HTTP API before the WebSocket connects.

**Architecture:** Call `Prompt.listConversations(taskId)` + `Prompt.getMessages(id)` in `ChallengeHome.vue` alongside `connectPrompt()`. The HTTP response populates the store immediately; the WebSocket `init` handler skips overwriting messages if the conversation ID already matches (preventing stale overwrite without breaking "新对话"). A cancellation token prevents in-flight HTTP responses from writing to the store after the user navigates away.

**Tech Stack:** Vue 3, TypeScript, Naive UI (`n-spin`), existing `Prompt` API client

---

## File Map

| File | Change |
|------|--------|
| `client/src/utils/type.ts` | Add `created?: string` to `PromptMessage` interface |
| `client/src/store/prompt.ts` | Add `historyLoading` ref, cancellation token, `loadHistory()` function; update `init` handler and `disconnectPrompt` |
| `client/src/pages/ChallengeHome.vue` | Call `loadHistory()` alongside `connectPrompt()` in `loadChallenge()` |
| `client/src/components/PromptPanel.vue` | Import `historyLoading`; show `n-spin` while loading |

---

### Task 1: Add `created` to `PromptMessage` in `utils/type.ts`

**Files:**
- Modify: `client/src/utils/type.ts`

The `PromptMessage` interface represents the raw HTTP response shape from
`GET /prompt/conversations/{id}/messages/`. The backend already returns a `created` field
but the frontend type is missing it, which would cause a TypeScript error when mapping
the HTTP response in `loadHistory`.

- [ ] **Step 1: Add `created` field**

  In `client/src/utils/type.ts`, change:

  ```typescript
  export interface PromptMessage {
    id: number
    role: string
    content: string
    code_html: string | null
    code_css: string | null
    code_js: string | null
  }
  ```

  to:

  ```typescript
  export interface PromptMessage {
    id: number
    role: string
    content: string
    code_html: string | null
    code_css: string | null
    code_js: string | null
    created?: string
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd /home/xuyue/Projects/webpreview/client && npx tsc --noEmit
  ```

  Expected: no new errors

- [ ] **Step 3: Commit**

  ```bash
  cd /home/xuyue/Projects/webpreview/client
  git add src/utils/type.ts
  git commit -m "fix: add created field to PromptMessage type"
  ```

---

### Task 2: Add `historyLoading` and `loadHistory` to `prompt.ts`

**Files:**
- Modify: `client/src/store/prompt.ts`

Key design decisions:
- Use a `_historyLoadId` counter as a cancellation token: `disconnectPrompt` increments it,
  and `loadHistory` checks it before writing to the store — preventing in-flight responses
  from corrupting state after the user navigates away.
- Filter conversations by `conv.username === user.username` so admin/super users only load
  their own chat history (the API returns all users' conversations for non-normal roles).
- No new local type needed: `Prompt.getMessages` already returns `PromptMessage[]`
  (from `utils/type.ts`) which now includes `created`.

- [ ] **Step 1: Add import for `user` store and `PromptMessage` type**

  At the top of `client/src/store/prompt.ts`, add to the existing imports:

  ```typescript
  import { Prompt } from "../api"
  import type { PromptMessage as RawMessage } from "../utils/type"
  import { user } from "./user"
  ```

  > Note: `RawMessage` is an alias to avoid collision with the store's own `PromptMessage`
  > interface (which uses the nested `code: {html, css, js}` shape).

- [ ] **Step 2: Add `historyLoading` export and cancellation token**

  After the existing `export const streaming = ref(false)` line, add:

  ```typescript
  export const historyLoading = ref(false)
  let _historyLoadId = 0
  ```

- [ ] **Step 3: Add `loadHistory` function**

  Add this function after `disconnectPrompt`:

  ```typescript
  export async function loadHistory(taskId: number) {
    const loadId = ++_historyLoadId
    historyLoading.value = true
    try {
      const convs = await Prompt.listConversations(taskId)
      if (loadId !== _historyLoadId) return  // navigated away, abort
      const active = convs.find(
        (c: { is_active: boolean; message_count: number; username: string }) =>
          c.is_active && c.message_count > 0 && c.username === user.username
      )
      if (!active) return
      const raw: RawMessage[] = await Prompt.getMessages(active.id)
      if (loadId !== _historyLoadId) return  // navigated away, abort
      conversationId.value = active.id
      messages.value = raw.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        code:
          m.role === "assistant"
            ? { html: m.code_html, css: m.code_css, js: m.code_js }
            : undefined,
        created: m.created,
      }))
    } catch {
      // 静默失败，不影响 WebSocket 正常流程
    } finally {
      if (loadId === _historyLoadId) historyLoading.value = false
    }
  }
  ```

- [ ] **Step 4: Fix `disconnectPrompt` to reset `historyLoading` and cancel in-flight loads**

  Find `disconnectPrompt`. Add two lines at the top of the function body:

  ```typescript
  export function disconnectPrompt() {
    _historyLoadId++          // cancel any in-flight loadHistory
    historyLoading.value = false
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
  ```

- [ ] **Step 5: Fix the `init` handler guard**

  Find the `if (data.type === "init")` block inside `connectPrompt`. Replace the whole block:

  ```typescript
  if (data.type === "init") {
    // Skip overwriting messages if HTTP preload already loaded this conversation.
    // If conversation_id differs (e.g. after "新对话"), always overwrite.
    const alreadyLoaded = conversationId.value === data.conversation_id
    conversationId.value = data.conversation_id
    if (!alreadyLoaded) {
      messages.value = data.messages || []
    }
    // Apply code from last assistant message if exists
    const lastAssistant = [...messages.value]
      .reverse()
      .find((m) => m.role === "assistant" && m.code)
    if (lastAssistant?.code) {
      applyCode(lastAssistant.code)
    }
  }
  ```

- [ ] **Step 6: Verify TypeScript compiles**

  ```bash
  cd /home/xuyue/Projects/webpreview/client && npx tsc --noEmit
  ```

  Expected: no errors in `src/store/prompt.ts`

- [ ] **Step 7: Commit**

  ```bash
  cd /home/xuyue/Projects/webpreview/client
  git add src/store/prompt.ts
  git commit -m "feat: add loadHistory for HTTP-based chat history preload"
  ```

---

### Task 3: Call `loadHistory` in `ChallengeHome.vue`

**Files:**
- Modify: `client/src/pages/ChallengeHome.vue`

- [ ] **Step 1: Add `loadHistory` to the import**

  In the existing prompt import line, add `loadHistory`:

  ```typescript
  import {
    connectPrompt,
    disconnectPrompt,
    conversationId,
    streaming,
    setOnCodeComplete,
    loadHistory,
  } from "../store/prompt"
  ```

- [ ] **Step 2: Call `loadHistory` alongside `connectPrompt` in `loadChallenge`**

  In `loadChallenge()`, after `taskId.value = data.task_ptr`, find the line:

  ```typescript
  connectPrompt(data.task_ptr)
  ```

  Replace with:

  ```typescript
  loadHistory(data.task_ptr)   // HTTP preload — async, non-blocking
  connectPrompt(data.task_ptr) // WebSocket — synchronous open
  ```

  Both fire without `await` so they run concurrently. HTTP is typically faster than
  WebSocket handshake + backend DB query, so the user usually sees history before
  the `init` message arrives. The `init` guard handles deduplication if WS wins the race.

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  cd /home/xuyue/Projects/webpreview/client && npx tsc --noEmit
  ```

  Expected: no errors

- [ ] **Step 4: Commit**

  ```bash
  cd /home/xuyue/Projects/webpreview/client
  git add src/pages/ChallengeHome.vue
  git commit -m "feat: preload chat history via HTTP on challenge entry"
  ```

---

### Task 4: Show loading indicator in `PromptPanel.vue`

**Files:**
- Modify: `client/src/components/PromptPanel.vue`

- [ ] **Step 1: Import `historyLoading`**

  In the script block, add `historyLoading` to the existing import:

  ```typescript
  import {
    messages,
    streaming,
    streamingContent,
    sendPrompt,
    newConversation,
    historyLoading,
  } from "../store/prompt"
  ```

- [ ] **Step 2: Add loading indicator to template**

  Inside `<div class="messages" ref="messagesRef">`, add as first child:

  ```html
  <div class="messages" ref="messagesRef">
    <div v-if="historyLoading" class="history-loading">
      <n-spin size="small" />
      <span>加载历史记录…</span>
    </div>
    <div v-for="(msg, i) in messages" :key="i" :class="['message', msg.role]">
  ```

- [ ] **Step 3: Add loading style**

  In `<style scoped>`, add:

  ```css
  .history-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    color: #aaa;
    font-size: 13px;
    justify-content: center;
  }
  ```

- [ ] **Step 4: Verify TypeScript compiles**

  ```bash
  cd /home/xuyue/Projects/webpreview/client && npx tsc --noEmit
  ```

  Expected: no errors

- [ ] **Step 5: Manual smoke test**
  1. Start Django: `uv run manage.py runserver` (from `api/`)
  2. Start dev server: `npm run start` (from `client/`)
  3. Log in as a user who has previous AI chat on a challenge
  4. Open that challenge → switch to "AI 对话" tab → previous messages appear (with brief loading spinner)
  5. Navigate away and back → same result
  6. Open a challenge with no prior AI chat → empty chat, no spinner
  7. During a chat, click "新对话" → messages clear correctly

- [ ] **Step 6: Commit**

  ```bash
  cd /home/xuyue/Projects/webpreview/client
  git add src/components/PromptPanel.vue
  git commit -m "feat: show loading indicator while chat history preloads"
  ```
