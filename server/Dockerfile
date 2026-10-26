# 构建上下文是仓库根目录（见 docker-compose.yaml），只装 server 这个 workspace 的依赖
FROM oven/bun:1.4.4-alpine

WORKDIR /app

# 国内服务器用 npmmirror 加速
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV BUN_CONFIG_REGISTRY=$NPM_REGISTRY

COPY package.json bun.lock ./
COPY client/package.json client/
COPY server/package.json server/
RUN bun install --frozen-lockfile --production --filter webpreview-server

WORKDIR /app/server
COPY server/tsconfig.json ./
COPY server/src ./src
COPY server/scripts ./scripts

ENV ENV=production \
    PORT=8000 \
    DB_PATH=/app/data/db.sqlite3 \
    MEDIA_ROOT=/app/media

EXPOSE 8000

CMD ["bun", "run", "src/index.ts"]
