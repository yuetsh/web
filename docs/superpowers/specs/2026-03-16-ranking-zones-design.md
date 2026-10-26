# Ranking Zones Page — Design Spec

**Date:** 2026-03-16
**Status:** Approved

## Overview

A new standalone page that displays challenge submissions that students have explicitly nominated for ranking. Each nominated submission is placed into one of four score-based zones (Bayesian weighted score). Students choose which of their submissions enters the ranking; each student may nominate at most one submission per challenge.

---

## 1. Scoring: Bayesian Weighted Score (global — replaces existing `score`)

The existing `score` field is replaced with a Bayesian weighted score to prevent extreme scores from small numbers of raters distorting rankings. This affects the Submissions page, Leaderboard, My Scores, and the new Ranking page — all use Bayesian `score`.

### Formula

```
bayesian_score = (C × m + n × raw_score) / (C + n)
```

- `raw_score` = role-weighted average: `(super×0.5 + admin×0.3 + normal×0.2) / n`
- `m` = global mean of `raw_score` across all submissions with at least one rating, excluding the current submission
- `n` = number of raters on this submission
- `C` = 3 (confidence parameter)

When `n = 0`: both `score` and `raw_score` are 0.

### Model changes (`api/submission/models.py`)

Add `raw_score` field and add `Avg` import:

```python
from django.db.models import Avg   # add to imports

raw_score = models.FloatField(default=0.0, verbose_name="原始加权分")
```

### `update_score()` replacement

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
    # Exclude self to avoid stale DB value skewing the mean
    global_mean = (
        Submission.objects.filter(raw_score__gt=0)
        .exclude(pk=self.pk)
        .aggregate(Avg("raw_score"))["raw_score__avg"]
    ) or self.raw_score  # fallback if this is the only ever-rated submission

    self.score = (C * global_mean + n * self.raw_score) / (C + n)
    self.save(update_fields=["raw_score", "score"])
```

**Downstream note:** `Profile.recalculate_total_score()` (called after every rating via signal) uses best-score-per-challenge. After this change it will use Bayesian `score` values — leaderboard totals will reflect Bayesian scores. This is the intended global effect.

Migration required: adds `raw_score` column (default `0.0`, no backfill needed for existing rows).

---

## 2. Nomination: student opts one submission per challenge into ranking

### Model changes (`api/submission/models.py`)

```python
nominated = models.BooleanField(default=False, db_index=True, verbose_name="参与排名")
```

**Constraint:** at most one nominated submission per (user, task) pair — enforced in the API.

### New endpoint (`api/submission/api.py`)

```
PUT /api/submission/{submission_id}/nominate
```

- Login required; only the submission's owner may call it
- Sets `nominated=True` on this submission
- Sets `nominated=False` on all other submissions by the same user for the same task
- Returns `{"nominated": true}`

### Schema changes (`api/submission/schemas.py`)

Add `nominated: bool = False` to `SubmissionOut`:

```python
nominated: bool = False
```

No resolver needed — `nominated` maps directly from the model field.

### Frontend type (`client/src/utils/type.ts`)

Add to `SubmissionOut` interface:

```ts
nominated: boolean
```

### Nomination UI (`client/src/pages/Submissions.vue` and/or submission result)

- Add a "参与排名" button visible only to the submission's owner (`row.userid === currentUser.id`)
- Nominated submission: show a 🏅 indicator on the row
- Clicking calls `Submission.nominate(id)`, then toggles `nominated` on the affected rows in `data.value` (set clicked row to `true`, others with same `task_id` and same user to `false`)

---

## 3. Zones

Only `nominated=True` submissions appear on the Ranking page. Zones by Bayesian `score`:

| Zone | Score Condition | Sort Order |
|------|----------------|------------|
| 🏆 精华 | score ≥ 4.5 | score DESC |
| ⭐ 优秀 | 3.5 ≤ score < 4.5 | score DESC |
| 📝 普通 | 0 < score < 3.5 | score DESC |
| ⏳ 待评 | score = 0 | created DESC |

待评 zone uses `score__lt=0.001` (not exact float equality) to safely capture unrated submissions.
Minimum non-zero Bayesian score is well above 0.001 (single normal-role rater scoring 1 → raw=0.2 → Bayesian ≈ (3×m+0.2)/4).

---

## 4. Ranking Page layout

Split-pane (same as `Submissions.vue`): left 33% list, right 67% preview.

**Left panel:**
- Zone tabs with count badges (fetched on mount, not refreshed after scoring)
- Empty zone: `n-empty` placeholder
- Columns: `#` · `得分` · `提交者` · `任务` · `时间`
- Pagination 10/page; resets to page 1 on zone switch

**Right panel:**
- `Preview` component; `@after-score` updates only `my_score` on the row — zone reassignment waits for full reload (accepted)

---

## 5. Backend filter changes (`api/submission/`)

### `schemas.py` — `SubmissionFilter` additions

```python
score_min: Optional[float] = None
score_max_exclusive: Optional[float] = None
score_lt_threshold: Optional[float] = None   # replaces score_exact_zero; use 0.001 for 待评
nominated: Optional[bool] = None
ordering: Optional[str] = None   # "-score" | "score" | "-created"
```

### `api.py` — `list_submissions` additions

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

Existing callers pass none of these params — unaffected.

### Zone → API param mapping

| Zone | Params |
|------|--------|
| 精华 | `task_type=challenge, nominated=true, score_min=4.5, ordering=-score` |
| 优秀 | `task_type=challenge, nominated=true, score_min=3.5, score_max_exclusive=4.5, ordering=-score` |
| 普通 | `task_type=challenge, nominated=true, score_min=0.001, score_max_exclusive=3.5, ordering=-score` |
| 待评 | `task_type=challenge, nominated=true, score_lt_threshold=0.001, ordering=-created` |

---

## 6. Frontend API changes (`client/src/api.ts`)

Updated `Submission.list` signature (adds new params, preserves existing ones):

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
})
```

New method:

```ts
async nominate(id: string) {
  const res = await http.put(`/submission/${id}/nominate`)
  return res.data
}
```

---

## 7. New file: `client/src/pages/Ranking.vue`

- Auth-guarded (`meta: { auth: true }`)
- Zone tab + per-zone page state; default zone: 精华
- 4 parallel count-badge calls on mount
- Selected submission → Preview

## 8. Router & nav

```ts
// router.ts
{ path: '/ranking', component: () => import('./pages/Ranking.vue'), meta: { auth: true } }
```

Add "排名" link in existing nav.

---

## 9. Database migration

Adds `raw_score` (FloatField, default=0.0) and `nominated` (BooleanField, default=False) to `submission_submission`.

---

## Out of Scope

- Per-challenge filtering on Ranking page
- Withdrawing from ranking without re-nominating
- Refreshing zone counts after inline scoring
- Tutorial submissions (fixed `task_type=challenge` on all Ranking page requests)
