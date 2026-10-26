import { createApp } from "vue"
import { create } from "naive-ui"
import App from "./App.vue"
import "./global.css"
import { addAPIProvider } from "@iconify/vue"

//@ts-ignore
import "github-markdown-css/github-markdown-light.css"

import { marked } from "marked"
import { trustedExtensions } from "./utils/markdown"
//@ts-ignore
import "highlight.js/styles/github.min.css"
import { router } from "./router"

marked.use(...trustedExtensions)

const app = createApp(App)
const naive = create()

app.use(naive)
app.use(router)
app.mount("#app")

if (!!import.meta.env.PUBLIC_ICONIFY_URL) {
  addAPIProvider("", {
    resources: [import.meta.env.PUBLIC_ICONIFY_URL],
  })
}
