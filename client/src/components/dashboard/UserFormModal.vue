<template>
  <n-modal
    style="width: 360px"
    :mask-closable="false"
    preset="card"
    :title="user ? `修改 ${user.username}` : '新建用户'"
    :show="show"
    @update:show="emit('update:show', $event)"
  >
    <n-form label-placement="left" label-width="60">
      <n-form-item label="用户名">
        <n-input v-model:value="form.username" />
      </n-form-item>
      <n-form-item label="密码">
        <n-input
          v-model:value="form.password"
          :placeholder="user ? '不修改请留空' : '6 到 20 位'"
        />
      </n-form-item>
      <n-form-item label="权限">
        <n-select v-model:value="form.role" :options="roles" />
      </n-form-item>
      <n-form-item label="班级">
        <n-input v-model:value="form.classname" placeholder="可不填" />
      </n-form-item>
    </n-form>
    <n-button
      type="primary"
      block
      :loading="loading"
      :disabled="!form.username || (!user && !form.password)"
      @click="submit"
    >
      保存
    </n-button>
  </n-modal>
</template>
<script lang="ts" setup>
import { reactive, ref, watch } from "vue"
import { useMessage } from "naive-ui"
import { Account } from "../../api"
import { Role, type User } from "../../utils/type"

const props = defineProps<{ show: boolean; user?: User | null }>()
const emit = defineEmits(["update:show", "saved"])

const message = useMessage()
const loading = ref(false)
const form = reactive({
  username: "",
  password: "",
  role: Role.Normal,
  classname: "",
})

const roles = [
  { label: "普通用户", value: Role.Normal },
  { label: "管理员", value: Role.Admin },
]

watch(
  () => props.show,
  (show) => {
    if (!show) return
    form.username = props.user?.username ?? ""
    form.password = ""
    form.role = props.user?.role ?? Role.Normal
    form.classname = props.user?.classname ?? ""
  },
)

async function submit() {
  loading.value = true
  try {
    const data = props.user
      ? await Account.update(props.user.id, {
          username: form.username,
          role: form.role,
          classname: form.classname,
          ...(form.password ? { password: form.password } : {}),
        })
      : await Account.create({ ...form })
    message.success(data.message)
    emit("update:show", false)
    emit("saved")
  } catch (err: any) {
    const detail = err.response?.data?.detail
    message.error(
      typeof detail === "string" ? detail : (detail?.[0]?.msg ?? "保存失败"),
    )
  } finally {
    loading.value = false
  }
}
</script>
