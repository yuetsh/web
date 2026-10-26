# 提交打开次数统计 设计文档

**日期：** 2026-03-30

## 目标

统计每个 Submission 被打开（查看详情）的次数，供管理员判断哪些作品被查看最多（热度指标）。

## 触发条件

每次调用 `GET /api/submission/{submission_id}` 时计数加一，无论访问者身份。

## 数据模型变更

在 `Submission` 模型新增字段：

```python
view_count = models.PositiveIntegerField(default=0, verbose_name="查看次数")
```

新建对应 migration。

## API 变更

### `GET /api/submission/{submission_id}`

- 在返回响应前，执行原子递增：
  ```python
  Submission.objects.filter(pk=submission_id).update(view_count=F("view_count") + 1)
  ```
- `SubmissionOut` schema 新增 `view_count: int` 字段，暴露给前端。

## 不在本次范围内

- 去重（同一用户多次访问分别计数）
- 时序数据 / 按时间段查询
- 前端展示（管理员可通过 Django Admin 或 API 查看）
