import { createApp } from "vue"
import { create } from "naive-ui"
import App from "./App.vue"
import "./global.css"
import { addAPIProvider } from "@iconify/vue"

//@ts-ignore
import "github-markdown-css/github-markdown-light.css"

import { marked } from "marked"
import alert from "marked-alert"
import { markedHighlight } from "marked-highlight"
import preview from "marked-code-preview"
import { alertVariants } from "./utils/const"

import hljs from "highlight.js/lib/core"
import xml from "highlight.js/lib/languages/xml"
import css from "highlight.js/lib/languages/css"
import javascript from "highlight.js/lib/languages/javascript"
import plaintext from "highlight.js/lib/languages/plaintext"
//@ts-ignore
import "highlight.js/styles/github.min.css"
import { router } from "./router"

hljs.registerLanguage("html", xml)
hljs.registerLanguage("css", css)
hljs.registerLanguage("js", javascript)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("plaintext", plaintext)

marked.use({
  gfm: true,
})
marked.use(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext"
      return hljs.highlight(code, { language }).value
    },
  }),
)
marked.use(alert({ variants: alertVariants }))

const template = `<div class="markedown-body-preview">{preview}</div>`
marked.use(preview({ template }))

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
