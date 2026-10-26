# 人气前五 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在提交统计弹窗中新增"人气前五"区块，展示当前 task 下 view_count 最高的前 5 条提交，跟随班级筛选。

**Architecture:** 后端在现有 `get_task_stats` 端点中新增 `top_viewed` 查询，前端在 `TaskStatsModal` 底部新增对应 UI 区块。全程复用已有数据流，不新增 API 路由。

**Tech Stack:** Python/Django-Ninja (backend schema + query), TypeScript (type definition), Vue 3 + Naive UI (frontend component)

---

### Task 1: 后端 Schema — 新增 `TopViewedItem`，更新 `TaskStatsOut`

**Files:**
- Modify: `api/submission/schemas.py:134-151`

- [ ] **Step 1: 在 `FlagStats` 之前插入 `TopViewedItem` class**

在 `api/submission/schemas.py` 第 134 行（`class FlagStats` 之前）插入：

```python
class TopViewedItem(Schema):
    username: str
    classname: str
    view_count: int
    submission_id: str
```

- [ ] **Step 2: 在 `TaskStatsOut` 末尾新增 `top_viewed` 字段**

将 `TaskStatsOut`（当前第 141-151 行）更新为：

```python
class TaskStatsOut(Schema):
    submitted_count: int
    unsubmitted_count: int
    average_score: Optional[float]
    unrated_count: int
    unsubmitted_users: list[UserTag]
    unrated_users: list[UserTag]
    submission_count_distribution: SubmissionCountBucket
    flag_stats: FlagStats
    classes: list[str]
    top_viewed: list[TopViewedItem]
```

- [ ] **Step 3: 验证 Schema 无语法错误**

```bash
cd /home/xuyue/Projects/webpreview/api
uv run python -c "from submission.schemas import TaskStatsOut, TopViewedItem; print('OK')"
```

Expected output: `OK`

- [ ] **Step 4: Commit**

```bash
git add api/submission/schemas.py
git commit -m "feat: add TopViewedItem schema and top_viewed field to TaskStatsOut"
```

---

### Task 2: 后端查询 — 在 `get_task_stats` 中计算并返回 `top_viewed`

**Files:**
- Modify: `api/submission/api.py:13-23` (imports)
- Modify: `api/submission/api.py:306-330` (flag_stats 之后 → return 之前，以及 return 语句)

- [ ] **Step 1: 在 import 中新增 `TopViewedItem`**

将 `api/submission/api.py` 顶部的 import（第 13-23 行）更新为：

```python
from .schemas import (
    FlagIn,
    FlagStats,
    SubmissionCountBucket,
    SubmissionFilter,
    SubmissionIn,
    SubmissionOut,
    RatingScoreIn,
    TaskStatsOut,
    TopViewedItem,
    UserTag,
)
```

- [ ] **Step 2: 在 `flag_stats =` 赋值之后、`return TaskStatsOut(...)` 之前插入 top_viewed 查询**

在 `api/submission/api.py` 第 318 行（`return TaskStatsOut(` 之前）插入：

```python
    # Top 5 submissions by view_count (within filtered student_ids)
    top_viewed_qs = (
        Submission.objects
        .filter(task=task, user_id__in=student_ids)
        .select_related("user")
        .order_by("-view_count")[:5]
    )
    top_viewed = [
        TopViewedItem(
            username=s.user.username,
            classname=s.user.classname,
            view_count=s.view_count,
            submission_id=str(s.id),
        )
        for s in top_viewed_qs
    ]
```

- [ ] **Step 3: 在 `return TaskStatsOut(...)` 中新增 `top_viewed=top_viewed`**

将返回语句（当前第 320-330 行）更新为：

```python
    return TaskStatsOut(
        submitted_count=submitted_count,
        unsubmitted_count=unsubmitted_count,
        average_score=average_score,
        unrated_count=unrated_count,
        unsubmitted_users=unsubmitted_users,
        unrated_users=unrated_users,
        submission_count_distribution=SubmissionCountBucket(**dist),
        flag_stats=flag_stats,
        classes=all_classes,
        top_viewed=top_viewed,
    )
```

- [ ] **Step 4: 启动开发服务器，验证接口返回**

```bash
cd /home/xuyue/Projects/webpreview/api
uv run manage.py runserver
```

另开终端，用已有管理员账号 cookie 或 session 测试（替换 `<task_id>` 和 `<session>`）：

```bash
curl -s -H "Cookie: sessionid=<session>" \
  http://127.0.0.1:8000/api/submission/stats/<task_id> \
  | python3 -m json.tool | grep -A 20 '"top_viewed"'
```

Expected: 看到 `"top_viewed": [...]`，每项含 `username`、`classname`、`view_count`、`submission_id`。

- [ ] **Step 5: Commit**

```bash
git add api/submission/api.py
git commit -m "feat: query top 5 by view_count in get_task_stats"
```

---

### Task 3: 前端类型 — 新增 `TopViewedItem` 接口，更新 `TaskStatsOut`

**Files:**
- Modify: `client/src/utils/type.ts:136-148`

- [ ] **Step 1: 在 `TaskStatsOut` 之前插入 `TopViewedItem` 接口**

在 `client/src/utils/type.ts` 第 136 行（`export interface TaskStatsOut` 之前）插入：

```ts
export interface TopViewedItem {
  username: string
  classname: string
  view_count: number
  submission_id: string
}
```

- [ ] **Step 2: 在 `TaskStatsOut` 末尾新增 `top_viewed` 字段**

将 `TaskStatsOut`（当前第 137-148 行）更新为：

```ts
export interface TaskStatsOut {
  submitted_count: number
  unsubmitted_count: number
  average_score: number | null
  unrated_count: number
  unsubmitted_users: UserTag[]
  unrated_users: UserTag[]
  submission_count_distribution: SubmissionCountBucket
  score_distribution: ScoreBucket
  flag_stats: FlagStats
  classes: string[]
  top_viewed: TopViewedItem[]
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/type.ts
git commit -m "feat: add TopViewedItem type and top_viewed to TaskStatsOut"
```

---

### Task 4: 前端 UI — 在 `TaskStatsModal` 中新增"人气前五"区块

**Files:**
- Modify: `client/src/components/TaskStatsModal.vue`

- [ ] **Step 1: 在模板的"标记统计"区块（`<!-- 标记统计 -->`，第 282 行附近）之后新增"人气前五"区块**

找到 `</n-spin>` 之前的 `<!-- 标记统计 -->` 区块末尾的 `</div>`（第 325 行附近），在它后面、`</n-spin>` 之前插入：

```html
          <!-- 人气前五 -->
          <div style="margin-top: 12px">
            <div
              style="
                font-weight: 600;
                font-size: 13px;
                margin-bottom: 8px;
                color: #333;
              "
            >
              人气前五
            </div>
            <div
              v-if="stats.top_viewed.length === 0"
              style="color: #aaa; font-size: 12px"
            >
              暂无
            </div>
            <div v-else style="display: flex; flex-direction: column; gap: 6px">
              <div
                v-for="(item, i) in stats.top_viewed"
                :key="item.submission_id"
                style="
                  display: flex;
                  align-items: center;
                  gap: 8px;
                  padding: 6px 10px;
                  border: 1px solid #eee;
                  border-radius: 6px;
                  cursor: pointer;
                  background: #fafafa;
                "
                @click="viewSubmission(item.submission_id)"
              >
                <span
                  :style="{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: i < 3 ? ['#f0a020', '#888', '#a07040'][i] : '#ddd',
                    color: '#fff',
                    fontSize: '11px',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: '0',
                  }"
                >{{ i + 1 }}</span>
                <span style="flex: 1; font-size: 13px; color: #333">
                  {{ displayName(item.username, item.classname) }}
                </span>
                <span style="font-size: 12px; color: #2080f0; font-weight: 600">
                  {{ item.view_count }} 次
                </span>
              </div>
            </div>
          </div>
```

- [ ] **Step 2: 在 `<script>` 中确认 `TopViewedItem` 类型已被 `TaskStatsOut` 携带（无需额外 import）**

打开 `client/src/components/TaskStatsModal.vue`，确认顶部 import 行：

```ts
import type { TaskStatsOut } from "../utils/type"
```

`TopViewedItem` 作为 `TaskStatsOut.top_viewed` 的元素类型，无需单独导入。

- [ ] **Step 3: 启动前端开发服务器，打开任意 task 的提交统计弹窗**

```bash
cd /home/xuyue/Projects/webpreview/client
npm run start
```

在浏览器中打开 Dashboard，进入任意 tutorial/challenge，点击"提交统计"，向下滚动确认：
- 出现"人气前五"标题
- 列表按 view_count 降序排列，最多 5 项
- 点击某项会在新标签打开对应提交详情
- 切换班级筛选后列表随之更新

- [ ] **Step 4: Commit**

```bash
git add client/src/components/TaskStatsModal.vue
git commit -m "feat: add top-viewed-5 section to TaskStatsModal"
```
