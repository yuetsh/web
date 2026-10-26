# 登录框重构：班级+姓名选择登录

**日期:** 2026-03-18
**状态:** 已批准

---

## 背景

当前登录框只有用户名+密码两个字段。用户（学生）的用户名格式为 `web{classname}{name}`（如 `web301张三`），输入完整用户名对学生不友好。需要重构为班级→姓名下拉选择方式登录，同时为管理员保留用户名+密码入口。

---

## 需求

- 学生通过"选班级 → 选姓名 → 输密码"方式登录
- 管理员通过原有用户名+密码方式登录
- 两种模式通过 Tab 切换

---

## 后端改动

### 1. User 模型新增字段

```python
# api/account/models.py
classname = models.CharField(max_length=50, blank=True, default="", verbose_name="班级")
```

执行数据库迁移。迁移后，**现有数据库中的所有用户（包括历史批量创建的用户）`classname` 均为空字符串**，因此不会出现在新端点的班级列表中。这是已知且可接受的行为——历史用户需重新通过新版批量创建接口创建，或手动更新 `classname`。

### 2. batch_create 接口保存 classname

在 `User(...)` 构造函数中设置 `classname`，在调用 `set_password()` 之前（`set_password` 内部调用 `self.save()`，必须保证字段在首次持久化时已赋值）：

```python
user = User(username=username, classname=payload.classname)
user.set_password(password)  # 触发 save()，此时 classname 已在实例上
users_to_create.append(user)
```

> 注：现有代码中 `set_password` 会触发 `save()`，之后的 `bulk_create(..., ignore_conflicts=True)` 对已存在行为空操作，无需改动该逻辑。

### 3. 新增两个无鉴权 GET 端点

> **安全说明：** 两个端点均不需要登录。`/names` 会返回某班级所有学生的用户名，存在账号枚举风险。考虑到平台面向内部学生，此为可接受的设计权衡。

**`GET /api/account/classes`**

返回所有不重复的非空班级名列表，按字典序升序排列。

```json
["301", "302", "高一1班"]
```

实现：
```python
User.objects.filter(classname__gt="").values_list("classname", flat=True).distinct().order_by("classname")
```

**`GET /api/account/names?classname=301`**

`classname` 为必填查询参数（缺省时 django-ninja 返回 422）。

返回该班级所有用户的姓名和用户名，按 `username` 升序排列（等价于按姓名升序，因 classname 前缀相同）。仅返回 `username` 以 `"web" + classname` 开头的用户，防止异常数据干扰。

```json
[
  {"name": "张三", "username": "web301张三"},
  {"name": "李四", "username": "web301李四"}
]
```

实现：
```python
prefix = "web" + classname
users = User.objects.filter(classname=classname, username__startswith=prefix).order_by("username")
return [{"name": u.username[len(prefix):], "username": u.username} for u in users]
```

如果 `classname` 不存在或该班无用户，返回空列表 `[]`。

---

## 前端改动

### Login.vue 重构

用 `n-tabs` 分为两个 Tab：

**Tab 1 - 学生登录**

| 字段 | 组件 | 说明 |
|------|------|------|
| 班级 | `n-select` | 挂载时调 `/classes` 加载，结果缓存在组件内，切换 Tab 不重新请求 |
| 姓名 | `n-select` | 选完班级后调 `/names?classname=X` 加载；班级未选时 disabled |
| 密码 | `n-input` type=password | 手动输入 |

**`n-select` 数据绑定：**
- 班级下拉：`label = classname, value = classname`
- 姓名下拉：`label = item.name, value = item.username`（即 `selectedUsername` 存储完整 username）

**登录按钮 disabled 条件：**
学生 Tab：班级、姓名、密码三者均已填写才可点击。

**级联状态管理：**
- 切换到其他 Tab 时，**清空**班级、姓名、密码的已选值（重置为初始状态）
- 重新选择班级时，**清空**已选姓名（`selectedUsername = ""`）并重新调 `/names` 加载

**API 错误处理：**
- `/classes` 加载失败：班级下拉显示为空，展示通用错误提示
- `/names` 加载失败：姓名下拉显示为空并保持 disabled，展示通用错误提示

登录时发送 `{ username: selectedUsername, password }` 到现有 `/api/account/login` 端点。

**Tab 2 - 管理员登录**

保持现有用户名+密码表单，无改动。管理员 Tab 登录按钮 disabled 条件：用户名和密码均非空。

### api.ts 新增

```typescript
Account.listClasses(): Promise<string[]>
Account.listNamesByClass(classname: string): Promise<{name: string, username: string}[]>
```

---

## 数据流

```
挂载 Login.vue
  → GET /api/account/classes → 缓存班级列表，填充班级下拉

用户选择班级
  → 清空 selectedUsername
  → GET /api/account/names?classname=X → 填充姓名下拉
    （每个 option: label=name, value=username）

用户选姓名 → selectedUsername = item.username（完整 username）
用户输密码
  → POST /api/account/login { username: selectedUsername, password }
  → 登录成功 → 关闭 Modal，更新 user store
```

---

## 不在此次范围内

- 历史用户（非 batch 创建）的 classname 回填（现有用户 classname 为空，不出现在班级列表中）
- `UserListSchema` 和用户管理页不展示 classname 字段（可后续迭代）
- 学生忘记密码流程
