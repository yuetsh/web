import { createWebHistory, createRouter } from "vue-router"
import { loginModal } from "./store/modal"

import Workspace from "./pages/Workspace.vue"
import { hasLogin } from "./token"
import { authed } from "./store/user"

const routes = [
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
    component: Workspace,
    meta: { auth: true },
  },
  {
    path: "/challenge/:display",
    name: "home-challenge",
    component: () => import("./pages/ChallengeDetail.vue"),
    meta: { auth: true },
  },
  {
    path: "/submissions/:page",
    name: "submissions",
    component: () => import("./pages/Submissions.vue"),
    meta: { auth: true },
  },
  {
    path: "/submission/:id",
    name: "submission",
    component: () => import("./pages/Submission.vue"),
    props: true,
    meta: { auth: true },
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
    meta: { auth: true },
    children: [
      {
        path: "tutorial/:display",
        name: "tutorial-editor",
        component: () => import("./pages/TutorialEditor.vue"),
      },
      {
        path: "challenge/:display",
        name: "challenge-editor",
        component: () => import("./pages/ChallengeEditor.vue"),
      },
      {
        path: "user-manage/:page",
        name: "user-manage",
        component: () => import("./pages/UserManage.vue"),
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
      },
    ],
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const isLoggedIn = authed.value || hasLogin()
  if (to.meta.auth && !isLoggedIn) {
    loginModal.value = true
    return false
  }
})
