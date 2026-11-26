// 生成 public/game/assets.js：游戏预览要用的素材清单，图集以 base64 内嵌。
// 预览是沙箱 iframe（来源和网站不同），从网站加载的图片画进 WebGL 会被浏览器拦下（跨域“污染”），
// 内嵌成 data: URL 就没有这个问题。改了 assets.json 或 sheets/ 之后运行：bun scripts/game-assets.ts
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const dir = join(import.meta.dir, "..", "public", "game")
const catalog = JSON.parse(readFileSync(join(dir, "assets.json"), "utf8"))

const sheets: Record<string, { size: number; cols: number; data: string }> = {}
for (const [name, s] of Object.entries<{ file: string; size: number; cols: number }>(catalog.sheets)) {
  const png = readFileSync(join(dir, s.file)).toString("base64")
  sheets[name] = { size: s.size, cols: s.cols, data: `data:image/png;base64,${png}` }
}
const sprites = catalog.groups.flatMap((g: any) =>
  g.sprites.map((s: any) => ({ name: s.name, sheet: s.sheet, frames: s.frames })),
)
const backgrounds = catalog.backgrounds.map(({ desc: _, ...b }: any) => b)

const out = `// 由 scripts/game-assets.ts 根据 assets.json 生成，不要手改
window.__WP_GAME_ASSETS = ${JSON.stringify({ sheets, sprites, backgrounds })};
`
writeFileSync(join(dir, "assets.js"), out)
console.log(`assets.js: ${sprites.length} sprites, ${backgrounds.length} backgrounds, ${(out.length / 1024).toFixed(1)} KB`)
