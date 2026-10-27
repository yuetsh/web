# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebPreview is a web-based tutorial/challenge platform where users view tutorials and submit HTML/CSS/JS code for challenges. It is a Bun workspaces monorepo: a Bun backend (`server/`, package `webpreview-server`) and a Vue 3 frontend (`client/`, package `webpreview-client`) share one root `package.json` and one `bun.lock`, deployed via Docker Compose with Caddy as reverse proxy.

The backend was rewritten from Django in 2026-10 to cut memory use (~25 MB vs. 1–2 GB). It keeps Django's exact database schema (table names, column types, UTC `YYYY-MM-DD HH:MM:SS.ffffff` timestamps, 32-char hex UUIDs, `pbkdf2_sha256$...` password hashes) so old data loads unchanged. The Django code is in git history before that change.

## Architecture

- **`server/`** — Bun + **Hono** HTTP API, Bun's native WebSocket, **`bun:sqlite`** (single SQLite file, WAL). No Redis, no Postgres.
  - `src/index.ts` — `Bun.serve`: WebSocket upgrades go to `ws.ts`, everything else to the Hono app
  - `src/app.ts` — mounts routers under `/api/<prefix>`, CORS, auth middleware, error → `{ detail }` JSON (ninja-compatible; validation errors are 422)
  - `src/db.ts` — schema (`CREATE TABLE IF NOT EXISTS`, same DDL as Django), `all/get/run/tx` helpers using `$name` params, time (`now()`, `iso()`) and UUID (`uuidHex()`, `uuidOut()`) conversions
  - `src/auth.ts` — Django-compatible password hashing; JWT login, no cookies: `POST /account/login` returns a 15-min HS256 `access_token` (sent as `Authorization: Bearer`, signed with `JWT_SECRET`, random per process if unset) and a 14-day opaque `refresh_token` (only its sha256 is stored, in `auth_refresh_token`; `POST /account/refresh` trades it for a new access token, logout / password change / deactivation delete it). An invalid or expired Bearer token is a 401 even on public endpoints so the client knows to refresh. `requireUser/requireAdmin/requireSuper` (401 / 403)
  - `src/routes/` — `account`, `tasks` (tutorial / challenge / creation), `files` (task assets + image upload), `submission`, `showcase` (mounted under `/submission/showcase`), `review` (mounted under `/submission/review`: teacher class × task wall, students' same-class peer works), `prompt`
  - Who can read a submission (`canView` in `routes/submission.ts`): staff, the owner, anyone if it's in the showcase, or a same-class student who has submitted the same task. Students' `GET /submission/` only lists their own. Peer works and the random-rating item are anonymous until the viewer rates them (`PUT /:id/score` returns the author). `flag` now only carries `present` (teacher's in-class presentation queue); the old four colors are no longer shown
  - `src/services/` — `score.ts` (rating weights super×0.5, admin×0.3, normal×0.2, then Bayesian smoothing with C=3 and zones), `gradebook.ts`, `llm.ts` (OpenAI-compatible streaming via fetch; DeepSeek default, ARK for doubao models; chat context is the last 20 messages with older code blocks elided), `classifier.ts` (Bloom-level L1–L6 prompt tagging, runs in background), `cascade.ts` (Django's CASCADE deletes done by hand, plus the shared delete rules: `hasRatingsOrAwards`, `deleteRound`), `pyround.ts` (`pyRound`/`pySum` reproduce Python's `round()` and `sum()` so scores match the old system bit-for-bit)
  - `src/ws.ts` — `/ws/prompt/<task_id>/?token=<access_token>` (code generation chat; the AI context and the page's chat include `conversation`, `edit` and `manual` messages) and `/ws/guidance/<task_id>/?token=...` (prompt coaching); one message per connection at a time (a message sent while the AI is still replying gets an error, payloads capped at 64 KB); on disconnect the pending user message is deleted and the LLM request aborted
  - `scripts/` — one-off CLIs: `create-superuser.ts`, `classify-prompts.ts`, `recalculate-scores.ts`
  - Roles: `super`, `admin`, `normal`. Task model is multi-table: `task_task` + one of `task_tutorial` / `task_challenge` / `task_creation` (`task_ptr_id`)

- **`client/`** — Vue 3 + TypeScript SPA built with **Vite**; Bun is the package manager and runtime (no Node/npm)
  - `vite.config.ts` — browser targets are Chrome ≥ 87 (lab machines run Chrome 105); `@vitejs/plugin-legacy` only injects usage-based core-js polyfills, no legacy chunks
  - UI framework: **Naive UI** (auto-imported via `unplugin-vue-components`)
  - `src/token.ts` — tokens in localStorage; refreshes the access token shortly before expiry (one request at a time) and builds WebSocket URLs
  - `src/api.ts` — Axios-based API client; adds the Bearer header, on 401 refreshes once and retries, otherwise clears login and goes home; 403 alerts and goes home
  - `src/router.ts` — Vue Router; `meta.auth` needs login, `meta.role` (`staff` = admin+super, `super`) is checked in the guard after `store/session.loadUser()`, `meta.bare` pages render without the top bar
  - `src/theme.ts` — the only place colors are defined: one palette (light + dark values) becomes both `--wp-*` CSS variables and Naive UI `themeOverrides`; use `var(--wp-...)` in styles, never hard-coded colors (iframes stay white: they show students' pages). No `color-mix()` (Chrome 105). `store/theme.ts` holds the mode (auto / light / dark, toggled in the top bar) and sets `data-theme` on `<html>`; `styles/dark-content.css` is generated from the GitHub dark markdown and highlight.js styles (selectors prefixed with `:root[data-theme="dark"]`); CodeMirror uses One Dark highlighting in dark mode
  - `src/icons.ts` — `<Icon icon="lucide:name" />` renders bundled `lucide-vue-next` icons (works offline); register new names in its map. Fonts are bundled too (`@fontsource/jetbrains-mono`)
  - `components/workbench/Workbench.vue` — shared challenge / creation page: left = brief + AI chat (`PromptPanel`), right = preview / code (`CodeTabs`) + `VersionBar`. Every assistant message with code is a version; hand edits and pasted external-AI code are saved as versions via `POST /prompt/versions` (`source` `edit` / `manual`, stored as a user+assistant pair). Challenges are submitted only when the student clicks “交这一版” (`POST /submission/` with `message_id`), never automatically. Editor code is per task (`composables/useTaskCode.ts`, localStorage `web-code:<user>:<task>`); the tutorial page edits the shared `store/editors.ts` refs but `Workspace.vue` saves them under the same per-task key and `TutorialContent` restores them (example code only the first time)
  - `pages/ChallengeHome.vue` — challenge list page; `pages/TaskEditor.vue` (prop `kind`) is the single tutorial / challenge authoring page
  - `pages/Review.vue` (“批改”, default teaching page) + `components/review/ReviewPanel.vue` (also opened from the gradebook) — keys: J/K next/prev student, 1–5 rate, P present; `components/review/PeersDrawer.vue` is the students' “同学作品”
  - `components/layout/AppShell.vue` — top bar for every page; `pages/Dashboard.vue` is the teaching sidebar (“教学”) under `/dashboard`
  - `src/store/` — Reactive state (plain Vue refs, not Vuex/Pinia); `prompt.ts` / `guidance.ts` own the WebSockets
  - `src/pages/`, `src/components/` — user management uses `components/dashboard/UserFormModal.vue` (there is no Django Admin anymore)

- **`Caddyfile`** — serves SPA from `build/` and `/media`, proxies `/api*` and `/ws*` to the backend
- **`docker-compose.yaml`** — `webpreview-web` (Caddy) and `webpreview-api` (Bun); the API reads the repo-root `.env` via `env_file` (`server/.env` is only for local dev). The one-time Postgres → SQLite migration (script, `webpreview-db` service, `docs/migrate-to-bun.md`) was removed after commit `cdeb7c1`; restore it from there if another server still needs the cutover
- **`.github/workflows/deploy.yaml`** — on push to `main`: build client with Bun, rsync to server `build/`, then `git pull && docker compose up -d --build` on the server

## Development Commands

From the repo root (each script runs inside its workspace, via `bun run --filter`):
```bash
bun install              # installs both workspaces into the single root bun.lock
bun run dev              # backend (bun --watch, :8000) + frontend (Vite, :3000) together
bun run build            # client production build (build:staging for the school server)
bun run test             # server tests
bun run typecheck        # server (tsc 7) + client (vue-tsc) typecheck
bun run fmt              # format the client
```
Add a dependency from inside its workspace (`cd client && bun add x`); the lockfile is still the root one.

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
bun run dev          # Dev server (Vite, run on the Bun runtime) on :3000
bun run build        # Production build (bun run build:staging for the school server)
bun run typecheck    # vue-tsc; the client pins TypeScript 5.9 because vue-tsc can't run on TS 7 (the server uses TS 7)
bun fmt              # Format with Bun's built-in formatter (config in bunfig.toml)
```
Frontend env vars used at build time: `PUBLIC_BASE_URL`, `PUBLIC_WS_URL`, `PUBLIC_WEB_URL` (dev proxy target for `/media` and `/ws`).

### Docker (from project root)
`server/Dockerfile` builds with the repo root as context (so it can use the root `bun.lock`) and installs only the server workspace; `.dockerignore` is an allowlist, so new top-level server files must be added there.
```bash
docker compose up -d --build
docker compose run --rm webpreview-api bun scripts/create-superuser.ts <username> <password>
```
Back up production by copying `sqlite/` (or `sqlite3 sqlite/db.sqlite3 ".backup backup.sqlite3"`).

## Key Technical Details

- **Schema changes**: there is no migration framework. Edit the DDL in `src/db.ts` for new tables; for altering existing tables add an idempotent step guarded by `PRAGMA user_version`
- **SQL style**: raw SQL with named params (`$id`), `strict: true` so params are passed without the `$` prefix (`{ id }`). Wrap multi-statement writes in `tx()`. Deleting tasks/submissions must go through `services/cascade.ts`
- **Queries block the whole server**: `bun:sqlite` is synchronous in a single process, so a slow query stalls every HTTP request and WebSocket. Request-path queries must take milliseconds; batch work goes in `scripts/`. Never `await` inside `tx()` (it would commit early). Code with no `await` runs atomically, so read-check-write needs no locking; races only happen across an `await`
- **Wide rows**: unlike Postgres (TOAST), SQLite keeps `html/css/js` and `prompt_message.content/code_*` inline, and Django's column order puts `user_id`, `task_id`, `flag`, `zone`, `raw_score` *after* them, so reading those columns from the table reads the whole code. List/scan queries must not select the big columns: page on indexes first (select `rowid`s with `ORDER BY ... LIMIT`), then fetch full rows for just that page (see `GET /submission/`, `random-for-rating`)
- **Indexes**: SQLite uses one index per table for AND conditions (no BitmapAnd), so multi-column filters need a composite index (equality columns first, then range/sort). Hot scans on `submission_submission` must be covered by `submission_submission_slim`; compare `rowid` rather than `id` (`id` is a separate index). The planner only has stats via `PRAGMA optimize` (run on open and hourly), and may pick a poor single-column index — check new queries with `EXPLAIN QUERY PLAN` (no `SCAN` of big tables, ideally `COVERING INDEX`); a unary `+` (`+s.zone = $zone`) stops a column's index from being used. `CREATE INDEX IF NOT EXISTS` matches by name only, so a changed index needs a new name (drop the old one in a `user_version` step)
- **Types**: booleans are `0/1`; timestamps are text compared as strings, so only write values from `now()` (never `CURRENT_TIMESTAMP` / `datetime('now')`); text sorts by code point; `ORDER BY ... ASC` puts NULLs first (Postgres: last), so add `NULLS LAST` where it matters; no `ILIKE` / `DISTINCT ON`
- **API compatibility**: response shapes, status codes and trailing-slash tolerance (`strict: false`) mirror the old django-ninja API, so the client needed no changes besides user management. Paginated endpoints take `page` / `page_size` (default 10, max 100) and return `{ items, count }`
- **Task `display` field**: integer used as URL slug for tutorials/challenges/creations (unique per task type), not the DB `id`
- **Submission / conversation IDs**: UUIDs in the API, 32-char hex in the DB
- Language/locale is Chinese; timestamps are stored in UTC and returned as ISO strings ending in `Z`
- Client build output is served by Caddy from `build/` in production
