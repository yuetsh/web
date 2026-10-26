import { Marked } from "marked"

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

const safeMarked = new Marked({
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
