# Submission Flag Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add colored flag markers (red/blue/green/yellow) to submissions, settable by teachers/admins, visible to all users, with list filtering support.

**Architecture:** Add a nullable `flag` CharField to the Submission model. New PUT endpoint for setting/clearing flags with role check. Frontend shows flag icons in the table with a popover for admins to pick colors, plus a dropdown filter.

**Tech Stack:** Django + django-ninja (backend), Vue 3 + Naive UI + TypeScript (frontend)

---

### Task 1: Add `flag` field to Submission model

**Files:**
- Modify: `api/submission/models.py:1-13` (add FLAG_CHOICES and field)

**Step 1: Add FLAG_CHOICES and field to model**

In `api/submission/models.py`, add after the imports (before the class):

```python
class FlagChoices(models.TextChoices):
    RED = "red", "值得展示"
    BLUE = "blue", "需要讲解"
    GREEN = "green", "优秀作品"
    YELLOW = "yellow", "需要改进"
```

In the `Submission` class, add after the `conversation` field (line 33):

```python
    flag = models.CharField(
        max_length=10,
        choices=FlagChoices.choices,
        null=True,
        blank=True,
        default=None,
        verbose_name="标记",
    )
```

**Step 2: Create and run migration**

Run:
```bash
cd api && uv run manage.py makemigrations submission && uv run manage.py migrate
```

Expected: Migration created and applied successfully.

**Step 3: Commit**

```bash
git add api/submission/models.py api/submission/migrations/
git commit -m "feat: add flag field to Submission model"
```

---

### Task 2: Add flag to API schemas and filter

**Files:**
- Modify: `api/submission/schemas.py`

**Step 1: Update SubmissionOut schema**

In `api/submission/schemas.py`, add to the `SubmissionOut` class fields (after line 27 `conversation_id`):

```python
    flag: Optional[str] = None
```

**Step 2: Update SubmissionOut.list() static method**

Add `"flag": submission.flag,` to the return dict in `list()` (after the `conversation_id` line):

```python
            "flag": submission.flag,
```

**Step 3: Update SubmissionOut.get() static method**

Add `"flag": submission.flag,` to the return dict in `get()` (after the `conversation_id` line):

```python
            "flag": submission.flag,
```

**Step 4: Update SubmissionFilter**

Add flag filter field to `SubmissionFilter`:

```python
class SubmissionFilter(Schema):
    task_id: Optional[int] = None
    task_type: Optional[Literal["tutorial", "challenge"]] = None
    username: Optional[str] = None
    flag: Optional[Literal["red", "blue", "green", "yellow"]] = None
```

**Step 5: Add FlagIn schema**

Add at the end of `schemas.py`:

```python
class FlagIn(Schema):
    flag: Optional[Literal["red", "blue", "green", "yellow"]] = None
```

**Step 6: Commit**

```bash
git add api/submission/schemas.py
git commit -m "feat: add flag to submission schemas and filter"
```

---

### Task 3: Add flag API endpoint and filter logic

**Files:**
- Modify: `api/submission/api.py`

**Step 1: Add flag filter to list_submissions**

In `api/submission/api.py`, in the `list_submissions` function, add after the username filter block (after line 65):

```python
    if filters.flag:
        submissions = submissions.filter(flag=filters.flag)
```

**Step 2: Add flag endpoint**

Import `FlagIn` in the imports from `.schemas`. Add the new endpoint after `update_score`:

```python
@router.put("/{submission_id}/flag")
@login_required
def update_flag(request, submission_id: UUID, payload: FlagIn):
    """
    设置或清除提交的标记（仅管理员和超级管理员可操作）
    """
    if request.user.role not in (RoleChoices.SUPER, RoleChoices.ADMIN):
        raise HttpError(403, "没有权限")

    submission = get_object_or_404(Submission, id=submission_id)
    submission.flag = payload.flag
    submission.save(update_fields=["flag"])
    return {"flag": submission.flag}
```

Also add `RoleChoices` to the imports from `account.models`:

```python
from account.models import RoleChoices
```

**Step 3: Commit**

```bash
git add api/submission/api.py
git commit -m "feat: add flag endpoint and filter logic"
```

---

### Task 4: Update frontend types and API client

**Files:**
- Modify: `client/src/utils/type.ts`
- Modify: `client/src/api.ts`
- Modify: `client/src/store/submission.ts`

**Step 1: Add flag type to TypeScript interfaces**

In `client/src/utils/type.ts`, add the FlagType and update interfaces:

```typescript
export type FlagType = "red" | "blue" | "green" | "yellow" | null
```

Add `flag?: FlagType` to `SubmissionOut` (after `conversation_id`):

```typescript
export interface SubmissionOut {
  id: string
  userid: number
  username: string
  task_display: number
  task_type: TASK_TYPE
  task_title: string
  score: number
  my_score: number
  conversation_id?: string
  flag?: FlagType
  created: Date
  modified: Date
}
```

Add `flag?: FlagType` to `SubmissionAll` (after `my_score`):

```typescript
export interface SubmissionAll {
  id: string
  userid: number
  username: string
  task_id: number
  task_display: number
  task_type: TASK_TYPE
  task_title: string
  score: number
  my_score: number
  flag?: FlagType
  html: ""
  css: ""
  js: ""
  created: Date
  modified: Date
}
```

**Step 2: Add updateFlag to API client**

In `client/src/api.ts`, add to the `Submission` object:

```typescript
  async updateFlag(id: string, flag: FlagType) {
    const res = await http.put(`/submission/${id}/flag`, { flag })
    return res.data
  },
```

Also add the import at the top:

```typescript
import type { TutorialIn, ChallengeIn, FlagType } from "./utils/type"
```

**Step 3: Commit**

```bash
git add client/src/utils/type.ts client/src/api.ts client/src/store/submission.ts
git commit -m "feat: add flag type and API method to frontend"
```

---

### Task 5: Add flag column and interaction to Submissions.vue

**Files:**
- Modify: `client/src/pages/Submissions.vue`

**Step 1: Add imports and flag config**

In the `<script setup>` section, add imports:

```typescript
import { roleAdmin, roleSuper } from "../store/user"
import type { FlagType } from "../utils/type"
```

Add flag color config after the existing refs:

```typescript
const FLAG_OPTIONS: { value: FlagType; color: string; label: string }[] = [
  { value: "red", color: "#e03030", label: "值得展示" },
  { value: "blue", color: "#2080f0", label: "需要讲解" },
  { value: "green", color: "#18a058", label: "优秀作品" },
  { value: "yellow", color: "#f0a020", label: "需要改进" },
]

const isAdmin = computed(() => roleAdmin.value || roleSuper.value)
```

**Step 2: Add flag update function**

```typescript
async function updateFlag(row: SubmissionOut, flag: FlagType) {
  await Submission.updateFlag(row.id, flag)
  row.flag = flag
}
```

**Step 3: Add flag column to columns array**

Add as the first column in the `columns` array (before the "时间" column):

```typescript
  {
    title: "标记",
    key: "flag",
    width: 50,
    render: (row) => {
      const flagOption = FLAG_OPTIONS.find((f) => f.value === row.flag)
      const flagIcon = h("span", {
        style: {
          display: "inline-block",
          width: "12px",
          height: "12px",
          borderRadius: "50%",
          backgroundColor: flagOption ? flagOption.color : "transparent",
          border: flagOption ? "none" : "1px dashed #ccc",
          cursor: isAdmin.value ? "pointer" : "default",
        },
      })

      if (!isAdmin.value) return flagIcon

      return h(
        NPopover,
        { trigger: "click" },
        {
          trigger: () => flagIcon,
          default: () =>
            h(NSpace, { vertical: true, size: "small" }, () => [
              ...FLAG_OPTIONS.map((opt) =>
                h(
                  NButton,
                  {
                    text: true,
                    onClick: () => updateFlag(row, opt.value),
                  },
                  () =>
                    h("span", { style: { display: "flex", alignItems: "center", gap: "6px" } }, [
                      h("span", {
                        style: {
                          display: "inline-block",
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          backgroundColor: opt.color,
                        },
                      }),
                      opt.label,
                    ]),
                ),
              ),
              row.flag
                ? h(
                    NButton,
                    {
                      text: true,
                      type: "error",
                      onClick: () => updateFlag(row, null),
                    },
                    () => "清除",
                  )
                : null,
            ]),
        },
      )
    },
  },
```

**Step 4: Add NPopover and NSpace to imports**

Update the naive-ui import:

```typescript
import { NButton, NPopover, NSpace, type DataTableColumn } from "naive-ui"
```

**Step 5: Commit**

```bash
git add client/src/pages/Submissions.vue
git commit -m "feat: add flag column with color picker to submissions table"
```

---

### Task 6: Add flag filter dropdown

**Files:**
- Modify: `client/src/pages/Submissions.vue`

**Step 1: Add flag to query reactive object**

Update the `query` reactive:

```typescript
const query = reactive({
  page: Number(route.params.page),
  username: route.query.username ?? "",
  flag: "" as string,
})
```

**Step 2: Add flag filter dropdown in template**

In the template, inside the `<n-flex align="center">` block (before the username input), add:

```html
<n-select
  v-model:value="query.flag"
  style="width: 100px"
  clearable
  placeholder="标记"
  :options="[
    { label: '红旗', value: 'red' },
    { label: '蓝旗', value: 'blue' },
    { label: '绿旗', value: 'green' },
    { label: '黄旗', value: 'yellow' },
  ]"
/>
```

**Step 3: Add watcher for flag filter**

Add a watch for the flag filter (alongside the existing username watcher):

```typescript
watch(
  () => query.flag,
  () => {
    query.page = 1
    init()
  },
)
```

**Step 4: Commit**

```bash
git add client/src/pages/Submissions.vue
git commit -m "feat: add flag filter dropdown to submissions list"
```

---

### Task 7: Manual verification

**Step 1: Start dev servers**

```bash
cd api && uv run manage.py runserver &
cd client && npm run start &
```

**Step 2: Verify the following**

1. Submissions list shows the flag column
2. As admin/super: clicking the dot opens a color picker popover
3. Selecting a color sets the flag (colored dot appears)
4. Clicking "清除" removes the flag
5. As normal user: flag dot is visible but not clickable
6. Flag filter dropdown filters the list correctly
7. Page refresh preserves flag state (persisted in DB)

**Step 3: Final commit if any fixes needed**
