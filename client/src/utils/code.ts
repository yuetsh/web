export interface Code {
  html: string
  css: string
  js: string
}

export const emptyCode = (): Code => ({ html: "", css: "", js: "" })

export const sameCode = (a: Code, b: Code) =>
  a.html === b.html && a.css === b.css && a.js === b.js

export const isEmptyCode = (c: Code) => !c.html.trim() && !c.css.trim() && !c.js.trim()

// 把一整页 HTML（外部 AI 常给的格式）拆成 html / css / js 三段
export function splitHtml(raw: string): Code {
  const cssBlocks: string[] = []
  const jsBlocks: string[] = []
  let result = raw.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, content) => {
    cssBlocks.push(content.trim())
    return ""
  })
  result = result.replace(
    /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi,
    (_, content) => {
      jsBlocks.push(content.trim())
      return ""
    },
  )
  return {
    html: result.trim(),
    css: cssBlocks.join("\n\n"),
    js: jsBlocks.join("\n\n"),
  }
}

// prettier 加上各语言插件近 1MB，只在点“整理代码”时才加载
export async function formatCode(code: Code): Promise<Code> {
  const [prettier, htmlParser, cssParser, babelParser, estreeParser] =
    await Promise.all([
      import("prettier/standalone"),
      import("prettier/parser-html"),
      import("prettier/parser-postcss"),
      import("prettier/parser-babel"),
      import("prettier/plugins/estree"),
    ])
  const [html, css, js] = await Promise.all([
    prettier.format(code.html, {
      parser: "html",
      //@ts-ignore
      plugins: [htmlParser, babelParser, estreeParser, cssParser],
      tabWidth: 4,
    }),
    prettier.format(code.css, {
      parser: "css",
      plugins: [cssParser],
      tabWidth: 4,
    }),
    prettier.format(code.js, {
      parser: "babel",
      //@ts-ignore
      plugins: [babelParser, estreeParser],
      tabWidth: 2,
    }),
  ])
  return { html, css, js }
}
