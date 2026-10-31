# Subtask Creation + Collaborator-Assignee — Design Plan

Supersedes the deferred **multi-assignee** item in `pending.md` (P0 section). Verdict: don't
build `task_assignees` (N assignees on one task) — model collaboration as **1 story + N
single-assignee subtasks**. Story progress = subtask completion %. This reuses infra that's
already shipped and sidesteps every hard problem the multi-assignee item was stuck on
(permissions, notify-fanout, view-scope) because each collaborator still owns exactly one
`tasks` row.

---

## 0. Why this resolves the pending multi-assignee item

`pending.md` blocked multi-assignee on 3 unresolved questions. Each is already answered by
using subtasks instead:

| Problem multi-assignee couldn't solve | How subtask model solves it |
|---|---|
| `permissions.py` (`can_modify_task`, `can_view_task`, `get_user_view_scope`) all reason about one scalar `task_assigned_to` — would need a rewrite to "any of N assignees" | Not touched. Each subtask is its own `tasks` row with its own single `task_assigned_to`. Existing single-assignee checks already work correctly on it. |
| `notify()` (`main.py:225-318`) takes one `recipient_id: str`, no fanout | Not touched. Bulk-subtask-create just calls `notify()` once per subtask, same as today's single-assignee call. |
| Schema: join table vs array column, and what "reported by" means with N assignees | Not needed. `task_assigned_by` on the story stays the creator; each subtask has its own assigner/assignee pair, identical to today's model. |

Net: this is additive (new columns, new indexes, one new optional request field, one migration)
— not a rewrite of the assignment model.

---

## 1. Current state (verified in code, not assumed)

- `tasks.task_assigned_to` — single scalar, FK `users.emp_id` (`models.py:110-114`).
- `task_links` (`models.py:183-201`) already models parent/child:
  `link_type="subtask"` → `to_task_id` = **parent**, `from_task_id` = **child**.
  `link_type="depends_on"` → `from_task_id` depends on `to_task_id`.
- `completion_blockers()` (`main.py:321-340`) already blocks a parent from being marked done while
  any child (`from_task_id` rows where `to_task_id == this task`, `link_type="subtask"`) is
  unfinished. This already does the "overall progress depends on subtask completion" gating —
  just as a boolean block, not a %.
- **Gaps** (DBA-relevant, none currently exist):
  - No unique constraint on `task_links(from_task_id, to_task_id, link_type)` — duplicate-link
    guard in `POST /tasks/{id}/links` (`main.py:2907-2913`) is app-level only → race window under
    concurrent writes.
  - No composite index — only the two single-column indexes SQLAlchemy auto-creates from
    `index=True`. Any "get all children of parent X" or "get all subtask parents pointing at X"
    query is index-assisted on one column only, not covering.
  - No progress/count field anywhere (`subtask_total`/`subtask_done` don't exist); `GET /tasks`
    list endpoint (`main.py:1193-1247`) does zero joins against `task_links`.
  - `TaskCreationModal.tsx`'s staged-link panel hardcodes `link_type: "depends_on"`
    (`:216`) — there is currently no way to stage a `subtask` link at creation time. That support
    only exists post-creation, in `TaskLinks.tsx` inside the detail view.
  - `AssigneePicker.tsx` is single-select (confirmed) — correct, does **not** need to change.

---

## 2. Schema changes (DBA)

New Alembic revision `0008_subtask_progress_and_link_integrity`:

```sql
-- Denormalized rollup on the parent (story) row — O(1) read, no join needed on list views.
ALTER TABLE tasks ADD COLUMN subtask_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN subtask_done  INTEGER NOT NULL DEFAULT 0;

-- Backfill from any subtask links that already exist in prod (there may be a handful,
-- created manually via TaskLinks.tsx's existing "subtask-child"/"parent" kind selector).
UPDATE tasks t SET
  subtask_total = sub.total,
  subtask_done  = sub.done
FROM (
  SELECT tl.to_task_id AS parent_id,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE LOWER(c.task_status) IN ('done','completed')) AS done
  FROM task_links tl
  JOIN tasks c ON c.id = tl.from_task_id
  WHERE tl.link_type = 'subtask'
  GROUP BY tl.to_task_id
) sub
WHERE t.id = sub.parent_id;

-- Close the TOCTOU race on duplicate links. Dedupe first (keep lowest id) since no
-- constraint existed before this revision:
DELETE FROM task_links a USING task_links b
WHERE a.id > b.id
  AND a.from_task_id = b.from_task_id
  AND a.to_task_id = b.to_task_id
  AND a.link_type = b.link_type;

CREATE UNIQUE INDEX uq_task_links_edge ON task_links(from_task_id, to_task_id, link_type);

-- Composite indexes for the two access patterns that actually run (parent→children,
-- child→parent), replacing reliance on the single-column indexes for these lookups.
CREATE INDEX ix_task_links_to_type   ON task_links(to_task_id, link_type);
CREATE INDEX ix_task_links_from_type ON task_links(from_task_id, link_type);

-- Optional but recommended: stop "subtask"/"depends_on" typos from ever landing in prod data.
ALTER TABLE task_links ADD CONSTRAINT ck_task_links_type
  CHECK (link_type IN ('subtask','depends_on'));
```

**Depth limit — 2 levels only (story → subtask, no subtask → sub-subtask).** Enforce in
`POST /tasks/{id}/links`: reject a new `subtask` link if the intended parent (`to_task_id`) is
itself already a child in some other `subtask` link. Keeps progress rollup single-hop and avoids
recursive queries. Call this out to the user as a deliberate scope limit, not an oversight.

**Counter maintenance rule — recompute-from-truth, not increment/decrement.** Every write that
touches a subtask edge or a child's status (link add/remove, `PATCH .../status`,
`PUT /tasks/{id}`) re-runs a single grouped aggregate for that one parent and overwrites
`subtask_total`/`subtask_done`, inside the same transaction as the write. Blind +1/-1 drifts
under concurrent edits, manual DB fixes, or retried requests; a targeted re-aggregate is still
O(1) (one indexed query per touched parent, not a table scan) and stays correct.

**Parent deletion policy:** `DELETE /tasks/{id}` on a task with `subtask_total > 0` returns 409
by default ("N subtasks depend on this — delete them first or pass `?cascade=true`"), mirroring
the app's existing "surface a warning instead of failing silently" pattern
(`TaskCreationModal.tsx`'s staged-link failure toast). `cascade=true` deletes children first
(existing FK is already `ondelete="CASCADE"` on `task_links`, but the child `tasks` rows
themselves need an explicit delete loop — cascading `task_links` alone doesn't delete `tasks`).

---

## 3. Backend API changes

### `POST /tasks` — add optional bulk subtask creation

```python
class SubtaskCreate(BaseModel):
    task_name: str
    task_assigned_to: str
    task_priority: str | None = None
    task_duration: str | None = None
    task_due_date: datetime | None = None

class TaskCreate(BaseModel):
    ...  # existing fields unchanged
    subtasks: list[SubtaskCreate] = []
```

Handler: create the story row as today, then — **in the same DB transaction** — for each
`SubtaskCreate`: create a `tasks` row (`task_assigned_by` = story creator), insert
`TaskLink(from_task_id=subtask.id, to_task_id=story.id, link_type="subtask")`, and after commit,
`notify()` once per subtask assignee (existing single-recipient call, looped — no signature
change). Recompute the story's `subtask_total`/`subtask_done` before returning.

Do this **server-side atomically**, not via the frontend's existing client-staged
POST-after-create loop (used today for `depends_on`). Rationale: a staged `depends_on` link
failing post-creation just means a missing link on an already-real task (annoying, recoverable,
already has a warning-toast fallback). A subtask failing post-creation means a **half-created
story** — a collaborator who was told "you own the backend half" but has no task row. That's a
worse failure mode, so it earns a real transaction instead of best-effort.

### `GET /tasks` / `GET /tasks/{id}` — surface progress

Add `subtask_total`, `subtask_done` to `TaskRead` (straight from the new columns — zero added
query cost, since they're already on the row `GET /tasks` fetches).

### No new "list subtasks" endpoint needed

`GET /tasks/{id}/links` already returns everything, and `TaskLinks.tsx:109-113` already computes
a `subtasks` group client-side from it. Frontend just needs to render that group as its own
labeled section instead of leaving it folded into "Links & Dependencies" (see §4).

### Story auto-completion — explicit non-decision

Do **not** auto-flip the story to `done` when the last subtask completes. `completion_blockers`
already prevents the reverse (force-closing early); closing is left to the story owner acting on
the "all subtasks complete" notification (see §5). Keeps a human in the loop instead of a
surprise status flip. Flag this as a decision point in case the user wants auto-close instead —
easy to add later as one `if subtask_done == subtask_total: auto-transition` branch.

---

## 4. Frontend changes

- **`TaskCreationModal.tsx`** — new "Subtasks" panel (separate from the existing "Linked Tasks"
  depends_on-only panel, which is unrelated and stays as-is). Each row: title input +
  `AssigneePicker` (reused as-is, single-select per row — correct, no component change) +
  optional priority/estimate. "+ Add subtask" button. On submit, send the `subtasks: [...]`
  array as one field in the create payload (§3), replacing the client-loop pattern for this case
  only.
- The story's own top-level `AssigneePicker` is unchanged — that's the "overall story" owner
  (e.g. Mira in the example). No special-casing needed; it's just today's single assignee field.
- **`TaskDetailForm.tsx` / `TaskLinks.tsx`** — promote the already-computed `subtasks` group
  (`TaskLinks.tsx:112`) into its own "Subtasks (`subtask_done`/`subtask_total`)" section with a
  thin progress bar, sitting above "Links & Dependencies". Data comes straight off the task
  object already in Redux (no extra fetch).
- **Task list / dashboard / timeline chips** — anywhere a task row renders and
  `subtask_total > 0`, show a small progress pill/bar under the title. Purely additive, data
  already present on the `GET /tasks` row per §3.

---

## 5. Notification behavior

- Story creation → notify story assignee (unchanged).
- Bulk subtask creation → notify each subtask assignee individually (loop over existing
  single-recipient `notify()`, no fanout logic needed anywhere).
- Subtask completion → **don't** notify on every partial tick (would spam the story owner once
  per child). Only notify the story assignee + assigner when the last subtask completes
  (`subtask_done == subtask_total` after the recompute) — "All subtasks done for `<story>`, ready
  to close."

---

## 6. Scale notes (why this holds up beyond a handful of stories)

- **Read path stays O(1) per page.** `GET /tasks` list views don't join `task_links` at all —
  progress comes off denormalized columns already on the row. No N+1, no per-story query.
- **Write path stays O(1) per mutation.** Counter recompute is one indexed aggregate query
  scoped to the single touched parent (`ix_task_links_to_type`), not a scan of the whole
  `task_links` table.
- **Real-time already covered.** Updating the story row's counters is a normal task mutation, so
  the existing `notify_change()` → WebSocket `tasks_changed` broadcast (already shipped, §5 of
  `plan.md`) invalidates it for every connected client same as any other edit — nothing new to
  build there.
- **Depth cap (§2) keeps rollup single-hop** — no recursive CTE ever needed even at large
  story/subtask counts, since a subtask can never itself have subtasks.
- If this ever needs to scale past "org-tree dashboards with hundreds of stories per page"
  (unlikely at this org's size, but noting it): move counter recompute off the request path into
  a Celery task enqueued by the same trigger, since Celery + Redis are already real
  infrastructure in this stack (`plan.md` §12) — not needed at current scale, don't build it now.

---

## 7. Migration / rollout order

1. Ship `0008_subtask_progress_and_link_integrity` (schema, §2) — safe, additive, backfills from
   whatever subtask links already exist.
2. Ship backend: `SubtaskCreate` payload + transactional bulk-create + counter recompute helper +
   `subtask_total`/`subtask_done` in `TaskRead` (§3).
3. Ship frontend: Subtasks panel in create modal, progress section in detail view, progress pill
   on list/dashboard rows (§4).
4. Update `pending.md` — replace the deferred multi-assignee item with a pointer to this doc and
   mark it resolved-by-decomposition rather than "still needs a design decision."
