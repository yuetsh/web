#!/bin/bash

ROOT="$(cd "$(dirname "$0")" && pwd)"

# 启动后端
cd "$ROOT/api" || exit 1
uv run manage.py runserver &
BACKEND_PID=$!

# 启动前端
cd "$ROOT/client" || exit 1
npm run start &
FRONTEND_PID=$!

# 捕获退出信号，同时终止两个进程
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM

wait
