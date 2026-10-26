# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebPreview is a web-based tutorial/challenge platform where users view tutorials and submit HTML/CSS/JS code for challenges. It has a Django API backend and a Vue 3 frontend, deployed via Docker Compose with Caddy as reverse proxy.

## Architecture

- **`api/`** — Django backend using **django-ninja** for REST APIs and **Django Channels** (Daphne/ASGI) for WebSocket support
  - `api/api/` — Django project config (settings, urls, asgi)
  - `api/account/` — User auth (login/logout, profiles, batch creation). Three roles: `super`, `admin`, `normal` — affects scoring weights
  - `api/task/` — Tutorial and Challenge models (single `Task` base model with `task_type`), with separate `tutorial.py` and `challenge.py` router files
  - `api/submission/` — Code submission + `Rating` model. Submission score is a weighted average of ratings by role: super×0.5, admin×0.3, normal×0.2. `Profile.recalculate_total_score()` uses best-score-per-challenge
  - `api/prompt/` — LLM chat feature: WebSocket consumer streams DeepSeek responses, `Conversation`/`Message` models store history, code blocks extracted from responses
  - `api/utils/upload.py` — Image upload endpoint
  - API routers are registered in `api/api/urls.py` under `/api/` prefix
  - Uses `AUTH_USER_MODEL = "account.User"` (custom user model)
  - Dev mode uses SQLite (`ENV != "production"`); production uses PostgreSQL + Redis (sessions, caching, channel layers)

- **`client/`** — Vue 3 + TypeScript SPA built with **Rsbuild**
  - UI framework: **Naive UI** (auto-imported via `unplugin-vue-components`)
  - `src/api.ts` — Axios-based API client with CSRF and auth interceptors; exports `Account`, `Tutorial`, `Challenge`, `Submission`, `Prompt`, `Helper` objects
  - `src/router.ts` — Vue Router with auth guards; routes under `/dashboard` require login
  - `src/store/` — Reactive state (plain Vue refs, not Vuex/Pinia)
  - `src/pages/` — Route-level views (Home, Dashboard, ChallengeHome, TutorialEditor, ChallengeEditor, Submissions, Leaderboard, MyScores)
  - `src/components/` — Shared components: `Task.vue`, `Tutorial.vue`, `Challenge.vue`, `Editors.vue` (CodeMirror), `Preview.vue` (live HTML preview), `Toolbar.vue`, `PromptPanel.vue` (LLM chat)

- **`Caddyfile`** — Routes `/api*`, `/admin*`, `/ws*` to backend; serves SPA and static/media files
- **`docker-compose.yaml`** — Services: caddy, api, postgres, redis

## Development Commands

### Client (from `client/`)
```bash
npm run start        # Dev server (Rsbuild)
npm run build        # Production build
npm run fmt          # Format with Prettier
```

Frontend env vars used at build time: `PUBLIC_BASE_URL`, `PUBLIC_ADMIN_URL`, `PUBLIC_WS_URL`.

### API (from `api/`)
```bash
uv run manage.py runserver    # Dev server
uv run manage.py migrate      # Run migrations
uv run manage.py createsuperuser  # Create admin user
```
Uses `uv` for Python dependency management (`pyproject.toml` + `uv.lock`). Set `ENV=dev` in `.env` (default) for SQLite.

### Docker (from project root)
```bash
docker compose up -d          # Start all services
docker compose up -d --build  # Rebuild and start
```

## Key Technical Details

- **Backend API pattern**: each Django app has `api.py` (or named router files like `task/tutorial.py`, `task/challenge.py`) with django-ninja routers, plus `schemas.py` for Pydantic models. Routers mount under `/api/<prefix>/`
- **WebSocket**: `prompt/consumers.py` handles LLM chat at `ws://<host>/ws/prompt/<task_id>/`. Django Channels is configured; in dev, channel layer is in-memory (no Redis needed)
- **LLM config**: `LLM_API_KEY`, `LLM_BASE_URL` (default: DeepSeek), `LLM_MODEL` set via `.env`
- **Task `display` field**: integer used as URL slug for tutorials/challenges (unique per task type), not the DB `id`
- **Submission IDs**: UUIDs (not integers)
- Frontend dev server proxies `/media` to `PUBLIC_WEB_URL` env var; API calls go to `BASE_URL` defined in `src/utils/const.ts`
- Environment config via `.env` file in `api/` (referenced by docker-compose and Django's `python-dotenv`)
- Language/locale is Chinese (`zh-hans`, `Asia/Shanghai` timezone)
- Client build output goes to `build/` directory, served by Caddy in production
