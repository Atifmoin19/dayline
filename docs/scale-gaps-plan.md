# Dayline — Org-Scale Gap Analysis & Plan

Context: current shipped state (`plan.md`) works well for the actual org today (44 real HRIS
employees, low hundreds of tasks). This doc asks: what breaks / what's missing if this org grows
to **1,000s of employees** and **100s-1000s of concurrent tasks/stories**? Two parts — (A) deep
dive on task/story/subtask management + Timeline/Week/Calendar visualization at that scale, since
that's the core product; (B) gaps in every other module. Ends with a phased plan.

---

## A. Task / Story / Subtask hierarchy — gaps at scale

**Current model:** flat `tasks` table, org-tree scoping, 2-level depth cap (story → subtask, no
sub-subtask), `task_links` for `subtask`/`depends_on`. No grouping concept above a story.

1. **No layer above "story."** There's no Epic/Initiative/Project entity. At 1,000 employees
   running dozens of parallel programs, a cross-team effort (e.g. "Q3 migration") spanning 15
   stories across 4 teams has nowhere to live except a shared tag — no rollup %, no owner, no
   single place to see all its stories. `subtask_total`/`subtask_done` only rolls up one level.
2. **No team/department/project grouping in any view.** Every grouping today is either
   *org-tree* (self + subtree) or *tags* (free text, no hierarchy). A VP wanting "all Payments
   team work this month" across multiple managers' subtrees has no view for it — org-tree
   scoping is strictly hierarchical, not cross-cutting.
3. **Progress invisible outside the detail view — by design, now a real cost.** `pending.md`
   already flags this as a deliberate cut ("no subtask-count/progress pill on Timeline/Week/
   Calendar chips"). Fine at today's task volume; at hundreds of open stories, "open every card to
   see % done" doesn't scale for a manager scanning a board.
4. **No bulk subtask operations.** Adding N collaborators to a story is N manual add-subtask
   actions (staged in the create modal, or one at a time post-creation). CSV task upload
   (`/tasks/upload`) has no subtask column (flagged in `pending.md`) — bulk/admin provisioning of
   multi-person stories isn't possible at all.
5. **No cross-subtask sequencing / critical path.** `depends_on` links exist but are manual,
   1-hop, and not story-aware — a story with "backend subtask blocks frontend subtask" only works
   if someone remembers to add that specific link. No auto-detected critical path, no "this whole
   story is blocked because subtask #3 of 5 is stuck" surfaced anywhere but the detail view.
6. **No dependency graph view.** `TaskLinks.tsx` shows one hop (blocks/depends-on badges). A
   program with dozens of interlinked stories has no visual graph — impossible to spot a cycle or
   a critical bottleneck without manually clicking through each task.
7. **Depth cap of 2 is a real ceiling, not just a "current" limit.** Fine for story+subtask; a
   true Epic→Story→Subtask→Task breakdown (common at larger orgs) doesn't fit without either
   raising the cap (reopening the recursive-query problem it was designed to avoid) or adding a
   genuinely separate Epic entity above the existing 2-level model (recommended — keeps subtask
   rollup simple, adds one new table instead of relaxing the cap).

---

## B. Timeline / Week / Calendar — gaps at scale

**Current model:** per-developer horizontal rows (Timeline), users×7-days grid (Week), month grid
(Calendar) — all org-tree scoped, row-virtualized, no cross-team grouping.

1. **Row count at the top of the org.** A CTO/VP's "subtree" *is* the whole company at 1,000
   employees. Row virtualization (`content-visibility`) helps rendering, but there's no
   in-timeline search-by-name/team filter — today's only filter is the "All Members" manager
   dropdown (a flat list, presumably of *managers*, not a typeahead over 1,000 names). Finding one
   person's row in a 1,000-row timeline by scrolling doesn't work.
2. **No saved custom team views for Timeline/Week.** `useSavedViews` (saved filter presets) only
   exists for the Task List toolbar (status/priority/search combos). A lead who cuts across two
   managers' subtrees (a cross-functional squad) can't save "these 8 people" as a Timeline view —
   org-tree scoping is the only lens.
3. **Calendar month-cell overflow is unaddressed.** At low task volume, a day cell holding a
   handful of task chips is fine. At org scale (hundreds of tasks/day across a subtree), nothing
   in `plan.md` describes a "+N more" overflow affordance for a day with dozens of items — likely
   renders unbounded or clips silently.
4. **No roadmap/Gantt view.** Timeline is a single-day, per-person, hour-grain view. Week is
   7-days × person, worked-time grain. Calendar is a month grid of individual task chips. None of
   the three show a *story's* date range across weeks/months — there's no way to see "these 12
   stories run Jul–Sep across 4 teams" at a glance. This is the natural view for portfolio/roadmap
   planning at org scale and doesn't exist in any form today.
5. **No sprint/cycle concept, so no burndown/velocity.** Everything is continuous, todo→done per
   task, with no time-boxed grouping. An org planning quarterly/sprintly can't see velocity trends
   or a burndown chart — `Reports` has static stat cards (status distribution, 7-day throughput)
   but no cycle-over-cycle comparison.
6. **Organization Resource View's capacity horizon is 48h only** (`GET /capacity` — "today/
   tomorrow, all it currently provides," per `plan.md` §7). At org scale, staffing/hiring
   decisions need a multi-week or quarterly forecast, not a 2-day window.
7. **Org chart itself has no search.** `/organization` renders the full company tree with
   expand/collapse and auto-expands the viewer's own ancestor chain — but at 1,000 employees,
   finding an arbitrary person requires manually expanding branches; no name search/jump-to.

---

## C. Other module gaps (non-task)

Pulled from `plan.md`/`bugs.md`/`pending.md` plus scale-specific reasoning:

1. **No SSO/SAML/OIDC.** Auth is email/password + opaque token only. A 1,000-employee org
   virtually always expects IdP login (Okta/Azure AD/Google Workspace) — none exists; provisioning
   is 100% via `seed_demo.py` + manual CSV, no directory sync.
2. **Open self-registration still live (bugs.md S5, still ⬜).** Anyone can self-register from
   the login screen with no invite/domain gate — a real security hole that gets worse, not
   better, as headcount grows (bigger attack surface, harder to notice a rogue signup).
3. **No org-wide audit log.** Per-task activity log exists (`task_comments.is_system`), but
   nothing cross-cutting logs admin actions — user deletion, role/manager changes, bulk imports.
   At 1,000-employee scale this is a compliance gap (who changed X, when).
4. **RBAC is a single boolean gate, not scoped permissions.** `is_admin` (rank ≥ 4) is all-or-
   nothing for user management. No dept-scoped admin, no read-only auditor role, no way to grant
   "manage users in Team X only" without full org-wide admin rank.
5. **No SLA/escalation.** The overdue sweeper auto-holds/flags a task but never escalates up the
   manager chain after N days overdue — at scale, overdue work silently accumulates unless someone
   manually scans for it.
6. **Rate limiting only covers `/login`/`/register`** (bugs.md S8). Every other endpoint —
   `/tasks`, `/user`, uploads — is unprotected against scripted abuse, which matters more with
   1,000 live accounts than with 44.
7. **Org-tree traversal has no caching layer.** `get_all_subordinates` was fixed from N+1 to a
   single query + in-memory walk (bugs.md), which is fine at 44 rows; unverified at 1,000+ rows
   per request on every scoped endpoint (`/tasks`, `/capacity`, `/insights`, timeline views).
8. **SQLite silent fallback if `DATABASE_URL` unset** (bugs.md, still ⬜) — a real footgun for
   any future prod-like environment stood up carelessly at scale.
9. **`docker-compose` still ships dev config by default** (bugs.md, still ⬜) — bind-mounts,
   default pgAdmin creds, no separation from the prod compose file unless explicitly chosen.
10. **No CSV/PDF export or scheduled reports.** `Reports` is view-only; leadership decks / board
    reporting at org scale typically need an export or a scheduled email digest, neither exists.
11. **Full regression suite not re-run since the subtask feature** (`pending.md`, still ⬜) —
    a correctness gap to close before building more on top.
12. **Migration `0009` not yet applied to prod** (`pending.md` P0) — blocks everything else
    listed here; must land first.

---

## Phased Plan

### Phase 0 — close what's already flagged (prerequisite, not new scope)

- Run migration `0009` on prod (the one open P0 item).
- Re-run full
- `pytest`/`Vitest` suite post-subtask-feature.
- Close S5 (gate self-registration behind invite/admin, or disable and rely solely on HRIS
  import).
- Fix SQLite silent fallback (loud warning or hard-fail without `DATABASE_URL` in non-dev).
- Split docker-compose so prod never gets dev defaults by accident (partially done —
  `docker-compose.prod.yml` exists per `plan.md`; confirm it's the one actually deployed).

### Phase 1 — hierarchy & grouping (task model) — ✅ shipped 2026-07-27

- ✅ **Epic entity** one level above Story — new `epics` table (migration `0010`, applied +
  verified against dev Postgres), `tasks.epic_id` (nullable FK, `SET NULL` on epic delete).
  Owner (defaults to creator) + status + department (informational, not a scope filter — an
  epic spans teams by definition). Rollup (`story_total`/`story_done`/`progress_pct`) computed
  live on read from linked stories (not denormalized — this is a low-frequency dashboard read,
  unlike the subtask counters' hot-path). `GET/POST/PUT/DELETE /epics`, `GET /epics/{id}` (+
  linked stories). Company-wide visibility (like the org chart, not org-tree scoped); create is
  open to any user, edit/delete gated to owner/creator/admin (`permissions.can_modify_epic`).
  Frontend: `/epics` list page, `/epics/:epicId` detail (inline-editable, story list, delete),
  create modal, and an `EpicPicker` wired into both `TaskCreationModal` (stories only) and
  `TaskDetailForm`'s sidebar (hidden on a subtask's own page, same check used to hide "+ Add
  Subtask" there).
- ✅ **Department as a first-class filter** — `GET /tasks?department=` (backend, intersects with
  org-tree scope) and a client-side department dropdown in `TaskListingView`'s toolbar (sourced
  from the org directory already in Redux, same pattern as the existing status/priority filters).
- ✅ **Bulk subtask support in CSV upload** (`/tasks/upload`) — optional `row_ref`/`subtask_of`
  columns (subtask_of points at another row's row_ref in the same file, or an existing task's
  real id) plus an `epic_id` column to roll a story into an existing Epic straight from CSV.
  Sample template + in-page instructions updated to match.
- ✅ **Dependency graph view** — `GET /tasks/{id}/graph` (backend BFS over subtask/depends_on
  edges reachable from a task, capped at `MAX_GRAPH_NODES=200`, returns `truncated` if hit) +
  a "View graph" button in `TaskDetailForm`'s Links & Dependencies header opening a custom
  Portal-overlay SVG node/edge render (`TaskGraphView.tsx` — simple BFS-layered layout, no new
  charting dependency, same nested-modal-avoidance pattern as the attachment lightbox).

All four items verified end-to-end against the live dev Postgres + a real browser pass (create
epic → link a story via the create-modal picker → confirm rollup on the epic detail page →
confirm the Epic field + graph button on the task detail view → confirm the department filter
narrows the task list) — zero console errors, `tsc`/`eslint` clean project-wide.

### Phase 2 — visualization at scale — ✅ shipped 2026-07-27

- ✅ **Progress pill on Timeline/Week/Calendar chips** — compact "done/total" badge
  (`SubtaskProgressPill.tsx`) on any chip/segment/swimlane label where `subtask_total > 0`;
  renders nothing for a leaf task, so density is unchanged for the common case.
- ✅ **Search/typeahead filter in Timeline/Week views** — `MemberSearchFilter.tsx` (modeled on
  `AssigneePicker`'s searchable-combobox UX, but multi-select and row-filtering rather than
  single-assignee) narrows visible rows in `TimelineView`/`WeekView` on top of org-tree scoping.
- ✅ **Saved custom team views** for Timeline/Week — `useSavedViews` gained an optional
  `namespace` (Task List's own key/behavior is 100% unchanged — verified via its existing test
  suite) + an optional `memberIds` field; `SavedTeamViewsPopover.tsx` saves/applies a named set
  of people, independent of org-tree subtrees.
- ✅ **Calendar month-cell overflow handling** — dense days show capped chips + a "+N more"
  `Popover` listing every remaining task for that day (click any to open its detail), replacing
  the old single-hidden-task badge.
- ✅ **Roadmap/Gantt view** (`/roadmap`, new nav entry) — week/month-grain horizontal bars per
  Epic over `start_date`/`target_date` (added to Epic via migration `0011`), adaptive gridline
  grain, a "today" marker, progress fill, click-through to the epic. Epics with neither date set
  are called out with a count hint rather than silently omitted. Plain Chakra/CSS, no charting
  library (same convention as `TaskGraphView.tsx`).
- ✅ **Sprint/Cycle entity + burndown/velocity** — new `sprints` table (migration `0012`,
  `tasks.sprint_id`), full CRUD (`/sprints`, `/sprints/{id}`, company-wide like Epics, creator/
  admin-gated edit/delete) + `GET /sprints/{id}/burndown` (ideal-vs-actual, reconstructed from
  each task's real `completed_at` against `task_duration` as the scope unit — no snapshot table
  needed). Frontend: `/sprints` list + detail (mirrors the Epics pages exactly), an inline-SVG
  burndown chart (`SprintBurndownChart.tsx`), a `SprintPicker` wired into both the create-task
  modal and task-detail sidebar (independent of Epic — a sprint is a slice of time, not scope,
  so it's available on subtasks too, unlike Epic), and a "Velocity — Completed Hours by Sprint"
  panel in Reports.
- ✅ **`/capacity` multi-week horizon** — `days` query param (default 2 = unchanged "next-48h"
  behavior for every existing caller, clamped to `MAX_CAPACITY_HORIZON_DAYS=28`); the backlog
  bin-pack generalized from a hardcoded 2-day window to N days. `OrganizationResourceView` got
  a horizon selector (2/7/14/28 days) driving both the Saturation Heatmap and the per-employee
  availability bars, which already rendered generically over `days` and needed no further change.
- ✅ **Name-search on the `/organization` tree** — a search box highlights matching name/
  designation nodes in place (not hiding non-matches, to keep hierarchy context) and generalizes
  the existing "auto-expand viewer's own ancestor chain" logic to any matched employee.

All items verified: migrations applied + functionally exercised against the live dev Postgres
(sprint/epic CRUD, burndown reconstruction from a real `completed_at`, capacity horizon at
2/7/28 days), full project-wide `tsc`/`eslint` clean, `vitest` 126/126 passing, and a real
browser pass (create sprint → attach a task via the new picker → confirm rollup/burndown →
roadmap → reports velocity panel → timeline progress pill/member filter/saved views → calendar
overflow popover → org search) — zero console errors. One bug found and fixed during the browser
pass: a duplicate-key React warning in the burndown chart's Y-axis ticks when an empty sprint's
scope floors to a 1-hour axis (0/0.5/1 all rounding to the same tick) — deduped.

### Phase 3 — platform gaps for a 1,000+-employee org

- ✅ **SSO/OIDC integration** (2026-07-27) — generic OIDC client (`sso_util.py`) alongside local
  auth, works unchanged against Okta/Azure AD/Google Workspace (shared discovery+JWKS protocol).
  `GET/POST /auth/sso/status|login|callback` + `GET /auth/me`; frontend `SsoBootstrap.tsx` +
  a conditional button in `login.tsx`. Deliberately never auto-provisions — an IdP login for an
  email with no matching HRIS-imported `users` row is rejected, not created. 12 new backend
  tests (`tests/test_sso.py`), all passing; `tsc`/`eslint` clean. **Not yet live anywhere** — no
  IdP app registration exists for this org, so `OIDC_ISSUER` etc. are unset in every
  environment (see `pending.md`); this is a credentials/ops gap, not a code one.
- ✅ **Org-wide audit log** (2026-07-27) — `audit_util.py`/`audit_log` table (migration `0013`),
  wired into user create/update/delete/bulk-delete/CSV-import + task CSV-import. `GET
  /audit-log` (admin-only) + a new Audit Log admin page. 8 new backend tests, all passing;
  verified end-to-end against the live dev Postgres via a real browser pass. Found and fixed a
  real bug along the way: `POST /user`/`/users/upload` could 500 against Postgres from a
  flush-ordering race between the `User` and `Foundation` inserts (SQLite, what the test suite
  runs against, never enforces the FK that exposes it) — both now explicitly `db.flush()`
  between the two inserts.
- Scoped RBAC (dept-scoped admin, read-only auditor role) beyond today's single admin-rank gate.
- SLA/escalation on overdue tasks (notify up the manager chain after N days, not just flag/hold).
- Rate limiting broadened past `/login`/`/register` to the full mutation surface.
- Caching layer for org-tree traversal (`get_all_subordinates`) if it proves slow at real scale.
- CSV/PDF export or scheduled email digest for Reports.

Each phase is independently shippable; Phase 0 is a hard prerequisite (open correctness/security
items), Phases 1–3 can reorder based on which pain shows up first as headcount/task volume grows.
