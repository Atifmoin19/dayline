# Dayline — Pending Work (`pending.md`)

**Only open work lives here.** Everything shipped — P0 security foundation, P1 robustness, the
P1.5 UI redesign (incl. the SuperAdmin restyle), the timeline actual-history redesign + all its
P1.6 follow-ups, real-time WebSocket, the RBAC matrix, foreign keys, the real HRIS org data,
Calendar view, editable profile + full org chart, the full P2 set (attachments, Slack,
saved views, web-push), 2026-07-26's **open task assignment** / **Jira-style task detail view**
/ **redesigned create-task modal** round, the leaked-token rotation + git-history purge (done on
the real repo/prod deployment), the **entire P3 set** (tests, CI/CD, dev/prod Docker split,
observability, Celery background jobs, branding, accessibility/mobile, README), the **entire
Future UI/analytics set** (capacity & utilization metrics, skillset tags, AI Insight panel,
Organization Resource View, Team Saturation Heatmap + Resource Efficiency Index), a
**platform-polish pass** (ruff lint widened + ~350 findings triaged, ESLint `any`/fast-refresh
debt fixed for real, frontend bundle code-split 983KB→51.79KB entry chunk, a live Celery
docker-compose smoke test, a genuine per-employee `timezone` field feeding `GET /capacity`), the
**"Must Have" AI-powered smart assignment/workload balancer**, and — 2026-07-27/28 — **subtask
creation + progress rollup** (the former deferred multi-assignee ask, resolved by decomposition)
— is documented in `plan.md` (the feature inventory). Nothing shipped is repeated here.

---

## P0 — remaining (blocked, no prod environment yet)

- [ ] **Run migration `0009` against prod Postgres.** Applied and verified against the real dev
  Postgres (confirmed `tasks.subtask_total`/`subtask_done`, `uq_task_links_edge`,
  `ck_task_links_type`, and both composite indexes landed, plus a live query through the app's
  own engine succeeds) — dev being caught up doesn't mean prod is. **2026-07-27: confirmed there
  is no prod deployment/DATABASE_URL yet** — this repo's `.env` only has a local Postgres
  connection string, nothing pointing at prod. Not actionable until a prod Postgres instance
  exists; when it does, follow the deployment checklist below in order (step 2).

---

## Known gaps (not blocking, worth a look)

- [ ] **SSO/OIDC (`sso_util.py`, plan.md §2/§12) has no IdP registered.** The generic OIDC
  client, `/auth/sso/*` endpoints, and frontend button are all shipped and covered by
  `tests/test_sso.py` (12 passing) — but `OIDC_ISSUER`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`
  are unset everywhere (dev and prod), so `GET /auth/sso/status` reports disabled and the
  button never shows. Needs someone to actually register this app with an IdP (Okta/Azure
  AD/Google Workspace) and set the four `OIDC_*` env vars — not a code gap, a credentials one.
- [ ] **Bulk task CSV upload (`/tasks/upload`) has no subtask column support.** Only
  `POST /tasks`'s `subtasks` field and `POST /tasks/{id}/subtasks` create subtasks; a CSV import
  can't stage them. Low priority — CSV task upload is a bulk/admin path, subtask creation is
  inherently a per-story, human-driven action.
- [ ] **No subtask-count/progress pill on Timeline/Week/Calendar chips.** Deliberate scope cut
  (those are dense, small-format renders where another badge would hurt more than help), not an
  oversight — but worth revisiting if a story's progress becomes something people want to see
  without opening the detail view.

---

## "Try the demo" sandbox (shipped 2026-10-31, follow-ups)

`POST /demo` (backend `DEMO_MODE_ENABLED=true`) + the login-page button (frontend
`VITE_DEMO_ENABLED=true`). Each visitor gets an isolated copy of Quillbrook Labs, tagged by
`workspace_id`, purged after `DEMO_TTL_HOURS` (on every `POST /demo` and hourly by the
`purge-expired-demo-workspaces` Celery Beat job). Demo users opening admin URLs are sent to
`/app` with a notice. Open follow-ups:

- [ ] **Idle logout inside a demo.** Sessions still expire after 15 minutes of inactivity; a
  visitor who comes back later must click "Try the demo" again and gets a new workspace
  (counts toward the per-IP limit). Consider a longer session TTL for demo users.
- [ ] **Set `DEMO_IP_SALT`** to a random value wherever the demo is public, and run behind a
  proxy that sets the real client address (`uvicorn --proxy-headers`), or every visitor
  shares one per-IP budget.

---

## Deployment — pending on your side (run on prod Postgres, in order)

1. `python fk_preflight_audit.py` — review orphan counts (read-only).
2. `alembic upgrade head` on a new database (the single `0001_initial_schema` baseline builds the
   whole schema). A database built by the old chain must first be at `0015_add_is_onboarded`,
   then `alembic stamp --purge 0001_initial_schema` (see `backend/README.md`). Also `pip install -r requirements.txt` (adds
   `pywebpush`, `sentry-sdk`, `celery`, `redis`, `google-genai`) and set on prod:
   `VAPID_PRIVATE_KEY`/`VAPID_PUBLIC_KEY`/`VAPID_CLAIMS_EMAIL` (mint separate prod keys, don't
   reuse the dev pair), `SENTRY_DSN`/`ENVIRONMENT` (optional), `GEMINI_API_KEY`(+`_2`/`_3`)/
   `GEMINI_MODEL` (optional, powers both `GET /insights` and its risk/rebalance fields — dev
   `.env` now has real keys, reused from another internal service's config, same pattern as this app's
   Mandrill SMTP keys; prod needs its own set the same way). See
   `backend/.env.example` for the full current list.
3. `python seed_demo.py` (dry run) → `--yes` — **wipes** old users/tasks and loads
   the 12 fictional demo users from `seed/quillbrook_labs.json`. Default password `ChangeMe123!`.
4. Prod needs Redis running as real infrastructure now (Celery broker/backend, not just a startup
   ping) — `docker-compose.prod.yml` already runs `taskboard_celery_worker` + `taskboard_celery_beat`
   alongside `taskboard_redis`; if deploying outside that compose file, stand up the worker + beat
   processes explicitly or the overdue sweep silently stops running (the old in-process asyncio
   loop it replaced is gone).

Until (2)+(3) run, the enriched HRIS fields are null on prod and avatars fall back to initials.

---

## Next up

Nothing queued beyond the P0 item above. Once migration `0009` runs on prod, this pass is fully
closed out.
