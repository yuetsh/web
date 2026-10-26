# Repository Guidelines

## Project Structure & Module Organization

WebPreview is a Django API plus Vue 3 client.

- `api/` contains the Django project. `api/api/` holds settings and URLs; feature apps live in `account/`, `task/`, `submission/`, `prompt/`, and `utils/`.
- `client/` contains the Vue 3 + TypeScript SPA. Route views are in `client/src/pages/`, shared UI in `client/src/components/`, state in `client/src/store/`, and helpers/types in `client/src/utils/`.
- `client/public/` stores browser assets. `build/`, `data/`, `media/`, and `redis/` are generated or runtime directories.
- `docs/` stores design and implementation plans.

## Build and Development Commands

- `./dev.sh`: starts the Django API and Rsbuild frontend together for local development.
- `cd api && uv run manage.py runserver`: run only the backend.
- `cd api && uv run manage.py migrate`: apply Django migrations.
- `cd client && npm run start`: start the frontend dev server.
- `cd client && npm run build`: create the production client build in `build/`.
- `cd client && npm run fmt`: format frontend source with Prettier.
- `docker compose up -d --build`: rebuild and start the Docker stack.

## Coding Style & Naming Conventions

Use 4-space indentation for Python and follow Django app conventions: models in `models.py`, handlers in `api.py` or router files, schemas in `schemas.py`, and migrations in `migrations/`. Use `snake_case` for functions and variables.

Frontend code uses Vue single-file components, TypeScript strict mode, and Prettier. Name components/pages in `PascalCase.vue`, and keep store modules domain-based, such as `submission.ts`.

## Commit & Pull Request Guidelines

This checkout lacks readable Git history, so use concise imperative commit messages such as `Add showcase management view`. Pull requests should describe the behavior change, list build/manual verification steps, link issues or plans, and include screenshots for visible UI changes.

## Security & Configuration Tips

Keep secrets in `.env` and do not commit credentials or generated runtime data. The API uses environment-driven settings for database, Redis, and LLM provider configuration.
