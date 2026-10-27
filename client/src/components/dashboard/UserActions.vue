<template>
  <n-flex>
    <n-button secondary v-if="user.role !== Role.Super" @click="edit">
      修改
    </n-button>
    <n-button
      secondary
      type="error"
      v-if="user.role !== Role.Super && user.is_active"
      @click="toggleUserActive"
    >
      封号
    </n-button>
    <n-button
      secondary
      type="primary"
      v-if="user.role !== Role.Super && !user.is_active"
      @click="toggleUserActive"
    >
      解封
    </n-button>
    <UserFormModal
      v-model:show="showEdit"
      :user="user"
      @saved="emits('reload')"
    />
  </n-flex>
</template>
<script lang="ts" setup>
import { ref } from "vue"
import { useDialog, useMessage } from "naive-ui"
import { Account } from "../../api"
import { Role, type User } from "../../utils/type"
import UserFormModal from "./UserFormModal.vue"

interface Props {
  user: User
}

const props = defineProps<Props>()
const emits = defineEmits(["reload"])

const message = useMessage()
const dialog = useDialog()
const showEdit = ref(false)

function edit() {
  showEdit.value = true
}

async function doToggle() {
  const data = await Account.toggleActive(props.user.id)
  message.success(data.message)
  emits("reload")
}

function toggleUserActive() {
  if (!props.user.is_active) return doToggle()
  dialog.warning({
    title: `封禁「${props.user.username}」？`,
    content: "封禁后这个账号不能登录，已经登录的也会被退出。之后可以再解封。",
    positiveText: "封禁",
    negativeText: "取消",
    onPositiveClick: doToggle,
  })
}
</script>
