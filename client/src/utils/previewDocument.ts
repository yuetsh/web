// 预览里跑的是用户写的代码（可能是别人的提交），不能给 allow-same-origin，
// 否则它和本站同源，能读 localStorage 里的登录 token
export const PREVIEW_SANDBOX =
  "allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock"

interface PreviewDocumentOptions {
  html: string
  css: string
  js: string
  assetBaseUrl?: string
}

export function buildPreviewDocument({
  html,
  css,
  js,
  assetBaseUrl,
}: PreviewDocumentOptions) {
  return `<!DOCTYPE html>
<html lang="zh-Hans-CN">
  <head>
    <meta charset="UTF-8" />
    <title>预览</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${assetBaseUrl ? `<base href="${assetBaseUrl}">` : ""}
    <style>${css}</style>
    <link rel="stylesheet" href="/normalize.min.css" />
  </head>
  <body>
    ${html}
    <script>${js}<\/script>
  </body>
</html>`
}
