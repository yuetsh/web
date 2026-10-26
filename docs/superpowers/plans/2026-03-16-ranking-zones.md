# Ranking Zones Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a zone-based ranking page where students nominate their best submission per challenge, scored by a Bayesian weighted formula, displayed in four quality tiers.

**Architecture:** Three sequential layers — (1) backend model + Bayesian scoring, (2) nomination API + schema updates, (3) new Ranking frontend page. Each layer is independently testable before moving on.

**Tech Stack:** Django + django-ninja (backend), Vue 3 + Naive UI + TypeScript (frontend), SQLite/PostgreSQL, Axios

---

## Chunk 1: Backend — Model, Scoring, Migration

### Task 1: Add `raw_score` and `nominated` fields to Submission model

**Files:**
- Modify: `api/submission/models.py`

- [ ] **Step 1: Add imports and new fields**

Open `api/submission/models.py`. At the top, add `Avg` to the django.db.models import:

```python
from django.db.models import Avg
```

Add two new fields inside the `Submission` class, after the `flag` field:

```python
raw_score = models.FloatField(default=0.0, verbose_name="原始加权分")
nominated = models.BooleanField(default=False, db_index=True, verbose_name="参与排名")
```

- [ ] **Step 2: Replace `update_score()` entirely**

Replace the existing `update_score` method with:

```python
def update_score(self):
    ratings = list(self.ratings.select_related("user").all())
    n = len(ratings)

    if n == 0:
        self.raw_score = 0.0
        self.score = 0.0
        self.save(update_fields=["raw_score", "score"])
        return

    weighted_sum = sum(
        r.score * (0.5 if r.user.role == RoleChoices.SUPER
                   else 0.3 if r.user.role == RoleChoices.ADMIN
                   else 0.2)
        for r in ratings
    )
    self.raw_score = weighted_sum / n

    C = 3
    global_mean = (
        Submission.objects.filter(raw_score__gt=0)
        .exclude(pk=self.pk)
        .aggregate(Avg("raw_score"))["raw_score__avg"]
    ) or self.raw_score

    self.score = (C * global_mean + n * self.raw_score) / (C + n)
    self.save(update_fields=["raw_score", "score"])
```

- [ ] **Step 3: Verify the file looks correct**

```bash
cd api && uv run python -c "from submission.models import Submission; print('OK')"
```

Expected: `OK` (no import errors)

- [ ] **Step 4: Generate migration**

```bash
cd api && uv run manage.py makemigrations submission --name "add_raw_score_nominated"
```

Expected: `Migrations for 'submission': api/submission/migrations/0006_add_raw_score_nominated.py`

- [ ] **Step 5: Apply migration**

```bash
uv run manage.py migrate
```

Expected: `Applying submission.0006_add_raw_score_nominated... OK`

- [ ] **Step 6: Smoke-test Bayesian scoring in Django shell**

```bash
uv run manage.py shell
```

```python
from submission.models import Submission, Rating
# Pick any submission that has at least one rating
s = Submission.objects.filter(score__gt=0).first()
if s:
    old_score = s.score
    s.update_score()
    print(f"old={old_score:.4f}  new={s.score:.4f}  raw={s.raw_score:.4f}")
else:
    print("No rated submissions yet — will test after first rating")
```

Expected: prints three float values without errors; `score` ≈ bayesian-shifted version of `raw_score`.

- [ ] **Step 7: Commit**

```bash
cd api
git add submission/models.py submission/migrations/0006_add_raw_score_nominated.py
git commit -m "feat: add raw_score/nominated fields and Bayesian update_score"
```

---

### Task 2: Update schemas — `SubmissionOut` and `SubmissionFilter`

**Files:**
- Modify: `api/submission/schemas.py`

- [ ] **Step 1: Add `nominated` to `SubmissionOut`**

In `SubmissionOut`, add after `flag`:

```python
nominated: bool = False
```

No resolver is needed — the field maps directly from the model.

Also add `"nominated": submission.nominated` to the static `get()` method dict (around line 69), after `"flag"`:

```python
"flag": submission.flag,
"nominated": submission.nominated,  # ← add this line
```

- [ ] **Step 2: Add new filter fields to `SubmissionFilter`**

Replace the existing `SubmissionFilter` class with:

```python
class SubmissionFilter(Schema):
    task_id: Optional[int] = None
    task_type: Optional[Literal["tutorial", "challenge"]] = None
    username: Optional[str] = None
    flag: Optional[Literal["red", "blue", "green", "yellow"]] = None
    score_min: Optional[float] = None
    score_max_exclusive: Optional[float] = None
    score_lt_threshold: Optional[float] = None
    nominated: Optional[bool] = None
    ordering: Optional[str] = None
```

- [ ] **Step 3: Verify schema imports**

Check the top of `schemas.py` — `Optional` and `Literal` are already imported. No new imports needed.

- [ ] **Step 4: Quick check**

```bash
uv run manage.py check
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 5: Commit**

```bash
git add submission/schemas.py
git commit -m "feat: add nominated to SubmissionOut, add score/ordering filters to SubmissionFilter"
```

---

### Task 3: Add filter logic to `list_submissions` + new `nominate` endpoint

**Files:**
- Modify: `api/submission/api.py`

- [ ] **Step 1: Apply new filters in `list_submissions`**

In `list_submissions`, after the existing `if filters.flag:` block and before `user_rating_subquery`, add:

```python
if filters.nominated is not None:
    submissions = submissions.filter(nominated=filters.nominated)
if filters.score_lt_threshold is not None:
    submissions = submissions.filter(score__lt=filters.score_lt_threshold)
else:
    if filters.score_min is not None:
        submissions = submissions.filter(score__gte=filters.score_min)
    if filters.score_max_exclusive is not None:
        submissions = submissions.filter(score__lt=filters.score_max_exclusive)
if filters.ordering in ("-score", "score", "-created"):
    submissions = submissions.order_by(filters.ordering)
```

- [ ] **Step 2: Add the `nominate` endpoint**

Append to `api/submission/api.py`:

```python
@router.put("/{submission_id}/nominate")
@login_required
def nominate_submission(request, submission_id: UUID):
    """
    学生将某条提交标记为"参与排名"。
    同一用户同一题目只能有一条参与排名，旧的自动取消。
    """
    submission = get_object_or_404(Submission, id=submission_id)

    if submission.user != request.user:
        raise HttpError(403, "只能提名自己的提交")

    # Clear any existing nomination for same user + same task
    Submission.objects.filter(
        user=request.user,
        task=submission.task,
        nominated=True,
    ).exclude(pk=submission.pk).update(nominated=False)

    submission.nominated = True
    submission.save(update_fields=["nominated"])

    return {"nominated": True}
```

- [ ] **Step 3: Check the server starts without errors**

```bash
uv run manage.py check
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 4: Manual API test (optional — requires dev server)**

Start the server: `uv run manage.py runserver`

Test the nominate endpoint with curl (replace `<uuid>` and cookie):
```bash
curl -X PUT http://localhost:8000/api/submission/<uuid>/nominate \
  -H "Cookie: sessionid=<your-session>"
```
Expected: `{"nominated": true}`

- [ ] **Step 5: Commit**

```bash
git add submission/api.py
git commit -m "feat: add score/nominated filters to list endpoint and PUT nominate endpoint"
```

---

## Chunk 2: Frontend — Types and API Client

### Task 4: Update TypeScript types

**Files:**
- Modify: `client/src/utils/type.ts`

- [ ] **Step 1: Add `nominated` to `SubmissionOut` interface**

Find the `SubmissionOut` interface (around line 59) and add `nominated`:

```ts
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
  nominated: boolean   // ← add this
  created: Date
  modified: Date
}
```

- [ ] **Step 2: Commit**

```bash
cd client
git add src/utils/type.ts
git commit -m "feat: add nominated field to SubmissionOut interface"
```

---

### Task 5: Update `api.ts` — `Submission.list` signature and `nominate` method

**Files:**
- Modify: `client/src/api.ts`

- [ ] **Step 1: Expand `Submission.list` signature**

Find the existing `list` method in the `Submission` object:

```ts
async list(query: { page: number }) {
```

Replace with:

```ts
async list(query: {
  page: number
  username?: string
  flag?: string | null
  task_type?: string
  score_min?: number
  score_max_exclusive?: number
  score_lt_threshold?: number
  nominated?: boolean
  ordering?: string
}) {
```

- [ ] **Step 2: Add `nominate` method**

After `updateFlag`, add:

```ts
async nominate(id: string) {
  const res = await http.put(`/submission/${id}/nominate`)
  return res.data as { nominated: boolean }
},
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no TypeScript errors related to `Submission.list` or `SubmissionOut`.

- [ ] **Step 4: Commit**

```bash
git add src/api.ts
git commit -m "feat: expand Submission.list params and add Submission.nominate"
```

---

## Chunk 3: Frontend — Nomination UI + Ranking Page

### Task 6: Add nomination button to Submissions.vue

**Files:**
- Modify: `client/src/pages/Submissions.vue`

- [ ] **Step 1: Update the user store import in `Submissions.vue`**

The file currently imports only `{ roleAdmin, roleSuper }` from `"../store/user"` (line 145). Add `user` to that import:

```ts
import { roleAdmin, roleSuper, user } from "../store/user"
```

(`user` has a `username` property which is used to identify the current user's rows, since the user store has no `id` field.)

- [ ] **Step 2: Add nomination column to `columns` array**

In the `columns` array (around line 224), add a new column after the `flag` column:

```ts
{
  title: "排名",
  key: "nominated",
  width: 60,
  render: (row) => {
    // Only show nomination button for the current user's own submissions
    if (row.username !== user.username) {
      return row.nominated
        ? h("span", { style: { color: "#f0a020" } }, "🏅")
        : null
    }
    return h(
      NButton,
      {
        text: true,
        title: row.nominated ? "已参与排名（点击可重新提名）" : "参与排名",
        onClick: (e: Event) => {
          e.stopPropagation()
          handleNominate(row)
        },
      },
      () => (row.nominated ? "🏅" : "☆"),
    )
  },
},
```

- [ ] **Step 3: Add `handleNominate` function**

After the `afterScore` function, add:

```ts
async function handleNominate(row: SubmissionOut) {
  await Submission.nominate(row.id)
  // Update local state: clear other nominations for same task by same user, set this one
  data.value = data.value.map((d) => {
    if (d.username === user.username && d.task_display === row.task_display) {
      d.nominated = d.id === row.id
    }
    return d
  })
}
```

- [ ] **Step 4: Verify the page renders without errors**

Start the frontend dev server: `npm run start`

Open Submissions page. Verify:
- 排名 column appears
- Your own submissions show ☆ / 🏅 button
- Other users' submissions show 🏅 if nominated, nothing if not
- Clicking ☆ calls the API and changes to 🏅 (and clears 🏅 from others in same task)

- [ ] **Step 5: Commit**

```bash
git add src/pages/Submissions.vue
git commit -m "feat: add nomination column to Submissions page"
```

---

### Task 7: Create `Ranking.vue`

**Files:**
- Create: `client/src/pages/Ranking.vue`

- [ ] **Step 1: Create the file**

Create `client/src/pages/Ranking.vue` with the following content:

```vue
<template>
  <n-split class="container" direction="horizontal" :default-size="0.333" :min="0.2" :max="0.8">
    <template #1>
      <n-flex vertical style="height: 100%; padding-right: 10px">
        <n-flex justify="space-between" align="center">
          <n-button secondary @click="$router.back()">返回</n-button>
          <span style="font-weight: bold; font-size: 16px">排名榜</span>
          <div style="width: 60px" />
        </n-flex>

        <!-- Zone tabs -->
        <n-tabs v-model:value="activeZone" type="line" animated @update:value="onZoneChange">
          <n-tab v-for="zone in ZONES" :key="zone.key" :name="zone.key">
            <n-flex align="center" :style="{ gap: '4px' }">
              <span>{{ zone.label }}</span>
              <n-badge
                v-if="counts[zone.key] !== undefined"
                :value="counts[zone.key]"
                :max="999"
                :show-zero="true"
                style="margin-left: 4px"
              />
            </n-flex>
          </n-tab>
        </n-tabs>

        <!-- Ranked table -->
        <n-empty
          v-if="!loading && data.length === 0"
          description="该区暂无提交"
          style="margin: auto"
        />
        <n-data-table
          v-else
          striped
          :columns="columns"
          :data="data"
          :loading="loading"
          :row-props="rowProps"
          :row-class-name="rowClassName"
        />

        <n-pagination
          v-model:page="page"
          :page-size="PAGE_SIZE"
          :item-count="counts[activeZone] ?? 0"
          simple
          style="align-self: flex-end"
        />
      </n-flex>
    </template>
    <template #2>
      <div style="height: 100%; padding-left: 10px">
        <Preview
          v-if="selectedSubmission.id"
          :html="selectedSubmission.html"
          :css="selectedSubmission.css"
          :js="selectedSubmission.js"
          :submission-id="selectedSubmission.id"
          @after-score="afterScore"
        />
      </div>
    </template>
  </n-split>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch, h } from "vue"
import type { DataTableColumn } from "naive-ui"
import { Submission } from "../api"
import type { SubmissionOut } from "../utils/type"
import { parseTime } from "../utils/helper"
import Preview from "../components/Preview.vue"
import { submission as submissionStore } from "../store/submission"

const PAGE_SIZE = 10

interface Zone {
  key: string
  label: string
  params: Record<string, unknown>
}

const ZONES: Zone[] = [
  {
    key: "top",
    label: "🏆 精华",
    params: { score_min: 4.5, ordering: "-score" },
  },
  {
    key: "good",
    label: "⭐ 优秀",
    params: { score_min: 3.5, score_max_exclusive: 4.5, ordering: "-score" },
  },
  {
    key: "normal",
    label: "📝 普通",
    params: { score_min: 0.001, score_max_exclusive: 3.5, ordering: "-score" },
  },
  {
    key: "unrated",
    label: "⏳ 待评",
    params: { score_lt_threshold: 0.001, ordering: "-created" },
  },
]

const activeZone = ref("top")
const page = ref(1)
const data = ref<SubmissionOut[]>([])
const loading = ref(false)
const counts = reactive<Record<string, number>>({})

const selectedSubmission = computed(() => submissionStore.value)

const columns: DataTableColumn<SubmissionOut>[] = [
  {
    title: "#",
    key: "rank",
    width: 45,
    render: (_, index) => (page.value - 1) * PAGE_SIZE + index + 1,
  },
  {
    title: "得分",
    key: "score",
    width: 65,
    render: (row) =>
      row.score > 0
        ? h("span", { style: { fontWeight: "bold" } }, row.score.toFixed(2))
        : h("span", { style: { color: "#999" } }, "—"),
  },
  { title: "提交者", key: "username", width: 80, render: (row) => row.username },
  { title: "任务", key: "task_title", render: (row) => row.task_title },
  {
    title: "时间",
    key: "created",
    width: 110,
    render: (row) => parseTime(row.created, "YYYY-MM-DD HH:mm:ss"),
  },
]

function rowProps(row: SubmissionOut) {
  return {
    style: { cursor: "pointer" },
    onClick: () => loadSubmission(row.id),
  }
}

function rowClassName(row: SubmissionOut) {
  return submissionStore.value.id === row.id ? "row-active" : ""
}

async function loadSubmission(id: string) {
  submissionStore.value = await Submission.get(id)
}

function afterScore() {
  data.value = data.value.map((d) => {
    if (d.id === submissionStore.value.id) {
      d.my_score = submissionStore.value.my_score
    }
    return d
  })
}

function currentZone(): Zone {
  return ZONES.find((z) => z.key === activeZone.value)!
}

async function fetchPage() {
  loading.value = true
  try {
    const zone = currentZone()
    const res = await Submission.list({
      page: page.value,
      task_type: "challenge",
      nominated: true,
      ...zone.params,
    } as Parameters<typeof Submission.list>[0])
    data.value = res.items
    counts[zone.key] = res.count
  } finally {
    loading.value = false
  }
}

async function fetchAllCounts() {
  await Promise.all(
    ZONES.map(async (zone) => {
      const res = await Submission.list({
        page: 1,
        task_type: "challenge",
        nominated: true,
        ...zone.params,
      } as Parameters<typeof Submission.list>[0])
      counts[zone.key] = res.count
    }),
  )
}

function onZoneChange() {
  page.value = 1
  fetchPage()
}

watch(page, fetchPage)

onMounted(async () => {
  await fetchAllCounts()
  await fetchPage()
})
</script>

<style scoped>
.container {
  padding: 10px;
  box-sizing: border-box;
  height: calc(100% - 43px);
  width: 100%;
}

:deep(.row-active td) {
  background-color: rgba(24, 160, 80, 0.1) !important;
}
</style>
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npm run build 2>&1 | grep -E "error TS|Error" | head -20
```

Expected: no TypeScript errors in `Ranking.vue`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Ranking.vue
git commit -m "feat: add Ranking page with four-zone display"
```

---

### Task 8: Register route and add nav entry

**Files:**
- Modify: `client/src/router.ts`
- Modify: `client/src/components/Toolbar.vue`

- [ ] **Step 1: Add route to `router.ts`**

After the `leaderboard` route entry, add:

```ts
{
  path: "/ranking",
  name: "ranking",
  component: () => import("./pages/Ranking.vue"),
  meta: { auth: true },
},
```

- [ ] **Step 2: Add "排名" menu item to `Toolbar.vue`**

In the `menu` computed array, after the `"我的提交"` entry, add:

```ts
{
  label: "排名榜",
  key: "ranking",
  icon: () =>
    h(Icon, {
      icon: "streamline-emojis:trophy",
    }),
},
```

- [ ] **Step 3: Handle the new menu key in `clickMenu`**

In the `clickMenu` switch, after the `submissions` case, add:

```ts
case "ranking":
  router.push({ name: "ranking" })
  break
```

- [ ] **Step 4: End-to-end verification**

Start both servers (`uv run manage.py runserver` + `npm run start`).

Checklist:
- [ ] Log in, open user menu → "排名榜" appears
- [ ] Clicking "排名榜" navigates to `/ranking`
- [ ] All four zone tabs render with count badges
- [ ] 待评 tab shows submissions with score = 0
- [ ] Click a row → right panel shows the preview
- [ ] On Submissions page, own submissions show ☆ / 🏅 in "排名" column
- [ ] Clicking ☆ calls nominate, row shows 🏅, previous nomination clears
- [ ] After nominating, go to Ranking page → submission appears in correct zone

- [ ] **Step 5: Commit**

```bash
git add src/router.ts src/components/Toolbar.vue
git commit -m "feat: register /ranking route and add nav entry"
```
