# 等待 AI 回复时随机作品打分弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ChallengeDetail 页面，学生等待 AI 流式回复期间，弹出一个随机的其他同学的提交供其打分，增加评分数据量并提升等待期间的参与感。

**Architecture:** 新增一个无状态的只读接口 `GET /api/submission/random-for-rating/`，从其他学生的提交中随机选取一个（优先选评分人数 < 5 的），排除自己的提交和已评过的提交，并尊重每日 30 次评分上限。前端新增 `RandomRatingModal.vue`，监听现有的 `streaming` 状态（`store/prompt.ts`），在 AI 流式生成期间弹出该作品的预览 + 星级评分，评完自动换下一个，AI 回复完成立即关闭。

**Tech Stack:** Django + django-ninja（后端 API/Schema）、Vue 3 + TypeScript + Naive UI（前端弹窗/评分组件）

参考设计文档：`docs/superpowers/specs/2026-06-11-random-rating-popup-design.md`

---

## File Structure

- Modify `api/submission/schemas.py` — 新增 `RandomRatingOut` 响应 schema
- Modify `api/submission/api.py` — 新增 `GET /random-for-rating/` 端点
- Modify `api/submission/tests.py` — 新增端点单测
- Modify `client/src/utils/type.ts` — 新增 `RandomRatingItem` 类型
- Modify `client/src/api.ts` — 新增 `Submission.randomForRating()` 方法
- Create `client/src/components/ai/RandomRatingModal.vue` — 弹窗组件
- Modify `client/src/pages/ChallengeDetail.vue` — 挂载弹窗组件

---

### Task 1: 后端 — `random-for-rating` 接口

**Files:**
- Modify: `api/submission/schemas.py`
- Modify: `api/submission/api.py`
- Modify: `api/submission/tests.py`

- [ ] **Step 1: 在 `api/submission/tests.py` 中添加失败的测试**

在文件顶部的 import 中加入 `Rating`（当前只 import 了 `Award, Submission, SubmissionAward`）：

```python
from .models import Award, Rating, Submission, SubmissionAward
```

在文件末尾追加新的测试类：

```python
class RandomForRatingApiTest(TestCase):
    def setUp(self):
        self.viewer = _make_user("viewer")
        self.author = _make_user("author")
        self.task = _make_task()

    def _submission(self, user, html="<div>work</div>"):
        return Submission.objects.create(
            user=user, task=self.task, html=html, css="", js=""
        )

    def test_excludes_own_and_already_rated_submissions(self):
        self._submission(self.viewer)  # 自己的提交，应排除
        rated = self._submission(self.author)
        Rating.objects.create(user=self.viewer, submission=rated, score=4)
        eligible = self._submission(self.author)

        self.client.force_login(self.viewer)
        resp = self.client.get("/api/submission/random-for-rating/")

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsNotNone(data)
        self.assertEqual(data["submission_id"], str(eligible.id))
        self.assertEqual(data["username"], "author")
        self.assertEqual(data["task_title"], self.task.title)
        self.assertEqual(data["task_display"], self.task.display)
        self.assertEqual(data["task_type"], "challenge")

    def test_prefers_submission_with_fewer_than_five_ratings(self):
        raters = [_make_user(f"rater{i}") for i in range(5)]
        many_ratings = self._submission(self.author, html="<div>many</div>")
        for rater in raters:
            Rating.objects.create(user=rater, submission=many_ratings, score=3)
        few_ratings = self._submission(self.author, html="<div>few</div>")
        for rater in raters[:2]:
            Rating.objects.create(user=rater, submission=few_ratings, score=3)

        self.client.force_login(self.viewer)
        resp = self.client.get("/api/submission/random-for-rating/")

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["submission_id"], str(few_ratings.id))

    def test_exclude_id_param_excludes_given_submission(self):
        only = self._submission(self.author)

        self.client.force_login(self.viewer)
        resp = self.client.get(
            f"/api/submission/random-for-rating/?exclude_id={only.id}"
        )

        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json())

    def test_normal_user_reaching_daily_cap_returns_none(self):
        self._submission(self.author, html="<div>extra</div>")
        for i in range(30):
            target = self._submission(self.author, html=f"<div>{i}</div>")
            Rating.objects.create(user=self.viewer, submission=target, score=3)

        self.client.force_login(self.viewer)
        resp = self.client.get("/api/submission/random-for-rating/")

        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json())
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd api && uv run manage.py test submission.tests.RandomForRatingApiTest
```

期望：因为 `/api/submission/random-for-rating/` 路由不存在，请求返回 404，断言失败（`assertEqual(resp.status_code, 200)` 不通过）。

- [ ] **Step 3: 在 `api/submission/schemas.py` 末尾追加 `RandomRatingOut` schema**

```python
class RandomRatingOut(Schema):
    submission_id: UUID
    username: str
    task_title: str
    task_display: int
    task_type: Literal["tutorial", "challenge"]
    html: Optional[str] = None
    css: Optional[str] = None
    js: Optional[str] = None

    @staticmethod
    def resolve_submission_id(obj):
        return obj.id

    @staticmethod
    def resolve_username(obj):
        return obj.user.username

    @staticmethod
    def resolve_task_title(obj):
        return obj.task.title

    @staticmethod
    def resolve_task_display(obj):
        return obj.task.display

    @staticmethod
    def resolve_task_type(obj):
        return obj.task.task_type
```

- [ ] **Step 4: 在 `api/submission/api.py` 中添加 `timezone` 导入和 schema 导入**

在现有的 `from django.db.models import (...)` 之后添加：

```python
from django.utils import timezone
```

在 `from .schemas import (...)` 列表中添加 `RandomRatingOut`（按字母顺序插入即可，例如放在 `RatingScoreIn,` 之后）：

```python
    RatingScoreIn,
    RandomRatingOut,
```

- [ ] **Step 5: 在 `api/submission/api.py` 中添加新端点**

放在 `list_by_user_task` 函数之后（即第 288 行之后，`@router.delete("/flags")` 之前）：

```python
@router.get("/random-for-rating/", response=Optional[RandomRatingOut])
@login_required
def get_random_for_rating(request, exclude_id: Optional[UUID] = None):
    """
    随机返回一个待打分的其他同学的提交（用于AI生成期间的随手打分弹窗）
    """
    if request.user.role == RoleChoices.NORMAL:
        today_start = timezone.now().replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        today_end = today_start + timezone.timedelta(days=1)
        rating_count = Rating.objects.filter(
            user=request.user, created__range=(today_start, today_end)
        ).count()
        if rating_count >= 30:
            return None

    candidates = (
        Submission.objects.select_related("task", "user")
        .exclude(user=request.user)
        .exclude(ratings__user=request.user)
    )
    if exclude_id:
        candidates = candidates.exclude(pk=exclude_id)

    pending = candidates.annotate(rating_count=Count("ratings")).filter(
        rating_count__lt=5
    )
    return pending.order_by("?").first() or candidates.order_by("?").first()
```

注意：这里用 `Count("ratings")` 实时统计评分数，而不是依赖 `Submission.zone` 字段——因为 `zone` 只在某条提交收到评分（触发 `update_score`）后才会被设为 `pending`，全新的、从未被评过分的提交 `zone` 仍是 `None`，若依赖 `zone` 字段会把这些最需要被评分的提交漏掉。

- [ ] **Step 6: 运行测试，确认通过**

```bash
cd api && uv run manage.py test submission.tests.RandomForRatingApiTest
```

期望：4 个测试全部 `OK`。

- [ ] **Step 7: 运行完整 submission 测试套件，确认没有破坏现有测试**

```bash
cd api && uv run manage.py test submission
```

期望：全部 `OK`。

- [ ] **Step 8: Commit**

```bash
git add api/submission/schemas.py api/submission/api.py api/submission/tests.py
git commit -m "Add random-for-rating endpoint for AI-wait rating popup"
```

---

### Task 2: 前端 — 类型与 API 客户端

**Files:**
- Modify: `client/src/utils/type.ts`
- Modify: `client/src/api.ts`

- [ ] **Step 1: 在 `client/src/utils/type.ts` 末尾追加 `RandomRatingItem` 类型**

```ts
export interface RandomRatingItem {
  submission_id: string
  username: string
  task_title: string
  task_display: number
  task_type: TASK_TYPE
  html: string | null
  css: string | null
  js: string | null
}
```

- [ ] **Step 2: 在 `client/src/api.ts` 中导入新类型**

在 `import type { ... } from "./utils/type"` 列表中加入 `RandomRatingItem`（例如放在 `PromptRound,` 之后）：

```ts
  PromptRound,
  RandomRatingItem,
```

- [ ] **Step 3: 在 `client/src/api.ts` 的 `Submission` 对象中添加 `randomForRating` 方法**

放在 `updateScore` 方法之后：

```ts
  async randomForRating(excludeId?: string) {
    const res = await http.get("/submission/random-for-rating/", {
      params: excludeId ? { exclude_id: excludeId } : {},
    })
    return res.data as RandomRatingItem | null
  },
```

- [ ] **Step 4: Commit**

```bash
git add client/src/utils/type.ts client/src/api.ts
git commit -m "Add randomForRating API client method and type"
```

（本项目未配置独立的类型检查命令，TS 错误会在 Task 4 启动开发服务器时于终端输出中暴露。）

---

### Task 3: 前端 — `RandomRatingModal.vue` 组件

**Files:**
- Create: `client/src/components/ai/RandomRatingModal.vue`

- [ ] **Step 1: 创建组件文件**

```vue
<template>
  <n-modal
    preset="card"
    :show="show"
    title="等待 AI 回复时，给同学的作品打个分吧"
    style="width: 480px"
    @update:show="onUpdateShow"
  >
    <n-text
      v-if="current"
      depth="3"
      style="font-size: 12px; display: block; margin-bottom: 8px"
    >
      {{ current.task_title }} · 提交者 {{ current.username }}
    </n-text>
    <div class="preview-wrapper">
      <iframe class="preview-iframe" :srcdoc="previewContent"></iframe>
    </div>
    <div class="rate-row">
      <n-rate
        v-if="current"
        :key="current.submission_id"
        :size="32"
        @update:value="onRate"
      />
    </div>
    <n-text
      depth="3"
      style="font-size: 11px; display: block; text-align: center; margin-top: 8px"
    >
      打分后自动换下一个作品；AI 回复完成后弹窗会自动关闭
    </n-text>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue"
import { useMessage } from "naive-ui"
import { Submission } from "../../api"
import { streaming } from "../../store/prompt"
import { buildPreviewDocument } from "../../utils/previewDocument"
import type { RandomRatingItem } from "../../utils/type"

const message = useMessage()

const show = ref(false)
const current = ref<RandomRatingItem | null>(null)
const previewContent = ref("")
let reshowTimer: ReturnType<typeof setTimeout> | null = null

function clearReshowTimer() {
  if (reshowTimer !== null) {
    clearTimeout(reshowTimer)
    reshowTimer = null
  }
}

async function fetchAndShow() {
  const item = await Submission.randomForRating(current.value?.submission_id)
  if (item) {
    current.value = item
    previewContent.value = buildPreviewDocument({
      html: item.html ?? "",
      css: item.css ?? "",
      js: item.js ?? "",
    })
    show.value = true
  } else {
    show.value = false
  }
}

async function onRate(score: number) {
  if (!current.value) return
  try {
    await Submission.updateScore(current.value.submission_id, score)
    message.success("感谢评分！")
    await fetchAndShow()
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "打分失败，请重试")
  }
}

function onUpdateShow(value: boolean) {
  show.value = value
  if (!value) {
    clearReshowTimer()
    if (streaming.value) {
      reshowTimer = setTimeout(fetchAndShow, 30_000)
    }
  }
}

watch(streaming, (val) => {
  clearReshowTimer()
  if (val) {
    fetchAndShow()
  } else {
    show.value = false
  }
})

onUnmounted(() => {
  clearReshowTimer()
})
</script>

<style scoped>
.preview-wrapper {
  height: 220px;
  border: 1px solid #eee;
  border-radius: 4px;
  overflow: hidden;
}

.preview-iframe {
  width: 100%;
  height: 100%;
  border: none;
}

.rate-row {
  display: flex;
  justify-content: center;
  padding: 16px 0;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/ai/RandomRatingModal.vue
git commit -m "Add RandomRatingModal component"
```

---

### Task 4: 前端 — 在 ChallengeDetail 中挂载弹窗

**Files:**
- Modify: `client/src/pages/ChallengeDetail.vue`

- [ ] **Step 1: 导入组件**

在现有 import 列表中加入（放在 `PromptHistoryPanel` 导入之后）：

```ts
import RandomRatingModal from "../components/ai/RandomRatingModal.vue"
```

- [ ] **Step 2: 在模板中挂载组件**

在 `<TaskStatsModal v-model:show="showStats" :task-id="taskId" />` 之后添加：

```html
  <RandomRatingModal v-if="authed" />
```

- [ ] **Step 3: 启动开发服务器并手动验证**

```bash
./dev.sh
```

在浏览器中：
1. 以普通学生账号登录，打开任意挑战页面
2. 切换到「AI 对话」标签，发送一条消息
3. 观察：AI 开始流式生成时（"AI 正在生成中…"），应弹出居中弹窗，显示其他同学的作品预览 + 星级评分
4. 点击星级打分，确认出现"感谢评分！"提示，并自动加载下一个作品（弹窗保持打开）
5. 点击弹窗右上角关闭，确认弹窗消失；若 AI 仍在生成，约 30 秒后应再次弹出新作品
6. 等待 AI 回复完成，确认弹窗自动关闭

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/ChallengeDetail.vue
git commit -m "Show random rating popup while waiting for AI response"
```
