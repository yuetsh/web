import { Account } from "../api"
import { Role } from "../utils/type"
import { user } from "./user"

let loading: Promise<void> | null = null

// 取一次当前登录用户（路由守卫要按角色判断，可能比 App 挂载还早）
export function loadUser(): Promise<void> {
  if (user.loaded) return Promise.resolve()
  loading ??= Account.getMyProfile()
    .then((data) => {
      user.username = data.username
      user.role = data.role
    })
    .catch(() => {})
    .finally(() => {
      user.loaded = true
      loading = null
    })
  return loading
}

export async function logout() {
  // token 已经先清掉了，退出请求失败（比如断网）界面也要显示为已退出
  try {
    await Account.logout()
  } finally {
    user.username = ""
    user.role = Role.Normal
  }
}
