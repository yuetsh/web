FROM oven/bun:1.4.4-alpine

WORKDIR /app

# 国内服务器用 npmmirror 加速
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV BUN_CONFIG_REGISTRY=$NPM_REGISTRY

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

ENV ENV=production \
    PORT=8000 \
    DB_PATH=/app/data/db.sqlite3 \
    MEDIA_ROOT=/app/media

EXPOSE 8000

CMD ["bun", "run", "src/index.ts"]
