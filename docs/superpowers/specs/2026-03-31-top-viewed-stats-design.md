# 提交统计"人气前五"功能设计

**日期**: 2026-03-31

## 需求

在提交统计弹窗（`TaskStatsModal`）中新增"人气前五"区块，展示当前 task 下 view_count 最高的前 5 条提交记录，跟随班级筛选。

## 后端变更

### 新增 Schema（`api/submission/schemas.py`）

```python
class TopViewedItem(Schema):
    username: str
    classname: str
    view_count: int
    submission_id: str  # UUID，用于跳转
```

### `TaskStatsOut` 新增字段

```python
top_viewed: list[TopViewedItem]
```

### `get_task_stats` 查询逻辑（`api/submission/api.py`）

在已有的 `submitted_ids` / `student_ids` 过滤基础上，取 view_count 最高的前 5 条提交：

```python
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

`student_ids` 已经根据 `classname` 参数过滤，因此自动跟随班级筛选。

每个用户可能有多条提交，取 view_count 最高的那条（不按用户去重，直接取整体前 5）。

## 前端变更

### `client/src/utils/type.ts`

新增接口：

```ts
export interface TopViewedItem {
  username: string
  classname: string
  view_count: number
  submission_id: string
}
```

`TaskStatsOut` 新增字段：

```ts
top_viewed: TopViewedItem[]
```

### `client/src/components/TaskStatsModal.vue`

在"标记统计"区块下方新增"人气前五"区块：

- 标题："人气前五"，风格与"标记统计"/"提交次数分布"一致
- 每项展示：排名序号（1-5）+ 用户显示名 + view_count（如"128 次"）
- 点击可跳转到该提交详情（复用现有 `viewSubmission(id)` 方法）
- 若 `top_viewed` 为空则显示"暂无"
- view_count 为 0 的项仍展示（表示真实数据）

## 不涉及范围

- 不修改 `view_count` 的计算/更新逻辑
- 不新增 API 端点，复用现有 `/submission/stats/{task_id}`
- 不添加分页或更多排名
