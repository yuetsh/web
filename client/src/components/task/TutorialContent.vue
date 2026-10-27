<template>
  <div class="markdown-body" v-html="content" ref="$content" />
</template>
<script lang="ts" setup>
import { onMounted, ref, useTemplateRef, watch } from "vue"
import { Marked } from "marked"
import { trustedExtensions } from "../../utils/markdown"
import copyFn from "copy-text-to-clipboard"
import { css, html, js, tab } from "../../store/editors"
import { Tutorial } from "../../api"
import { readTaskCode } from "../../composables/useTaskCode"
import { step, tutorialIds, loadTutorials } from "../../store/tutorial"
import { taskId, assetBaseUrl } from "../../store/task"
import { useRouter } from "vue-router"

// 独立实例：带“复制/替换”按钮的代码块只用在教程里，不能改全局的 marked
const tutorialMarked = new Marked(...trustedExtensions, {
  renderer: {
    code({ text, lang }) {
      const language = lang?.toLowerCase() ?? "html"
      return `<div class="codeblock-wrapper" data-lang="${language}">
  <div class="codeblock-action">
    <span class="lang">${language.toUpperCase()}</span>
    <div class="btn-group">
      <button class="action-btn" data-action="copy">复制</button>
      <button class="action-btn" data-action="replace">替换</button>
    </div>
  </div>
  <pre><code class="language-${language}">${text}</code></pre>
</div>`
    },
    link({ href, text }) {
      return `<a href="${href}" target="_blank">${text}</a>`
    },
  },
})

const router = useRouter()
const content = ref("")
const $content = useTemplateRef<any>("$content")

// 连点“下一节”时只用最后一次请求的结果
let renderSeq = 0

async function render() {
  const seq = ++renderSeq
  const data = await Tutorial.get(step.value)
  if (seq !== renderSeq) return
  // 这一节写过代码就接着写，没写过才放示例代码（以前每次切换都会被示例覆盖）
  const saved = readTaskCode(data.task_ptr)
  taskId.value = data.task_ptr
  assetBaseUrl.value = `/media/tasks/tutorial/${step.value}/`
  html.value = saved?.html ?? data.example_html ?? ""
  css.value = saved?.css ?? data.example_css ?? ""
  js.value = saved?.js ?? data.example_js ?? ""
  const merged = `# ${data.display}. ${data.title}\n${data.content}`
  const rendered = await tutorialMarked.parse(merged, { async: true })
  if (seq !== renderSeq) return
  content.value = rendered
}

function flash(btn: HTMLButtonElement, done: string, original: string) {
  btn.textContent = done
  setTimeout(() => {
    btn.textContent = original
  }, 1000)
}

function setupCodeActions() {
  $content.value?.addEventListener("click", (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-action]",
    )
    if (!btn) return
    const wrapper = btn.closest<HTMLElement>("[data-lang]")!
    const lang = wrapper.dataset.lang ?? "html"
    const code = wrapper.querySelector("code")?.textContent ?? ""

    if (btn.dataset.action === "copy") {
      copyFn(code)
      flash(btn, "已复制", "复制")
    } else if (btn.dataset.action === "replace") {
      tab.value = lang
      if (lang === "html") html.value = code
      if (lang === "css") css.value = code
      if (lang === "js") js.value = code
      flash(btn, "已替换", "替换")
    }
  })
}

async function init() {
  await loadTutorials()
  if (!tutorialIds.value.length) {
    content.value = "暂无教程"
    return
  }
  render()
}

onMounted(() => {
  setupCodeActions()
  init()
})
watch(step, (v) => {
  router.push({ name: "home-tutorial", params: { display: v } })
  render()
})
</script>
<style scoped>
.markdown-body {
  padding: 16px;
  box-sizing: border-box;
  overflow: auto;
}
</style>
<style>
.markdown-body pre {
  position: relative;
}

.markdown-body pre code {
  padding: 0;
  font-size: 1rem;
  font-family: var(--wp-font-mono);
}

.markdown-body .codeblock-wrapper {
  padding: 1rem;
  background-color: var(--wp-paper);
  border-radius: 6px;
  margin-bottom: 1rem;
  overflow: auto;
}

.markdown-body .codeblock-wrapper pre {
  padding: 0;
  background-color: transparent;
  border-radius: 0;
  margin-bottom: 0;
  overflow: visible;
}

.codeblock-action {
  margin-bottom: 0.5rem;
  font-family:
    v-sans,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif,
    "Apple Color Emoji",
    "Segoe UI Emoji",
    "Segoe UI Symbol";
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.codeblock-action .lang {
  font-size: 0.9rem;
  font-weight: bold;
}

.codeblock-action .btn-group {
  display: flex;
  gap: 0.5rem;
}

.codeblock-action .action-btn {
  height: 28px;
  padding: 0 14px;
  font-size: 14px;
  border-radius: 3px;
  border: 1px solid var(--wp-line);
  background-color: var(--wp-surface);
  color: var(--wp-ink);
  cursor: pointer;
  transition: all 0.2s ease;
}

.codeblock-action .action-btn:hover {
  border-color: var(--wp-brand);
  color: var(--wp-brand);
}
</style>
