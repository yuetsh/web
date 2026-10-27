<template>
  <n-flex vertical class="container">
    <n-flex>
      <div>
        <n-input
          style="width: 200px"
          v-model:value="query.username"
          placeholder="搜索用户名"
          clearable
        />
      </div>
      <div>
        <n-select
          style="width: 120px"
          v-model:value="query.role"
          :options="roles"
        />
      </div>
      <n-button @click="showCreate = true">新建一个</n-button>
      <n-button @click="showBatch = true">批量新建</n-button>
      <n-pagination
        v-model:page="query.page"
        :page-size="10"
        :item-count="count"
        simple
      />
    </n-flex>
    <n-data-table striped :columns="columns" :data="users"></n-data-table>
    <UserFormModal v-model:show="showCreate" @saved="init" />
    <n-modal
      style="width: 440px"
      :mask-closable="false"
      preset="card"
      title="批量新建学生"
      v-model:show="showBatch"
    >
      <n-flex vertical>
        <n-text depth="3" style="font-size: 13px">
          每行一个名字。用户名是 web + 班级 + 名字（比如
          web{{ classname || "241" }}{{ names[0] || "张三" }}），密码随机生成，建好后在列表里点“显示”查看。
        </n-text>
        <n-input
          placeholder="班级，比如 241"
          v-model:value="classname"
          :disabled="batchLoading"
        />
        <n-input
          rows="16"
          type="textarea"
          placeholder="张三&#10;李四&#10;王五"
          v-model:value="namesStr"
          :disabled="batchLoading"
        />
        <n-button
          type="primary"
          :disabled="!(classname && !!names.length)"
          :loading="batchLoading"
          @click="batchCreateUsers"
        >
          创建 {{ names.length }} 个账号
        </n-button>
      </n-flex>
    </n-modal>
  </n-flex>
</template>
<script lang="ts" setup>
import { onMounted, reactive, ref, h, watch, computed } from "vue"
import { Account } from "../api"
import { parseTime } from "../utils/helper"
import { NButton, useMessage, type DataTableColumn } from "naive-ui"
import { getRole, Role, type User } from "../utils/type"
import UserActions from "../components/dashboard/UserActions.vue"
import UserFormModal from "../components/dashboard/UserFormModal.vue"
import { useRoute, useRouter } from "vue-router"
import { watchDebounced } from "@vueuse/core"

const users = ref([])
const count = ref(0)
const route = useRoute()
const router = useRouter()
const message = useMessage()
const query = reactive({
  username: "",
  page: Number(route.params.page),
  role: "",
})
const showBatch = ref(false)
const showCreate = ref(false)
const classname = ref("")
const namesStr = ref("")
const names = computed(() =>
  namesStr.value
    .split("\n")
    .map((it) => it.trim())
    .filter((it) => !!it),
)
const revealed = reactive(new Set<number>())

const batchLoading = ref(false)

const roles = [
  { label: "全部权限", value: "" },
  { label: "普通用户", value: Role.Normal },
  { label: "管理员", value: Role.Admin },
  { label: "超级管理员", value: Role.Super },
]

const columns: DataTableColumn<User>[] = [
  {
    title: "用户名",
    key: "username",
  },
  {
    // 密码默认不显示，投屏时不会被学生看到
    title: "初始密码",
    key: "raw_password",
    render: (row) =>
      !row.raw_password
        ? "—"
        : revealed.has(row.id)
        ? h("span", { style: "font-family: var(--wp-font-mono)" }, row.raw_password)
        : h(
            NButton,
            { text: true, size: "small", onClick: () => revealed.add(row.id) },
            () => "显示",
          ),
  },
  {
    title: "创建时间",
    key: "date_joined",
    render: (row) => parseTime(row.date_joined, "YYYY-MM-DD HH:mm:ss"),
  },
  {
    title: "上次登录",
    key: "last_login",
    render: (row) =>
      row.last_login
        ? parseTime(row.last_login, "YYYY-MM-DD HH:mm:ss")
        : "从未登录",
  },
  {
    title: "班级",
    key: "classname",
  },
  {
    title: "权限",
    key: "role",
    render: (row) => getRole(row.role),
  },
  {
    title: "选项",
    key: "actions",
    render: (row) => h(UserActions, { user: row, onReload: init }),
  },
]

async function batchCreateUsers() {
  if (!names.value.length) return
  try {
    batchLoading.value = true
    const data = await Account.batchCreate({
      classname: classname.value,
      names: names.value,
    })
    batchLoading.value = false
    message.success(data.message)
    showBatch.value = false
    query.page = 1
    query.role = ""
    init()
  } catch (err: any) {
    batchLoading.value = false
    message.error(err.response?.data?.detail ?? "批量创建失败")
  }
}

// 快速翻页时只用最后一次请求的结果
let initSeq = 0

async function init() {
  const seq = ++initSeq
  const data = await Account.list(query)
  if (seq !== initSeq) return
  users.value = data.items
  count.value = data.count
}

watch(
  () => query.role,
  () => {
    if (query.page !== 1) query.page = 1
    else init()
  },
)
watchDebounced(
  () => query.username,
  () => {
    if (query.page !== 1) query.page = 1
    else init()
  },
  { debounce: 500, maxWait: 1000 },
)
watch(
  () => query.page,
  (v) => {
    init()
    router.push({ params: { page: v } })
  },
)
// 浏览器前进 / 后退时，页码跟着地址栏走
watch(
  () => route.params.page,
  (v) => {
    const page = Number(v) || 1
    if (page !== query.page) query.page = page
  },
)

onMounted(init)
</script>
<style scoped>
.container {
  padding: 10px 10px 10px 0;
  height: 100%;
  overflow: auto;
}
</style>
