# 挑战分数系统 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让挑战评分真正可见可用——激活 Profile 总分、新增排行榜/我的成绩页面、挑战卡片显示最高得分、管理员可导出 CSV。

**Architecture:** 后端激活 `Profile.total_score` 自动重算逻辑，在 `account` 和 `submission` 路由各新增 2 个端点；前端新增两个独立页面（排行榜、我的成绩），并在挑战卡片和提交列表页做小改动。

**Tech Stack:** Django + django-ninja（后端）；Vue 3 + TypeScript + Naive UI（前端）；`uv run` 执行 Django 命令，`npm run start` 启动前端

---

### Task 1: 激活 Profile 总分自动重算

**Files:**
- Modify: `api/account/models.py`
- Modify: `api/submission/models.py`

**Step 1: 替换 update_total_score 为 recalculate_total_score**

打开 `api/account/models.py`，将 `Profile.update_total_score` 方法替换为：

```python
def recalculate_total_score(self):
    from django.db.models import Max, Sum
    from submission.models import Submission
    total = (
        Submission.objects
        .filter(user=self.user, task__task_type="challenge", score__gt=0)
        .values("task_id")
        .annotate(best=Max("score"))
        .aggregate(total=Sum("best"))["total"]
    ) or 0.0
    self.total_score = total
    self.save(update_fields=["total_score"])
```

**Step 2: 在 Rating post_save 信号里追加调用**

打开 `api/submission/models.py`，找到 `update_submission_score_on_save` 函数，在 `instance.submission.update_score()` 之后追加：

```python
instance.submission.user.profile.recalculate_total_score()
```

完整信号函数变为：

```python
@receiver(post_save, sender=Rating)
def update_submission_score_on_save(sender, instance, **kwargs):
    instance.submission.update_score()
    instance.submission.user.profile.recalculate_total_score()
```

**Step 3: 验证**

```bash
cd api
uv run manage.py check
```

期望：`System check identified no issues (0 silenced).`

**Step 4: Commit**

```bash
git add api/account/models.py api/submission/models.py
git commit -m "feat: activate Profile.total_score auto-recalculation on rating"
```

---

### Task 2: Challenge 模型添加 pass_score 字段

**Files:**
- Modify: `api/task/models.py`

**Step 1: 添加字段**

打开 `api/task/models.py`，在 `Challenge` 类的 `score = models.IntegerField(default=0)` 后追加：

```python
pass_score = models.FloatField(null=True, blank=True, verbose_name="通过分数线")
```

**Step 2: 生成并应用迁移**

```bash
cd api
uv run manage.py makemigrations task
uv run manage.py migrate
```

期望：迁移成功，无报错。

**Step 3: Commit**

```bash
git add api/task/migrations/ api/task/models.py
git commit -m "feat: add pass_score field to Challenge for future unlock mechanism"
```

---

### Task 3: 排行榜 API

**Files:**
- Modify: `api/account/schemas.py`
- Modify: `api/account/api.py`

**Step 1: 添加 LeaderboardEntry schema**

打开 `api/account/schemas.py`，在文件末尾追加：

```python
class LeaderboardEntry(Schema):
    rank: int
    username: str
    total_score: float
```

**Step 2: 添加端点**

打开 `api/account/api.py`，在文件末尾追加：

```python
from typing import List as TypingList

@router.get("/leaderboard", response=TypingList["LeaderboardEntry"])
def leaderboard(request):
    """
    排行榜：所有用户按总分降序
    """
    from .schemas import LeaderboardEntry
    from .models import Profile
    profiles = (
        Profile.objects
        .select_related("user")
        .filter(total_score__gt=0)
        .order_by("-total_score")
    )
    return [
        LeaderboardEntry(rank=i + 1, username=p.user.username, total_score=p.total_score)
        for i, p in enumerate(profiles)
    ]
```

注意：`LeaderboardEntry` 需要在 `api/account/schemas.py` 中导入，在 `api/account/api.py` 顶部的 import 处补充：

```python
from .schemas import (
    BatchUsersIn,
    UserListSchema,
    UserRegistrationSchema,
    UserLoginSchema,
    LeaderboardEntry,
)
```

并将端点函数里的局部 import 去掉。

**Step 3: 验证**

```bash
cd api
uv run manage.py check
```

**Step 4: Commit**

```bash
git add api/account/schemas.py api/account/api.py
git commit -m "feat: add leaderboard API endpoint"
```

---

### Task 4: 我的成绩 API

**Files:**
- Modify: `api/submission/schemas.py`
- Modify: `api/submission/api.py`

**Step 1: 添加 MyScoreOut schema**

打开 `api/submission/schemas.py`，末尾追加：

```python
class MyScoreOut(Schema):
    task_id: int
    task_display: int
    task_title: str
    score: float
    created: str
```

**Step 2: 添加端点**

打开 `api/submission/api.py`，末尾追加（注意顶部要导入 `MyScoreOut`）：

在顶部 imports 的 schemas 导入里加 `MyScoreOut`：

```python
from .schemas import (
    FlagIn,
    SubmissionFilter,
    SubmissionIn,
    SubmissionOut,
    RatingScoreIn,
    MyScoreOut,
)
```

末尾追加端点：

```python
from django.db.models import Max

@router.get("/my-scores", response=List[MyScoreOut])
@login_required
def my_scores(request):
    """
    当前用户每道挑战的最高分提交
    """
    from django.db.models import OuterRef, Subquery
    # 取每个 task 的最高分提交
    best_submissions = (
        Submission.objects
        .filter(user=request.user, task__task_type="challenge")
        .order_by("task_id", "-score")
        .distinct("task_id")
        .select_related("task")
    )
    return [
        MyScoreOut(
            task_id=s.task_id,
            task_display=s.task.display,
            task_title=s.task.title,
            score=s.score,
            created=s.created.isoformat(),
        )
        for s in best_submissions
    ]
```

> **注意**：`distinct("task_id")` 是 PostgreSQL 专用语法（`DISTINCT ON`）。开发环境使用 SQLite 时这行会报错。需用 Python 端去重替代：
>
> ```python
> seen = {}
> for s in Submission.objects.filter(
>     user=request.user, task__task_type="challenge"
> ).order_by("-score").select_related("task"):
>     if s.task_id not in seen:
>         seen[s.task_id] = s
> best_submissions = seen.values()
> ```
>
> 根据实际运行环境选择。开发用 SQLite 请用 Python 端去重版本。

**Step 3: 验证**

```bash
cd api
uv run manage.py check
```

**Step 4: Commit**

```bash
git add api/submission/schemas.py api/submission/api.py
git commit -m "feat: add my-scores API endpoint"
```

---

### Task 5: CSV 导出 API

**Files:**
- Modify: `api/submission/api.py`

**Step 1: 添加端点**

在 `api/submission/api.py` 末尾追加：

```python
import csv
from django.http import StreamingHttpResponse

@router.get("/export")
@login_required
def export_submissions(request, filters: SubmissionFilter = Query(...)):
    """
    导出提交成绩 CSV（仅管理员/超级管理员）
    """
    if request.user.role not in (RoleChoices.SUPER, RoleChoices.ADMIN):
        raise HttpError(403, "没有权限")

    from django.db.models import Max
    qs = (
        Submission.objects
        .filter(task__task_type="challenge")
        .select_related("task", "user")
    )
    if filters.task_id:
        qs = qs.filter(task_id=filters.task_id)
    if filters.username:
        qs = qs.filter(user__username__icontains=filters.username)

    # 每个用户每道题取最高分（Python 端聚合，兼容 SQLite）
    best: dict[tuple, dict] = {}
    for s in qs.order_by("-score"):
        key = (s.user.username, s.task_id)
        if key not in best:
            best[key] = {
                "username": s.user.username,
                "task_display": s.task.display,
                "task_title": s.task.title,
                "score": s.score,
                "created": s.created.isoformat(),
            }

    def rows():
        yield "用户名,题号,标题,最高分,提交时间\n"
        for r in best.values():
            yield f"{r['username']},{r['task_display']},{r['task_title']},{r['score']:.2f},{r['created']}\n"

    response = StreamingHttpResponse(rows(), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="submissions.csv"'
    return response
```

**Step 2: 验证**

```bash
cd api
uv run manage.py check
```

**Step 3: Commit**

```bash
git add api/submission/api.py
git commit -m "feat: add CSV export API for admin"
```

---

### Task 6: 前端 API 方法

**Files:**
- Modify: `client/src/api.ts`

**Step 1: 添加 Account.leaderboard**

在 `api.ts` 的 `Account` 对象里，`batchCreate` 方法之后追加：

```typescript
async leaderboard() {
  const res = await http.get("/account/leaderboard")
  return res.data as { rank: number; username: string; total_score: number }[]
},
```

**Step 2: 添加 Submission.myScores 和 Submission.export**

在 `api.ts` 的 `Submission` 对象里，`updateFlag` 之后追加：

```typescript
async myScores() {
  const res = await http.get("/submission/my-scores")
  return res.data as {
    task_id: number
    task_display: number
    task_title: string
    score: number
    created: string
  }[]
},

async exportCsv(params: { task_id?: number; username?: string }) {
  const res = await http.get("/submission/export", {
    params,
    responseType: "blob",
  })
  return res.data as Blob
},
```

**Step 3: Commit**

```bash
git add client/src/api.ts
git commit -m "feat: add leaderboard, myScores, exportCsv API methods"
```

---

### Task 7: 排行榜页面和路由

**Files:**
- Create: `client/src/pages/Leaderboard.vue`
- Modify: `client/src/router.ts`

**Step 1: 创建 Leaderboard.vue**

```vue
<template>
  <div class="container">
    <n-flex justify="space-between" align="center" style="margin-bottom: 16px">
      <n-button secondary @click="$router.back()">返回</n-button>
      <span style="font-weight: bold; font-size: 18px">排行榜</span>
      <div style="width: 60px" />
    </n-flex>
    <n-data-table :columns="columns" :data="data" :loading="loading" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, h } from "vue"
import { Account } from "../api"
import type { DataTableColumn } from "naive-ui"

const data = ref<{ rank: number; username: string; total_score: number }[]>([])
const loading = ref(false)

const columns: DataTableColumn<{ rank: number; username: string; total_score: number }>[] = [
  { title: "排名", key: "rank", width: 70 },
  { title: "用户名", key: "username" },
  {
    title: "总分",
    key: "total_score",
    render: (row) => h("span", { style: "font-weight: bold" }, row.total_score.toFixed(2)),
  },
]

onMounted(async () => {
  loading.value = true
  try {
    data.value = await Account.leaderboard()
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.container {
  max-width: 600px;
  margin: 40px auto;
  padding: 0 16px;
}
</style>
```

**Step 2: 添加路由**

打开 `client/src/router.ts`，在 `routes` 数组里（submission 路由之后）追加：

```typescript
{
  path: "/leaderboard",
  name: "leaderboard",
  component: () => import("./pages/Leaderboard.vue"),
},
```

**Step 3: Commit**

```bash
git add client/src/pages/Leaderboard.vue client/src/router.ts
git commit -m "feat: add leaderboard page and route"
```

---

### Task 8: 我的成绩页面和路由

**Files:**
- Create: `client/src/pages/MyScores.vue`
- Modify: `client/src/router.ts`

**Step 1: 创建 MyScores.vue**

```vue
<template>
  <div class="container">
    <n-flex justify="space-between" align="center" style="margin-bottom: 16px">
      <n-button secondary @click="$router.back()">返回</n-button>
      <span style="font-weight: bold; font-size: 18px">我的成绩</span>
      <div style="width: 60px" />
    </n-flex>
    <n-empty v-if="!loading && !data.length" description="暂无评分记录" />
    <n-data-table v-else :columns="columns" :data="data" :loading="loading" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, h } from "vue"
import { Submission } from "../api"
import type { DataTableColumn } from "naive-ui"
import { parseTime } from "../utils/helper"

type MyScore = {
  task_id: number
  task_display: number
  task_title: string
  score: number
  created: string
}

const data = ref<MyScore[]>([])
const loading = ref(false)

const columns: DataTableColumn<MyScore>[] = [
  { title: "题号", key: "task_display", width: 70 },
  { title: "标题", key: "task_title" },
  {
    title: "最高得分",
    key: "score",
    render: (row) =>
      row.score > 0
        ? h("span", { style: "font-weight: bold; color: #18a058" }, row.score.toFixed(2))
        : h("span", { style: "color: #999" }, "未评分"),
  },
  {
    title: "提交时间",
    key: "created",
    render: (row) => parseTime(row.created, "YYYY-MM-DD HH:mm"),
  },
]

onMounted(async () => {
  loading.value = true
  try {
    data.value = await Submission.myScores()
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.container {
  max-width: 700px;
  margin: 40px auto;
  padding: 0 16px;
}
</style>
```

**Step 2: 添加路由（需要登录）**

在 `client/src/router.ts` 里追加：

```typescript
{
  path: "/my-scores",
  name: "my-scores",
  component: () => import("./pages/MyScores.vue"),
  meta: { auth: true },
},
```

**Step 3: Commit**

```bash
git add client/src/pages/MyScores.vue client/src/router.ts
git commit -m "feat: add my-scores page and route"
```

---

### Task 9: 挑战卡片显示用户最高得分

**Files:**
- Modify: `client/src/components/Challenge.vue`

**Step 1: 加载 my-scores 并映射**

打开 `client/src/components/Challenge.vue`，在 `<script setup>` 里追加：

```typescript
import { Submission } from "../api"
// ...在现有 import 之后

const myScoreMap = ref<Map<number, number>>(new Map())

async function loadMyScores() {
  try {
    const scores = await Submission.myScores()
    myScoreMap.value = new Map(scores.map((s) => [s.task_display, s.score]))
  } catch {
    // 未登录时忽略
  }
}
```

在 `onMounted(loadList)` 改为：

```typescript
onMounted(async () => {
  await loadList()
  await loadMyScores()
})
```

**Step 2: 在卡片上显示**

在 `<template>` 中找到挑战卡片部分，在 `<template #header-extra>` 里的 `n-tag` 后追加：

```html
<n-tag
  v-if="myScoreMap.get(item.display)"
  type="success"
  size="small"
  style="margin-left: 4px"
>
  得分 {{ myScoreMap.get(item.display)!.toFixed(1) }}
</n-tag>
```

完整 `header-extra` 变为：

```html
<template #header-extra>
  <n-tag type="warning" size="small">{{ item.score }}分</n-tag>
  <n-tag
    v-if="myScoreMap.get(item.display)"
    type="success"
    size="small"
    style="margin-left: 4px"
  >
    得分 {{ myScoreMap.get(item.display)!.toFixed(1) }}
  </n-tag>
</template>
```

**Step 3: Commit**

```bash
git add client/src/components/Challenge.vue
git commit -m "feat: show user's best score on challenge cards"
```

---

### Task 10: Submissions 页面添加导出按钮

**Files:**
- Modify: `client/src/pages/Submissions.vue`

**Step 1: 添加导出函数**

在 `<script setup>` 里（靠近其他函数处）追加：

```typescript
async function exportCsv() {
  const params: { username?: string; task_id?: number } = {}
  if (query.username) params.username = query.username
  const blob = await Submission.exportCsv(params)
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "submissions.csv"
  a.click()
  URL.revokeObjectURL(url)
}
```

**Step 2: 添加导出按钮**

在 `<template>` 里，找到 `<n-flex align="center">` 筛选栏区域（含 `n-select`、`n-input`、`n-pagination`）。在 `n-pagination` 之后追加（仅 admin 可见）：

```html
<n-button v-if="isAdmin" secondary @click="exportCsv">导出 CSV</n-button>
```

**Step 3: Commit**

```bash
git add client/src/pages/Submissions.vue
git commit -m "feat: add CSV export button for admin in submissions page"
```

---

### Task 11: 添加排行榜和我的成绩导航入口

**Files:**
- Modify: `client/src/components/Task.vue`

**Step 1: 添加按钮**

打开 `client/src/components/Task.vue`，在 `<n-flex>` 右侧按钮区（含 submissions 图标按钮和 edit 按钮）里，在 submissions 按钮之后追加两个按钮：

```html
<n-button
  text
  @click="$router.push({ name: 'leaderboard' })"
>
  <Icon :width="16" icon="lucide:trophy" />
</n-button>
<n-button
  text
  v-if="isLoggedIn"
  @click="$router.push({ name: 'my-scores' })"
>
  <Icon :width="16" icon="lucide:bar-chart-2" />
</n-button>
```

**Step 2: 引入 isLoggedIn**

在 `<script setup>` 的 import 区追加：

```typescript
import { STORAGE_KEY } from "../utils/const"
import { computed } from "vue"
const isLoggedIn = computed(() => localStorage.getItem(STORAGE_KEY.LOGIN) === "true")
```

**Step 3: Commit**

```bash
git add client/src/components/Task.vue
git commit -m "feat: add leaderboard and my-scores navigation buttons"
```

---

## 完成验证

手动测试清单：

1. 给某个提交打分后，检查该用户 `Profile.total_score` 是否更新（Django shell: `User.objects.get(username='xxx').profile.total_score`）
2. 访问 `/leaderboard`，确认显示用户排名表格
3. 登录后访问 `/my-scores`，确认显示各题最高得分
4. 挑战列表页，确认有评分的挑战卡片上显示绿色"得分 X.X"标签
5. 以 admin 账号进入 Submissions 页面，确认出现"导出 CSV"按钮，点击后浏览器下载 CSV 文件
