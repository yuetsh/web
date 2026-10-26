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
  </n-flex>
</template>
<script lang="ts" setup>
import { useMessage } from "naive-ui"
import { Account } from "../../api"
import { ADMIN_URL } from "../../utils/const"
import { Role, type User } from "../../utils/type"

interface Props {
  user: User
}

const props = defineProps<Props>()
const emits = defineEmits(["reload"])

const message = useMessage()

function edit() {
  window.open(`${ADMIN_URL}/account/user/${props.user.id}/change/`)
}

async function toggleUserActive() {
  const data = await Account.toggleActive(props.user.id)
  message.success(data.message)
  emits("reload")
}
</script>
