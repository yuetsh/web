# 平时成绩册设计

**日期**: 2026-05-01
**状态**: 待用户复核

## 背景

期末需要在管理后台查看单个班级学生的平时成绩。现有系统已有学生班级字段、教程/挑战任务、提交记录、提交评分和单题统计弹窗，但缺少跨教程和挑战的班级成绩册。

本功能在管理后台新增“平时成绩”页面，面向管理员按班级查看、排序、分级和导出学生平时成绩。

## 目标

- 管理员可以选择一个班级查看该班平时成绩。
- 教程和挑战都计入成绩，不只统计挑战。
- 同一学生同一任务按最高分提交计算。
- 任务是否计入成绩由该班提交覆盖率决定，不依赖 `Task.is_public`。
- 页面显示排名、等级、每个任务得分、教程合计、挑战合计、总分、平均分、已提交任务数和未提交任务数。
- 支持导出当前班级成绩 CSV。

## 不在本期范围

- 不提供“全部班级”视图。
- 不做教程和挑战权重配置。
- 不做人工调整等级。
- 不新增持久化成绩快照，成绩册按当前提交和评分实时计算。
- 不修改现有 `Submission.score` 或 `Rating` 计算逻辑。

## 成绩计算规则

### 学生范围

成绩册必须选择一个班级。学生范围为：

- `User.role = normal`
- `User.classname = classname`

如果未传班级，接口返回 `400`，提示“请选择班级”。

### 任务范围

教程和挑战都可以纳入成绩。页面提供任务类型筛选：

- 全部
- 教程
- 挑战

任务纳入成绩的默认规则：

- 只看当前班级学生。
- 某任务只要该班至少 50% 学生有过提交，就计入成绩。
- 覆盖率门槛人数为 `ceil(班级学生数 * 0.5)`。
- 不使用 `Task.is_public` 判断是否计入，因为它只表示公开状态。

页面提供“显示所有有提交任务”的开关：

- 默认关闭，只显示计入成绩的任务。
- 开启后显示当前班级有提交记录的所有任务，用于检查任务是否未达到覆盖率门槛。
- 开启后每个任务仍返回 `included` 标记；汇总字段只计算 `included = true` 的任务。

### 单元格分数

每个学生每个任务的单元格分数为：

- 该学生在该任务所有提交中最高的 `Submission.score`。
- 如果没有提交，显示缺交，汇总时按 `0` 计入。

如果多个提交同分，提交详情链接指向最近创建的一条最高分提交。

### 汇总字段

每个学生行包含：

- `tutorial_total`: 教程最高分合计。
- `challenge_total`: 挑战最高分合计。
- `total_score`: 教程合计 + 挑战合计。
- `average_score`: `total_score / included_task_count`，没有计入任务时为 `null`。
- `submitted_task_count`: 有提交的计入任务数。
- `missing_task_count`: 没有提交的计入任务数。

## 等级规则

等级只在当前班级内计算。按 `total_score` 降序排名，同分按 `username` 升序稳定排序。

设班级人数为 `N`，排名从 1 开始：

- `A`: `rank <= ceil(0.30 * N)`
- `B`: `rank <= ceil(0.70 * N)`
- `C`: `rank <= ceil(0.90 * N)`
- `D`: `rank <= ceil(0.95 * N)`
- `E`: 其余

返回字段包含：

- `rank`
- `grade`

## 后端设计

### API

新增管理员接口：

```http
GET /api/submission/gradebook/
```

参数：

- `classname`: 必填，班级名。
- `task_type`: 可选，`tutorial` / `challenge`。
- `username`: 可选，按用户名片段搜索学生。
- `include_all_tasks`: 可选布尔值，默认 `false`。

权限：

- 仅 `admin` 和 `super` 可以访问。

### 返回结构

```ts
interface GradebookTask {
  id: number
  display: number
  title: string
  task_type: "tutorial" | "challenge"
  submitted_count: number
  coverage: number
  included: boolean
}

interface GradebookCell {
  score: number
  submitted: boolean
  submission_id: string | null
}

interface GradebookRow {
  user_id: number
  username: string
  classname: string
  rank: number
  grade: "A" | "B" | "C" | "D" | "E"
  scores: Record<number, GradebookCell>
  tutorial_total: number
  challenge_total: number
  total_score: number
  average_score: number | null
  submitted_task_count: number
  missing_task_count: number
}

interface GradebookOut {
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

### 查询策略

1. 查询班级列表，用于前端选择器。
2. 查询当前班级普通学生，得到 `student_ids` 和 `student_count`。
3. 查询这些学生所有提交涉及的任务，按 `task_type` 过滤。
4. 对每个任务统计有提交的学生数，判断是否达到 50% 覆盖率。
5. 根据 `include_all_tasks` 决定返回任务集合。
6. 查询 `(user_id, task_id)` 的最高分提交。
7. 组装每个学生的任务分数和汇总字段。
8. 按 `total_score desc, username asc` 排名并分配等级。

## 前端设计

### 路由和入口

在管理后台 `/dashboard` 下新增页面：

```text
/dashboard/gradebook
```

侧边栏或管理入口新增“平时成绩”。

### 页面布局

顶部筛选区：

- 班级选择，默认选择第一个班级，不提供“全部班级”。
- 任务类型：全部 / 教程 / 挑战。
- 学生搜索。
- “显示所有有提交任务”开关，默认关闭。
- 导出 CSV 按钮。

主体表格：

- 左侧固定列：排名、等级、学生、班级。
- 中间动态列：每个任务一列，显示最高分。
- 右侧固定汇总列：教程合计、挑战合计、总分、平均分、已提交、缺交。

显示规则：

- 缺交单元格在页面显示 `缺交`，使用轻微警示样式；CSV 中按 `0` 导出。
- 未计入成绩但被显示的任务列，用较弱样式并在表头标注未计入。
- 点击有提交的分数，打开该最高分提交详情页。

## 导出设计

新增导出接口：

```http
GET /api/submission/gradebook/export/
```

参数与成绩册接口一致。

CSV 列：

- 排名
- 等级
- 用户名
- 班级
- 每个任务得分
- 教程合计
- 挑战合计
- 总分
- 平均分
- 已提交任务数
- 未提交任务数

导出内容与当前页面筛选保持一致。

## 错误处理

- 未登录：沿用现有登录拦截。
- 非管理员访问：返回 `403`。
- 未选择班级：返回 `400`。
- 班级不存在或没有学生：返回空表格，并保留班级选择列表。
- 当前班级没有达到覆盖率门槛的任务：表格仍显示学生和汇总列，任务列为空，汇总为 0 或 `null`。

## 测试计划

后端测试：

- 任务覆盖率达到 50% 时被计入，低于 50% 时不计入。
- 教程和挑战都能参与计算。
- 同一学生同一任务取最高分。
- 缺交任务按 0 计入，并增加缺交数。
- A/B/C/D/E 按累计 `ceil` 边界分配。
- `classname` 缺失返回 `400`。
- 普通用户访问返回 `403`。

前端检查：

- 页面默认选择第一个班级并加载成绩。
- 任务类型筛选正确刷新表格。
- “显示所有有提交任务”能显示未计入任务。
- 点击分数能打开对应提交详情。
- CSV 导出与当前筛选一致。
