# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebPreview is a web-based tutorial/challenge platform where users view tutorials and submit HTML/CSS/JS code for challenges. It has a Bun backend (`server/`) and a Vue 3 frontend (`client/`) in one repository, deployed via Docker Compose with Caddy as reverse proxy.

The backend was rewritten from Django in 2026-10 to cut memory use (~25 MB vs. 1–2 GB). It keeps Django's exact database schema (table names, column types, UTC `YYYY-MM-DD HH:MM:SS.ffffff` timestamps, 32-char hex UUIDs, `pbkdf2_sha256$...` password hashes) so old data loads unchanged. The Django code is in git history before that change.

## Architecture

- **`server/`** — Bun + **Hono** HTTP API, Bun's native WebSocket, **`bun:sqlite`** (single SQLite file, WAL). No Redis, no Postgres.
  - `src/index.ts` — `Bun.serve`: WebSocket upgrades go to `ws.ts`, everything else to the Hono app
  - `src/app.ts` — mounts routers under `/api/<prefix>`, CORS, Origin check on writes, session middleware, error → `{ detail }` JSON (ninja-compatible; validation errors are 422)
  - `src/db.ts` — schema (`CREATE TABLE IF NOT EXISTS`, same DDL as Django), `all/get/run/tx` helpers using `$name` params, time (`now()`, `iso()`) and UUID (`uuidHex()`, `uuidOut()`) conversions
  - `src/auth.ts` — Django-compatible password hashing, sessions in table `auth_session` (cookie `sessionid`), `requireUser/requireAdmin/requireSuper` (401 / 403)
  - `src/routes/` — `account`, `tasks` (tutorial / challenge / creation), `files` (task assets + image upload), `submission`, `showcase` (mounted under `/submission/showcase`), `prompt`
  - `src/services/` — `score.ts` (rating weights super×0.5, admin×0.3, normal×0.2, then Bayesian smoothing with C=3 and zones), `gradebook.ts`, `llm.ts` (OpenAI-compatible streaming via fetch; DeepSeek default, ARK for doubao models), `classifier.ts` (Bloom-level L1–L6 prompt tagging, runs in background), `cascade.ts` (Django's CASCADE deletes, done by hand), `pyround.ts` (`pyRound`/`pySum` reproduce Python's `round()` and `sum()` so scores match the old system bit-for-bit)
  - `src/ws.ts` — `/ws/prompt/<task_id>/` (code generation chat) and `/ws/guidance/<task_id>/` (prompt coaching); messages per connection are processed serially; on disconnect the pending user message is deleted and the LLM request aborted
  - `scripts/` — one-off CLIs: `migrate-from-postgres.ts`, `create-superuser.ts`, `classify-prompts.ts`, `recalculate-scores.ts`
  - Roles: `super`, `admin`, `normal`. Task model is multi-table: `task_task` + one of `task_tutorial` / `task_challenge` / `task_creation` (`task_ptr_id`)

- **`client/`** — Vue 3 + TypeScript SPA built with **Rsbuild**
  - UI framework: **Naive UI** (auto-imported via `unplugin-vue-components`)
  - `src/api.ts` — Axios-based API client; 401 clears login and goes home, 403 alerts and goes home
  - `src/router.ts` — Vue Router with auth guards
  - `src/store/` — Reactive state (plain Vue refs, not Vuex/Pinia); `prompt.ts` / `guidance.ts` own the WebSockets
  - `src/pages/`, `src/components/` — user management uses `components/dashboard/UserFormModal.vue` (there is no Django Admin anymore)

- **`Caddyfile`** — serves SPA from `build/` and `/media`, proxies `/api*` and `/ws*` to the backend
- **`docker-compose.yaml`** — `webpreview-web` (Caddy) and `webpreview-api` (Bun); `webpreview-db` (Postgres) exists only under the `migrate` profile for the one-time data migration
- **`.github/workflows/deploy.yaml`** — on push to `main`: build client, rsync to server `build/`, then `git pull && docker compose up -d --build` on the server

## Development Commands

```bash
./dev.sh                 # backend (bun --watch) + frontend together
```

### Server (from `server/`)
```bash
bun run dev              # dev server on :8000 with auto-reload
bun test                 # API + unit tests (in-memory SQLite, LLM disabled)
bun run typecheck
bun scripts/create-superuser.ts <username> <password>
bun scripts/classify-prompts.ts [--task-id N] [--force] [--dry-run]
bun scripts/recalculate-scores.ts [--dry-run]
```
Config comes from `server/.env` (see `server/.env.example`); dev DB is `server/data/db.sqlite3`, uploads go to the repo-root `media/`.

### Client (from `client/`)
```bash
npm run start        # Dev server (Rsbuild) on :3000
npm run build        # Production build
npm run fmt          # Format with Prettier
```
Frontend env vars used at build time: `PUBLIC_BASE_URL`, `PUBLIC_WS_URL`, `PUBLIC_WEB_URL` (dev proxy target for `/media` and `/ws`).

### Docker (from project root)
```bash
docker compose up -d --build
docker compose run --rm webpreview-api bun scripts/create-superuser.ts <username> <password>
```

## Key Technical Details

- **Schema changes**: there is no migration framework. Edit the DDL in `src/db.ts` for new tables; for altering existing tables add an idempotent step guarded by `PRAGMA user_version`
- **SQL style**: raw SQL with named params (`$id`), `strict: true` so params are passed without the `$` prefix (`{ id }`). Wrap multi-statement writes in `tx()`. Deleting tasks/submissions must go through `services/cascade.ts`
- **API compatibility**: response shapes, status codes and trailing-slash tolerance (`strict: false`) mirror the old django-ninja API, so the client needed no changes besides user management. Paginated endpoints take `page` / `page_size` (default 10, max 100) and return `{ items, count }`
- **Task `display` field**: integer used as URL slug for tutorials/challenges/creations (unique per task type), not the DB `id`
- **Submission / conversation IDs**: UUIDs in the API, 32-char hex in the DB
- Language/locale is Chinese; timestamps are stored in UTC and returned as ISO strings ending in `Z`
- Client build output is served by Caddy from `build/` in production
