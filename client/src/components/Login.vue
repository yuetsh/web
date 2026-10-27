<template>
  <n-modal
    preset="card"
    title="登录"
    style="width: min(400px, 92vw)"
    :bordered="false"
    v-model:show="loginModal"
  >
    <n-tabs v-model:value="activeTab" @update:value="onTabChange">
      <n-tab-pane name="student" tab="学生">
        <n-form :show-feedback="false" class="form">
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
              filterable
              :placeholder="selectedClass ? '选择或输入姓名' : '先选班级'"
              :loading="namesLoading"
              :disabled="!selectedClass || namesLoading"
              @update:value="focusPassword"
            />
          </n-form-item>
          <n-form-item label="密码">
            <n-input
              ref="studentPasswordRef"
              type="password"
              show-password-on="click"
              v-model:value="studentPassword"
              name="password"
              placeholder="输入密码，按 Enter 登录"
              @keyup.enter="submitStudent"
            />
          </n-form-item>
          <div v-if="studentError" class="error">{{ studentError }}</div>
          <n-button
            block
            type="primary"
            :loading="studentLoading"
            :disabled="!selectedClass || !selectedUsername || !studentPassword"
            @click="submitStudent"
          >
            登录
          </n-button>
          <div class="note">忘了密码找老师重置</div>
        </n-form>
      </n-tab-pane>

      <n-tab-pane name="admin" tab="老师">
        <n-form :show-feedback="false" class="form">
          <n-form-item label="用户名">
            <n-input v-model:value="adminName" name="username" placeholder="用户名" />
          </n-form-item>
          <n-form-item label="密码">
            <n-input
              type="password"
              show-password-on="click"
              v-model:value="adminPassword"
              name="password"
              placeholder="输入密码，按 Enter 登录"
              @keyup.enter="submitAdmin"
            />
          </n-form-item>
          <div v-if="adminError" class="error">{{ adminError }}</div>
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
import { ref, computed, nextTick, onMounted } from "vue"
import { Account } from "../api"
import { loginModal } from "../store/modal"
import { user } from "../store/user"
import { router } from "../router"

// 机房的电脑一节课一个班轮流用：记住班级，不记姓名
const CLASS_KEY = "login-class"

const activeTab = ref("student")
const studentPasswordRef = ref<{ focus: () => void } | null>(null)

// Student tab state
const selectedClass = ref<string | null>(null)
const selectedUsername = ref<string | null>(null)
const studentPassword = ref("")
const studentLoading = ref(false)
const studentError = ref("")

const classes = ref<string[]>([])
const classesLoading = ref(false)
const classOptions = computed(() =>
  classes.value.map((c) => ({ label: c, value: c })),
)

// Names data
const names = ref<{ name: string; username: string }[]>([])
const namesLoading = ref(false)
const nameOptions = computed(() =>
  names.value.map((n) => ({ label: n.name, value: n.username })),
)

// Admin tab state
const adminName = ref("")
const adminPassword = ref("")
const adminLoading = ref(false)
const adminError = ref("")

// 班级列表只在打开页面时取一次
onMounted(async () => {
  classesLoading.value = true
  try {
    classes.value = await Account.listClasses()
  } catch {
    studentError.value = "班级列表没加载出来，请刷新页面重试"
    return
  } finally {
    classesLoading.value = false
  }
  let saved: string | null = null
  try {
    saved = localStorage.getItem(CLASS_KEY)
  } catch {}
  if (saved && classes.value.includes(saved)) {
    selectedClass.value = saved
    onClassChange(saved)
  }
})

// 换标签页时清掉输入的密码和错误；选好的班级和姓名留着
function onTabChange() {
  studentPassword.value = ""
  studentError.value = ""
  adminName.value = ""
  adminPassword.value = ""
  adminError.value = ""
}

async function onClassChange(classname: string) {
  selectedUsername.value = null
  names.value = []
  studentError.value = ""
  try {
    localStorage.setItem(CLASS_KEY, classname)
  } catch {}
  namesLoading.value = true
  try {
    names.value = await Account.listNamesByClass(classname)
  } catch {
    studentError.value = "姓名列表没加载出来，请重新选一次班级"
  } finally {
    namesLoading.value = false
  }
}

function focusPassword() {
  nextTick(() => studentPasswordRef.value?.focus())
}

// 失败次数太多被暂时禁止登录时，显示服务端给的提示
function loginError(err: any, fallback: string) {
  return err.response?.status === 429 ? err.response.data.detail : fallback
}

async function submitStudent() {
  if (!selectedUsername.value || !studentPassword.value) return
  studentLoading.value = true
  studentError.value = ""
  try {
    const data = await Account.login(
      selectedUsername.value,
      studentPassword.value,
    )
    user.username = data.username
    user.role = data.role
    user.loaded = true
    loginModal.value = false
    router.replace(
      window.location.pathname + window.location.search + window.location.hash,
    )
  } catch (err: any) {
    studentError.value = loginError(err, "登录失败，请检查密码")
  } finally {
    studentLoading.value = false
  }
}

async function submitAdmin() {
  if (!adminName.value || !adminPassword.value) return
  adminLoading.value = true
  adminError.value = ""
  try {
    const data = await Account.login(adminName.value, adminPassword.value)
    user.username = data.username
    user.role = data.role
    user.loaded = true
    loginModal.value = false
    router.replace(
      window.location.pathname + window.location.search + window.location.hash,
    )
  } catch (err: any) {
    adminError.value = loginError(err, "登录失败，请检查用户名和密码")
  } finally {
    adminLoading.value = false
  }
}
</script>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 4px;
}

.error {
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--wp-bad);
  background: var(--wp-bad-soft);
}

.note {
  font-size: 12px;
  text-align: center;
  color: var(--wp-faint);
}
</style>
