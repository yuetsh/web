import { createWebHistory, createRouter, type RouteRecordRaw } from "vue-router"
import { loginModal } from "./store/modal"

// 编辑器（CodeMirror 等）比较大，用到时才加载；几个路由共用同一个加载函数，切换时不会重新挂载
const Workspace = () => import("./pages/Workspace.vue")
import { hasLogin } from "./token"
import { authed, roleStaff, roleSuper } from "./store/user"
import { loadUser } from "./store/session"

declare module "vue-router" {
  interface RouteMeta {
    auth?: boolean
    // 教学页面：staff 是 admin 和 super，super 只有超管（和后端的 requireAdmin / requireSuper 对应）
    role?: "staff" | "super"
    // 不带顶栏的全屏页面
    bare?: boolean
  }
}

const routes: RouteRecordRaw[] = [
  { path: "/", name: "home", component: Workspace, meta: { auth: true } },
  {
    path: "/tutorial",
    name: "home-tutorial-list",
    component: Workspace,
    meta: { auth: true },
  },
  {
    path: "/tutorial/:display",
    name: "home-tutorial",
    component: Workspace,
    meta: { auth: true },
  },
  {
    path: "/challenge",
    name: "home-challenge-list",
    component: () => import("./pages/ChallengeHome.vue"),
    meta: { auth: true },
  },
  {
    path: "/challenge/:display",
    name: "home-challenge",
    component: () => import("./pages/ChallengeDetail.vue"),
    meta: { auth: true },
  },
  {
    // 学生（和老师自己）的“我的提交”；:page 是旧链接留下的，不用了
    path: "/submissions/:page?",
    name: "submissions",
    component: () => import("./pages/MySubmissions.vue"),
    meta: { auth: true },
  },
  {
    path: "/submission/:id",
    name: "submission",
    component: () => import("./pages/Submission.vue"),
    props: true,
    meta: { auth: true, bare: true },
  },
  {
    path: "/creation",
    name: "creation-list",
    component: () => import("./pages/CreationHome.vue"),
    meta: { auth: true },
  },
  {
    path: "/creation/:display",
    name: "creation",
    component: () => import("./pages/CreationDetail.vue"),
    meta: { auth: true },
  },
  {
    path: "/showcase",
    name: "showcase",
    component: () => import("./pages/Showcase.vue"),
    meta: { auth: true },
  },
  {
    path: "/dashboard",
    name: "dashboard",
    component: () => import("./pages/Dashboard.vue"),
    meta: { auth: true, role: "staff" },
    children: [
      {
        path: "tutorial/:display",
        name: "tutorial-editor",
        component: () => import("./pages/TaskEditor.vue"),
        props: { kind: "tutorial" },
        meta: { role: "super" },
      },
      {
        path: "challenge/:display",
        name: "challenge-editor",
        component: () => import("./pages/TaskEditor.vue"),
        props: { kind: "challenge" },
      },
      {
        path: "user-manage/:page",
        name: "user-manage",
        component: () => import("./pages/UserManage.vue"),
        meta: { role: "super" },
      },
      {
        path: "showcase",
        name: "showcase-manage",
        component: () => import("./pages/ShowcaseManage.vue"),
      },
      {
        path: "gradebook",
        name: "gradebook",
        component: () => import("./pages/Gradebook.vue"),
        meta: { role: "super" },
      },
      {
        path: "review",
        name: "review",
        component: () => import("./pages/Review.vue"),
      },
      {
        // 全站提交列表（超管），和学生的“我的提交”是两个页面
        path: "submissions/:page",
        name: "teach-submissions",
        component: () => import("./pages/Submissions.vue"),
        meta: { role: "super" },
      },
    ],
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const isLoggedIn = authed.value || hasLogin()
  if (to.meta.auth && !isLoggedIn) {
    loginModal.value = true
    return false
  }
  if (to.meta.role || to.name === "dashboard") {
    await loadUser()
    const allowed = to.meta.role === "super" ? roleSuper.value : roleStaff.value
    if (!allowed) return { name: "home" }
  }
  // 教学的默认页是批改
  if (to.name === "dashboard") return { name: "review" }
})
