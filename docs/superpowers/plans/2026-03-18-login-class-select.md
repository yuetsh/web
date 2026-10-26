# 登录框重构：班级+姓名选择登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构登录框，学生通过选班级→选姓名→输密码登录，管理员通过 Tab 切换使用用户名+密码登录。

**Architecture:** 后端在 User 模型上新增 `classname` 字段，并提供两个无鉴权端点返回班级列表和按班级的学生列表。前端 Login.vue 重构为两个 Tab，学生 Tab 使用级联下拉（班级→姓名），管理员 Tab 保留原有表单。

**Tech Stack:** Django + django-ninja (backend), Vue 3 + TypeScript + Naive UI (frontend), Axios (HTTP client)

---

## File Map

**Modified:**
- `api/account/models.py` — User 模型加 `classname` 字段
- `api/account/api.py` — `batch_create` 保存 classname，新增两个 GET 端点
- `api/account/schemas.py` — 新增 `ClassNameEntry` schema
- `client/src/api.ts` — Account 对象加两个新方法
- `client/src/components/Login.vue` — 完整重构为 Tab 布局

**Created:**
- `api/account/migrations/0003_user_classname.py` — 迁移文件（由 `makemigrations` 自动生成）

---

## Task 1: 后端 — 给 User 模型加 classname 字段并迁移

**Files:**
- Modify: `api/account/models.py`

- [ ] **Step 1: 在 User 模型里加 classname 字段**

在 `api/account/models.py` 的 `User` 类中，在 `raw_password` 字段之后添加：

```python
classname = models.CharField(
    max_length=50,
    blank=True,
    default="",
    verbose_name="班级",
)
```

- [ ] **Step 2: 生成迁移文件**

```bash
cd api && uv run manage.py makemigrations account
```

期望输出：`Migrations for 'account': account/migrations/0003_user_classname.py`

- [ ] **Step 3: 执行迁移**

```bash
uv run manage.py migrate
```

期望输出：`Applying account.0003_user_classname... OK`

- [ ] **Step 4: 验证字段已加入**

```bash
uv run manage.py shell -c "from account.models import User; print(User._meta.get_field('classname'))"
```

期望输出：`<django.db.models.fields.CharField: classname>`

- [ ] **Step 5: Commit**

```bash
cd api && git add account/models.py account/migrations/0003_user_classname.py
git commit -m "feat: add classname field to User model"
```

---

## Task 2: 后端 — batch_create 保存 classname

**Files:**
- Modify: `api/account/api.py:97-101`

- [ ] **Step 1: 修改 batch_create 中构造 User 的代码**

找到 `api/account/api.py` 中的 `batch_create` 函数，将：

```python
user = User(username=username)
user.set_password(password)
```

改为：

```python
user = User(username=username, classname=payload.classname)
user.set_password(password)
```

（必须在 `set_password` 之前设置 `classname`，因为 `set_password` 内部会触发 `save()`）

- [ ] **Step 2: 手动测试批量创建保存了 classname**

```bash
cd api && uv run manage.py shell -c "
from account.models import User
# 测试用：直接创建一个带 classname 的 user
u = User(username='webtest班级测试', classname='test班')
u.set_password('123456')
print('classname:', u.classname)
u.delete()
"
```

期望输出：`classname: test班`

- [ ] **Step 3: Commit**

```bash
git add api/account/api.py
git commit -m "feat: save classname in batch_create endpoint"
```

---

## Task 3: 后端 — 新增 /classes 和 /names 端点

**Files:**
- Modify: `api/account/api.py`
- Modify: `api/account/schemas.py`

- [ ] **Step 1: 在 schemas.py 新增返回 schema**

在 `api/account/schemas.py` 末尾添加：

```python
class ClassStudentEntry(Schema):
    name: str
    username: str
```

- [ ] **Step 2: 在 api.py 新增两个端点**

在 `api/account/api.py` 中，在 `router = Router()` 后的 import 区域加入 `ClassStudentEntry`：

```python
from .schemas import (
    BatchUsersIn,
    ClassStudentEntry,
    LeaderboardEntry,
    UserListSchema,
    UserRegistrationSchema,
    UserLoginSchema,
)
```

然后在文件末尾（`leaderboard` 函数之后）添加：

```python
@router.get("/classes", response=List[str])
def list_classes(request):
    """返回所有不重复的非空班级名列表，按字典序升序"""
    return list(
        User.objects.filter(classname__gt="")
        .values_list("classname", flat=True)
        .distinct()
        .order_by("classname")
    )


@router.get("/names", response=List[ClassStudentEntry])
def list_names_by_class(request, classname: str):
    """返回指定班级的学生姓名和用户名列表"""
    prefix = "web" + classname
    users = User.objects.filter(
        classname=classname,
        username__startswith=prefix,
    ).order_by("username")
    return [
        ClassStudentEntry(name=u.username[len(prefix):], username=u.username)
        for u in users
    ]
```

- [ ] **Step 3: 启动开发服务器测试端点**

```bash
cd api && uv run manage.py runserver
```

在另一个终端测试：

```bash
curl http://localhost:8000/api/account/classes
# 期望：[] （无 classname 数据时）

curl "http://localhost:8000/api/account/names?classname=301"
# 期望：[]
```

- [ ] **Step 4: Commit**

```bash
git add api/account/api.py api/account/schemas.py
git commit -m "feat: add /classes and /names endpoints for student login"
```

---

## Task 4: 前端 — api.ts 新增两个方法

**Files:**
- Modify: `client/src/api.ts`

- [ ] **Step 1: 在 Account 对象末尾加两个方法**

在 `client/src/api.ts` 的 `Account` 对象中，`leaderboard` 方法之后添加：

```typescript
  async listClasses(): Promise<string[]> {
    const res = await http.get("/account/classes")
    return res.data
  },

  async listNamesByClass(
    classname: string,
  ): Promise<{ name: string; username: string }[]> {
    const res = await http.get("/account/names", { params: { classname } })
    return res.data
  },
```

- [ ] **Step 2: Commit**

```bash
cd client && git add src/api.ts
git commit -m "feat: add listClasses and listNamesByClass to Account API client"
```

---

## Task 5: 前端 — 重构 Login.vue

**Files:**
- Modify: `client/src/components/Login.vue`

- [ ] **Step 1: 用以下完整内容替换 Login.vue**

```vue
<template>
  <n-modal
    preset="card"
    title="登录"
    style="width: 420px"
    v-model:show="loginModal"
  >
    <n-tabs v-model:value="activeTab" @update:value="onTabChange">
      <n-tab-pane name="student" tab="学生登录">
        <n-form>
          <n-form-item label="班级">
            <n-select
              v-model:value="selectedClass"
              :options="classOptions"
              placeholder="选择班级"
              :loading="classesLoading"
              @update:value="onClassChange"
            />
          </n-form-item>
          <n-form-item label="姓名">
            <n-select
              v-model:value="selectedUsername"
              :options="nameOptions"
              placeholder="选择姓名"
              :loading="namesLoading"
              :disabled="!selectedClass || namesLoading"
            />
          </n-form-item>
          <n-form-item label="密码">
            <n-input
              type="password"
              v-model:value="studentPassword"
              name="password"
            />
          </n-form-item>
          <n-alert
            type="error"
            v-if="classesError"
            class="message"
            title="加载班级列表失败，请刷新重试"
          />
          <n-alert
            type="error"
            v-if="namesError"
            class="message"
            title="加载姓名列表失败，请重新选择班级"
          />
          <n-alert
            type="error"
            v-if="showStudentError"
            class="message"
            title="登录失败，请检查密码"
          />
          <n-button
            block
            type="primary"
            :loading="studentLoading"
            :disabled="!selectedClass || !selectedUsername || !studentPassword"
            @click="submitStudent"
          >
            登录
          </n-button>
        </n-form>
      </n-tab-pane>

      <n-tab-pane name="admin" tab="管理员登录">
        <n-form>
          <n-form-item label="用户名">
            <n-input v-model:value="adminName" name="username" />
          </n-form-item>
          <n-form-item label="密码">
            <n-input
              type="password"
              v-model:value="adminPassword"
              name="password"
            />
          </n-form-item>
          <n-alert
            type="error"
            v-if="showAdminError"
            class="message"
            title="登录失败，请检查用户名和密码"
          />
          <n-button
            block
            type="primary"
            :loading="adminLoading"
            :disabled="!adminName || !adminPassword"
            @click="submitAdmin"
          >
            登录
          </n-button>
        </n-form>
      </n-tab-pane>
    </n-tabs>
  </n-modal>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from "vue"
import { Account } from "../api"
import { loginModal } from "../store/modal"
import { user } from "../store/user"

// Tab state
const activeTab = ref("student")

// Student tab state
const selectedClass = ref<string | null>(null)
const selectedUsername = ref<string | null>(null)
const studentPassword = ref("")
const studentLoading = ref(false)
const showStudentError = ref(false)

// Classes data
const classes = ref<string[]>([])
const classesLoading = ref(false)
const classesError = ref(false)
const classOptions = computed(() =>
  classes.value.map((c) => ({ label: c, value: c })),
)

// Names data
const names = ref<{ name: string; username: string }[]>([])
const namesLoading = ref(false)
const namesError = ref(false)
const nameOptions = computed(() =>
  names.value.map((n) => ({ label: n.name, value: n.username })),
)

// Admin tab state
const adminName = ref("")
const adminPassword = ref("")
const adminLoading = ref(false)
const showAdminError = ref(false)

// Load classes on mount (cached — not reloaded on tab switch)
onMounted(async () => {
  classesLoading.value = true
  classesError.value = false
  try {
    classes.value = await Account.listClasses()
  } catch {
    classesError.value = true
  } finally {
    classesLoading.value = false
  }
})

function onTabChange() {
  // Reset student tab state
  selectedClass.value = null
  selectedUsername.value = null
  studentPassword.value = ""
  showStudentError.value = false
  namesError.value = false
  names.value = []
  // Reset admin tab state
  adminName.value = ""
  adminPassword.value = ""
  showAdminError.value = false
}

async function onClassChange(classname: string) {
  selectedUsername.value = null
  names.value = []
  namesError.value = false
  namesLoading.value = true
  try {
    names.value = await Account.listNamesByClass(classname)
  } catch {
    namesError.value = true
  } finally {
    namesLoading.value = false
  }
}

async function submitStudent() {
  if (!selectedUsername.value || !studentPassword.value) return
  studentLoading.value = true
  showStudentError.value = false
  try {
    const data = await Account.login(selectedUsername.value, studentPassword.value)
    user.username = data.username
    user.role = data.role
    user.loaded = true
    loginModal.value = false
  } catch {
    showStudentError.value = true
  } finally {
    studentLoading.value = false
  }
}

async function submitAdmin() {
  if (!adminName.value || !adminPassword.value) return
  adminLoading.value = true
  showAdminError.value = false
  try {
    const data = await Account.login(adminName.value, adminPassword.value)
    user.username = data.username
    user.role = data.role
    user.loaded = true
    loginModal.value = false
  } catch {
    showAdminError.value = true
  } finally {
    adminLoading.value = false
  }
}
</script>

<style scoped>
.message {
  margin-bottom: 12px;
}
</style>
```

- [ ] **Step 2: 启动前端开发服务器验证**

```bash
cd client && npm run start
```

打开浏览器，点击登录按钮，检查：
- [ ] 显示两个 Tab：学生登录 / 管理员登录
- [ ] 学生登录 Tab：班级下拉加载数据（若无数据则为空列表）
- [ ] 选择班级后，姓名下拉变为可用并加载数据
- [ ] 三个字段未全填时，登录按钮 disabled
- [ ] 管理员登录 Tab：用户名+密码表单，两个字段未填时按钮 disabled
- [ ] 切换 Tab 时，两个 Tab 的所有字段清空

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Login.vue
git commit -m "feat: refactor Login.vue with class/name dropdown for students and admin tab"
```

---

## Task 6: 端到端验证

- [ ] **Step 1: 通过 Django admin 或 batch_create 创建测试用户**

```bash
cd api && uv run manage.py shell -c "
from account.models import User
u = User(username='web测试班张三', classname='测试班')
u.set_password('123456')
print('created:', u.username, u.classname)
"
```

- [ ] **Step 2: 验证 /classes 返回新班级**

```bash
curl http://localhost:8000/api/account/classes
# 期望：["测试班"]
```

- [ ] **Step 3: 验证 /names 返回学生**

```bash
curl "http://localhost:8000/api/account/names?classname=测试班"
# 期望：[{"name": "张三", "username": "web测试班张三"}]
```

- [ ] **Step 4: 在浏览器中完整登录流程测试**

1. 打开登录框，选学生登录 Tab
2. 班级下拉选"测试班"
3. 姓名下拉选"张三"
4. 输入密码 `123456`
5. 点击登录，验证成功跳转

- [ ] **Step 5: 测试管理员 Tab 登录**

用现有管理员账号在管理员 Tab 登录，验证正常。

- [ ] **Step 6: 清理测试数据**

```bash
cd api && uv run manage.py shell -c "
from account.models import User
User.objects.filter(username='web测试班张三').delete()
print('cleaned')
"
```
