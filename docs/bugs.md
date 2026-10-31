# TaskBoard — Bugs & Glitches (`bugs.md`)

Issues in the codebase, grouped by severity/type. Audited 2026-07-25. **Fix pass 2026-07-25.**

**Status legend:** ✅ fixed · 🟡 partial · ⬜ open (tracked in `pending.md`)

**Summary:** after fix passes + full P0/P1 work and the 2026-10-31 revive pass, the large majority are fixed. Still open (⬜): S5 open self-registration, docker-compose dev config, README depth, scheduler `as any`. 🟡 partial: sweeper race.

---

## 🔴 Security (Critical)

| # | Status | Issue | Location |
|---|--------|-------|----------|
| S1 | ✅ | **Plaintext passwords** — now bcrypt-hashed (`security.py`); login verifies + auto-upgrades legacy plaintext. Existing rows migrated (`hash_existing_passwords.py`), all reset to hashed default. | `main.py` login/register/create/upload |
| S2 | ✅ | **Committed secrets** — this repo was re-imported clean: no `foundation.csv`, `users.csv`, `.env` or `*.db` files, and `.gitignore` blocks them. Any credentials that lived in the old repository must still be treated as leaked and rotated there. | repo root |
| S3 | ✅ | **Unauthenticated user endpoints** — all now require a token; mutations require admin (`require_admin`, rank ≥ L2). | `main.py` `/user*` |
| S4 | ✅ | **No authz on task delete** — now checks assignee/assigner/admin/manager-in-scope. | `main.py` `delete_task` |
| S5 | ⬜ | **Open self-registration** — anyone can still register from the login screen. Needs invite/admin gating. | `login.tsx:44-71` |
| S6 | ✅ | **CORS wildcard `"*"` + credentials** — replaced with explicit origins + localhost regex, no wildcard. | `main.py` CORS |
| S7 | ✅ | **Hardcoded static CSP nonce** — now generated per page load. | `main.tsx` |
| S8 | ✅ | **No rate limiting** — slowapi 10/min on `/login` + `/register`. | `main.py` |

---

## 🟠 Correctness / Data Integrity

- ✅ **Datetimes stored as `String(32)`** — migrated to `DateTime(timezone=True)`/`timestamptz`; code uses aware UTC datetimes; `response()` serializes via `jsonable_encoder`. Also fixed a latent bug where `PATCH /tasks/{id}/status` never persisted `task_status`. — `models.py`, `main.py`
- ✅ **Frontend fabricated task id** — removed; backend generates the id, Redux stores the server task. — `TaskCreationModal.tsx`
- ✅ **Frontend overrides backend `task_sessions`** — backend is server-authoritative (overwrite line stays disabled; sessions managed by `start/close_current_session`). — `main.py`
- ✅ **Two sources of truth for tasks** — `TaskListingView` now reads Redux + paginates client-side; its duplicate `/tasks` fetch removed. Single fetch per page feeds both list + timeline.
- ✅ **`TaskListingView` ignored `filteredManagerId`** — now maps to the `user_id` query param. — `TaskListingView.tsx`
- ✅ **Empty-state `colSpan={6}` vs 7 columns** — fixed to 7. — `TaskListingView.tsx`
- ✅ **Pagination `page` not reset** on filter/user change — reset effect added. — `TaskListingView.tsx`
- ✅ **Role mismatch** — `OWNER`/`SUPERADMIN` added to `SUPER_ADMIN_ROLES`. — `constants.ts`
- ✅ **Unknown designation → empty user table** — empty-state message added. — `UserManagementPage.tsx`
- ✅ **Wrong sample CSV for tasks** — new `sample_task_creation.csv` asset. — `CreateTaskPage.tsx`
- ✅ **`getAssignee` deep-link "Unassigned"** — the directory is now loaded once for every authed route by `useUserDirectorySync` (mounted in `ProtectedRoute`); pages no longer fetch it themselves. — `hooks/useUserDirectorySync.ts`, `AppRouter.tsx`

---

## 🟡 Error / Loading Handling

- ✅ **Mutations without loading guard** — `isLoading` + `loadingText` on create-task/create-user/update-user/modal buttons (no double-submit).
- ✅ **Create/update no error toast** — error toasts added on both paths. — `TaskCreationModal.tsx`
- ✅ **`handleLogout` no `.catch`** — resets store on success or failure now. — `Header.tsx`
- ✅ **Login catch hides server message** — surfaces server message. — `login.tsx`
- ✅ **No global error boundary / 404 route** — `ErrorBoundary` wraps the app; catch-all `*` route renders `NotFound`.

---

## ⚪ Dead / Foreign Code

- ✅ **`useAutoFill.tsx`** (foreign BOB code) — deleted.
- ✅ **`simpleLayout.tsx` no-op string import** — removed.
- ✅ **Duplicated line** in `TimelineView.tsx` — removed.
- ✅ **Commented decrypt block + `baseUrl` comment** in `baseQuery.ts` — removed.
- ✅ **Dead `localStorage["timeline_view_date"]` write** — removed.
- ✅ **`console.log` in prod paths** — removed (dashboard, baseQuery, login, modal).
- ✅ **Branding inconsistency** — one name, "TaskBoard", across UI, docs, comments and tests (final product name TBD).

---

## 🔵 Backend Structure / Ops

- ✅ **No migration framework** — Alembic scaffolded + baseline stamped; the 11 ad-hoc scripts moved to `legacy_migrations/` (with `fix_schema.py` already guarded). Schema changes now go through `alembic revision`/`upgrade`.
- ✅ **SQLite silently used** if `DATABASE_URL` unset — `models.resolve_database_url` now logs a warning, and refuses SQLite outright when `ENVIRONMENT=production` (Alembic uses the same resolver). — `models.py`, `tests/test_database_url.py`
- ✅ **Redis pinged but unused** — now the primary session store (sliding-TTL sessions), with a cached client.
- ⬜ **docker-compose ships dev config** — bind-mount/`--reload`, default pgAdmin creds, hardcoded pwd. → `pending.md` P3.
- ✅ **Bare `except:`** in `remaining_seconds` — narrowed to `(ValueError, TypeError)`. — `models.py`
- ✅ **N+1 recursion** in `get_all_subordinates` — replaced with a single query + in-memory tree walk (cycle-safe).
- 🟡 **Race conditions** — `with_for_update()` row locks added on session/status/delete task fetches + the auto-hold query, closing the read-then-write window. The 60s sweeper still runs unlocked against sibling rows (acceptable; full serialization deferred).
- ✅ **Unpinned `requirements.txt`** — all deps version-pinned.
- ⬜ **README stub** — no setup docs. → `pending.md` P3.
- ✅ **`print` debugging** in `redis_client.py` — → logging.

---

## ⚡ Performance

- ✅ **`Header.pendingCount`** — memoized (`useMemo` on tasks/currentUser/config).
- ✅ **`TimelineView` 60-day `calculateSchedule`** reran every minute tick — the tick now only reaches the memo while a session is live (plus a day-rollover key), via `Utils/scheduleRefresh.ts`.
- ✅ **Pending-modal "show once" race** — the session flag was set on open, so a remount before the user saw it swallowed it. `useShowOncePerSession` marks it seen on dismiss, keyed per user. — `hooks/useShowOncePerSession.ts`

---

## 🧭 Scheduler Fragility (`Utils/scheduler.ts`)

- ✅ `fixTime` force-appended `'Z'` (broke negative offsets and date-only values) — `Utils/serverTime.ts` only normalizes naive timestamps to UTC; tested under `America/New_York`.
- ⬜ Heavy `as any` + hand-rolled control flow. → `pending.md` P1 (typed API).

---

## ✅ Checked — No Issue

- **Timers/intervals** — `TimelineView`, `useTimer`, `useWindowDimention`, `ElementStripper` all clean up correctly.

---

## Fixed 2026-10-31 (TaskBoard revive)

- ✅ **Capacity: work beyond the horizon vanished** — with the multi-day horizon every day was capped at 100%, so nobody could read as `over_capacitated` from backlog alone. The last day now absorbs the remainder. Sessions crossing local midnight are split by overlap. Capacity/insights tests run at three frozen instants (business hours, after hours, just past midnight). — `main.py` `_capacity_for_employee`, `_sessions_seconds_on_date`

