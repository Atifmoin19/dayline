# Dayline — Feature Inventory (`plan.md`)

What the app does **today**. Snapshot after full audit of frontend + backend on 2026-07-25,
updated 2026-07-26 for the task-detail-view + open-assignment + modal-redesign round, and again
2026-07-26 for a bugfix round (linked-task visibility, attachment-preview-closes-on-click,
detail-modal status actions, share-link login redirect, timeline history retention — see §4/§5/§10
and `pending.md` for the still-open multi-assignee item found in the same pass).

---

## 1. Overview

Role-based task scheduling / time-tracking app for an engineering org. Managers assign and monitor tasks on a live day-timeline; developers pick up, work, hold, and complete tasks with automatic work-session time accrual and overdue handling.

### Tech Stack

**Frontend** — `frontend/`
- React 19.1 + TypeScript ~5.9, Vite 5.4 (modes `dev` / `localback`)
- Chakra UI v2.10 + Emotion
- Redux Toolkit 2.2 + **RTK Query** over a **custom axios base query** (`Services/baseQuery.ts`)
- redux-persist 6.0 → **sessionStorage**, whitelist `["scheduler"]`
- react-router-dom v7.9, basename `/`
- framer-motion (largely unused), react-icons, axios

**Backend** — `backend/`
- FastAPI + Uvicorn, SQLAlchemy 2, Pydantic v2
- PostgreSQL (SQLite fallback if `DATABASE_URL` unset), Redis (pinged at startup but **not actually used**)
- Docker Compose (backend + Postgres + Redis + pgAdmin), root path mounted at `/api`

---

## 2. Authentication & Roles

- **Combined login / signup screen** (`Pages/login.tsx`), toggled by `isSignup`. Login → `POST /login`, signup → `POST /register`.
- **Open self-registration** — any visitor can create an account (no invite/role gate).
- **Auth token**: opaque random `secrets.token_hex(16)` stored in `foundation.token` DB column (`main.py:530`); **not JWT**. Sent as `Authorization: Token <token>`.
- **Inactivity expiry**: 15 minutes; `last_active_at` refreshed on every authed request (`main.py:192-208`).
- **Roles = real HRIS job titles** (from the org chart / seed data — the single source of truth,
  loaded via `seed_demo.py`). `permissions.HIERARCHY_RANKS` maps the 22
  designations to a 1–5 rank (5 CTO/CISO/VP · 4 AVP-PM/Engineering Manager · 3 Sr PM/Lead/Tech
  Lead/Team Lead · 2 Sr SWE I/Sr QA I/Sr DevOps/Sr Exec/UI-UX · 1 SWE/ASE/QA/Executive/Interns).
  Rank now drives ONLY the **admin gate** (rank ≥ 4 manages users) — **task assignability is open
  to every rank** (2026-07-26, see §4). **Visibility is the org tree, not rank** — anyone with
  reports sees their whole subtree (even a lead-titled IC); a pure IC sees only themselves.
  Legacy synthetic codes (SE1/L1/L2/…) were removed.
- **Frontend role tiers** (`Utils/constants.ts`) — `ROLE_RANK` maps the 22 designations to
  the same 1–5 ranks as the backend; `ADMIN_ROLES` (rank == 3, leads/managers) and
  `SUPER_ADMIN_ROLES` (rank ≥ 4, execs/EM) are **derived** from it, not hardcoded designation
  lists, so a new title is classified automatically. (These still gate user-management pages —
  only task *assignability* was opened up.)
- **Route guards** (`AppRouter.tsx`): `ProtectedRoute` (any authed user), `RoleProtectedRoute` (SuperAdmin pages).
  `ProtectedRoute` now redirects to `/login` with `state={{ from: location }}` (2026-07-26 fix —
  previously dropped the attempted URL entirely), and `login.tsx` reads `location.state.from` to
  navigate back there post-login/signup instead of always landing on `/` — fixes a shared task
  link (`/tasks/:taskId`) forgetting what you clicked through to once you authenticate. (Note:
  the dashboard/task-list scoping itself was checked and is unaffected either way — `GET /tasks`
  is unconditionally org-tree-scoped server-side, so visiting someone else's task via a shared
  link was already confirmed to never leak it into your own dashboard afterward.)
- **SSO / OIDC login (2026-07-27, scale-gaps-plan.md Phase 3, item 1 of 7)** — `sso_util.py`
  (backend) is a generic, config-driven OIDC client: works against Okta, Azure AD/Entra ID, or
  Google Workspace unchanged, since all three expose the same `/.well-known/openid-configuration`
  discovery doc + JWKS + authorization-code flow — no per-provider branching. Unset
  `OIDC_ISSUER` ⇒ `GET /auth/sso/status` reports `{enabled: false}` and the frontend hides the
  "Sign in with …" button entirely; local emp_id/password login is completely unaffected either
  way (same "unset = silent no-op" convention as Slack/web-push/Sentry, §12). Flow: `GET
  /auth/sso/login?next=<path>` stores a CSRF `state` (+ the return path) in Redis with a 10-min
  TTL and redirects to the IdP; `GET /auth/sso/callback` exchanges the code, verifies the
  `id_token`'s signature/`iss`/`aud`/`exp` against the IdP's live JWKS (`PyJWT`, added to
  `requirements.txt`), then maps the token's `email` claim onto an existing `users.emp_email`
  row. **Deliberately does not auto-provision** — a real email with no matching HRIS-imported
  user is rejected (`?sso_error=no_matching_account`), since this app's directory stays
  HRIS-import-only (`seed_demo.py`); SSO adds a second way to *authenticate*, not a
  second way to *appear* in the org. On success, issues the identical Redis/DB session `/login`
  does and redirects to the frontend with the token in a URL **fragment**
  (`#sso_token=...`, e.g. `/task-list#sso_token=...`) — never a query param, so it's never sent
  to a server or written to an access log. `SsoBootstrap.tsx` (mounted in `App.tsx`, above
  `AppRouter`) is the sole reader: it blocks rendering behind a spinner just long enough to pull
  the token off the fragment, strip it from the visible URL/history immediately, and call the
  new `GET /auth/me` (returns the caller's own `UserRead`, added since no prior endpoint
  answered "who am I" from a bare token) to hydrate `currentUser` — without that blocking step,
  `ProtectedRoute` would see `currentUser` still null on first render and bounce to `/login`
  before the async exchange finished. `login.tsx` shows the SSO button only when
  `GET /auth/sso/status` says so, and surfaces a failed round-trip
  (`?sso_error=<reason>`) as a toast. Config: `OIDC_ISSUER` / `OIDC_CLIENT_ID` /
  `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` / `OIDC_SCOPES` / `OIDC_PROVIDER_LABEL`
  (`.env.example`). Covered by `tests/test_sso.py` (12 tests: status/login config-gating,
  missing-code / IdP-error / invalid-state / unmatched-email / verification-failure rejection
  paths, and a full success round-trip through to a working `/auth/me` call) — all backend auth
  tests + the new suite pass; `tsc`/`eslint` clean on every touched frontend file.
- **Org-wide audit log (2026-07-27, scale-gaps-plan.md Phase 3, item 2 of 7)** — `audit_util.py`'s
  `record_audit()` stages an `AuditLog` row (append-only `audit_log` table, migration `0013`) in
  the same transaction as the mutation it's logging, so a rolled-back mutation never leaves an
  orphan "it happened" entry. Distinct from the existing per-task `task_comments.is_system`
  activity thread — this is cross-cutting. Wired into every admin write path: `user.create`,
  `user.update` (only when a tracked field — name/email/designation/department/**manager_id**—
  actually changed, as a `{field: {before, after}}` diff, so role/manager changes are named
  explicitly), `user.delete`, `user.bulk_delete`, `user.csv_import`, `task.csv_import`.
  `GET /audit-log` (admin-only, newest-first, filterable by `action`/`actor_emp_id`, capped at
  500/page) backs a new **Audit Log** admin page (`AuditLogPage.tsx`, sidebar Administration
  section) — action-type filter, actor filter, pagination, a JSON-summary column. Covered by
  `tests/test_audit_log.py` (8 tests) against the SQLite test DB, then verified end-to-end
  against the live dev Postgres via a real browser pass (logged in as the CTO, created a user
  through the UI, confirmed the row landed in Audit Log with the right actor/diff) — which is
  how a real, previously-undetected bug surfaced (see below).
  - **Bugfix found along the way — `POST /user` and `/users/upload` could fail against real
    Postgres.** Both endpoints `db.add()`ed a `UserModel` row and its matching `Foundation`
    (credentials) row in the same commit, relying on add-order to also be insert-order.
    SQLAlchemy doesn't guarantee that across unrelated mapper classes, and `Foundation.emp_id`'s
    FK requires the `User` row to exist first — so the two inserts could reach Postgres in
    either order and intermittently 500 with a `ForeignKeyViolation`. Every test exercising user
    creation passed anyway, because the whole suite runs against a throwaway SQLite DB
    (`conftest.py`), and SQLite doesn't enforce FK constraints unless `PRAGMA foreign_keys=ON`
    is set — which this app never does. `seed_demo.py` (the HRIS import path) was
    never affected, since it already commits all `User` rows before adding any `Foundation`
    row. Fixed by adding an explicit `db.flush()` between the two adds in both endpoints —
    reproduced directly against the dev Postgres first (bare `User`+`Foundation` add/commit,
    no audit-log code involved), confirmed the fix, then re-ran the full backend suite (still
    182 passed) and the browser pass end-to-end.
- **Central RBAC** (`permissions.py`) — single source of truth for ranks + every backend
  authorization decision. Documented permission matrix + named predicates (`is_admin` /
  `can_manage_users`, `can_view_task`, `can_modify_task`, `can_assign_task_to`,
  `can_delete_comment`) replace the rank checks that were scattered across `main.py`; every
  task/comment/link mutation now gates through it (no more unguarded endpoints). `HIERARCHY_RANKS`
  is keyed by the **real HRIS designations only** (legacy SE1/L1/L2/… codes removed); admin =
  rank ≥ 4, visibility is the org tree (not rank). **`can_assign_task_to` and
  `validate_assignee_eligibility` are now permissive pass-throughs** (2026-07-26) — kept as named
  functions (single place a future rule would land) but both unconditionally allow: any user may
  assign a task to any other user, in any direction, at any rank (previously: admins-anywhere,
  everyone else self/subordinate-only, and EM+ were never assignable at all).

---

## 3. User Management (SuperAdmin)

- Create single user — `CreateUserPage.tsx`. Real-designation dropdown, designation-aware
  manager dropdown, plus optional enriched fields (Company, Work Location, Date of Joining,
  LinkedIn). The dead `Hierarchy` (Employee/L1/L2/Admin) field was removed.
- **Bulk CSV upload** with client preview, 4 MB limit, sample-CSV download. `/users/upload`
  parses the full enriched column set, **rejects unknown designations** (reported in
  `skipped_detail`), and assigns managers in a **second FK-safe pass** (order-independent).
- Edit user inline; **single + bulk delete** with confirm — `UserManagementPage.tsx`.
- **Self-service profile edit** (`PUT /profile`) — a user edits their own contact/personal fields.
- **Manager-hierarchy validation** server-side (`validate_manager_hierarchy`): a manager must
  outrank the report; rank ≥ CTO (5) self-manageable.
- **Employees loaded from seed data** via `seed_demo.py` (`seed/quillbrook_labs.json`).

---

## 4. Task Management

- Full **CRUD** + status-only PATCH (`/tasks/{id}/status`).
- Fields: title, description, priority, tags, notes, duration (hours + minutes) or **"Till End of Day"** auto-calc, status.
- **Open assignment (2026-07-26)** — any user may assign a task to any other user, in either
  direction and at any rank; the old "assignee locking" (non-admins could only assign to
  themselves) and the rank<4 filter on who could *receive* a task are both gone. Enforced nowhere
  now — `can_assign_task_to`/`validate_assignee_eligibility` (backend) are permissive pass-throughs
  (see §2), and the four client-side rank<4 developer filters (`TimelineView`, `WeekView`,
  `CalendarView`, `CreateTaskPage`) were removed so an EM+/exec assigned a task gets a visible row.
  Assignee selection everywhere is now a searchable combobox (`AssigneePicker.tsx` — avatar +
  name + designation, filter-as-you-type), not a plain `<Select>`. **Smart assignee suggestions**
  (2026-07-26, the "Must Have" feature, refined 2026-07-27 after real usage feedback) sit above
  the picker in `TaskCreationModal` — a compact row of **circular avatar-only chips**
  (`AssigneeSuggestions.tsx`, reuses `UserAvatar`'s photo/initials fallback, no name/card text
  visible by default — deliberately distinct from the full-row `AssigneePicker` below it, which
  users were confusing it with; hover/focus reveals a tooltip with the full name + top reason)
  from `GET /tasks/assignee-suggestions`. Ranked by: `100 - utilization_pct` (weighted 1.25× for
  P0/P1, reusing `/capacity`'s load math) + an org-tree proximity bonus (self > report >
  manager-chain > peer > none) + a tag-history bonus (completed tasks sharing a requested tag,
  capped) + a **domain-affinity bonus** — when `title`/`description` are provided, the backend
  calls Gemini once (cached 5 min in Redis, keyed on a hash of the text) to classify the work into
  short domain/skill keywords, matched against each candidate's `skills` (or `emp_designation` as
  a fallback signal when skills are empty) — degrades to the pre-existing formula with zero Gemini
  calls when there's no description, it's too short, or Gemini is unavailable. The candidate pool
  is **IC-only** — anyone rank ≥ 3 (leads/managers/execs, `permissions.get_rank`) is filtered out
  of suggestions entirely (a UX quality filter; `can_assign_task_to` still permits assigning
  anyone, per open assignment). Tags/priority are debounced (`useDebouncedValue`, 400ms) before
  refetching; **title and description are each intentionally not debounced — both only join the
  query on their own field's `onBlur`** (`committedTitle`/`committedDescription` state, separate
  from the live typing state each field still uses for the form itself), since a non-trivial
  value on either can now trigger a real server-side Gemini call. Typing in one field never
  re-fires the request while the other is still mid-edit; blurring either fires using whatever
  the other was last committed to (2026-07-27 fix — an earlier pass left `title` wired live,
  which fired a request on every keystroke; both fields now commit independently, matching the
  intended "only-title", "only-description", and "both, wait for whichever blurs" cases). A
  request failure silently hides the section rather than blocking task creation.
- **Min-10-minute** duration validation; priority-upgrade "arrive now" reset.
- **Staged dependencies on create** — `TaskCreationModal`'s "Linked Tasks" panel lets you pick a
  "depends on" target before the task exists (same pattern as staged attachments); the real
  `POST /tasks/{id}/links` calls fire right after creation succeeds, best-effort per link.
  **2026-07-26 fix:** `TaskCreationModal` never set `task_assigned_by` on the new task, so
  `permissions.can_modify_task` (which allows assigner-or-assignee-or-admin-or-manager) fell
  through to `False` whenever a non-admin assigned the new task to a peer — the immediate
  `POST /tasks/{id}/links` 403'd and was silently swallowed, so the link never existed and the
  detail view's "Links & Dependencies" section correctly showed nothing (that section's RTK
  wiring was fine). Now `task_assigned_by` is set to the creator, and any link that still fails
  to attach surfaces a warning toast naming which dependency needs to be added manually from the
  detail view, instead of failing silently.
- Bulk **task CSV upload** (`/tasks/upload`, validated).
- **Subtask creation + progress rollup (2026-07-27, iterated through 2026-07-28)** — split a
  story across collaborators, each subtask its own single-assignee task row (e.g. Mira on
  frontend, Tomas on backend, story owned by Mira). Resolves the former "multi-assignee" ask
  via decomposition instead of a schema overhaul (full rationale in
  `subtask-collaboration-plan.md`) — deliberately does **not** touch
  `permissions.py`/`notify()`/`get_user_view_scope`, since each collaborator still owns one task
  row with one assignee. Built on the `task_links(link_type="subtask")` table and
  `completion_blockers` gating that already existed (see §9).
  - **Two creation paths, one shared form.** `SubtaskCreationModal` — full parity with the main
    create form (title, description, attachments, assignee w/ suggestions, priority, status,
    deadline, duration, tags), minus its own nested Subtasks panel and minus Linked Tasks (depth
    is capped at 2 levels; a dependency picker needs other *existing* tasks to point at, which is
    orthogonal to "fill in this subtask's own details"). From **`TaskCreationModal`** (a story
    that doesn't exist yet): "+ Add Subtask" stages the draft into a Jira-style row list (bookmark
    icon, "NEW" placeholder — no real id exists pre-submission); all staged subtasks are created
    in one atomic batch via `POST /tasks`'s optional `subtasks` field when the story itself is
    created (partial failure surfaces as a `subtask_warning` on the response, not a 500, since the
    parent having saved shouldn't be masked by a subtask hiccup; capped at `MAX_SUBTASKS_PER_REQUEST`
    = 25 per request — an unbounded batch of inlined base64 attachments blocking on N sequential
    `notify()` calls doesn't scale). From **`TaskDetailForm`** (a story that already exists): the
    same modal's "Add Task" instead calls `POST /tasks/{id}/subtasks` immediately — created and
    linked in one request, with its own real id/ticket_id right away (`create_subtask_row`, shared
    by both paths). Both call sites deliberately render this as a custom `Portal` overlay, not a
    nested Chakra `Modal` — opening a second real Modal on top of an already-open one (the create
    modal, or the task-detail modal) hit the exact same Chakra `modalManager`/scroll-lock
    conflict already documented for `TaskAttachments`' lightbox, here manifesting as the inner
    modal's own scroll container refusing to scroll.
  - **Navigation both ways.** `TaskDetailForm` renders its own "Subtasks" section directly in the
    left column (not the sidebar) — progress bar (`subtask_done`/`subtask_total`) plus a clickable
    Jira-style row per child (real ticket id, title, priority, assignee); clicking opens that
    subtask's own detail view. If the task being viewed IS a subtask, a "Subtask of #TICKET Title"
    breadcrumb under the header links back up to its parent. `LinkedTask` (backend) carries
    `task_ticket_id`/`task_assigned_to`/`subtask_total`/`subtask_done` to support this without an
    extra round trip. The Subtasks section — and its "+ Add Subtask" trigger — is hidden entirely
    on a subtask's own page, since depth is capped at 2 levels and it could only ever 409.
    `TaskLinks.tsx` ("Links & Dependencies") was trimmed to true dependencies only, matching its
    heading, now that subtasks/parent get the richer treatment above instead of a bare badge.
  - **Depth cap** at 2 levels (no sub-subtasks, `check_subtask_depth`, enforced on both creation
    paths) so rollup never needs a recursive query.
  - **Deleting** a task with subtasks needs `?cascade=true` (409 otherwise, naming the count);
    cascade-deleting notifies each affected subtask's assignee first (their logged work vanishing
    silently would read as a bug report at any org size). The frontend surfaces that 409's real
    message (all three delete entry points — task detail, list view, timeline — were silently
    swallowing it before) and offers a one-click cascade retry instead of a dead end; bulk delete
    uses `Promise.allSettled` so one blocked task no longer sinks the whole batch.
  - **Counter integrity.** `tasks.subtask_total`/`subtask_done` are recomputed-from-truth (a fresh
    aggregate query), never incremented in place — but the delete-gate itself re-checks live
    `task_links` rows rather than trusting that denormalized column, and deleting a subtask
    directly now recomputes its parent's counters immediately (the `task_links` row referencing
    it cascades away at the DB level silently on `ON DELETE CASCADE`, and nothing was recomputing
    the parent side of that before — the specific bug that let one dev-DB task's counter drift to
    "1 subtask" with zero real links behind it, blocking its own deletion).
  - Migration `0009` also closed two integrity gaps `task_links` had since it originally shipped:
    no unique constraint on an edge (app-level duplicate check only, a real race under concurrent
    writes) and no composite index for the "children of parent X" lookup `completion_blockers`/
    counter-recompute both run. Applied and verified against the real dev Postgres.
  - **Task-detail header** reordered: Maximize / Copy Link / Delete stay together, then a divider,
    then a dedicated Close (X) as the last, rightmost control — Delete used to sit in that
    top-right corner, the spot people reflexively click to close a modal.

---

## 5. Scheduling & Timeline

- **Horizontal per-developer day timeline** (`TimelineView.tsx`): AM/PM header, hour columns, **zoom-to-10-min**, prev/next-day nav (next-day disabled until EOD).
- **Actual-history model** (redesigned 2026-07-25): the timeline renders **real work sessions as segments** (via `calculateSchedule(..., { actualOnly: true })`), not a planned reservation. Segments come from `task_sessions`; the 60-day planned simulation in `scheduler.ts` is skipped for the timeline. Fill color is **per-task** (vivid palette, `Utils/avatar.ts#taskColor`), priority is the left-border accent; the open/live session carries an `isLive` now-dot.
- **Two-tier per-user row:** collapsed = one non-overlapping **activity ribbon** (all of that user's segments in a single lane, gaps = idle, parked/no-session tasks as chips); expanded (chevron) = **one swimlane per task** showing that task's segments + hatched hold gaps. Overlap is impossible by construction (single active session/user).
- Hover popover with **Pick / Resume / Edit / Hold / Done / Delete** (status-driven); actions resolve to the segment's task.
- **Auto-realign** (`realign_user_tasks`, `main.py`): recomputes sequential start times so reservations don't overlap; now reserves **remaining** work (`remaining_seconds`), not the full block, so a resumed task no longer drifts. (Reservations feed create-append/fallbacks; the timeline itself no longer draws them.)
- **Preemption**: picking a task auto-holds the currently in-progress one server-side (single active session/user, `start_new_session`); the paused session is labeled **`on-hold`** (not `completed`) and the clock moves. The old client-side double-preemption was removed.
- **Sequential completion** enforcement (re-based on the task list, not the schedule).
- **Work sessions**: in-progress → opens session; hold → closes labeled `on-hold`; done → closes labeled `completed`; `time_spent` accrued server-side from closed sessions (`recalculate_total_time`). Pick/resume restarts `task_assigned_date` + `task_updated_at` together so the schedule slot and overdue sweeper share one clock.
- **Background overdue sweeper**: 60 s asyncio loop; overdue = `task_due_date` (if set) else `ref_time + remaining_seconds`; also auto-holds + caps runaway open sessions (crossed-day / past-EOD / max-hours).
- **2026-07-26 fix — history no longer disappears once a task goes to `backlog`**: `TimelineView`
  pre-filtered which tasks even reach `calculateSchedule(..., { actualOnly: true })` by their
  **current** `task_status` (`in-progress`/`done`/`todo`/`on-hold` only). Once the overdue sweeper
  flips a task to `backlog`, it dropped out of that filter entirely — which meant its real,
  already-worked session segments vanished from *every* day's view retroactively, including a
  prior day where it was genuinely worked (proof-of-work for that day disappeared once you
  navigated the timeline forward past midnight). The filter now also keeps any task that has
  `task_sessions.length > 0`, so historical segments render on the day they actually happened
  regardless of what the task's status has become since; the "parked chip for today" logic
  (separate, keyed off the live `tasks` list) is untouched.
- **Real-time**: a `/ws` WebSocket broadcasts a `tasks_changed` ping after every task mutation; the frontend (`useRealtimeSync`, mounted in `simpleLayout`) invalidates the `["Task"]` cache so all views refetch instantly. In-memory single-instance fan-out (`ConnectionManager`); reconnect with backoff; the 60 s `tick` poll remains as a safety net.

---

## 6. Pending-Tasks Notifier

- Header bell (`Header.tsx`) with badge count of actionable backlog/todo/on-hold tasks **within business hours**.
- Auto-opens the `PendingTasksModal` once per session (redesigned 2026-07-26: `size="3xl"`, each
  task a full-width row — title/priority badge/estimate/due date inline, description + attachment
  thumbnails below). **Clicking a row opens the task detail view** (`TaskDetailModal`, §10); "Pick"
  stays a separate always-clickable action (`stopPropagation`, mirrors the timeline's Pick/Resume)
  — the backend's `start_new_session` auto-holds whatever else is in-progress for that user
  server-side, and the modal optimistically reflects that preempt locally for instant feedback.
  Pick is plain brand-blue now (was priority-tinted) — priority stays on the badge only, per the
  app's "semantic colors only for priority/status, one accent for actions" rule.

---

## 7. Dashboards

- **Landing overview** (`DashboardOverview`) — gradient hero banner (greeting, live summary
  sentence, Create Task / Organization quick actions, completion % + progress bar) followed by
  **live KPI tiles** (soft gradient cards): managers see Active now / In progress / Pending /
  Overdue / Completed / Team members; individuals see In progress / Pending / Completed / Time
  logged. All computed from the scoped Redux tasks — no extra fetch. An **AI Insight panel**
  (`AIInsightPanel.tsx`, 2026-07-26) sits below it — Gemini-generated summary + 2-4
  recommendations from `GET /insights` (org-tree scoped, same visibility as everywhere else),
  with a loading skeleton and a clear "insight unavailable" state when Gemini isn't configured
  or all keys fail. Extended the same pass with the "Must Have" workload-balancer data — **at-risk
  tasks** and **rebalance suggestions**, both computed deterministically server-side (bucketed
  overdue-risk from remaining time vs. assignee load; overloaded↔idle pairing preferring a shared
  skill) and rendered in their own sections **independent of Gemini's own availability** — they
  still show up even when `available: false`, since they don't depend on the AI summary succeeding.
  Task rows resolve locally from the scoped Redux task list (click → `openTaskDetail`, same
  pattern as `PendingTasksModal`); rebalance pairs resolve emp_id → name from the developer
  directory already in Redux. Risk/rebalance colors reuse `Utils/capacity.ts`'s status color scale
  for consistency with the Organization Resource View.
- **Management view**: team timeline, "All Members" manager filter (org-tree scoped — self +
  subtree only, no seniors/peers), Create Task, view toggle (Timeline/Week/Calendar/List).
- **Developer view**: personal timeline + own task list, same toggle.
- Admin operations (Create Tasks / Create Users / Manage Users) live directly in the sidebar's
  **Administration** section — no separate Admin Console landing page.
- **Organization Resource View** (`/resources`, `OrganizationResourceView.tsx`, 2026-07-26) —
  org-tree scoped like every other view (not admin-gated — an IC hitting it directly sees a
  scope of just themselves). Four summary cards (Total / Available / Over-capacitated / Avg
  Utilization) from `GET /capacity`'s aggregate; a department filter (client-side, joined against
  `GET /user` since `/capacity` itself doesn't carry department); an employee availability table
  with a next-48h (today/tomorrow — all `/capacity` currently provides) two-segment capacity bar
  per person, each with a muted timezone badge (`formatTimezoneLabel`, tooltip shows the full IANA
  name); a **Team Saturation Heatmap** (employees × the 2 available days, color-graded by
  utilization, now genuinely grouped by each employee's own `users.timezone` — a self/admin-
  editable column, same pattern as `skills`, that also makes `GET /capacity`'s committed/available-
  seconds math use each employee's own timezone instead of one org-wide default; rows are sectioned
  under an alphabetically-sorted timezone divider, `Utils/capacity.ts#groupRowsByTimezone`); and a
  **Resource Efficiency
  Index** gauge (`Utils/capacity.ts#computeEfficiencyIndex` — `avgUtilization × 0.7 +
  (100 − overCapacitatedRatio×100) × 0.3`, documented in-code, chosen so raw over-utilization
  doesn't read as "efficient"). All charts are Chakra-native (`CircularProgress` + `Box` grids),
  no new charting dependency.

---

## 8. API Surface

### Backend endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | – | Welcome |
| GET | `/health` | – | Liveness + DB probe (LB / uptime) |
| GET | `/metrics` | ✅ | Uptime, DB reachability, open-task/active-session/overdue counts (unscoped, operational) |
| GET | `/capacity` | ✅ | Per-employee 48h committed-vs-available time + status bucket, org-tree scoped |
| GET | `/insights` | ✅ | Gemini summary/recommendations + deterministic `at_risk_tasks`/`rebalance_suggestions` (populate even if Gemini isn't configured) from `/capacity`+`/tasks` data, org-tree scoped, Redis-cached 5 min |
| GET | `/tasks/assignee-suggestions` | ✅ | Top-5 ranked IC-only assignee candidates (load + org-tree + tag-history + optional Gemini domain-match from `title`/`description`), no scoping (open assignment) |
| POST | `/login` | – | Password check → token (rate-limited) |
| POST | `/register` | – | Set pwd/token (rate-limited) |
| GET | `/auth/sso/status` | – | `{enabled, provider_label}` — whether OIDC SSO is configured |
| GET | `/auth/sso/login` | – | Redirect to the IdP's authorization endpoint (404 if unconfigured) |
| GET | `/auth/sso/callback` | – | OIDC code exchange + id_token verify → session, redirects to frontend |
| GET | `/auth/me` | ✅ | Caller's own `UserRead`, given only a token (hydrates SSO logins) |
| POST | `/logout` | manual header | Delete session token |
| POST | `/user` | ✅ admin | Create user + foundation entry |
| GET | `/user` | ✅ | List users / subordinates (hierarchy-scoped) |
| PUT | `/user/{emp_id}` | ✅ admin | Update user |
| DELETE | `/user/{emp_id}` | ✅ admin | Delete user |
| POST | `/users/bulk-delete` | ✅ admin | Bulk delete |
| POST | `/tasks` | ✅ | Create task + realign + notify assignee; optional `subtasks:[...]` creates N single-assignee subtasks atomically (§4) |
| GET | `/tasks` | ✅ | List (hierarchy-scoped, paginated), rows include `subtask_total`/`subtask_done` |
| PUT | `/tasks/{id}` | ✅ | Full update + session transitions + notify on reassign; notifies parent's assignee/assigner once all subtasks are done |
| PATCH | `/tasks/{id}/status` | ✅ | Status-only update + activity log; same parent-notify-on-all-done as above |
| DELETE | `/tasks/{id}` | ✅ | Delete (ownership/rank check); 409 (real message surfaced client-side, with a cascade retry) if it has subtasks unless `?cascade=true`; notifies affected subtask assignees on cascade |
| POST | `/tasks/{id}/subtasks` | ✅ | Add one subtask to an already-existing task immediately (real id/ticket_id, no staging) — depth-guarded same as `/links` |
| DELETE | `/tasks/{id}/sessions` | ✅ | Remove one work session (manual time correction) |
| PATCH | `/tasks/{id}/sessions` | ✅ | Edit a session's start/end (manual time correction) |
| POST | `/tasks/{id}/sessions/split` | ✅ | Split one session into two at a given instant |
| GET/POST | `/tasks/{id}/comments` | ✅ | List / add comments (+ activity thread) |
| DELETE | `/comments/{id}` | ✅ | Delete a comment (author/admin) |
| GET/POST | `/tasks/{id}/links` | ✅ | List / add subtask & dependency links; `subtask` links are capped at 2 levels (no sub-subtasks) and recompute the parent's progress counters |
| DELETE | `/links/{id}` | ✅ | Remove a link |
| GET/POST | `/tasks/{id}/attachments` | ✅ | List / upload image attachments (base64 inline) |
| DELETE | `/attachments/{id}` | ✅ | Remove an attachment (uploader/admin) |
| GET | `/notifications` | ✅ | Own notifications + unread count |
| POST | `/notifications/{id}/read` · `/notifications/read-all` | ✅ | Mark read |
| GET | `/push/vapid-public-key` | ✅ | VAPID public key for `pushManager.subscribe()` |
| POST | `/push/subscribe` | ✅ | Register a browser's push subscription (upserts on endpoint) |
| POST | `/push/unsubscribe` | ✅ | Remove a browser's push subscription |
| PUT | `/profile` | ✅ | Self-edit own contact/personal HRIS fields |
| POST | `/users/upload` | ✅ admin | CSV user import (real designations, enriched fields) |
| POST | `/tasks/upload` | ✅ | CSV task import |
| GET | `/audit-log` | ✅ admin | Org-wide admin action log, newest-first, filterable by action/actor |

Auth + rate-limiting + ownership checks were added in P0 (all user/task mutations are now
token-gated; admin-gated where noted). Completing a task returns **409** while a dependency or
subtask is unfinished (`completion_blockers`).

### Frontend RTK Query hooks

All in `Services/user.api.ts`, tag types `Task` / `User` / `Comment` / `Notification` / `Link` /
`Attachment`:
`userList`, `getUser`, `taskList`, `createTask`, `updateTask`, `deleteTask`, `deleteTaskSession`,
`editTaskSession`, `splitTaskSession`, `taskComments`, `addComment`, `deleteComment`,
`taskAttachments`, `addTaskAttachment`, `deleteTaskAttachment`, `notifications`,
`markNotificationRead`, `markAllNotificationsRead`, `taskLinks`, `addTaskLink`, `deleteTaskLink`,
`login`, `logout`, `createUser`, `updateUser`, `updateProfile`, `uploadTasks`, `uploadUsers`,
`register`, `deleteUser`, `bulkDeleteUsers`, `vapidPublicKey`, `subscribePush`, `unsubscribePush`,
`capacity`, `insights`, `ssoStatus`, `authMe`, `auditLog` (untagged queries — nothing
invalidates them, matching the `vapidPublicKey`-style pattern already in the file).

---

## 9. Data Model (`models.py`)

Eight tables. **Foreign keys** are now declared (revision `0002_add_foreign_keys`): manager_id,
foundation.emp_id, task assignee/assigner, comment/link/notification → task, notification → user,
each with an appropriate `ON DELETE` (SET NULL / CASCADE); `task_comments.author_id` is left
unconstrained (holds the `"system"` sentinel). New tables are still created by `init_db()`
(`create_all`, which now emits the FKs on a fresh DB); existing databases get them via the Alembic
revision (run `fk_preflight_audit.py` first — it reports orphaned rows the migration would clean).

- **`users`**: `id`, `emp_name`, `emp_id` (unique), `emp_email` (unique), phone, `emp_designation`
  (real HRIS title), department, hierarchy, `manager_id` (emp_id of manager) + enriched HRIS
  profile stored for future use: `node_id`, `hris_user_id`, `company`, `legal_entity`, `gender`,
  `work_location`, `date_of_joining`, `date_of_birth`, `blood_group`, `payscale`, `education`
  (JSON), `linkedin`, `profile_pic`. Loaded from `seed/quillbrook_labs.json` via `seed_demo.py`.
  Plus `skills` (revision `0006_add_skills`, JSON list of free-text tags, default `[]`, capped at
  20 tags / 40 chars each server-side) — self-editable via `PUT /profile`, admin-editable via
  `PUT /user/{emp_id}`. Deliberately included in **both** the admin `UserRead` and the PII-lean
  `UserDirectory` shapes (unlike DOB/blood-group/phone/education/linkedin) since skills are
  work-relevant, not personal, and the Organization Resource View needs the company-wide
  directory to render them.
- **`foundation`** (credentials/auth): `id`, `emp_id` (1:1 with user), **bcrypt-hashed `password`** (P0), `token`, `last_active_at` (`DateTime(timezone=True)`).
- **`tasks`**: string `id`, name/description/status/priority/tags/notes, `task_assigned_to` / `task_assigned_by`, date fields as **`DateTime(timezone=True)`/timestamptz** (P0), `task_duration`, `time_spent` (Float hrs), `task_sessions` (JSON list), `completed_at`. Computed `remaining_seconds` with a 30-min floor. Plus `subtask_total`/`subtask_done` (revision `0009_subtask_progress_and_link_integrity`, both `Integer` default `0`) — denormalized progress rollup, recomputed from `task_links` on every write that touches a child (see §4), never incremented in place.
- **`task_comments`**: `id`, `task_id`, `author_id`/`author_name`, `body`, `is_system` (True = auto activity-log entry), `created_at`.
- **`task_links`**: `id`, `from_task_id`, `to_task_id`, `link_type` (`subtask` = from is a subtask of to; `depends_on` = from waits on to), `created_at`. As of `0009`: a `UNIQUE(from_task_id, to_task_id, link_type)` constraint (closes a duplicate-link race the app-level check alone couldn't — no DB backing existed before), composite indexes `(to_task_id, link_type)`/`(from_task_id, link_type)` for the "children of parent X" / "parent of child X" lookups `completion_blockers` and the subtask-counter recompute both run, and a `CHECK (link_type IN ('subtask','depends_on'))`.
- **`task_attachments`** (revision `0004_add_task_attachments`): `id`, `task_id`, `filename`, `content_type`, `data` (**base64 data URI, stored inline** — no object storage), `uploaded_by`, `created_at`. Image-only (`png/jpeg/gif/webp`), 5 MB cap enforced on the decoded bytes.
- **`notifications`**: `id`, `user_id` (recipient), `type`, `message`, `task_id`, `is_read`, `created_at`.
- **`push_subscriptions`** (revision `0005_add_push_subscriptions`): `id`, `user_id`, `endpoint`
  (unique — one row per subscribed browser/device), `p256dh`, `auth`, `created_at`.

---

## 10. UI / UX — "Dayline Enterprise" (current state)

Professional enterprise redesign of all existing screens, incl. the once-deferred SuperAdmin
pages (`CreateUserPage`, `CreateTaskPage`, `UserManagementPage`) — restyled to the same tokens
(`surface.card`/`surface.border`/`neutral.*`/`brand.*`, `card` radius/shadow, left-aligned
titles + subtitles); semantic red is kept on destructive actions. **Design language:** one font
family, 4 font sizes (bumped one notch for readability), single brand-blue accent + neutral
gray-blue surfaces, semantic colors only for priority/status, muted avatar palette
(`Utils/avatar.ts`), tasteful gradients (`src/Styles/index.ts`, incl. a rich hero gradient +
soft KPI-tile gradients). Icons are **lucide-react** everywhere (see App shell below); no emoji.
A global `overflow-x: hidden` on `html/body/#root` guards against any stray tooltip/popover
computing past the true viewport edge and growing a page-wide horizontal scrollbar (nested
elements, e.g. the timeline, keep their own internal horizontal scrolling) — paired with an
explicit `overflow-y: visible` (2026-07-26 fix) on the same selector, since setting only
`overflow-x` makes the browser silently compute `overflow-y: auto`, which turned `#root` into a
phantom scroll container that never actually overflows but *is* the nearest scrolling ancestor for
any `position: sticky` element inside it — `Header` was scrolling away with the page because of
this. **`Header` is now `position: fixed`** (not sticky) for the same reason, with `simpleLayout`'s
main content area getting an explicit `mt={HEADER_HEIGHT}` to compensate for the space a fixed
element no longer reserves in flow.

- **One shared blue "glow" shadow** (`BRAND_GLOW`/`BRAND_GLOW_HOVER`, `Styles/index.ts`) is wired
  into the `Button` theme's solid+brand variant, so every plain brand button gets it automatically
  (Create Task, Save Changes, etc.); the handful of custom elements that set `bg` directly instead
  of using `colorScheme` (the floating create-task FAB, the sidebar CTA, the dashboard's active
  Timeline/Week/Calendar/List tab) apply the same two constants inline.

- **App shell** — a full-width **fixed** `Header` on top (brand/logo → home, one combined
  `NotificationCenter` bell, profile **menu** with Profile + Logout — no page-title heading) with
  a fixed left `Sidebar` below it (Create-Task CTA, primary nav = My Work / Organization / Reports,
  and for admins an **Administration** section spreading the former Admin-Console ops: Create
  Tasks / Create Users / Manage Users). Task List is a dashboard view toggle (not a nav item).
  `simpleLayout` supports `hideSidebar` for focused pages (Profile spans full width). Login uses a
  split-panel `AuthLayout`. Icons are **lucide-react** throughout (via an `Fa*`-named shim in
  `Utils/icons.tsx`, so no per-call-site renames were needed); no emoji anywhere in the UI.
- **Org-tree visibility** (`Utils/orgTree.ts`) — the member filter dropdown and the
  Timeline/Week/Calendar rows show only **self + entire subtree** (every direct + indirect
  report) — **pure tree, not rank-gated** (a lead-titled IC with reports sees them same as a
  manager). No peers or seniors. Mirrors the backend `get_user_view_scope`, which already scopes
  `GET /tasks`.
- **Dashboard is timeline-first.** Greeting + a **Timeline / Week / Calendar / List** toggle
  (Timeline default). **Week** = users × 7-days worked-time grid (`WeekView`); **Calendar** = month
  grid with native drag-to-reschedule (`CalendarView`).
  Managers see "Team Schedule"; individuals see "My Schedule". (An earlier Kanban-board home was
  built and then removed — timeline is the priority per product direction.)
- **Timeline (`TimelineView`) — the core view, redesigned to an actual-history model:**
  - Clean grid: solid neutral gridlines, "10 AM / 12 PM" hour labels, contiguous member rows.
  - **Member column** shows a chevron expand toggle + avatar + name + designation; hierarchy
    hover-popover (reports-to + direct reports) resolves against the full user directory.
  - **Segment-per-session rendering:** each real work session is one solid bar at its true
    start/end; **per-task vivid fill** so same-priority neighbours stay distinct; priority is the
    left-border accent; the open session shows a **live now-dot**. No more full-duration
    reservation bars, no dual-shade progress fill (each segment *is* worked time).
  - **Two-tier rows:** collapsed = a single non-overlapping **activity ribbon** per user (idle
    gaps show through; parked/no-session tasks as chips). Expanded = **one swimlane per task**
    with that task's segments + **hatched hold gaps**, so "worked → held → resumed" is explicit.
    Auto-expanded in the single-developer (own dashboard) view.
  - **Live current-time vertical line** (red, with dot) spanning all rows; height-agnostic so it
    stays aligned as rows expand.
  - **Click-to-zoom** any hour → 10-min detail view (same styling); segments clamp to the hour.
  - **Hover** popover (unchanged) shows a compact task summary — description, assignee,
    planned/actual duration, due date, tags, attachment thumbnails, session history — plus task
    actions (Pick / Resume / Hold / Done / Edit / Delete) driven by status. **Click** (2026-07-26,
    new) opens the full **task detail view** (`TaskDetailModal`, below) — added to the segment,
    the collapsed-row parked-task chip, and the expanded per-task lane chip; none of the three
    trigger elements had a click handler before, so this was purely additive alongside the
    existing hover popover.
  - **Role-scoped rows:** individuals see only themselves; a manager sees self + their reportees
    (recursive); EM/CTO+ see the whole team below them.
- **Task table** (`TaskListingView`) — card table with priority pills, status dots, assignee, due
  date, actions; single Redux source + client pagination. **Toolbar:** search (name/tags/assignee),
  status & priority filters, **row selection with bulk delete + bulk set-status**, and a
  **Views** popover for **saved filter presets** (`useSavedViews` — named search/status/priority
  combos persisted to `localStorage` per user; save current filters, click to re-apply, delete).
- **Create-task modal** (`TaskCreationModal.tsx`, 2026-07-26 redesign, pixel-matched to a Stitch
  mockup) — **create-only** now (see task detail view below for editing an existing task). Two
  columns, no shared bordered panels: left is plain (Title, Description on a soft `#f9fafb`
  field, Estimate hours/minutes + "Till End of Day", a **drag-and-drop "Reference Materials"**
  dropzone — real `onDrop`/`onDragOver`, not just click-to-browse); right is a tinted sidebar
  card (`taskModalStyles.ts#sidebarPanelProps`) with Assignee (`AssigneePicker`, searchable
  combobox), Priority + Status as two side-by-side `<Select>`s, Deadline, Tags
  (`TagsInput` — rotating pastel chip colors, "+ New" to add), and **Linked Tasks** (staged
  "depends on" picker, committed via `POST /tasks/{id}/links` right after the task is created —
  same pattern as staged attachments). Header/footer are fixed, only the body scrolls
  (`scrollBehavior="inside"` on top of an explicit `h`/`maxH` — needed together, since Chakra's
  own outer dialog wrapper defaults to `overflow: auto` unless told otherwise, which could
  scroll the whole dialog including the header as one block).
- **Task detail view** (`TaskDetailModal.tsx` + `TaskDetailForm.tsx`, new 2026-07-26) — the single
  canonical place an **existing** task is opened from anywhere in the app (pending tasks, timeline
  click, week/calendar chip click, task-list row/edit) via a shared `TaskDetailContext`
  (`openTaskDetail(task)`, provider mounted in `App.tsx` above the router so every page and the
  header's `NotificationCenter` can reach it). Jira-style: header shows a short id (`#`+last 6
  chars of the task id) + primary tag breadcrumb and the title; **title and description are
  double-click-to-edit** (`InlineEditableText` — plain text until double-clicked, Enter/blur
  commits, Escape cancels) so a stray click can't overwrite them, while structured fields
  (status/assignee/priority/due date) stay explicit pickers that already save on
  change/immediately — no separate "Save" step needed per field (a "Save Changes" button in the
  shared footer exists mainly to flush an in-progress inline edit by blurring it). Left column:
  Description, Attachments, Comments & Activity (all one shared scroll region with the sidebar —
  not two independently-scrolling panes). Right sidebar (same tinted-card treatment as the create
  modal): Assignee, Priority + Status (also two selects, matching create), Due Date, Estimate,
  Tags, Links & Dependencies (badges: "Blocks" / "Depends on", strikethrough on a completed link,
  collapsed "+ Add dependency" trigger matching the create modal's). Header icons: **maximize**
  (closes the modal, navigates to `/tasks/:taskId` — the identical `TaskDetailForm` rendered
  full-page inside `SimpleLayout` via `TaskDetailPage.tsx`, so there's no separate "page version"
  of the fields to keep in sync), **copy link**, **delete**. Outermost footer (never scrolls):
  "Reported by / Created … / Last updated …" on the left, Close + Save Changes on the right
  ("Save Changes" intentionally does not close the modal — every structured field already
  autosaves on change, the button just flushes an in-progress inline-text edit by blurring it).
  The attachment lightbox (`TaskAttachments.tsx`) is a custom `Portal` overlay, not a nested
  Chakra `<Modal>` — nesting two real `<Modal>`s caused Chakra's `modalManager`/focus-trap to
  treat opening the inner one as an outside-click on the outer task-detail modal and close it.
  **2026-07-26 fix — status actions:** the sidebar Status `<Select>` had dead code gating
  `in-progress`/`done` behind `emp_designation === "L1"`, a legacy synthetic-code check that the
  RBAC rewrite already removed everywhere else (§2) — so in practice those two options only ever
  showed once a task was *already* in that state, and `on-hold` wasn't in the list at all. Fixed:
  the dropdown now always offers all five statuses, and a Pick/Resume · Hold · Done button row
  (mirroring the timeline popover's actions, including the same sequential-completion guard and
  optimistic same-user preemption) was added next to it so a status change doesn't require the
  dropdown at all.
  **2026-07-26 fix — attachment preview-closes-on-click (timeline popover only):** the timeline's
  hover `Popover` (`trigger="hover"`, `isLazy`) rendered `AttachmentThumbnails`' click-to-preview
  lightbox as a nested Chakra `<Modal>` *inside* its own `PopoverContent`. Opening that lightbox
  put a full-viewport overlay directly under the cursor, so the browser re-hit-tested and fired a
  real `mouseleave` on `PopoverContent` — Chakra's hover-popover close timer then fired 500ms
  later and unmounted the whole popover subtree, taking the just-opened lightbox down with it
  (read: "clicking to preview an attachment closes the preview almost immediately"). Fixed by
  lifting the preview state out of `AttachmentThumbnails` (now optionally controlled via an
  `onPreview` prop) up into `TimelineView`, which renders the lightbox `Modal` as a sibling of the
  popovers, not a descendant — so a popover auto-closing no longer touches it. The
  `PendingTasksModal` usage (click-triggered `Modal`, not hover) was unaffected either way and
  still uses `AttachmentThumbnails`' own local-state fallback.
- **Notification center** (see App shell, §10 above) — every in-app notification also fans out
  to **email** (if configured), **Slack** (if `SLACK_WEBHOOK_URL` is set), and **browser push**
  (if the user has enabled it via the popover's Enable/Disable toggle) via `notify()`.
- **Reports** (`/reports`, management) — stat cards, status distribution, 7-day throughput, team-load bars.
- **Profile** (`/profile`) — enriched + **self-editable**: real photo, task stats, contact/role +
  personal (company, work location, joining date + tenure, DOB, blood group, education, LinkedIn,
  reports-to). Users edit their own contact/personal fields (`PUT /profile`); HR-controlled fields
  (id/designation/dept/manager) are read-only.
- **Organization** (`/organization`) — the **full company hierarchy, visible to everyone**
  (org structure is shared information, not access-gated — unlike task/timeline data, which
  stays org-tree scoped). Root = whoever has no manager; every node shows photo, title,
  department, report count, expand/collapse. The signed-in user's own node gets a **"You" badge**
  and a brand highlight, and every ancestor above them auto-expands so they're not buried in a
  now company-wide tree. Keeps the highlighted **"Reports to: X → Y → Z" flow bar** above the
  tree. Real photos via `UserAvatar` (falls back to initials) also appear in the timeline, week
  view and hierarchy popover.
- **Priorities: P0–P4** via central `Utils/priority.ts` (backend stores priority as a free
  string, so existing P0–P2 tasks remain valid).

**Where we are:** P0, full P1, and P1.5 UI redesign complete (incl. the deferred SuperAdmin
restyle), the **timeline actual-history redesign** + all **P1.6 follow-ups** (manual session
edit/split, full Week view, per-dev memoization + row virtualization — see §11), real-time
WebSocket, the **RBAC matrix** (real HRIS designations, org-tree visibility), **foreign keys**,
**Calendar view**, the **real HRIS org data** (roles/hierarchy/enriched profile from
`seed/quillbrook_labs.json`), **editable profile + a full-company org chart**, and the full **P2** set:
task **attachments** (inline base64 images, available on both create and edit), **Slack
notifications**, **saved views**, and **browser web-push** (VAPID + service worker). All four
notification channels — in-app bell, email, Slack, web-push — are done; assignment/reassignment
emails are a full HTML detail card with attachments included (2026-07-26 fix — see `pending.md`
for the root cause). Also shipped 2026-07-26: **open task assignment** (no more hierarchy/rank
gating, §2/§4), the **Jira-style task detail view** (modal + full-page `/tasks/:taskId`, §10),
the **redesigned create-task modal** (Stitch-mockup-matched), and a pass of layout/scroll/button
bugfixes (fixed `Header`, per-modal scroll containment, one shared button glow). Also shipped,
this pass (2026-07-26): the **full P3 set** — pytest (backend) + Vitest/RTL (frontend) test
suites, CI (lint+test+build, both repos), a real dev/prod Docker split
(`docker-compose.prod.yml`, no bind-mount/`--reload`/pgAdmin, no baked-in secrets), observability
(Sentry, `GET /metrics`, documented `/docs`), the overdue sweeper migrated off the in-process
asyncio loop onto **Celery + Celery Beat** (Redis now real broker/backend infra, not just a
startup ping; cross-process WebSocket broadcast bridged via Redis pub/sub), branding
standardized on **Dayline**, an accessibility/mobile pass (keyboard nav, ARIA labels, WCAG AA
contrast fixes, a mobile hamburger+Drawer nav below 768px), and real setup READMEs — and the full
**Future UI/analytics** set: **capacity & utilization metrics** (`GET /capacity`, org-tree
scoped), **skillset tags** (`users.skills`, §9), an **AI Insight panel** (`GET /insights`, Gemini
with key fallback + Redis caching, §7), and the **Organization Resource View** (§7) with its Team
Saturation Heatmap + Resource Efficiency Index gauge. Also shipped, in a follow-up platform-polish
pass: the ruff/eslint lint debt actually triaged and fixed (not just deferred), frontend bundle
code-split (983KB → 51.79KB entry chunk), a live Celery docker-compose smoke test (caught and
fixed a real `create_all()`-breaking bug in `models.py` on fresh Postgres), and a genuine
per-employee `users.timezone` field making `GET /capacity` and the Team Saturation Heatmap
actually vary by timezone instead of assuming one org-wide clock. Also shipped, this pass: the
**"Must Have" AI-powered smart assignment/workload balancer** — `GET /tasks/assignee-suggestions`
(§4) wired into a "Suggested" section in the create-task modal, and `GET /insights`'s
`at_risk_tasks`/`rebalance_suggestions` (§7), surfaced in the AI Insight panel independent of
Gemini's own availability. Also shipped, 2026-07-27 through 2026-07-28: **subtask creation +
progress rollup** (§4/§9) — resolves the former deferred multi-assignee ask via decomposition
(one story, N single-assignee subtasks) instead of a schema overhaul; a full-detail sub-modal
(`SubtaskCreationModal`, a custom `Portal` overlay, not a nested Chakra `Modal`) reachable both
from the create-task modal (staged, atomic batch) and from an already-existing task's own detail
view (`POST /tasks/{id}/subtasks`, immediate); two-way navigation between a story and its
subtasks in `TaskDetailForm`'s own left-column section + parent breadcrumb; migration `0009`
also closed two `task_links` integrity gaps (no unique edge constraint, no composite index) that
predated this feature, applied and verified against the real dev Postgres. Fixed along the way: a
counter-drift bug where deleting a subtask directly left its parent's `subtask_total` stuck
stale (blocking the parent's own deletion with a false 409); all three delete entry points
(task detail, list view, timeline) were silently swallowing the backend's real error message
instead of showing it. **Still open (see `pending.md`):** running migration `0009` against
**prod** Postgres.

---

## 11. Timeline & Time-Tracking Follow-ups — status

The actual-history redesign's follow-ups (were §11 open items) are now largely shipped:

- ✅ **Overdue clock** — sweeper uses `task_due_date` else `ref_time + remaining_seconds`; open-session tasks not swept mid-work.
- ✅ **Runaway open sessions** — auto-held + `time_spent` capped at EOD / max-hours (`close_session_at`, business tz).
- ✅ **Timezone** — pinned to `BUSINESS_TZ` / `VITE_BUSINESS_TZ`; all hour/date math via `zonedHourOfDay` / `getLocalDateKey`.
- ✅ **Session breakdown**, ✅ **planned-vs-actual overlay**, ✅ **legend**, ✅ **a11y**, ✅ **optimistic preempt**.
- ✅ **Manual time correction** — session delete + **edit** (`PATCH /tasks/{id}/sessions`) + **split**
  (`POST /tasks/{id}/sessions/split`); UI via `SessionCorrectionControls` in the timeline popover.
- ✅ **Multi-day** — carry-over markers + a full **Week** view (`WeekView`, users × 7-days worked-time grid).
- ✅ **Perf** — per-dev stable-reference schedule memoization + memoized per-row derivation +
  native `content-visibility` row virtualization in `TimelineView`.

All former 🔸 items are now shipped; `pending.md` tracks the remaining P2/P3/Future work.

---

## 12. Configuration — environment variables for shipped integrations

- **Email (notifications)** — reuse existing Mandrill SMTP keys:
  `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL`.
  Unset ⇒ email is a silent no-op; in-app notifications still work. Assignment/reassignment
  emails (`notify()` → `build_task_email_html`, `email_util.py`) are a full HTML task-detail
  card — priority badge, status, assignee/assigner, due date, duration, tags, notes, an
  "Open in Dayline" link (`FRONTEND_APP_URL`) — with any task attachments sent as real email
  attachments (decoded from the base64 `task_attachments` rows).
- **Slack (notifications)** — `SLACK_WEBHOOK_URL` (a Slack Incoming Webhook). Unset ⇒ silent
  no-op. Posts each notification to the webhook's channel, prefixed with the recipient's name.
  Requires `certifi` (in `requirements.txt`) so outbound HTTPS has a valid CA bundle on macOS
  python.org builds that don't auto-link the system store.
- **Web-push (notifications)** — `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_CLAIMS_EMAIL`
  (`push_util.py`, `pywebpush`). Unset ⇒ silent no-op. Browser subscriptions live in
  `push_subscriptions` (migration `0005_add_push_subscriptions`); `notify()` sends to every
  subscription for the recipient and self-deletes any that come back 404/410 (gone). Frontend:
  `public/sw.js` (service worker, scope `/`) + `Utils/push.ts` +
  `hooks/usePushNotifications.ts`, toggled on/off from the `NotificationCenter` bell popover.
- **Timeline timezone** — `BUSINESS_TIMEZONE` (backend, default `Asia/Kolkata`) / `VITE_BUSINESS_TZ`
  (frontend, same default) — plus `BUSINESS_START_HOUR`/`BUSINESS_END_HOUR`,
  `MAX_OPEN_SESSION_HOURS` for the runaway-session sweeper and the `/capacity` business-day math.
- **Database** — `DATABASE_URL` (Postgres; falls back to a local SQLite file if unset).
- **CORS** — `FRONTEND_ORIGIN` (comma-separated extra origins); any `localhost` port is
  auto-allowed for Vite dev.
- **Sentry error tracking** — `SENTRY_DSN` (unset ⇒ silent no-op, `sentry_sdk` isn't even
  imported), `ENVIRONMENT` (tags events, defaults to `"development"`).
- **Background jobs (Celery)** — `REDIS_DB_CELERY` (default `1`, separate index from the
  session store's), `CELERY_BROKER_URL`/`CELERY_RESULT_BACKEND` (full overrides, derived from
  `REDIS_HOST`/`REDIS_PORT` if unset), `OVERDUE_SWEEP_INTERVAL_SECONDS` (default `60`).
- **AI Insight** (`GET /insights`, shipped 2026-07-26) — `GEMINI_API_KEY` (+ `_2`/`_3` fallback,
  tried in order), `GEMINI_MODEL` (default `gemini-2.0-flash`). Unset/all-fail ⇒ endpoint returns
  `available: false`, not an error. Generated insights are Redis-cached per-caller for 5 minutes.
  Dev `.env` now has real keys reused from another internal service's config, same pattern as this
  app's Mandrill SMTP keys.
- **SSO / OIDC** (`sso_util.py`, shipped 2026-07-27) — `OIDC_ISSUER` / `OIDC_CLIENT_ID` /
  `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` (must exactly match what's registered with the IdP,
  points at this backend's own `/auth/sso/callback`, not the frontend), `OIDC_SCOPES` (default
  `openid email profile`), `OIDC_PROVIDER_LABEL` (button text on the frontend). Unset
  `OIDC_ISSUER` ⇒ `/auth/sso/status` reports disabled and the frontend hides the button; local
  login is unaffected. No dev keys shipped (needs a real IdP app registration — Okta/Azure
  AD/Google Workspace — which nobody has set up for this org yet; see `pending.md`).
