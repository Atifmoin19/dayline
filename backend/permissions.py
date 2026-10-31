"""
permissions.py — Central RBAC / permissions matrix.

Single source of truth for role ranks and EVERY authorization decision in the app.
Before this module the rank checks (`get_rank(...) >= 3`, inline assignee/manager
booleans, `ADMIN_DESIGNATIONS`) were copy-pasted across many endpoints in `main.py`;
they now live here as named predicates so there is exactly one place that decides
"who may do what".

All predicates are pure functions of (a db session, the acting `User`, and the target
object). They never raise for a plain deny — they return a bool, and the caller turns
that into a 403. The two historical `validate_*` helpers keep raising HTTPException
because they encode *form-validation* rules (bad hierarchy input), not access control.

=========================================================================
PERMISSION MATRIX
=========================================================================
Capability                        | Allowed for
----------------------------------|-------------------------------------
Manage users                      | the management tier — rank >= EM (4)  OR
  (create/edit/delete/bulk/import)|   an admin role (execs / eng+product managers)
View another user's data / tasks  | self, or target is anywhere in the actor's
  (get_tasks scope)               |   subtree — PURE ORG TREE, not rank-gated
                                  |   (anyone with reports sees them, incl. lead ICs)
Be assignable a task              | anyone, any rank (open — no longer gated by rank)
Assign a task to X                | anyone (open — no longer gated by hierarchy)
Create / update / status / delete | task assignee, task assigner, admin, or
  a task; edit its sessions       |   the assignee is the actor's subordinate
View a task's comments & links;   | anyone who can view the task's assignee
  add a comment                   |   (same subtree scope as get_tasks)
Add / remove a structural link    | same as "modify a task"
Delete a comment                  | the comment's author, or admin
Be your own manager               | rank >= CTO (5)
Manager outranks their report     | manager rank strictly > report rank
Manage users (dept_admin grant)   | scoped to the dept_admin's OWN emp_department only —
                                  |   cannot touch other departments, grant special_role,
                                  |   or create/promote into the rank>=EM management tier
View admin surfaces (audit log,   | full admin, dept_admin, OR auditor (auditor is
  enriched user directory)       |   read-only — never passes a manage/modify check)
=========================================================================

`users.special_role` (nullable: null / "dept_admin" / "auditor") is a scoped-admin GRANT,
independent of `emp_designation`/rank — see is_dept_admin/is_auditor below. Only a full
(rank-based) admin may set it (can_grant_special_role); it is never self-editable.

Reconciled role gaps (were noted in pending.md):
- ASE     — was rank 0 ("unknown") on the backend; the frontend already treats it
            as a rank-1 IC. Set to 1 so it is a real, assignable designation.
- PRODUCT — was rank 0 on the backend but rescued only by ADMIN_DESIGNATIONS, so a
            PRODUCT user could pass the admin gate yet get a *self-only* view scope
            (rank 0 < 2) and could never be a valid manager. The frontend treats
            PRODUCT as a super-admin (rank 5). Set to 5 so admin gate, view scope and
            manager validation all agree.
"""


from fastapi import HTTPException

from models import User as UserModel

# ---------------------------------------------------------------------------
# Rank thresholds — named so call sites read as intent, not magic numbers.
# ---------------------------------------------------------------------------
RANK_IC = 1          # individual contributor (SE tiers, TL, ASE, developer)
RANK_L1 = 2          # first-line manager — sees direct/indirect reports
RANK_L2 = 3          # admin floor — user-management capability
RANK_EM = 4          # admin gate floor (task assignability is no longer rank-gated)
RANK_CTO = 5         # may be their own manager
RANK_SUPERADMIN = 6
RANK_OWNER = 7

# Numeric hierarchy, keyed by designation (UPPER-cased for case-insensitive lookup).
# Job titles (designations) are the ONLY source of roles — the
# older synthetic codes (SE1/L1/L2/EM/CTO/…) are intentionally NOT present. Rank drives ONLY
# the admin gate (rank >= EM/4 manages users) — task assignability is open to every rank.
# VISIBILITY is the org tree, not rank (see get_user_view_scope).
HIERARCHY_RANKS = {
    # 5 — top executives
    "CHIEF TECHNOLOGY OFFICER": 5,
    "CHIEF INFORMATION SECURITY OFFICER": 5,
    "VICE PRESIDENT, ENGINEERING": 5,
    # 4 — senior management (not assignable, admin)
    "DIRECTOR OF PRODUCT": 4,
    "ENGINEERING MANAGER": 4,
    # 3 — managers / leads
    "SENIOR PRODUCT MANAGER": 3,
    "LEAD": 3,
    "OPERATIONS LEAD": 3,
    "TECH LEAD": 3,
    "TEAM LEAD": 3,
    # 2 — senior individual contributors
    "SENIOR SOFTWARE ENGINEER": 2,
    "SENIOR QA ENGINEER": 2,
    "SENIOR DEVOPS ENGINEER": 2,
    "SENIOR OPERATIONS ASSOCIATE": 2,
    "UI/UX DESIGNER": 2,
    # 1 — individual contributors / junior
    "SOFTWARE ENGINEER": 1,
    "ASSOCIATE SOFTWARE ENGINEER": 1,
    "QA ENGINEER": 1,
    "ASSOCIATE QA ENGINEER": 1,
    "OPERATIONS ASSOCIATE": 1,
    "MACHINE LEARNING INTERN": 1,
    "SOFTWARE ENGINEERING INTERN": 1,
}

# Designations that may manage users — the management tier (rank >= EM/4).
ADMIN_DESIGNATIONS = {
    "CHIEF TECHNOLOGY OFFICER",
    "CHIEF INFORMATION SECURITY OFFICER",
    "VICE PRESIDENT, ENGINEERING",
    "DIRECTOR OF PRODUCT",
    "ENGINEERING MANAGER",
}


# ---------------------------------------------------------------------------
# Workspaces (tenancy). NULL = the real organisation; a value = a POST /demo sandbox.
# Users never see, assign to or modify anything outside their own workspace.
# ---------------------------------------------------------------------------
def workspace_clause(column, workspace_id):
    """SQL filter matching `column` to `workspace_id`, treating None as the real org."""
    return column.is_(None) if workspace_id is None else column == workspace_id


def users_in_workspace(db, workspace_id):
    return db.query(UserModel).filter(workspace_clause(UserModel.workspace_id, workspace_id))


def same_workspace(db, actor: UserModel, target_emp_id: str | None) -> bool:
    if not target_emp_id:
        return False
    row = db.query(UserModel.workspace_id).filter(UserModel.emp_id == target_emp_id).first()
    return row is not None and row[0] == actor.workspace_id


def get_rank(designation: str | None) -> int:
    """Numeric rank for a designation (0 for unknown/blank). Case-insensitive."""
    if not designation:
        return 0
    return HIERARCHY_RANKS.get(designation.upper(), 0)


# ---------------------------------------------------------------------------
# Hierarchy / view scope
# ---------------------------------------------------------------------------
def get_all_subordinates(db, manager_emp_id: str) -> set:
    """All subordinates (direct + indirect) of a manager, as a set of emp_ids.

    Loads the (emp_id, manager_id) edges in ONE query and walks the tree in memory
    (no N+1). The seen-set makes it cycle-safe.
    """
    rows = db.query(UserModel.emp_id, UserModel.manager_id).all()
    children: dict = {}
    for emp_id, mgr_id in rows:
        children.setdefault(mgr_id, []).append(emp_id)

    subordinates: set = set()
    stack = list(children.get(manager_emp_id, []))
    while stack:
        eid = stack.pop()
        if eid in subordinates:
            continue
        subordinates.add(eid)
        stack.extend(children.get(eid, []))
    return subordinates


def get_user_view_scope(db, emp_id: str) -> set:
    """emp_ids whose data `emp_id` may see: self + ALL reports (direct + indirect).

    Visibility is driven purely by the org tree, NOT by designation rank — real job titles
    don't encode management level (e.g. a "Software Engineer" or "Tech Lead" can have reports),
    so anyone with reports sees their subtree. A pure IC has no reports → sees only themselves.
    """
    user = db.query(UserModel).filter(UserModel.emp_id == emp_id).first()
    if not user:
        return set()
    return {emp_id} | get_all_subordinates(db, emp_id)


# ---------------------------------------------------------------------------
# Role capability predicates (return bool — caller raises 403 on False)
# ---------------------------------------------------------------------------
def is_admin(user: UserModel) -> bool:
    """Administrative caller (may manage users, blanket-modify tasks): the management tier —
    rank >= EM (4), or a designated admin role. Leads/senior ICs are NOT admins; they still
    act on their own subtree via the org-tree checks."""
    designation = (user.emp_designation or "").upper()
    return get_rank(user.emp_designation) >= RANK_EM or designation in ADMIN_DESIGNATIONS


# User-management gate is the same capability as `is_admin`; named separately so the
# call site documents *why* (managing users) rather than *how* (rank check).
can_manage_users = is_admin


# ---------------------------------------------------------------------------
# Scoped admin grants (scale-gaps-plan.md Phase 3, item 3) — `users.special_role`,
# independent of the rank-based `is_admin` above. A rank-4+ admin is still org-wide;
# these are narrower, explicit grants a full admin hands out.
# ---------------------------------------------------------------------------
def is_dept_admin(user: UserModel) -> bool:
    """Department-scoped admin: may manage users, but only within their own
    `emp_department` (checked per-target at the call site, not here — this predicate
    only answers "does this grant exist", not "for this specific target")."""
    return (getattr(user, "special_role", None) or "") == "dept_admin"


def is_auditor(user: UserModel) -> bool:
    """Read-only visibility into admin surfaces (audit log, enriched user directory).
    Never a mutation gate — an auditor must never pass a `can_manage_*`/`can_modify_*`
    check on its own."""
    return (getattr(user, "special_role", None) or "") == "auditor"


def can_manage_users_at_all(user: UserModel) -> bool:
    """True if `user` may reach the user-management surface in ANY capacity — a full
    admin (unscoped) or a dept_admin (scoped, checked per-target via
    `can_manage_department`). Auditors do NOT pass this — they are read-only."""
    return is_admin(user) or is_dept_admin(user)


def can_view_admin_surfaces(user: UserModel) -> bool:
    """True if `user` may view admin-only READ surfaces (audit log, enriched user
    directory): full admin, dept_admin, or auditor. Broader than
    `can_manage_users_at_all` — this is the read gate, not the write gate."""
    return is_admin(user) or is_dept_admin(user) or is_auditor(user)


def can_manage_department(user: UserModel, target_department: str | None) -> bool:
    """True if `user` may create/edit/delete a user belonging to `target_department`.
    Full admins manage any department; a dept_admin only their own (and only if their
    own `emp_department` is actually set — an unset department scopes to nothing,
    never to "everything")."""
    if is_admin(user):
        return True
    if not is_dept_admin(user):
        return False
    own_department = getattr(user, "emp_department", None)
    return bool(own_department) and own_department == target_department


def can_grant_special_role(user: UserModel) -> bool:
    """Only a full (rank-based) admin may set/change `special_role` on another user —
    a dept_admin granting themselves or a peer `dept_admin`/`auditor` would be a
    privilege escalation the whole scoping exercise is meant to prevent."""
    return is_admin(user)


def can_assign_designation(user: UserModel, target_designation: str | None) -> bool:
    """A dept_admin may not create/promote someone INTO the rank-4+ management tier —
    that would let a department-scoped grant mint a new org-wide admin. Full admins are
    unrestricted."""
    if is_admin(user):
        return True
    return get_rank(target_designation) < RANK_EM


def can_view_user(db, actor: UserModel, target_emp_id: str) -> bool:
    """True if `actor` may see `target_emp_id`'s data (self or within their subtree)."""
    return target_emp_id in get_user_view_scope(db, actor.emp_id)


def can_view_task(db, actor: UserModel, task) -> bool:
    """True if `actor` may view a task (its assignee is in the actor's view scope)."""
    return can_view_user(db, actor, task.task_assigned_to)


def can_modify_task(db, actor: UserModel, task) -> bool:
    """True if `actor` may mutate a task (create/update/status/delete/sessions).

    Assignee, assigner, an admin, or a manager in whose subtree the assignee sits.
    This is the exact predicate the delete endpoints already used, now shared.
    """
    if not same_workspace(db, actor, task.task_assigned_to or task.task_assigned_by):
        return False
    if is_admin(actor):
        return True
    if task.task_assigned_to == actor.emp_id:
        return True
    if task.task_assigned_by == actor.emp_id:
        return True
    return task.task_assigned_to in get_all_subordinates(db, actor.emp_id)


def can_assign_task_to(db, actor: UserModel, target_emp_id: str) -> bool:
    """True if `actor` may assign a task TO `target_emp_id`.

    Assignment is open to anyone in the org, in any direction (self, subordinate, peer,
    or a senior/manager/exec) — hierarchy no longer gates who can be handed a task. Kept
    as a named predicate (rather than removed) so call sites keep a single place to read
    "who may assign to whom" from, and so a future rule change has one place to land.
    The one hard boundary is the workspace: never across organisations / demo sandboxes.
    """
    return same_workspace(db, actor, target_emp_id)


def can_delete_comment(actor: UserModel, comment) -> bool:
    """A comment's author, or an admin, may delete it."""
    return comment.author_id == actor.emp_id or is_admin(actor)


def can_modify_sprint(actor: UserModel, sprint) -> bool:
    """True if `actor` may edit/delete a Sprint/Cycle: its creator, or an admin. Unlike Epic
    there's no separate "owner" concept — a sprint is a shared time cadence, not something one
    person is put in charge of running."""
    if is_admin(actor):
        return True
    return sprint.created_by == actor.emp_id


def can_modify_epic(actor: UserModel, epic) -> bool:
    """True if `actor` may edit/delete an Epic: its owner, its creator, or an admin.

    Epics are visible company-wide (like the org chart — a cross-team initiative isn't
    any one manager's subtree), so viewing has no gate; only mutation is restricted.
    """
    if is_admin(actor):
        return True
    if epic.owner_id == actor.emp_id:
        return True
    return epic.created_by == actor.emp_id


# ---------------------------------------------------------------------------
# Form-validation helpers (raise HTTPException — these are input rules, not RBAC)
# ---------------------------------------------------------------------------
def validate_manager_hierarchy(
    db, manager_id: str, employee_designation: str, employee_id: str | None = None
):
    """Validate that a manager exists and outranks the employee.
    Allows self-management for rank >= CTO (5). Raises HTTPException on violation."""
    manager = db.query(UserModel).filter(UserModel.emp_id == manager_id).first()
    if not manager:
        raise HTTPException(status_code=400, detail=f"Manager with ID {manager_id} not found")

    manager_rank = get_rank(manager.emp_designation)
    employee_rank = get_rank(employee_designation)

    # Self-management first.
    if employee_id and manager_id == employee_id:
        if employee_rank >= RANK_CTO:
            return True
        raise HTTPException(
            status_code=400,
            detail="Only hierarchies of Level 5 (CTO/Admin) and above can be their own manager.",
        )

    # Standard check: manager must be strictly higher.
    if manager_rank <= employee_rank:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid Hierarchy: Manager ({manager.emp_designation}) must be higher "
                f"rank than Employee ({employee_designation})"
            ),
        )
    return True


def validate_assignee_eligibility(user: UserModel):
    """Any user, at any rank, may be assigned a task — EM+/execs included.

    Kept as a call-through (rather than deleting its call sites in main.py) so a future
    eligibility rule (e.g. deactivated accounts) has one place to land.
    """
    return True
