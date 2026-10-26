# Showcase Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Dashboard-based management page for awards and awarded submissions that controls the existing student-facing showcase.

**Architecture:** Keep the existing public showcase API unchanged. Add admin-only django-ninja management endpoints under `submission/api.py`, extend the TypeScript API client and shared types, then add a focused `ShowcaseManage.vue` Dashboard page wired into the existing router and sidebar.

**Tech Stack:** Django, django-ninja, Django TestCase, Vue 3 Composition API, TypeScript, Naive UI, Axios.

---

### Task 1: Backend Management API

**Files:**
- Modify: `api/submission/schemas.py`
- Modify: `api/submission/api.py`
- Test: `api/submission/tests.py`

- [ ] **Step 1: Write failing API tests**

Append tests to `api/submission/tests.py` that create an admin user, a normal user, an award, and a submission. Cover forbidden normal-user access, award creation/update, adding the same submission twice, and student showcase visibility after removal/deactivation.

Run: `uv run manage.py test submission`

Expected: FAIL because `/api/submission/showcase/manage/awards` endpoints do not exist.

- [ ] **Step 2: Add schema classes**

Add management schemas in `api/submission/schemas.py`:

```python
class AwardManageIn(Schema):
    name: str
    description: str = ""
    sort_order: int = 0
    is_active: bool = True
    item_ordering: str = "manual"


class AwardManageOut(Schema):
    id: int
    name: str
    description: str
    sort_order: int
    is_active: bool
    item_ordering: str
    item_count: int


class AwardItemIn(Schema):
    submission_id: UUID
    sort_order: int = 0


class AwardItemUpdateIn(Schema):
    sort_order: int = 0


class AwardItemManageOut(Schema):
    id: int
    submission_id: UUID
    username: str
    task_title: str
    task_display: int
    score: float
    view_count: int
    sort_order: int
    awarded_at: datetime
    has_prompt_chain: bool
```

- [ ] **Step 3: Add admin-only endpoints**

In `api/submission/api.py`, import `admin_required` and the new schemas. Add endpoints before `/showcase/{submission_id}/` so static `manage/...` paths resolve correctly:

- `GET /showcase/manage/awards`
- `POST /showcase/manage/awards`
- `PUT /showcase/manage/awards/{award_id}`
- `DELETE /showcase/manage/awards/{award_id}`
- `GET /showcase/manage/awards/{award_id}/items`
- `POST /showcase/manage/awards/{award_id}/items`
- `PUT /showcase/manage/items/{item_id}`
- `DELETE /showcase/manage/items/{item_id}`

Use `admin_required`, `get_object_or_404`, `Count`, `Exists`, and `OuterRef`. Validate `item_ordering` against `ItemOrdering.values`.

- [ ] **Step 4: Run backend tests**

Run: `uv run manage.py test submission`

Expected: PASS.

### Task 2: Frontend API Types And Client

**Files:**
- Modify: `client/src/utils/type.ts`
- Modify: `client/src/api.ts`

- [ ] **Step 1: Add TypeScript types**

Add:

```ts
export type ItemOrdering = "manual" | "awarded_at" | "score" | "view_count"

export interface AwardManageIn {
  name: string
  description: string
  sort_order: number
  is_active: boolean
  item_ordering: ItemOrdering
}

export interface AwardManageOut extends AwardManageIn {
  id: number
  item_count: number
}

export interface AwardItemIn {
  submission_id: string
  sort_order: number
}

export interface AwardItemUpdateIn {
  sort_order: number
}

export interface AwardItemManageOut {
  id: number
  submission_id: string
  username: string
  task_title: string
  task_display: number
  score: number
  view_count: number
  sort_order: number
  awarded_at: string
  has_prompt_chain: boolean
}
```

- [ ] **Step 2: Extend API client**

Import the new types in `client/src/api.ts` and add `Showcase` methods:

- `listManageAwards()`
- `createAward(payload)`
- `updateAward(id, payload)`
- `deleteAward(id)`
- `listAwardItems(id)`
- `addAwardItem(id, payload)`
- `updateAwardItem(itemId, payload)`
- `deleteAwardItem(itemId)`

- [ ] **Step 3: Run type/build check**

Run: `npm run build` from `client/`.

Expected: PASS.

### Task 3: Dashboard Route And Page

**Files:**
- Modify: `client/src/router.ts`
- Modify: `client/src/pages/Dashboard.vue`
- Create: `client/src/pages/ShowcaseManage.vue`

- [ ] **Step 1: Add route and menu**

Add `/dashboard/showcase` child route named `showcase-manage`. Add a Dashboard sidebar item labelled `作品广场`, visible to `admin` and `super`.

- [ ] **Step 2: Create management page**

Build `ShowcaseManage.vue` with:

- Left award list and new award button.
- Right award edit form.
- Award items table with sortable numeric input and remove button.
- Submission search table using existing `Submission.list()`.
- Add-to-award button for each searched submission.

- [ ] **Step 3: Run frontend build**

Run: `npm run build` from `client/`.

Expected: PASS.

### Task 4: End-To-End Verification

**Files:**
- No production file edits expected.

- [ ] **Step 1: Run backend tests**

Run: `uv run manage.py test submission` from `api/`.

Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run: `npm run build` from `client/`.

Expected: PASS.

- [ ] **Step 3: Manual smoke path**

Start the app with existing dev command if needed. Log in as an admin user, visit `/dashboard/showcase`, create an award, add a submission, then visit `/showcase` and confirm the awarded work appears.
