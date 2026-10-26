# Submission View Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `GET /api/submission/{id}` 时原子递增 `view_count` 字段，并在响应中返回该值，供管理员了解哪些提交热度最高。

**Architecture:** 在 `Submission` 模型新增 `view_count` 整数字段；`get_submission` 视图在查询后、返回前执行一次 `UPDATE ... SET view_count = view_count + 1`（使用 `F()` 表达式保证原子性）；`SubmissionOut` schema 暴露该字段。

**Tech Stack:** Django 6, django-ninja, SQLite（开发）/ PostgreSQL（生产），uv

---

## 文件变更概览

| 文件 | 操作 |
|------|------|
| `api/submission/models.py` | 新增 `view_count` 字段 |
| `api/submission/migrations/0009_add_view_count.py` | 新建 migration |
| `api/submission/schemas.py` | `SubmissionOut` 新增 `view_count: int` |
| `api/submission/api.py` | `get_submission` 中递增 `view_count` |
| `api/submission/tests.py` | 新建测试文件 |

---

### Task 1: 写失败测试

**Files:**
- Create: `api/submission/tests.py`

- [ ] **Step 1: 创建测试文件**

```python
# api/submission/tests.py
import uuid
from django.test import TestCase
from django.contrib.auth import get_user_model
from ninja.testing import TestClient

from task.models import Task
from submission.models import Submission
from api.api import api  # django-ninja 的 NinjaAPI 实例

User = get_user_model()


class ViewCountTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="testuser", password="pass"
        )
        self.task = Task.objects.create(
            title="Test Task",
            task_type="challenge",
            display=1,
        )
        self.submission = Submission.objects.create(
            user=self.user,
            task=self.task,
            html="<p>hi</p>",
        )

    def test_get_submission_increments_view_count(self):
        """每次 GET /{id} 后 view_count 应加 1"""
        client = TestClient(api)
        client.force_login(self.user)  # ninja TestClient auth

        assert self.submission.view_count == 0

        client.get(f"/submission/{self.submission.id}")
        self.submission.refresh_from_db()
        assert self.submission.view_count == 1

        client.get(f"/submission/{self.submission.id}")
        self.submission.refresh_from_db()
        assert self.submission.view_count == 2

    def test_get_submission_response_includes_view_count(self):
        """响应 JSON 中应包含 view_count 字段"""
        client = TestClient(api)
        client.force_login(self.user)

        response = client.get(f"/submission/{self.submission.id}")
        assert response.status_code == 200
        data = response.json()
        assert "view_count" in data
        assert data["view_count"] == 1
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd api && uv run manage.py test submission.tests.ViewCountTest -v 2
```

预期：`AttributeError: 'Submission' object has no attribute 'view_count'`（字段不存在）

---

### Task 2: 新增模型字段与 migration

**Files:**
- Modify: `api/submission/models.py`
- Create: `api/submission/migrations/0009_add_view_count.py`

- [ ] **Step 1: 在 `Submission` 模型添加字段**

在 `api/submission/models.py` 的 `zone` 字段后面插入：

```python
    view_count = models.PositiveIntegerField(default=0, verbose_name="查看次数")
```

完整的字段列表变为（只展示新增行的上下文）：

```python
    zone = models.CharField(
        max_length=10,
        choices=ZoneChoices.choices,
        null=True,
        blank=True,
        default=None,
        db_index=True,
        verbose_name="分区",
    )
    view_count = models.PositiveIntegerField(default=0, verbose_name="查看次数")
```

- [ ] **Step 2: 生成 migration**

```bash
cd api && uv run manage.py makemigrations submission --name add_view_count
```

预期输出：`Migrations for 'submission': submission/migrations/0009_add_view_count.py`

- [ ] **Step 3: 执行 migration**

```bash
cd api && uv run manage.py migrate
```

预期：`Applying submission.0009_add_view_count... OK`

---

### Task 3: 更新 schema

**Files:**
- Modify: `api/submission/schemas.py`

- [ ] **Step 1: 在 `SubmissionOut` 中添加 `view_count` 字段**

在 `submit_count: int = 0` 这行之后添加：

```python
    view_count: int = 0
```

同时在 `resolve_submit_count` 方法之后添加解析器：

```python
    @staticmethod
    def resolve_view_count(obj):
        return getattr(obj, "view_count", 0) or 0
```

- [ ] **Step 2: 运行测试，确认仍失败（API 还未递增）**

```bash
cd api && uv run manage.py test submission.tests.ViewCountTest -v 2
```

预期：`AssertionError: assert 0 == 1`（字段存在但没有递增）

---

### Task 4: 在 API 中递增 view_count

**Files:**
- Modify: `api/submission/api.py`

- [ ] **Step 1: 在 `get_submission` 中添加原子递增**

找到 `api/submission/api.py` 的 `get_submission` 函数（第 311 行附近），将其改为：

```python
@router.get("/{submission_id}", response=SubmissionOut)
@login_required
def get_submission(request, submission_id: UUID):
    """
    获取单个提交的详细信息
    """
    user_rating_subquery = Subquery(
        Rating.objects.filter(user=request.user, submission=OuterRef("pk")).values(
            "score"
        )[:1],
        output_field=IntegerField(),
    )
    submission = get_object_or_404(
        Submission.objects.select_related("task", "user").annotate(
            my_score=user_rating_subquery
        ),
        id=submission_id,
    )
    Submission.objects.filter(pk=submission.pk).update(
        view_count=F("view_count") + 1
    )
    submission.view_count += 1  # 更新内存中的值，避免再次查询
    return submission
```

同时将 `api/submission/api.py` 顶部的导入行：

```python
from django.db.models import Avg, Count, IntegerField, Max, OuterRef, Q, Subquery
```

改为：

```python
from django.db.models import Avg, Count, F, IntegerField, Max, OuterRef, Q, Subquery
```

- [ ] **Step 2: 运行全部测试，确认通过**

```bash
cd api && uv run manage.py test submission.tests.ViewCountTest -v 2
```

预期：
```
test_get_submission_increments_view_count ... ok
test_get_submission_response_includes_view_count ... ok
----------------------------------------------------------------------
Ran 2 tests in X.XXXs
OK
```

- [ ] **Step 3: 提交**

```bash
cd api && git add submission/models.py submission/migrations/0009_add_view_count.py submission/schemas.py submission/api.py submission/tests.py
git commit -m "feat: track view_count on Submission, increment on GET /{id}"
```
