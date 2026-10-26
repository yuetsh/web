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
              @keyup.enter="submitStudent"
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
              @keyup.enter="submitAdmin"
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
import { router } from "../router"

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
    router.replace(
      window.location.pathname + window.location.search + window.location.hash,
    )
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
