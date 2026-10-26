interface ImportMetaEnv {
  readonly PUBLIC_WEB_URL: string
  readonly PUBLIC_BASE_URL: string
  readonly PUBLIC_ADMIN_URL: string
  readonly PUBLIC_MAXKB_URL: string
  readonly PUBLIC_ICONIFY_URL: string
  readonly PUBLIC_WS_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
