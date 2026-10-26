# 挑战分数系统设计

**日期**: 2026-03-09
**状态**: 已审批

## 背景

`Submission.score` 已有加权平均评分逻辑，`Profile.total_score` 字段存在但从未激活。分数计算出来后无任何展示或用途，需要设计让分数真正发挥作用的功能。

## 目标

- 学生：看到自己各题得分和在全班的排名
- 老师：快速了解哪些学生表现好，可按条件导出成绩
- 为未来解锁机制预留接口

## 方案选择

采用**方案 A（积分展示中心）**，在 `Challenge` 模型预留 `pass_score` 字段供日后解锁功能使用。

---

## 数据层

### Profile.recalculate_total_score()

替换现有 `update_total_score()` 的累加逻辑，改为从数据库重算：

```python
def recalculate_total_score(self):
    from submission.models import Submission
    from django.db.models import Max, Sum
    # 每道挑战取最高分，再求和
    total = (
        Submission.objects
        .filter(user=self.user, task__task_type='challenge')
        .values('task_id')
        .annotate(best=Max('score'))
        .aggregate(total=Sum('best'))['total']
    ) or 0.0
    self.total_score = total
    self.save(update_fields=['total_score'])
```

### Rating post_save 信号

在现有 `update_submission_score_on_save` 之后，追加调用：

```python
instance.submission.user.profile.recalculate_total_score()
```

### Challenge.pass_score 字段

```python
pass_score = models.FloatField(null=True, blank=True, verbose_name="通过分数线")
```

默认 null，不影响现有功能，为解锁机制预留。

### 用户最佳分数定义

同一用户同一挑战取 `score` 最高的提交作为该题成绩。

---

## API 层

### 1. 排行榜

```
GET /api/account/leaderboard/
```

- 无需登录
- 返回所有用户按 `total_score` 降序，含排名、用户名、总分

### 2. 我的各题得分

```
GET /api/submission/my-scores/
```

- 需登录
- 返回当前用户每道挑战的最高分提交（challenge display、title、score、提交时间）

### 3. 成绩导出

```
GET /api/submission/export/?task_id=&username=
```

- 仅限 admin/super 角色
- 复用现有 `SubmissionFilter` 参数
- 返回 CSV 文件流，每行：用户名、挑战题号、挑战标题、最高分、提交时间

---

## 前端

| 改动点 | 说明 |
|--------|------|
| 挑战列表卡片 | 显示该用户最高得分（灰色小标，未评分不显示） |
| 新页面 `/leaderboard` | 排名/用户名/总分表格，所有人可访问，放主页导航 |
| 新页面 `/my-scores` | 我的各题得分列表，登录后可见，放主页用户区域 |
| Submissions 页面 | 现有筛选栏旁加"导出 CSV"按钮，触发浏览器下载 |

---

## 不在本期范围内

- 解锁机制（`pass_score` 字段已预留，后续单独设计）
- 班级/分组维度的统计
- 实时分数推送（WebSocket）
