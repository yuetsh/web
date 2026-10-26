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
