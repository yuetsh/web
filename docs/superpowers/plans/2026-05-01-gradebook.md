# Gradebook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin gradebook page that computes per-class daily-performance grades across tutorials and challenges, supports coverage-based task inclusion, and exports the visible gradebook as CSV.

**Architecture:** Put the gradebook computation in a focused backend service so the JSON and CSV endpoints share one implementation. Expose admin-only django-ninja routes under `submission/`, then add typed frontend API methods and a Dashboard child page that renders fixed summary columns plus dynamic task columns.

**Tech Stack:** Django, django-ninja, Django TestCase, Python `csv`, Vue 3 Composition API, TypeScript, Naive UI, Axios.

---

## File Structure

- Create: `api/submission/gradebook.py`
  - Owns all gradebook query and aggregation logic.
  - Exposes `GradebookFilters`, `build_gradebook()`, and `gradebook_csv_rows()`.
- Modify: `api/submission/schemas.py`
  - Adds response schemas for gradebook tasks, cells, rows, and whole payload.
- Modify: `api/submission/api.py`
  - Adds admin-only JSON and CSV endpoints before dynamic submission-id routes.
- Modify: `api/submission/tests.py`
  - Adds API tests for permissions, coverage, highest-score cells, grade boundaries, filtering, and CSV export.
- Modify: `client/src/utils/type.ts`
  - Adds TypeScript gradebook query and response types.
- Modify: `client/src/api.ts`
  - Adds `Gradebook.get()` and `Gradebook.downloadCsv()`.
- Modify: `client/src/router.ts`
  - Adds `/dashboard/gradebook`.
- Modify: `client/src/pages/Dashboard.vue`
  - Adds the sidebar entry visible to admin and super users.
- Create: `client/src/pages/Gradebook.vue`
  - Implements filters, dynamic table columns, score links, missing/excluded states, and CSV export action.

Implementation note: coverage, included-task totals, ranks, and grades are calculated against the full selected class. The optional `username` filter only filters returned rows after full-class ranks and grades are assigned.

---

### Task 1: Backend Tests

**Files:**
- Modify: `api/submission/tests.py`

- [ ] **Step 1: Extend test helpers**

Update the imports and existing helpers near the top of `api/submission/tests.py`:

```python
import csv
import io
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from account.models import RoleChoices
from prompt.models import Conversation, Message
from task.models import Task

from .models import Award, Submission, SubmissionAward

User = get_user_model()


def _make_user(username, role=RoleChoices.NORMAL, classname=""):
    user = User.objects.create_user(username=username, password="pw")
    user.role = role
    user.classname = classname
    user.save(update_fields=["role", "classname"])
    return user


def _make_task(
    title="Test Challenge",
    task_type="challenge",
    display=1,
    is_public=True,
):
    return Task.objects.create(
        title=title,
        task_type=task_type,
        display=display,
        content="",
        is_public=is_public,
    )
```

Run: `cd /home/xuyue/Projects/webpreview/api && uv run manage.py test submission`

Expected: PASS. Existing tests should still work because the helper defaults preserve the old call shape.

- [ ] **Step 2: Add failing gradebook API tests**

Append this test class to `api/submission/tests.py`:

```python
class GradebookApiTest(TestCase):
    def setUp(self):
        self.admin = _make_user("grade-admin", role=RoleChoices.ADMIN)
        self.normal = _make_user("grade-normal", classname="blocked")

    def _student(self, username, classname="10A"):
        return _make_user(username, classname=classname)

    def _submit(self, user, task, score, created=None):
        submission = Submission.objects.create(
            user=user,
            task=task,
            score=score,
            html="",
            css="",
            js="",
        )
        if created is not None:
            Submission.objects.filter(pk=submission.pk).update(created=created)
            submission.refresh_from_db()
        return submission

    def test_gradebook_requires_classname(self):
        self.client.force_login(self.admin)

        resp = self.client.get("/api/submission/gradebook/")

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["detail"], "请选择班级")

    def test_normal_user_cannot_access_gradebook(self):
        self.client.force_login(self.normal)

        resp = self.client.get("/api/submission/gradebook/?classname=10A")
        export_resp = self.client.get(
            "/api/submission/gradebook/export/?classname=10A"
        )

        self.assertIn(resp.status_code, (302, 403))
        self.assertIn(export_resp.status_code, (302, 403))

    def test_coverage_includes_tutorial_and_challenge_without_public_requirement(self):
        students = [
            self._student("alice"),
            self._student("bob"),
            self._student("carol"),
            self._student("dave"),
        ]
        tutorial = _make_task(
            title="Intro",
            task_type="tutorial",
            display=1,
            is_public=False,
        )
        challenge = _make_task(
            title="Challenge One",
            task_type="challenge",
            display=1,
            is_public=True,
        )
        low_coverage = _make_task(
            title="Optional",
            task_type="challenge",
            display=2,
            is_public=True,
        )
        self._submit(students[0], tutorial, 4.0)
        self._submit(students[1], tutorial, 5.0)
        self._submit(students[0], challenge, 3.0)
        self._submit(students[1], challenge, 4.0)
        self._submit(students[0], low_coverage, 5.0)
        self.client.force_login(self.admin)

        resp = self.client.get("/api/submission/gradebook/?classname=10A")

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["student_count"], 4)
        self.assertEqual(data["coverage_threshold_count"], 2)
        self.assertEqual(data["included_task_count"], 2)
        self.assertEqual([task["id"] for task in data["tasks"]], [tutorial.id, challenge.id])
        self.assertTrue(all(task["included"] for task in data["tasks"]))

        alice = next(row for row in data["rows"] if row["username"] == "alice")
        carol = next(row for row in data["rows"] if row["username"] == "carol")
        self.assertEqual(alice["tutorial_total"], 4.0)
        self.assertEqual(alice["challenge_total"], 3.0)
        self.assertEqual(alice["total_score"], 7.0)
        self.assertEqual(alice["average_score"], 3.5)
        self.assertEqual(alice["submitted_task_count"], 2)
        self.assertEqual(alice["missing_task_count"], 0)
        self.assertEqual(carol["total_score"], 0.0)
        self.assertEqual(carol["submitted_task_count"], 0)
        self.assertEqual(carol["missing_task_count"], 2)

        include_all_resp = self.client.get(
            "/api/submission/gradebook/?classname=10A&include_all_tasks=true"
        )
        include_all = include_all_resp.json()
        optional = next(task for task in include_all["tasks"] if task["id"] == low_coverage.id)
        alice_all = next(row for row in include_all["rows"] if row["username"] == "alice")
        self.assertFalse(optional["included"])
        self.assertTrue(alice_all["scores"][str(low_coverage.id)]["submitted"])
        self.assertEqual(alice_all["scores"][str(low_coverage.id)]["score"], 5.0)
        self.assertEqual(alice_all["total_score"], 7.0)
        self.assertEqual(alice_all["submitted_task_count"], 2)

    def test_best_submission_uses_highest_score_and_latest_equal_score_link(self):
        alice = self._student("alice")
        bob = self._student("bob")
        task = _make_task(title="Best Score", task_type="tutorial", display=3)
        older = timezone.now() - timedelta(days=2)
        newer = timezone.now() - timedelta(days=1)
        self._submit(alice, task, 2.0)
        old_best = self._submit(alice, task, 4.5, created=older)
        new_best = self._submit(alice, task, 4.5, created=newer)
        self._submit(bob, task, 3.0)
        self.client.force_login(self.admin)

        resp = self.client.get("/api/submission/gradebook/?classname=10A")

        self.assertEqual(resp.status_code, 200)
        alice_row = next(row for row in resp.json()["rows"] if row["username"] == "alice")
        cell = alice_row["scores"][str(task.id)]
        self.assertEqual(cell["score"], 4.5)
        self.assertEqual(cell["submission_id"], str(new_best.id))
        self.assertNotEqual(cell["submission_id"], str(old_best.id))

    def test_task_type_and_username_filters_keep_full_class_rank(self):
        alice = self._student("alice")
        bob = self._student("bob")
        tutorial = _make_task(title="Tutorial", task_type="tutorial", display=1)
        challenge = _make_task(title="Challenge", task_type="challenge", display=1)
        self._submit(alice, tutorial, 1.0)
        self._submit(bob, tutorial, 5.0)
        self._submit(alice, challenge, 5.0)
        self._submit(bob, challenge, 1.0)
        self.client.force_login(self.admin)

        resp = self.client.get(
            "/api/submission/gradebook/?classname=10A&task_type=tutorial&username=alice"
        )

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual([task["task_type"] for task in data["tasks"]], ["tutorial"])
        self.assertEqual(len(data["rows"]), 1)
        self.assertEqual(data["rows"][0]["username"], "alice")
        self.assertEqual(data["rows"][0]["rank"], 2)

    def test_missing_class_returns_empty_table_with_class_options(self):
        self._student("alice")
        self.client.force_login(self.admin)

        resp = self.client.get("/api/submission/gradebook/?classname=missing")

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("10A", data["classes"])
        self.assertEqual(data["student_count"], 0)
        self.assertEqual(data["coverage_threshold_count"], 0)
        self.assertEqual(data["tasks"], [])
        self.assertEqual(data["rows"], [])

    def test_no_included_tasks_still_returns_student_rows(self):
        students = [
            self._student("alice"),
            self._student("bob"),
            self._student("carol"),
        ]
        optional = _make_task(title="Low Coverage", task_type="challenge", display=8)
        self._submit(students[0], optional, 5.0)
        self.client.force_login(self.admin)

        resp = self.client.get("/api/submission/gradebook/?classname=10A")

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["student_count"], 3)
        self.assertEqual(data["coverage_threshold_count"], 2)
        self.assertEqual(data["tasks"], [])
        self.assertEqual(data["included_task_count"], 0)
        self.assertEqual(len(data["rows"]), 3)
        alice = next(row for row in data["rows"] if row["username"] == "alice")
        self.assertEqual(alice["total_score"], 0.0)
        self.assertIsNone(alice["average_score"])
        self.assertEqual(alice["submitted_task_count"], 0)
        self.assertEqual(alice["missing_task_count"], 0)

        include_all_resp = self.client.get(
            "/api/submission/gradebook/?classname=10A&include_all_tasks=true"
        )
        include_all = include_all_resp.json()
        self.assertEqual(include_all["task_count"], 1)
        self.assertFalse(include_all["tasks"][0]["included"])
        alice_all = next(row for row in include_all["rows"] if row["username"] == "alice")
        self.assertTrue(alice_all["scores"][str(optional.id)]["submitted"])
        self.assertEqual(alice_all["total_score"], 0.0)

    def test_grade_boundaries_use_ceil_thresholds(self):
        task = _make_task(title="Boundary", task_type="challenge", display=7)
        for i in range(1, 21):
            student = self._student(f"s{i:02d}", classname="10B")
            self._submit(student, task, float(21 - i))
        self.client.force_login(self.admin)

        resp = self.client.get("/api/submission/gradebook/?classname=10B")

        self.assertEqual(resp.status_code, 200)
        rows_by_name = {row["username"]: row for row in resp.json()["rows"]}
        self.assertEqual(rows_by_name["s01"]["grade"], "A")
        self.assertEqual(rows_by_name["s06"]["grade"], "A")
        self.assertEqual(rows_by_name["s07"]["grade"], "B")
        self.assertEqual(rows_by_name["s14"]["grade"], "B")
        self.assertEqual(rows_by_name["s15"]["grade"], "C")
        self.assertEqual(rows_by_name["s18"]["grade"], "C")
        self.assertEqual(rows_by_name["s19"]["grade"], "D")
        self.assertEqual(rows_by_name["s20"]["grade"], "E")

    def test_export_csv_matches_current_filters(self):
        alice = self._student("alice")
        bob = self._student("bob")
        tutorial = _make_task(title="Intro", task_type="tutorial", display=1)
        challenge = _make_task(title="Challenge", task_type="challenge", display=1)
        self._submit(alice, tutorial, 4.0)
        self._submit(bob, tutorial, 2.0)
        self._submit(alice, challenge, 5.0)
        self.client.force_login(self.admin)

        resp = self.client.get(
            "/api/submission/gradebook/export/?classname=10A&task_type=tutorial"
        )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "text/csv; charset=utf-8")
        self.assertIn("attachment;", resp["Content-Disposition"])
        rows = list(csv.reader(io.StringIO(resp.content.decode("utf-8-sig"))))
        self.assertEqual(
            rows[0],
            [
                "排名",
                "等级",
                "用户名",
                "班级",
                "教程1-Intro",
                "教程合计",
                "挑战合计",
                "总分",
                "平均分",
                "已提交任务数",
                "未提交任务数",
            ],
        )
        self.assertEqual(rows[1][2], "alice")
        self.assertEqual(rows[1][4], "4")
        self.assertEqual(rows[1][7], "4")
```

Run: `cd /home/xuyue/Projects/webpreview/api && uv run manage.py test submission.GradebookApiTest`

Expected: FAIL because `/api/submission/gradebook/` and `/api/submission/gradebook/export/` are not implemented.

- [ ] **Step 3: Commit tests**

```bash
git add api/submission/tests.py
git commit -m "test: add gradebook API coverage"
```

---

### Task 2: Backend Gradebook Builder

**Files:**
- Create: `api/submission/gradebook.py`

- [ ] **Step 1: Create the gradebook service**

Create `api/submission/gradebook.py` with this content:

```python
from dataclasses import dataclass
from math import ceil
from typing import Literal

from django.db.models import Count
from ninja.errors import HttpError

from account.models import RoleChoices, User
from task.models import Task, TaskTypeChoices

from .models import Submission

GradebookTaskType = Literal["tutorial", "challenge"]


@dataclass(frozen=True)
class GradebookFilters:
    classname: str
    task_type: GradebookTaskType | None = None
    username: str | None = None
    include_all_tasks: bool = False


def _score(value):
    rounded = round(float(value or 0), 2)
    if rounded == 0:
        return 0.0
    return rounded


def _grade_for_rank(rank: int, student_count: int) -> str:
    if rank <= ceil(0.30 * student_count):
        return "A"
    if rank <= ceil(0.70 * student_count):
        return "B"
    if rank <= ceil(0.90 * student_count):
        return "C"
    if rank <= ceil(0.95 * student_count):
        return "D"
    return "E"


def _task_sort_key(task):
    type_order = 0 if task.task_type == TaskTypeChoices.TUTORIAL else 1
    return (type_order, task.display, task.id)


def _task_type_label(task_type: str) -> str:
    return "教程" if task_type == TaskTypeChoices.TUTORIAL else "挑战"


def _csv_number(value):
    if value == "":
        return ""
    number = float(value)
    if number.is_integer():
        return str(int(number))
    return f"{number:.2f}".rstrip("0").rstrip(".")


def _classes():
    return list(
        User.objects.filter(role=RoleChoices.NORMAL)
        .exclude(classname="")
        .values_list("classname", flat=True)
        .distinct()
        .order_by("classname")
    )


def _task_csv_header(task):
    return f"{_task_type_label(task['task_type'])}{task['display']}-{task['title']}"


def build_gradebook(filters: GradebookFilters):
    classname = filters.classname.strip() if filters.classname else ""
    if not classname:
        raise HttpError(400, "请选择班级")
    if filters.task_type not in (None, "tutorial", "challenge"):
        raise HttpError(400, "无效的任务类型")

    classes = _classes()
    class_students = list(
        User.objects.filter(role=RoleChoices.NORMAL, classname=classname)
        .order_by("username", "id")
        .only("id", "username", "classname")
    )
    class_student_ids = [student.id for student in class_students]
    student_count = len(class_student_ids)
    coverage_threshold_count = ceil(student_count * 0.5) if student_count else 0

    task_submission_qs = Submission.objects.filter(user_id__in=class_student_ids)
    if filters.task_type:
        task_submission_qs = task_submission_qs.filter(task__task_type=filters.task_type)

    submitted_counts = {
        row["task_id"]: row["submitted_count"]
        for row in task_submission_qs.values("task_id").annotate(
            submitted_count=Count("user_id", distinct=True)
        )
    }
    task_map = {
        task.id: task
        for task in Task.objects.filter(id__in=submitted_counts.keys()).only(
            "id",
            "display",
            "title",
            "task_type",
        )
    }

    all_tasks = []
    for task in sorted(task_map.values(), key=_task_sort_key):
        submitted_count = submitted_counts[task.id]
        included = student_count > 0 and submitted_count >= coverage_threshold_count
        all_tasks.append(
            {
                "id": task.id,
                "display": task.display,
                "title": task.title,
                "task_type": task.task_type,
                "submitted_count": submitted_count,
                "coverage": _score(submitted_count / student_count)
                if student_count
                else 0.0,
                "included": included,
            }
        )

    tasks = [
        task
        for task in all_tasks
        if filters.include_all_tasks or task["included"]
    ]
    visible_task_ids = [task["id"] for task in tasks]
    included_task_ids = {task["id"] for task in tasks if task["included"]}

    best_by_pair = {}
    if class_student_ids and visible_task_ids:
        submissions = (
            Submission.objects.filter(
                user_id__in=class_student_ids,
                task_id__in=visible_task_ids,
            )
            .select_related("task")
            .only("id", "user_id", "task_id", "score", "created", "task__task_type")
            .order_by("user_id", "task_id", "-score", "-created", "-id")
        )
        for submission in submissions:
            best_by_pair.setdefault(
                (submission.user_id, submission.task_id),
                submission,
            )

    rows = []
    for student in class_students:
        scores = {}
        tutorial_total = 0.0
        challenge_total = 0.0
        submitted_task_count = 0
        missing_task_count = 0

        for task in tasks:
            submission = best_by_pair.get((student.id, task["id"]))
            if submission:
                cell_score = _score(submission.score)
                scores[task["id"]] = {
                    "score": cell_score,
                    "submitted": True,
                    "submission_id": submission.id,
                }
            else:
                cell_score = 0.0
                scores[task["id"]] = {
                    "score": 0.0,
                    "submitted": False,
                    "submission_id": None,
                }

            if not task["included"]:
                continue
            if submission:
                submitted_task_count += 1
            else:
                missing_task_count += 1
            if task["task_type"] == TaskTypeChoices.TUTORIAL:
                tutorial_total += cell_score
            else:
                challenge_total += cell_score

        tutorial_total = _score(tutorial_total)
        challenge_total = _score(challenge_total)
        total_score = _score(tutorial_total + challenge_total)
        average_score = (
            _score(total_score / len(included_task_ids))
            if included_task_ids
            else None
        )
        rows.append(
            {
                "user_id": student.id,
                "username": student.username,
                "classname": student.classname,
                "rank": 0,
                "grade": "E",
                "scores": scores,
                "tutorial_total": tutorial_total,
                "challenge_total": challenge_total,
                "total_score": total_score,
                "average_score": average_score,
                "submitted_task_count": submitted_task_count,
                "missing_task_count": missing_task_count,
            }
        )

    rows.sort(key=lambda row: (-row["total_score"], row["username"]))
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
        row["grade"] = _grade_for_rank(index, student_count)

    username = filters.username.strip().lower() if filters.username else ""
    if username:
        rows = [row for row in rows if username in row["username"].lower()]

    return {
        "classname": classname,
        "classes": classes,
        "task_count": len(tasks),
        "included_task_count": len(included_task_ids),
        "student_count": student_count,
        "coverage_threshold_count": coverage_threshold_count,
        "tasks": tasks,
        "rows": rows,
    }


def gradebook_csv_rows(gradebook):
    tasks = gradebook["tasks"]
    yield [
        "排名",
        "等级",
        "用户名",
        "班级",
        *[_task_csv_header(task) for task in tasks],
        "教程合计",
        "挑战合计",
        "总分",
        "平均分",
        "已提交任务数",
        "未提交任务数",
    ]

    for row in gradebook["rows"]:
        yield [
            row["rank"],
            row["grade"],
            row["username"],
            row["classname"],
            *[_csv_number(row["scores"][task["id"]]["score"]) for task in tasks],
            _csv_number(row["tutorial_total"]),
            _csv_number(row["challenge_total"]),
            _csv_number(row["total_score"]),
            "" if row["average_score"] is None else _csv_number(row["average_score"]),
            row["submitted_task_count"],
            row["missing_task_count"],
        ]
```

- [ ] **Step 2: Verify service imports**

Run:

```bash
cd /home/xuyue/Projects/webpreview/api
uv run python -c "from submission.gradebook import GradebookFilters, build_gradebook, gradebook_csv_rows; print('OK')"
```

Expected output: `OK`

- [ ] **Step 3: Commit service**

```bash
git add api/submission/gradebook.py
git commit -m "feat: add gradebook aggregation service"
```

---

### Task 3: Backend Schemas And Routes

**Files:**
- Modify: `api/submission/schemas.py`
- Modify: `api/submission/api.py`
- Test: `api/submission/tests.py`

- [ ] **Step 1: Add gradebook schemas**

In `api/submission/schemas.py`, keep the existing `from typing import Optional, Literal` import and append these classes after `TaskStatsOut`:

```python
class GradebookTask(Schema):
    id: int
    display: int
    title: str
    task_type: Literal["tutorial", "challenge"]
    submitted_count: int
    coverage: float
    included: bool


class GradebookCell(Schema):
    score: float
    submitted: bool
    submission_id: Optional[UUID] = None


class GradebookRow(Schema):
    user_id: int
    username: str
    classname: str
    rank: int
    grade: Literal["A", "B", "C", "D", "E"]
    scores: dict[int, GradebookCell]
    tutorial_total: float
    challenge_total: float
    total_score: float
    average_score: Optional[float]
    submitted_task_count: int
    missing_task_count: int


class GradebookOut(Schema):
    classname: str
    classes: list[str]
    task_count: int
    included_task_count: int
    student_count: int
    coverage_threshold_count: int
    tasks: list[GradebookTask]
    rows: list[GradebookRow]
```

- [ ] **Step 2: Add imports in `api/submission/api.py`**

Update the top of `api/submission/api.py`:

```python
import csv
import threading
from typing import List, Literal, Optional
from urllib.parse import quote
from uuid import UUID

from django.http import HttpResponse
```

Add `GradebookOut` to the `.schemas` import list:

```python
    GradebookOut,
```

Add the gradebook service import near the model imports:

```python
from .gradebook import GradebookFilters, build_gradebook, gradebook_csv_rows
```

- [ ] **Step 3: Add JSON and CSV endpoints**

Insert these routes in `api/submission/api.py` after `get_task_stats()` and before `/showcase/` routes:

```python
@router.get("/gradebook/", response=GradebookOut)
@admin_required
def get_gradebook(
    request,
    classname: str = "",
    task_type: Optional[Literal["tutorial", "challenge"]] = None,
    username: Optional[str] = None,
    include_all_tasks: bool = False,
):
    return build_gradebook(
        GradebookFilters(
            classname=classname,
            task_type=task_type,
            username=username,
            include_all_tasks=include_all_tasks,
        )
    )


@router.get("/gradebook/export/")
@admin_required
def export_gradebook(
    request,
    classname: str = "",
    task_type: Optional[Literal["tutorial", "challenge"]] = None,
    username: Optional[str] = None,
    include_all_tasks: bool = False,
):
    gradebook = build_gradebook(
        GradebookFilters(
            classname=classname,
            task_type=task_type,
            username=username,
            include_all_tasks=include_all_tasks,
        )
    )
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    filename = f"gradebook-{gradebook['classname']}.csv"
    response["Content-Disposition"] = (
        f"attachment; filename*=UTF-8''{quote(filename)}"
    )
    response.write("\ufeff")
    writer = csv.writer(response)
    for row in gradebook_csv_rows(gradebook):
        writer.writerow(row)
    return response
```

- [ ] **Step 4: Run backend tests**

Run:

```bash
cd /home/xuyue/Projects/webpreview/api
uv run manage.py test submission.GradebookApiTest
```

Expected: PASS.

- [ ] **Step 5: Run full submission tests**

Run:

```bash
cd /home/xuyue/Projects/webpreview/api
uv run manage.py test submission
```

Expected: PASS.

- [ ] **Step 6: Commit backend API**

```bash
git add api/submission/schemas.py api/submission/api.py api/submission/tests.py
git commit -m "feat: expose gradebook API and CSV export"
```

---

### Task 4: Frontend Types And API Client

**Files:**
- Modify: `client/src/utils/type.ts`
- Modify: `client/src/api.ts`

- [ ] **Step 1: Add gradebook TypeScript types**

Append these types to `client/src/utils/type.ts`:

```ts
export type GradebookTaskType = "tutorial" | "challenge"
export type GradebookGrade = "A" | "B" | "C" | "D" | "E"

export interface GradebookQuery {
  classname: string
  task_type?: GradebookTaskType | ""
  username?: string
  include_all_tasks?: boolean
}

export interface GradebookTask {
  id: number
  display: number
  title: string
  task_type: GradebookTaskType
  submitted_count: number
  coverage: number
  included: boolean
}

export interface GradebookCell {
  score: number
  submitted: boolean
  submission_id: string | null
}

export interface GradebookRow {
  user_id: number
  username: string
  classname: string
  rank: number
  grade: GradebookGrade
  scores: Record<number, GradebookCell>
  tutorial_total: number
  challenge_total: number
  total_score: number
  average_score: number | null
  submitted_task_count: number
  missing_task_count: number
}

export interface GradebookOut {
  classname: string
  classes: string[]
  task_count: number
  included_task_count: number
  student_count: number
  coverage_threshold_count: number
  tasks: GradebookTask[]
  rows: GradebookRow[]
}
```

- [ ] **Step 2: Import gradebook types in API client**

In `client/src/api.ts`, add these names to the existing type import:

```ts
  GradebookOut,
  GradebookQuery,
```

- [ ] **Step 3: Add `Gradebook` API object**

Add this export in `client/src/api.ts` after `Submission`:

```ts
function gradebookParams(query: GradebookQuery) {
  const params: Record<string, string | boolean> = {
    classname: query.classname,
  }
  if (query.task_type) params.task_type = query.task_type
  if (query.username) params.username = query.username
  if (query.include_all_tasks) params.include_all_tasks = true
  return params
}

function filenameFromDisposition(disposition: string | undefined, fallback: string) {
  const match = disposition?.match(/filename\*=UTF-8''([^;]+)/)
  return match ? decodeURIComponent(match[1]) : fallback
}

export const Gradebook = {
  async get(query: GradebookQuery): Promise<GradebookOut> {
    const res = await http.get("/submission/gradebook/", {
      params: gradebookParams(query),
    })
    return res.data
  },

  async downloadCsv(query: GradebookQuery) {
    const res = await http.get("/submission/gradebook/export/", {
      params: gradebookParams(query),
      responseType: "blob",
    })
    const blob = new Blob([res.data], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filenameFromDisposition(
      res.headers["content-disposition"],
      `gradebook-${query.classname}.csv`,
    )
    a.click()
    URL.revokeObjectURL(url)
  },
}
```

- [ ] **Step 4: Run frontend build**

Run:

```bash
cd /home/xuyue/Projects/webpreview/client
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit frontend API**

```bash
git add client/src/utils/type.ts client/src/api.ts
git commit -m "feat: add gradebook frontend API types"
```

---

### Task 5: Dashboard Route And Gradebook Page

**Files:**
- Modify: `client/src/router.ts`
- Modify: `client/src/pages/Dashboard.vue`
- Create: `client/src/pages/Gradebook.vue`

- [ ] **Step 1: Add dashboard child route**

In `client/src/router.ts`, add this child route under `/dashboard`:

```ts
      {
        path: "gradebook",
        name: "gradebook",
        component: () => import("./pages/Gradebook.vue"),
      },
```

- [ ] **Step 2: Add dashboard sidebar entry**

In `client/src/pages/Dashboard.vue`, add this menu item before the `"提交"` item:

```ts
    {
      label: "平时成绩",
      route: { name: "gradebook" },
      show: roleAdmin.value || roleSuper.value,
    },
```

- [ ] **Step 3: Create `Gradebook.vue` template**

Create `client/src/pages/Gradebook.vue` with this template:

```vue
<template>
  <n-flex vertical class="gradebook-page" :size="12">
    <n-flex class="toolbar" align="center" justify="space-between">
      <n-flex align="center" :size="8" class="filters">
        <n-select
          v-model:value="query.classname"
          class="class-select"
          :options="classOptions"
          placeholder="班级"
          :loading="classesLoading"
        />
        <n-select
          v-model:value="query.task_type"
          class="type-select"
          :options="taskTypeOptions"
        />
        <n-input
          v-model:value="query.username"
          class="search-input"
          clearable
          placeholder="学生搜索"
        />
        <n-switch v-model:value="query.include_all_tasks">
          <template #checked>全部有提交任务</template>
          <template #unchecked>只看计入任务</template>
        </n-switch>
      </n-flex>
      <n-flex align="center" :size="8">
        <n-button
          secondary
          title="刷新"
          :disabled="!query.classname"
          :loading="loading"
          @click="loadGradebook"
        >
          <template #icon>
            <Icon icon="lucide:refresh-cw" :width="15" />
          </template>
        </n-button>
        <n-button
          type="primary"
          secondary
          :disabled="!query.classname || !gradebook"
          :loading="exporting"
          @click="exportCsv"
        >
          <template #icon>
            <Icon icon="lucide:download" :width="15" />
          </template>
          导出 CSV
        </n-button>
      </n-flex>
    </n-flex>

    <n-alert v-if="loadError" type="error" closable @close="loadError = ''">
      {{ loadError }}
    </n-alert>

    <n-flex v-if="gradebook" class="summary" align="center" :size="8">
      <n-tag size="small">学生 {{ gradebook.student_count }}</n-tag>
      <n-tag size="small">任务 {{ gradebook.task_count }}</n-tag>
      <n-tag size="small" type="success">
        计入 {{ gradebook.included_task_count }}
      </n-tag>
      <n-tag size="small">
        覆盖门槛 {{ gradebook.coverage_threshold_count }} 人
      </n-tag>
    </n-flex>

    <n-data-table
      class="gradebook-table"
      size="small"
      striped
      flex-height
      :loading="loading"
      :columns="columns"
      :data="rows"
      :row-key="(row: GradebookRow) => row.user_id"
      :scroll-x="scrollX"
    />
  </n-flex>
</template>
```

- [ ] **Step 4: Add `Gradebook.vue` script**

Add this script block below the template:

```vue
<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from "vue"
import { Icon } from "@iconify/vue"
import { watchDebounced } from "@vueuse/core"
import {
  NButton,
  NTag,
  NText,
  useMessage,
  type DataTableColumn,
} from "naive-ui"
import { useRouter } from "vue-router"
import { Account, Gradebook } from "../api"
import type {
  GradebookCell,
  GradebookOut,
  GradebookQuery,
  GradebookRow,
  GradebookTask,
  GradebookTaskType,
} from "../utils/type"

const router = useRouter()
const message = useMessage()
const classesLoading = ref(false)
const loading = ref(false)
const exporting = ref(false)
const loadError = ref("")
const gradebook = ref<GradebookOut | null>(null)
const classes = ref<string[]>([])

const query = reactive<GradebookQuery>({
  classname: "",
  task_type: "",
  username: "",
  include_all_tasks: false,
})

const taskTypeOptions: { label: string; value: GradebookTaskType | "" }[] = [
  { label: "全部", value: "" },
  { label: "教程", value: "tutorial" },
  { label: "挑战", value: "challenge" },
]

const classOptions = computed(() =>
  classes.value.map((classname) => ({ label: classname, value: classname })),
)
const rows = computed(() => gradebook.value?.rows ?? [])
const scrollX = computed(() => 860 + (gradebook.value?.tasks.length ?? 0) * 96)

function formatScore(value: number | null) {
  if (value === null) return "-"
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function taskTitle(task: GradebookTask) {
  const typeLabel = task.task_type === "tutorial" ? "教程" : "挑战"
  return `${typeLabel}${task.display}`
}

function openSubmission(cell: GradebookCell) {
  if (!cell.submitted || !cell.submission_id) return
  const { href } = router.resolve({
    name: "submission",
    params: { id: cell.submission_id },
  })
  window.open(href, "_blank")
}

function gradeTagType(grade: string) {
  if (grade === "A") return "success"
  if (grade === "B") return "info"
  if (grade === "C") return "default"
  return "warning"
}

function renderTaskHeader(task: GradebookTask) {
  return h("div", { class: ["task-header", { muted: !task.included }] }, [
    h("div", { class: "task-title", title: task.title }, taskTitle(task)),
    h("div", { class: "task-meta" }, [
      h("span", `${Math.round(task.coverage * 100)}%`),
      task.included
        ? null
        : h(
            NTag,
            { size: "tiny", round: false },
            { default: () => "未计入" },
          ),
    ]),
  ])
}

function renderScore(row: GradebookRow, task: GradebookTask) {
  const cell = row.scores[task.id]
  if (!cell || !cell.submitted) {
    return h("span", { class: "missing-cell" }, "缺交")
  }
  return h(
    NButton,
    {
      text: true,
      type: task.included ? "primary" : "default",
      class: ["score-link", { muted: !task.included }],
      onClick: (event: MouseEvent) => {
        event.stopPropagation()
        openSubmission(cell)
      },
    },
    { default: () => formatScore(cell.score) },
  )
}

const columns = computed<DataTableColumn<GradebookRow>[]>(() => {
  const tasks = gradebook.value?.tasks ?? []
  return [
    {
      title: "排名",
      key: "rank",
      width: 66,
      fixed: "left",
    },
    {
      title: "等级",
      key: "grade",
      width: 66,
      fixed: "left",
      render: (row) =>
        h(
          NTag,
          { size: "small", type: gradeTagType(row.grade) },
          { default: () => row.grade },
        ),
    },
    {
      title: "学生",
      key: "username",
      width: 140,
      fixed: "left",
      render: (row) =>
        h(NText, { title: row.username }, { default: () => row.username }),
    },
    {
      title: "班级",
      key: "classname",
      width: 90,
      fixed: "left",
    },
    ...tasks.map((task) => ({
      title: () => renderTaskHeader(task),
      key: `task-${task.id}`,
      width: 96,
      align: "center" as const,
      className: task.included ? "" : "excluded-task-column",
      render: (row: GradebookRow) => renderScore(row, task),
    })),
    {
      title: "教程合计",
      key: "tutorial_total",
      width: 92,
      fixed: "right",
      render: (row) => formatScore(row.tutorial_total),
    },
    {
      title: "挑战合计",
      key: "challenge_total",
      width: 92,
      fixed: "right",
      render: (row) => formatScore(row.challenge_total),
    },
    {
      title: "总分",
      key: "total_score",
      width: 82,
      fixed: "right",
      render: (row) => formatScore(row.total_score),
    },
    {
      title: "平均",
      key: "average_score",
      width: 82,
      fixed: "right",
      render: (row) => formatScore(row.average_score),
    },
    {
      title: "已交",
      key: "submitted_task_count",
      width: 70,
      fixed: "right",
    },
    {
      title: "缺交",
      key: "missing_task_count",
      width: 70,
      fixed: "right",
    },
  ]
})

async function loadClasses() {
  classesLoading.value = true
  try {
    classes.value = await Account.listClasses()
    if (!query.classname && classes.value.length > 0) {
      query.classname = classes.value[0]
    }
  } finally {
    classesLoading.value = false
  }
}

async function loadGradebook() {
  if (!query.classname) {
    gradebook.value = null
    return
  }
  loading.value = true
  loadError.value = ""
  try {
    gradebook.value = await Gradebook.get(query)
    classes.value = gradebook.value.classes
  } catch (err: any) {
    loadError.value = err.response?.data?.detail ?? "成绩册加载失败"
  } finally {
    loading.value = false
  }
}

async function exportCsv() {
  if (!query.classname) return
  exporting.value = true
  try {
    await Gradebook.downloadCsv(query)
  } catch (err: any) {
    message.error(err.response?.data?.detail ?? "导出失败")
  } finally {
    exporting.value = false
  }
}

watch(
  () => [query.classname, query.task_type, query.include_all_tasks],
  () => loadGradebook(),
)

watchDebounced(
  () => query.username,
  () => loadGradebook(),
  { debounce: 400, maxWait: 1000 },
)

onMounted(async () => {
  await loadClasses()
  await loadGradebook()
})
</script>
```

- [ ] **Step 5: Add `Gradebook.vue` styles**

Add this style block at the bottom of `client/src/pages/Gradebook.vue`:

```vue
<style scoped>
.gradebook-page {
  height: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 10px 10px 10px 0;
  overflow: hidden;
}

.toolbar,
.summary {
  flex-shrink: 0;
}

.filters {
  min-width: 0;
  flex-wrap: wrap;
}

.class-select {
  width: 150px;
}

.type-select {
  width: 112px;
}

.search-input {
  width: 160px;
}

.gradebook-table {
  flex: 1;
  min-height: 0;
}

.task-header {
  min-width: 0;
  line-height: 1.2;
}

.task-header.muted {
  color: #888;
}

.task-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.task-meta {
  display: flex;
  min-height: 18px;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 2px;
  color: #999;
  font-size: 11px;
}

.missing-cell {
  color: #d03050;
  font-size: 12px;
}

.score-link.muted {
  color: #777;
}

:deep(.excluded-task-column) {
  background: #fafafa;
}

@media (max-width: 720px) {
  .toolbar {
    align-items: flex-start;
  }

  .class-select,
  .type-select,
  .search-input {
    width: 100%;
  }
}
</style>
```

- [ ] **Step 6: Run frontend format**

Run:

```bash
cd /home/xuyue/Projects/webpreview/client
npm run fmt
```

Expected: PASS and only frontend source formatting changes.

- [ ] **Step 7: Run frontend build**

Run:

```bash
cd /home/xuyue/Projects/webpreview/client
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit page**

```bash
git add client/src/router.ts client/src/pages/Dashboard.vue client/src/pages/Gradebook.vue
git commit -m "feat: add admin gradebook page"
```

---

### Task 6: End-To-End Verification

**Files:**
- No production file edits expected.

- [ ] **Step 1: Run backend tests**

Run:

```bash
cd /home/xuyue/Projects/webpreview/api
uv run manage.py test submission
```

Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run:

```bash
cd /home/xuyue/Projects/webpreview/client
npm run build
```

Expected: PASS.

- [ ] **Step 3: Start local app**

Run the full stack if it is not already running:

```bash
cd /home/xuyue/Projects/webpreview
./dev.sh
```

Expected: Django and Rsbuild dev servers start without errors.

- [ ] **Step 4: Manual smoke test**

Use an admin or super account:

1. Visit `/dashboard/gradebook`.
2. Confirm the first class is selected automatically.
3. Switch task type between `全部`, `教程`, and `挑战`; the task columns change.
4. Search for a username fragment; the returned rows shrink but ranks remain class-wide.
5. Toggle `全部有提交任务`; tasks below coverage appear with `未计入` headers and muted scores.
6. Click a submitted score; a new tab opens the matching `/submission/:id` page.
7. Click `导出 CSV`; the downloaded CSV columns match the current filters.
