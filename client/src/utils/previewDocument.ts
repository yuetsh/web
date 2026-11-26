// 预览里跑的是用户写的代码（可能是别人的提交），不能给 allow-same-origin，
// 否则它和本站同源，能读 localStorage 里的登录 token
export const PREVIEW_SANDBOX =
  "allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock"

import { storageShim, type PreviewStorage } from "./previewStorage"

interface PreviewDocumentOptions {
  html: string
  css: string
  js: string
  assetBaseUrl?: string
  // 不传：localStorage 替身只存在内存里；传入：带上已存的数据并写回主页面；
  // false：不注入替身（下载成文件时用，浏览器里直接打开有真正的 localStorage）
  storage?: PreviewStorage | false
  // 游戏：先加载 Phaser、ZzFX、内置素材和辅助代码（public/game/runtime.js），画布铺满预览
  game?: boolean
}

// 改了 public/game 下的脚本就改这个版本号，浏览器才不会用缓存里的旧文件
const GAME_RUNTIME_VERSION = "1"

const GAME_HEAD = `<style>html,body{margin:0;height:100%;overflow:hidden;background:#000}</style>
    <script src="/game/vendor/phaser-4.2.1.min.js"><\/script>
    <script src="/game/vendor/zzfx-1.4.0.min.js"><\/script>
    <script src="/game/assets.js?v=${GAME_RUNTIME_VERSION}"><\/script>
    <script src="/game/runtime.js?v=${GAME_RUNTIME_VERSION}"><\/script>`

export function buildPreviewDocument({
  html,
  css,
  js,
  assetBaseUrl,
  storage,
  game,
}: PreviewDocumentOptions) {
  return `<!DOCTYPE html>
<html lang="zh-Hans-CN">
  <head>
    <meta charset="UTF-8" />
    ${storage === false ? "" : storageShim(storage)}
    <title>预览</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${assetBaseUrl ? `<base href="${assetBaseUrl}">` : ""}
    ${game ? GAME_HEAD : ""}
    <!-- normalize 要在学生的样式前面，否则同样写法的规则（body、h1 的边距等）会被它盖掉 -->
    <link rel="stylesheet" href="/normalize.min.css" />
    <style>${css}</style>
  </head>
  <body>
    ${html}
    <script>${js}<\/script>
  </body>
</html>`
}
