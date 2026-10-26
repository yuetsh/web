import { Marked, type MarkedExtension } from "marked"
import alert from "marked-alert"
import { markedHighlight } from "marked-highlight"
import preview from "marked-code-preview"
import hljs from "highlight.js/lib/core"
import xml from "highlight.js/lib/languages/xml"
import css from "highlight.js/lib/languages/css"
import javascript from "highlight.js/lib/languages/javascript"
import plaintext from "highlight.js/lib/languages/plaintext"
import { alertVariants } from "./const"

hljs.registerLanguage("html", xml)
hljs.registerLanguage("css", css)
hljs.registerLanguage("js", javascript)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("plaintext", plaintext)

const highlight = markedHighlight({
  langPrefix: "hljs language-",
  highlight(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : "plaintext"
    return hljs.highlight(code, { language }).value
  },
})
const alerts = alert({ variants: alertVariants })

// 老师写的教程、挑战描述用：带 preview 的代码块会渲染成真实的 HTML
export const trustedExtensions: MarkedExtension[] = [
  { gfm: true },
  highlight,
  alerts,
  preview({ template: `<div class="markedown-body-preview">{preview}</div>` }),
]

// 提示词和 AI 回复是用户可控的内容，渲染进 v-html 前必须去掉可执行的部分：
// 原始 HTML 一律转义成文本，链接和图片只放行 http(s)/mailto 和相对地址
const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

const isSafeUrl = (href: string) =>
  !/^\s*[a-z][a-z0-9+.-]*:/i.test(href) || /^\s*(https?|mailto):/i.test(href)

// 独立实例，不带 preview 扩展（它会把代码块原样当 HTML 渲染）
const safeMarked = new Marked({ gfm: true }, highlight, alerts, {
  renderer: {
    html({ text }) {
      return escapeHtml(text)
    },
    link({ href, tokens }) {
      if (isSafeUrl(href)) return false
      return this.parser.parseInline(tokens)
    },
    image({ href, text }) {
      if (isSafeUrl(href)) return false
      return escapeHtml(text)
    },
  },
})

export function renderMarkdown(text: string): string {
  return safeMarked.parse(text) as string
}
