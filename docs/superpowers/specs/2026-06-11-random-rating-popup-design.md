# 等待 AI 回复时随机作品打分弹窗 设计文档

**日期：** 2026-06-11

## 背景与目标

当前评分系统数据量偏少，学生积极性不高；同时在 ChallengeDetail 页面等待 AI 流式回复期间，学生处于"无事可做"的等待状态。希望利用这段等待时间，弹出一个随机的其他同学的提交，让学生打分，从而：

- 增加评分数据量，让评分系统更有效（n 越大，`update_score` 的统计意义越强）
- 提升等待期间的参与感

仅在 `ChallengeDetail.vue`（含 AI 对话面板的页面）生效。

## 触发逻辑

监听 `store/prompt.ts` 的 `streaming` 状态：

```
streaming: false → true
  → clearTimeout(reshowTimer)
  → fetchAndShow()   // 请求随机作品，有结果则弹窗

streaming: true → false
  → clearTimeout(reshowTimer)
  → show = false     // 立即关闭弹窗
```

弹窗内交互：

- **打分**（点击星级）→ 调用现有 `PUT /submission/{id}/score` → 提示"感谢评分！" → 立即 `fetchAndShow()` 换下一个作品，弹窗保持打开
- **关闭**（右上角 ✕）→ `show = false`；若此时 `streaming === true`，30 秒后 `fetchAndShow()` 重新弹出一个新作品
- **无可评作品**（接口返回空）→ 不弹窗 / 不重弹，等下一次 `streaming: false → true` 再尝试

组件卸载（离开页面）时清理 `reshowTimer` 并关闭弹窗。

无"跳过"按钮——星级评分是唯一主操作，关闭仅是临时隐藏（30 秒后会带新作品再弹出）。

## 后端 API 设计

新增端点：`GET /api/submission/random-for-rating/`（`login_required`）

**查询参数**：
- `exclude_id: Optional[UUID]` — 排除指定提交（避免连续两次抽到同一作品）

**筛选逻辑**（按顺序短路）：

1. 普通用户（`role == RoleChoices.NORMAL`）若今日 `Rating` 记录数已达 30（与 `Rating.clean()` 的上限一致）→ 直接返回 `null`，避免弹窗后打分必定失败
2. 候选集：`Submission.objects.exclude(user=request.user).exclude(ratings__user=request.user)`
   - 若提供 `exclude_id`，再 `.exclude(pk=exclude_id)`
3. 优先从候选集中 `zone=ZoneChoices.PENDING`（评分人数 < 5）的子集里 `order_by("?")` 取一条
4. 若 pending 子集为空，则从候选集整体 `order_by("?")` 取一条
5. 若候选集本身为空 → 返回空

不区分 `task_type`（tutorial / challenge 均可能出现），不排除"当前正在做的这个挑战"的其他提交。

**响应 Schema**：

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
```

响应类型为 `Optional[RandomRatingOut]`；无候选时返回 `null`（HTTP 200），前端据此判断不弹窗。

打分仍复用现有 `PUT /api/submission/{submission_id}/score`，不新增打分接口。

## 前端设计

新建组件 `client/src/components/ai/RandomRatingModal.vue`，挂载在 `ChallengeDetail.vue` 模板内（与现有 `<n-modal>` 并列）。

**内部状态**：
- `show: boolean`
- `current: RandomRatingItem | null`
- `reshowTimer: number | null`

**核心方法**：

```ts
async function fetchAndShow() {
  const res = await Submission.randomForRating(current.value?.submission_id)
  if (res) {
    current.value = res
    show.value = true
  } else {
    show.value = false
  }
}

async function onRate(score: number) {
  await Submission.updateScore(current.value!.submission_id, score)
  message.success("感谢评分！")
  await fetchAndShow()
}

function onClose() {
  show.value = false
  if (streaming.value) {
    reshowTimer = window.setTimeout(fetchAndShow, 30_000)
  }
}

watch(streaming, (val) => {
  if (reshowTimer) clearTimeout(reshowTimer)
  if (val) fetchAndShow()
  else show.value = false
})

onUnmounted(() => {
  if (reshowTimer) clearTimeout(reshowTimer)
})
```

**弹窗内容**（`n-modal` `preset="card"`，宽度约 480px）：

- 标题：「等待 AI 回复时，给同学的作品打个分吧」
- 副标题：`{task_title} · 提交者 {username}`
- 中间：`<iframe>` 预览，复用 `buildPreviewDocument`（`utils/previewDocument`），固定高度约 220px
- 底部：居中放大的 `n-rate`（5星，与 `Preview.vue` 同款打分组件）
- 底部小字提示：「打分后自动换下一个作品；AI 回复完成后弹窗会自动关闭」
- 右上角 ✕ 关闭按钮

**API client**（`src/api.ts`）新增：

```ts
async randomForRating(excludeId?: string) {
  const res = await http.get("/submission/random-for-rating/", {
    params: excludeId ? { exclude_id: excludeId } : {},
  })
  return res.data as RandomRatingItem | null
}
```

## 边界情况

- 打分接口报错（网络错误）→ `message.error`，弹窗保持打开、`current` 不变，允许用户重新点击星级重试
- 候选池为空 / 当日评分已达上限 → 不弹窗，不重试，等下一次 AI 请求触发时再判断
- 离开 ChallengeDetail 页面 → 现有 `onUnmounted(disconnectPrompt)` 中一并清理弹窗状态和计时器

## 测试计划

- **后端**：单测覆盖 `random-for-rating` —— 排除自己的提交、排除已评过的提交、优先返回 `pending` 区、`exclude_id` 生效、普通用户当日评分达 30 次后返回空
- **前端**：开发环境手动验证 —— 发起 AI 对话触发弹窗、打分后自动换下一个、点击关闭后 30 秒重弹、AI 回复完成后弹窗自动关闭

## 不在本次范围内

- 管理员开关该功能的配置项
- 按 `task_type` 过滤随机作品来源
- 排除"当前挑战"的其他提交（已决定不排除）
- 跳过按钮（已决定移除，强制打分为唯一主操作）
