# Dayline — Backend

FastAPI backend for Dayline, a role-based task scheduling / time-tracking app. The org hierarchy drives visibility, task assignment is open to any user, and a live day-timeline
tracks actual work sessions (pick / hold / resume / done) with automatic overdue handling.

See `../docs/plan.md` for the full feature inventory and `../docs/pending.md`
for open work.

## Tech stack

- FastAPI + Uvicorn, SQLAlchemy 2, Pydantic v2
- PostgreSQL (falls back to a local SQLite file if `DATABASE_URL` is unset — dev convenience only)
- Redis — Celery broker/result backend, plus the session-token store
- Celery + Celery Beat — periodic overdue-task sweep (replaces the old in-process asyncio loop)
- Alembic — schema migrations
- Sentry (optional), Slack/email/web-push notifications (all optional, unset env var = silent no-op)

## Local setup (without Docker)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env   # fill in real values — see comments in the file
```

Without a `DATABASE_URL`, the app falls back to a local SQLite file — fine for a quick look,
not representative of production behavior (foreign keys, timestamptz, etc. assume Postgres).

Run the API:

```bash
uvicorn main:app --reload
```

Run the Celery worker + beat (needed for the overdue sweep and any async work — requires Redis running):

```bash
celery -A celery_app.celery_app worker --loglevel=info
celery -A celery_app.celery_app beat --loglevel=info
```

Interactive API docs: `http://localhost:8000/docs` (Swagger) or `/redoc`.

## Docker

Two compose files — **do not use `docker-compose.yml` in production**, it bind-mounts the
source tree and runs `uvicorn --reload`, and `docker-compose.prod.yml` refuses to start
without real secrets (no baked-in defaults).

```bash
# Dev — bind-mounted source, auto-reload, includes pgAdmin
cp .env.example .env   # fill in values; POSTGRES_PASSWORD/PGADMIN_DEFAULT_* are required
docker compose up

# Prod — immutable image, no pgAdmin, every secret required or the container refuses to start
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

Both stacks run `taskboard_backend`, `taskboard_db` (Postgres), `taskboard_redis`,
`taskboard_celery_worker`, and `taskboard_celery_beat`; dev additionally runs `pgadmin`.

## Database migrations

A single baseline revision, `0001_initial_schema`, creates the whole schema on an empty
database (Postgres or SQLite):

```bash
alembic upgrade head
```

Existing databases created by the old migration chain (`8d840365c088` .. `0015_add_is_onboarded`,
kept for reference in `alembic/legacy_versions/`) already have this schema once they are at
`0015_add_is_onboarded`. Bring them to 0015 first if needed (temporarily point
`version_locations` at `alembic/legacy_versions`), then record the new baseline:

```bash
alembic stamp --purge 0001_initial_schema
```

New schema changes go in new revisions on top of `0001_initial_schema`
(`alembic revision --autogenerate -m "..."`); `alembic check` should report no drift.

Load the fictional demo org (Quillbrook Labs) (⚠️ **wipes existing users/tasks**):

```bash
python seed_demo.py           # dry run
python seed_demo.py --yes     # loads seed/quillbrook_labs.json; default password ChangeMe123!
```

## Tests & linting

```bash
pip install -r requirements-dev.txt
pytest -q                    # 111 tests
ruff check .                 # minimal correctness-only baseline (E9, F) — see pyproject.toml
```

The ruff config is deliberately narrow: ~330 pre-existing findings under the broader default
rule set were left untriaged rather than fixed as a side effect of turning on linting. Widen
the `select` list in `pyproject.toml` as its own reviewed cleanup pass, not casually.

## Environment variables

See `.env.example` for the full list with comments. Everything except `DATABASE_URL` (and, in
Docker, the Postgres/pgAdmin credentials) is optional — unset means the corresponding feature
(email, Slack, web-push, Sentry) silently no-ops rather than failing.

## Project layout

- `main.py` — FastAPI app, all HTTP routes, WebSocket endpoint
- `models.py` — SQLAlchemy models + Pydantic schemas, DB session setup
- `permissions.py` — central RBAC: rank derivation, org-tree visibility, all authorization predicates
- `task_helpers.py` — pure scheduling/session helpers shared by `main.py` and the Celery task
- `celery_app.py` / `tasks_celery.py` — background jobs (overdue sweep, Celery Beat schedule)
- `email_util.py` / `slack_util.py` / `push_util.py` — notification channels
- `redis_client.py` — Redis connection (session store + Celery broker/backend)
- `alembic/` — schema migrations
- `tests/` — pytest suite (isolated SQLite DB per run, see `tests/conftest.py`)
