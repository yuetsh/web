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
