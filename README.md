# TaskBoard

Role-based task scheduling and time tracking: live day timeline with work sessions,
task detail view, epics, sprints, org chart and capacity insights.

- `frontend/`: React 19 + TypeScript + Vite + Chakra UI v2 + RTK Query
- `backend/`: FastAPI + SQLAlchemy 2 + Alembic (Postgres, SQLite fallback), Redis, Celery
- `docs/`: planning notes, open work (`pending.md`) and known bugs (`bugs.md`)

## Quick start

```bash
# backend (SQLite fallback, no Redis needed for a first look)
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env            # optional; set API_ROOT_PATH= to call uvicorn directly
.venv/bin/python seed_demo.py --yes   # loads the fictional "Quillbrook Labs" demo org
.venv/bin/uvicorn main:app --port 8052

# frontend
cd frontend
npm install
cp .env.example .env.local
npm run dev                     # http://localhost:5173/
```

Demo logins: any of `QB0001`..`QB0012`, password `ChangeMe123!` (see `backend/seed/quillbrook_labs.json`).
All seed data is fictional.
