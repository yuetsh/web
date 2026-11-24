# 机房（debian114）

机房那台**不跑后端**：只有一个 Caddy，放 `build:staging` 构建的前端，`/api`、`/ws` 反代到
`https://web.xuyue.cc`。数据只有服务器上那一份 SQLite，两边的账号、任务、作品完全一致。

- 学生机出不了外网，是机房那台替它们连服务器（走 `192.168.1.1` 那条线）。那条线断了，机房的 WebPreview 就用不了。
- `/media` 先读本地 `./media`（Syncthing 从服务器同步过来），没有的再找服务器要。
- 学生访问 `http://10.13.114.114:91`。服务器后端默认的 `ALLOWED_ORIGINS` 已经包含这个地址。

平时 push 到 origin 的 main，`.gitea/workflows/deploy.yml` 会顺带部署机房。手动部署（机房那台在 `/root/WebPreview`，`ssh fschool` 经服务器跳板进去）：

```bash
bun run build:staging
tar -C client/dist -czf /tmp/wp-build.tgz .
scp school/Caddyfile school/docker-compose.yaml /tmp/wp-build.tgz fschool:/root/WebPreview/
ssh fschool 'cd /root/WebPreview && rm -rf build && mkdir build && tar -C build --no-same-owner -xzf wp-build.tgz && rm wp-build.tgz && docker compose up -d && docker compose restart'
```

只改了后端的话机房不用动。
