# 服务器切换到 Bun 后端（一次性）

后端从 Django + Postgres + Redis 换成了 Bun + SQLite，前后端也合并成了一个仓库
（`git.xuyue.cc:xuyue/web.git` / `github.com/yuetsh/web`）。
每台服务器（debian、school）都要按下面的步骤做一次，之后 push 到 `main` 就会自动部署。

切换时所有人需要重新登录一次（旧的登录会话在 Redis 里，不迁移）。密码不受影响。

## 0. GitHub 仓库设置

在 `yuetsh/web` 的 Settings → Secrets and variables → Actions 里添加和旧仓库一样的 `KEY`、`HOST`。

## 1. 备份

```bash
cd /root/WebPreview
docker compose exec webpreview-db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > /root/webpreview-$(date +%F).sql
```

`data/`（Postgres 数据目录）在整个过程中不会被修改，出问题可以随时回退。

## 2. 把目录变成新仓库的 clone

```bash
cd /root/WebPreview
git init -b main
git remote add origin git@git.xuyue.cc:xuyue/web.git
git fetch origin
git reset origin/main      # 只建立 git 记录，不改动现有文件
git checkout -- .          # 用仓库里的 docker-compose.yaml、Caddyfile 等覆盖旧文件
mv api /root/webpreview-api-old   # 旧的 Django 后端，确认没问题后可删
git status                 # 应该是干净的（.env、data/、build/、media/ 都被忽略）
```

## 3. 迁移数据（Postgres → SQLite）

找一个没人用的时间做，先停掉旧后端，避免迁移期间有新数据写进 Postgres：

```bash
docker stop webpreview-api
docker compose --profile migrate up -d webpreview-db     # 旧库本来就在运行的话不会有变化
docker compose build webpreview-api
docker compose run --rm --no-deps webpreview-api bun scripts/migrate-from-postgres.ts
```

脚本会逐表打印行数并做外键检查，最后输出 `导入完成` 才算成功。数据库文件在 `./sqlite/db.sqlite3`。
`.env` 里原有的 `POSTGRES_*` 变量就是脚本要用的，不需要改。

## 4. 启动新服务

```bash
docker compose up -d --remove-orphans      # 启动 Caddy + Bun，顺带删掉不再需要的 Redis 容器
docker compose --profile migrate stop webpreview-db
docker stats --no-stream                   # webpreview-api 应该在几十 MB
```

打开网站登录确认一下。之后就可以 `docker compose --profile migrate rm webpreview-db`，
`data/` 目录建议留一段时间再删（属主是容器里的 postgres 用户，需要 root 才能删）。

## 回退

```bash
docker compose down
mv /root/webpreview-api-old api
git show 47d4679:docker-compose.yaml > docker-compose.yaml
git show 47d4679:Caddyfile > Caddyfile
docker compose up -d --build
```

## 以后的日常操作

- 部署：push 到 `main`，GitHub Actions 会构建前端并在服务器上 `git pull && docker compose up -d --build`
- 新建超级管理员：`docker compose exec webpreview-api bun scripts/create-superuser.ts <用户名> <密码>`
- 补标注提示词层级：`docker compose exec webpreview-api bun scripts/classify-prompts.ts`
- 备份：复制 `sqlite/` 目录即可（或 `sqlite3 sqlite/db.sqlite3 ".backup backup.sqlite3"`）
