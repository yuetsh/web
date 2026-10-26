import type { GlobalThemeOverrides } from "naive-ui"

// 全站配色只在这里定义：同一份值既生成 CSS 变量（组件样式里用 var(--wp-*)），
// 也生成 Naive UI 的主题设置。机房是 Chrome 105，不支持 color-mix()，浅色底色单独列出来
export interface Palette {
  brand: string
  brandHover: string
  brandPressed: string
  brandSoft: string
  ink: string
  muted: string
  faint: string
  paper: string
  surface: string
  line: string
  html: string
  htmlSoft: string
  css: string
  cssSoft: string
  js: string
  jsSoft: string
  warn: string
  warnSoft: string
  bad: string
  badSoft: string
}

export const light: Palette = {
  brand: "#0d7a52",
  brandHover: "#118f61",
  brandPressed: "#0a6343",
  brandSoft: "#e3f2eb",
  ink: "#17201c",
  muted: "#5d6b65",
  faint: "#8a9791",
  paper: "#f5f7f6",
  surface: "#ffffff",
  line: "#dfe5e2",
  html: "#d9532c",
  htmlSoft: "#fdf3ef",
  css: "#2c6bd6",
  cssSoft: "#f1f5fd",
  js: "#b98900",
  jsSoft: "#fdf9ec",
  warn: "#b7791f",
  warnSoft: "#fbf3e6",
  bad: "#c2413b",
  badSoft: "#fbeceb",
}

// 暗色（阶段 4 才接上切换开关，值先定好）
export const dark: Palette = {
  brand: "#3cc189",
  brandHover: "#5ad19d",
  brandPressed: "#2ea374",
  brandSoft: "#173326",
  ink: "#e4ebe7",
  muted: "#9aaba3",
  faint: "#6f7f78",
  paper: "#0f1412",
  surface: "#161d1a",
  line: "#2a3531",
  html: "#f07a52",
  htmlSoft: "#2a1c17",
  css: "#6c9cf0",
  cssSoft: "#18202e",
  js: "#e2b93b",
  jsSoft: "#262113",
  warn: "#e0a34a",
  warnSoft: "#2b2316",
  bad: "#ec6b65",
  badSoft: "#2e1a19",
}

export const fontSans =
  '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", system-ui, sans-serif'
export const fontMono =
  '"JetBrains Mono", Consolas, "Microsoft YaHei", monospace'

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())

export function applyCssVars(p: Palette) {
  const root = document.documentElement.style
  for (const [k, v] of Object.entries(p)) root.setProperty(`--wp-${kebab(k)}`, v)
  root.setProperty("--wp-font-sans", fontSans)
  root.setProperty("--wp-font-mono", fontMono)
}

export function naiveOverrides(p: Palette): GlobalThemeOverrides {
  return {
    common: {
      primaryColor: p.brand,
      primaryColorHover: p.brandHover,
      primaryColorPressed: p.brandPressed,
      primaryColorSuppl: p.brandHover,
      warningColor: p.warn,
      errorColor: p.bad,
      textColorBase: p.ink,
      textColor1: p.ink,
      textColor2: p.ink,
      textColor3: p.muted,
      borderColor: p.line,
      dividerColor: p.line,
      fontFamily: fontSans,
      fontFamilyMono: fontMono,
      borderRadius: "6px",
      borderRadiusSmall: "4px",
    },
    Card: {
      borderRadius: "8px",
    },
  }
}
