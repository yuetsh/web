import { computed, reactive } from "vue"
import { Role } from "../utils/type"

export const user = reactive({
  loaded: false,
  username: "",
  role: Role.Normal,
})
export const authed = computed(() => !!user.username)
export const roleNormal = computed(
  () => authed.value && user.role === Role.Normal,
)
export const roleAdmin = computed(
  () => authed.value && user.role === Role.Admin,
)
export const roleSuper = computed(
  () => authed.value && user.role === Role.Super,
)
// 老师端（教学）：admin 和 super
export const roleStaff = computed(() => roleAdmin.value || roleSuper.value)
