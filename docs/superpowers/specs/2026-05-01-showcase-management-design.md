# 作品广场管理页设计

## 背景

作品广场当前已有学生浏览页 `/showcase` 和详情页 `/showcase/:id`。奖项与获奖作品的数据模型已经存在：

- `Award`：奖项名称、简介、启用状态、奖项排序、作品排序方式。
- `SubmissionAward`：提交作品与奖项的关联、手动排序值、授奖时间。

目前日常管理只能通过 Django Admin 完成，不适合老师在前端工作流中维护作品广场。

## 目标

在现有 Dashboard 中新增“作品广场”管理页，让管理员可以完成作品广场的日常维护：

- 创建、编辑、启停、删除奖项。
- 配置奖项在广场中的顺序。
- 配置奖项内作品排序方式。
- 通过复制来的 `submission_id` 查找提交作品，并把作品加入指定奖项。
- 查看、移除、调整奖项内作品。

## 非目标

- 不做公开代码查看。学生侧仍只展示运行效果和创作过程。
- 不做拖拽排序，第一版使用数字排序值。
- 不做批量导入或批量授奖。
- 不改变现有学生广场接口返回结构，避免影响 `/showcase`。

## 权限

管理页只对 `admin` 和 `super` 可见。

后端管理 API 使用 `admin_required` 限制。普通学生访问管理 API 返回 403，未登录用户返回登录态错误。

学生浏览页保持现状：登录用户可访问 `/showcase` 和 `/showcase/:id`。

## 前端入口

在 `Dashboard.vue` 侧栏新增菜单：

- 标签：`作品广场`
- 路由：`/dashboard/showcase`
- 可见角色：`admin`、`super`

新增页面文件：

- `client/src/pages/ShowcaseManage.vue`

## 页面结构

页面采用左右分栏，延续现有 Dashboard 的工具型界面风格。

左侧为奖项列表：

- 新建奖项按钮。
- 奖项名称。
- 启用状态。
- 展示排序值。
- 作品排序方式。
- 当前作品数量。

右侧为选中奖项详情：

- 奖项编辑表单：名称、简介、排序值、是否启用、作品排序方式。
- 保存按钮。
- 删除奖项按钮。
- 已授奖作品表格：作者、任务、分数、浏览量、手动排序值、授奖时间。
- 每行支持修改手动排序值和移除作品。
- 添加作品按钮：打开添加作品弹窗，粘贴 `submission_id` 后查找对应提交，确认无误后加入当前奖项。

当没有选中奖项时，右侧显示空状态。创建第一个奖项后自动选中。

## 后端 API

新增管理接口，放在 `submission/api.py`，路径位于现有 `/submission/showcase/` 下。

### 奖项管理

`GET /api/submission/showcase/manage/awards`

返回所有奖项，包括未启用和空奖项。每个奖项包含：

- `id`
- `name`
- `description`
- `sort_order`
- `is_active`
- `item_ordering`
- `item_count`

`POST /api/submission/showcase/manage/awards`

创建奖项。请求字段：

- `name`
- `description`
- `sort_order`
- `is_active`
- `item_ordering`

`PUT /api/submission/showcase/manage/awards/{award_id}`

更新奖项。字段同创建接口。

`DELETE /api/submission/showcase/manage/awards/{award_id}`

删除奖项。级联删除该奖项下的 `SubmissionAward` 关联，不删除提交作品本身。

### 作品查找

`GET /api/submission/showcase/manage/submissions/{submission_id}`

按提交 ID 查找一条提交，用于添加作品前确认。该接口只返回管理页需要的摘要，不返回 HTML/CSS/JS 源码。返回字段：

- `submission_id`
- `username`
- `task_title`
- `task_display`
- `score`
- `view_count`
- `has_prompt_chain`

提交不存在时返回 404。普通用户不能访问该接口。

### 奖项作品管理

`GET /api/submission/showcase/manage/awards/{award_id}/items`

返回该奖项下所有获奖作品。每项包含：

- `id`：`SubmissionAward.id`
- `submission_id`
- `username`
- `task_title`
- `task_display`
- `score`
- `view_count`
- `sort_order`
- `awarded_at`
- `has_prompt_chain`

排序规则沿用奖项的 `item_ordering`：

- `manual`：按 `SubmissionAward.sort_order`。
- `awarded_at`：按授奖时间倒序。
- `score`：按提交评分倒序。
- `view_count`：按浏览量倒序。

`POST /api/submission/showcase/manage/awards/{award_id}/items`

把提交作品加入奖项。请求字段：

- `submission_id`
- `sort_order`

如果同一作品已在该奖项中，返回现有关联，不重复创建。

`PUT /api/submission/showcase/manage/items/{item_id}`

更新获奖作品关联，目前只更新 `sort_order`。

`DELETE /api/submission/showcase/manage/items/{item_id}`

移除获奖作品关联，不删除提交作品。

## 前端 API 客户端

在 `client/src/api.ts` 中扩展 `Showcase`：

- `listManageAwards()`
- `createAward(payload)`
- `updateAward(id, payload)`
- `deleteAward(id)`
- `listAwardItems(id)`
- `findSubmissionForAward(submissionId)`
- `addAwardItem(id, payload)`
- `updateAwardItem(itemId, payload)`
- `deleteAwardItem(itemId)`

在 `client/src/utils/type.ts` 中新增管理页使用的类型：

- `AwardManageOut`
- `AwardManageIn`
- `AwardItemManageOut`
- `AwardItemIn`
- `AwardItemUpdateIn`

## 数据流

1. 进入 `/dashboard/showcase` 后加载奖项列表。
2. 自动选中第一个奖项，并加载该奖项作品。
3. 保存奖项后刷新奖项列表，并保留当前选中项。
4. 点击“添加作品”后打开弹窗，粘贴 `submission_id` 并查找提交。
5. 找到提交后展示提交者、任务、分数、浏览量和提示词状态。
6. 确认添加后刷新当前奖项作品，同时刷新左侧作品数量。
7. 修改作品手动排序值后刷新当前奖项作品。

## 错误处理

- 奖项名称重复时后端返回 400，前端显示错误消息。
- 奖项、作品关联或待添加提交不存在时返回 404，前端显示错误消息。
- 普通用户访问管理 API 返回 403。
- 网络或未知错误沿用现有 Axios 拦截器，同时管理页局部停止 loading 状态。

## 测试

后端测试覆盖：

- 普通用户不能访问作品广场管理接口。
- 管理员可以创建、编辑、启停奖项。
- 管理员可以通过 `submission_id` 查找提交作品摘要。
- 管理员可以给提交作品授奖。
- 重复授奖不会创建重复关联。
- 移除授奖后，学生广场列表不再返回该作品。
- 奖项停用后，学生广场列表不返回该奖项。

前端验证覆盖：

- Dashboard 中管理员能看到“作品广场”菜单，普通学生看不到。
- 奖项列表、奖项编辑、作品列表能正常加载。
- 粘贴 `submission_id` 查找作品并加入奖项后，已授奖作品列表更新。
- 删除或停用奖项后，学生 `/showcase` 表现符合预期。

## 后续增强

- 拖拽排序。
- 批量授奖。
- 按班级、挑战、作者筛选广场。
- 在提交列表中提供“加入作品广场”快捷入口。
