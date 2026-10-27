import { createApp } from "vue"
import { create } from "naive-ui"
import App from "./App.vue"
import "@fontsource/jetbrains-mono/400.css"
import "@fontsource/jetbrains-mono/600.css"
import "./global.css"
import "./store/theme"

//@ts-ignore
import "github-markdown-css/github-markdown-light.css"

import { marked } from "marked"
import { trustedExtensions } from "./utils/markdown"
//@ts-ignore
import "highlight.js/styles/github.min.css"
// 暗色时覆盖上面两份亮色样式
import "./styles/dark-content.css"
import { router } from "./router"

marked.use(...trustedExtensions)

const app = createApp(App)
const naive = create()

app.use(naive)
app.use(router)
app.mount("#app")
