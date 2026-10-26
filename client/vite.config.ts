import { defineConfig, loadEnv } from "vite"
import vue from "@vitejs/plugin-vue"
import legacy from "@vitejs/plugin-legacy"
import Components from "unplugin-vue-components/vite"
import { NaiveUiResolver } from "unplugin-vue-components/resolvers"

// 与原来 Rsbuild 默认的浏览器范围一致；机房电脑是 Chrome 105
const targets = ["chrome >= 87", "edge >= 88", "firefox >= 78", "safari >= 14"]

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "PUBLIC_")
  return {
    plugins: [
      vue(),
      Components({ resolvers: [NaiveUiResolver()] }),
      // 只按需注入 core-js（toSorted 等新 API），不生成给不支持 ES 模块的旧浏览器用的包
      legacy({ modernTargets: targets, modernPolyfills: true, renderLegacyChunks: false }),
    ],
    // 沿用 Rsbuild 时期的 PUBLIC_ 前缀
    envPrefix: "PUBLIC_",
    server: {
      port: 3000,
      proxy: {
        "/media": {
          target: env.PUBLIC_WEB_URL,
          changeOrigin: true,
        },
        "/ws": {
          target: env.PUBLIC_WEB_URL,
          ws: true,
          changeOrigin: true,
        },
      },
    },
  }
})
