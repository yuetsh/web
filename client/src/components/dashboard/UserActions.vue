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
import { useMessage } from "naive-ui"
import { Account } from "../../api"
import { Role, type User } from "../../utils/type"
import UserFormModal from "./UserFormModal.vue"

interface Props {
  user: User
}

const props = defineProps<Props>()
const emits = defineEmits(["reload"])

const message = useMessage()
const showEdit = ref(false)

function edit() {
  showEdit.value = true
}

async function toggleUserActive() {
  const data = await Account.toggleActive(props.user.id)
  message.success(data.message)
  emits("reload")
}
</script>
