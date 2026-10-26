# Chain Source Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the ChainModal prompt chain, show a small tag on each round indicating whether it originated from AI dialogue or a manual submission.

**Architecture:** The `Message.source` field already exists on the backend ("conversation" or "manual") but is not serialized. We expose it through the existing `list_messages` endpoint, propagate it through the frontend type, and render a tag badge in `ChainModal.vue` alongside the existing L1–L6 level badge.

**Tech Stack:** Django-ninja (Python), Vue 3, TypeScript, Naive UI

---

## File Map

| File | Change |
|------|--------|
| `api/prompt/schemas.py` | Add `source: str` to `MessageOut` |
| `api/prompt/api.py` | Add `"source": m.source` to `list_messages` response |
| `client/src/utils/type.ts` | Add `source?: string` to `PromptMessage` |
| `client/src/components/submissions/ChainModal.vue` | Carry `source` through rounds, render tag |

---

### Task 1: Expose `source` from the backend messages endpoint

**Files:**
- Modify: `api/prompt/schemas.py`
- Modify: `api/prompt/api.py`

- [ ] **Step 1: Add `source` to `MessageOut` schema**

Open `api/prompt/schemas.py`. Change:

```python
class MessageOut(Schema):
    id: int
    role: str
    content: str
    code_html: Optional[str] = None
    code_css: Optional[str] = None
    code_js: Optional[str] = None
    prompt_level: Optional[int] = None
    created: str
```

to:

```python
class MessageOut(Schema):
    id: int
    role: str
    source: str
    content: str
    code_html: Optional[str] = None
    code_css: Optional[str] = None
    code_js: Optional[str] = None
    prompt_level: Optional[int] = None
    created: str
```

- [ ] **Step 2: Include `source` in the `list_messages` response dict**

Open `api/prompt/api.py`. In `list_messages`, the return list comprehension currently builds dicts manually. Add `"source": m.source`:

```python
    return [
        {
            "id": m.id,
            "role": m.role,
            "source": m.source,
            "content": m.content,
            "code_html": m.code_html,
            "code_css": m.code_css,
            "code_js": m.code_js,
            "prompt_level": m.prompt_level,
            "created": m.created.isoformat(),
        }
        for m in messages
    ]
```

- [ ] **Step 3: Verify the API returns `source` manually**

With the dev server running (`uv run manage.py runserver` from `api/`), open the Django-ninja interactive docs at `http://localhost:8000/api/docs` and call the messages endpoint. Confirm the response includes `"source": "conversation"` or `"source": "manual"` on each message object.

- [ ] **Step 4: Commit**

```bash
git add api/prompt/schemas.py api/prompt/api.py
git commit -m "feat: expose message source field in messages API"
```

---

### Task 2: Add `source` to the frontend type

**Files:**
- Modify: `client/src/utils/type.ts`

- [ ] **Step 1: Add `source` to `PromptMessage`**

Open `client/src/utils/type.ts`. Change:

```typescript
export interface PromptMessage {
  id: number
  role: string
  content: string
  code_html: string | null
  code_css: string | null
  code_js: string | null
  prompt_level?: number | null
  created: string
}
```

to:

```typescript
export interface PromptMessage {
  id: number
  role: string
  source?: string
  content: string
  code_html: string | null
  code_css: string | null
  code_js: string | null
  prompt_level?: number | null
  created: string
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/utils/type.ts
git commit -m "feat: add source field to PromptMessage type"
```

---

### Task 3: Render source indicator in ChainModal

**Files:**
- Modify: `client/src/components/submissions/ChainModal.vue`

- [ ] **Step 1: Carry `source` through the rounds computed property**

In `ChainModal.vue`, the `rounds` computed property builds objects with `{ question, prompt_level, html, css, js }`. Add `source` from the user message:

```typescript
const rounds = computed(() => {
  const result: {
    question: string
    source: string | null
    prompt_level: number | null
    html: string | null
    css: string | null
    js: string | null
  }[] = []
  for (const [i, msg] of messages.value.entries()) {
    if (msg.role !== "user") continue
    let html: string | null = null,
      css: string | null = null,
      js: string | null = null
    for (const reply of messages.value.slice(i + 1)) {
      if (reply.role === "user") break
      if (reply.role === "assistant" && reply.code_html) {
        html = reply.code_html
        css = reply.code_css
        js = reply.code_js
        break
      }
    }
    result.push({
      question: msg.content,
      source: msg.source ?? null,
      prompt_level: msg.prompt_level ?? null,
      html,
      css,
      js,
    })
  }
  return result
})
```

- [ ] **Step 2: Add the source tag to the round card template**

Locate the `<div>` that renders the question and the L-level badge in the round card. It currently looks like:

```html
<div
  style="
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  "
>
  <span>{{ round.question }}</span>
  <span
    v-if="round.prompt_level"
    :style="{
      flexShrink: 0,
      fontSize: '11px',
      fontWeight: 'bold',
      color: levelColors[round.prompt_level],
      marginTop: '2px',
    }"
    >L{{ round.prompt_level }}</span
  >
</div>
```

Replace it with (source tag appears to the right of the L-level badge, in a small flex column):

```html
<div
  style="
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  "
>
  <span>{{ round.question }}</span>
  <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0">
    <span
      v-if="round.prompt_level"
      :style="{
        fontSize: '11px',
        fontWeight: 'bold',
        color: levelColors[round.prompt_level],
        marginTop: '2px',
      }"
      >L{{ round.prompt_level }}</span
    >
    <span
      v-if="round.source"
      :style="{
        fontSize: '10px',
        padding: '1px 5px',
        borderRadius: '4px',
        background: round.source === 'conversation' ? '#e8f0fe' : '#f0f0f0',
        color: round.source === 'conversation' ? '#2060c0' : '#888',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }"
    >{{ round.source === "conversation" ? "AI" : "手动" }}</span>
  </div>
</div>
```

- [ ] **Step 3: Verify visually in the browser**

Start the frontend dev server (`npm run start` from `client/`). Open the Submissions page, expand a row, click 查看 to open ChainModal. Confirm:
- Rounds from AI chat show a blue `AI` badge
- Rounds from manual submissions show a gray `手动` badge
- Rounds with no `source` (old data) show no badge and don't break

- [ ] **Step 4: Commit**

```bash
git add client/src/components/submissions/ChainModal.vue
git commit -m "feat: show AI/manual source indicator on each chain round"
```
