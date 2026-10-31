import os
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dotenv import load_dotenv
from pydantic import BaseModel, field_validator
from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()

Base = declarative_base()

# SQLAlchemy ORM models
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    emp_name = Column(String(255), nullable=False)
    # `unique=True` alone (no separate `index=True`) is deliberate: SQLAlchemy emits an
    # inline UNIQUE constraint as part of CREATE TABLE for `unique=True`-only columns, but
    # defers to a separate CREATE UNIQUE INDEX statement (run after all tables exist) when
    # `index=True` is ALSO set. That deferral broke `create_all()` against a genuinely fresh
    # Postgres DB — `manager_id`'s self-referential FK below needs `emp_id`'s uniqueness to
    # exist within this same CREATE TABLE statement, not in a later one. `unique=True` alone
    # already creates an index in Postgres, so nothing is lost.
    emp_id = Column(String(64), unique=True, nullable=False)
    emp_email = Column(String(255), unique=True, nullable=False)
    emp_phone = Column(String(32), nullable=True)
    emp_designation = Column(String(128), nullable=True)  # real title, e.g. "Engineering Manager"
    emp_department = Column(String(128), nullable=True)
    emp_hierarchy = Column(String(128), nullable=True)
    # Self-referential: a manager is another user (by emp_id). Deleting the manager
    # leaves reports manager-less rather than deleting them.
    manager_id = Column(
        String(64),
        ForeignKey("users.emp_id", ondelete="SET NULL", name="fk_users_manager_id"),
        nullable=True,
    )

    # ── Enriched HRIS profile (imported from an org-chart seed) — stored for future use ──
    node_id = Column(String(64), nullable=True, index=True)     # HRIS internal node id (optional)
    hris_user_id = Column(String(64), nullable=True)            # external HRIS user id (optional)
    company = Column(String(128), nullable=True)                # legal company / entity name
    legal_entity = Column(String(255), nullable=True)
    gender = Column(String(32), nullable=True)
    work_location = Column(String(255), nullable=True)
    date_of_joining = Column(String(32), nullable=True)         # kept as source string (varied formats)
    date_of_birth = Column(String(32), nullable=True)
    blood_group = Column(String(8), nullable=True)
    payscale = Column(String(64), nullable=True)
    education = Column(JSON, nullable=True)                     # list of degree labels
    linkedin = Column(String(512), nullable=True)
    profile_pic = Column(String(1024), nullable=True)          # URL, or initials fallback

    # ── Skills tagging (v1 — free-text tags, not a controlled taxonomy) ──
    # Self-editable via PUT /profile, admin-editable via PUT /user/{emp_id}. Feeds the
    # upcoming Org Resource View. list[str], default [] so a fresh user has "no tags" rather
    # than NULL (avoids every call site needing a `skills or []` guard).
    skills = Column(JSON, nullable=True, default=list)

    # ── Per-employee timezone (v1) ──
    # IANA tz name (e.g. "Asia/Kolkata", "America/New_York"). Self-editable via PUT
    # /profile, admin-editable via PUT /user/{emp_id} — same pattern as `skills`. Used by
    # GET /capacity so THIS employee's day-boundary/business-hours math is computed in
    # their own timezone rather than the single global BUSINESS_TIMEZONE. Nullable — most
    # existing users (loaded by seed_demo.py) won't have this set; callers fall
    # back to BUSINESS_TIMEZONE (task_helpers.BUSINESS_TZ) when null, so this is additive,
    # not a hard requirement.
    timezone = Column(String(64), nullable=True)

    # ── Scoped-admin grants (scale-gaps-plan.md Phase 3, item 3) ──
    # NULL for everyone by default. "dept_admin" grants user-management (create/edit/delete)
    # SCOPED to this employee's own `emp_department` — narrower than the existing rank-based
    # `is_admin` (rank >= EM), which is org-wide. "auditor" grants read-only visibility into
    # admin surfaces (audit log, the enriched user directory) with NO mutation rights at all.
    # Deliberately independent of `emp_designation`/rank — a grant, not a job title. Settable
    # ONLY by a full (rank-based) admin (enforced in main.py, not here); never self-editable
    # (absent from ProfileSelfUpdate).
    special_role = Column(String(32), nullable=True)

class Foundation(Base):
    __tablename__ = "foundation"

    id = Column(Integer, primary_key=True, index=True)
    # 1:1 with User. Deleting the user removes their credentials too.
    emp_id = Column(
        String(64),
        ForeignKey("users.emp_id", ondelete="CASCADE", name="fk_foundation_emp_id"),
        unique=True, nullable=False,
    )
    password = Column(String(255), nullable=False)
    token = Column(String(255), nullable=True)
    last_active_at = Column(DateTime(timezone=True), nullable=True)
    # False until the onboarding wizard (or /register) sets a real password, replacing the
    # bulk-reset default. Backfilled by migration 0015 for pre-existing rows; drives the
    # admin panel's onboarded/pending listing without a per-row bcrypt check on every load.
    is_onboarded = Column(Boolean, nullable=False, default=False)

class Task(Base):
    __tablename__ = "tasks"


    id = Column(String(64), primary_key=True, index=True)
    # Human-facing reference shown in the UI (e.g. "T-38291"), separate from the internal `id`.
    # Generated once at creation time and never changed.
    ticket_id = Column(String(16), unique=True, nullable=True, index=True)
    task_name = Column(String(255), nullable=False)
    task_description = Column(String(1024), nullable=True)
    task_status = Column(String(64), nullable=True)
    # Assignee / assigner reference users by emp_id. Deleting a user detaches (SET NULL)
    # rather than deleting their tasks.
    task_assigned_to = Column(
        String(64),
        ForeignKey("users.emp_id", ondelete="SET NULL", name="fk_tasks_assigned_to"),
        nullable=True,
    )
    task_assigned_by = Column(
        String(64),
        ForeignKey("users.emp_id", ondelete="SET NULL", name="fk_tasks_assigned_by"),
        nullable=True,
    )
    task_assigned_date = Column(DateTime(timezone=True), nullable=True)
    task_due_date = Column(DateTime(timezone=True), nullable=True)
    task_priority = Column(String(32), nullable=True)
    task_tags = Column(String(255), nullable=True)
    task_notes = Column(String(1024), nullable=True)
    task_created_at = Column(DateTime(timezone=True), nullable=True)
    task_updated_at = Column(DateTime(timezone=True), nullable=True)
    task_duration = Column(String(32), nullable=True)
    time_spent = Column(Float, nullable=True, default=0.0)
    task_sessions = Column(JSON, nullable=True, default=list)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    # Denormalized subtask rollup (see task_links link_type="subtask"). Recomputed from truth
    # on every write that touches a subtask edge or a child's status — never incremented in
    # place — so it can't drift under concurrent edits. 0 total = not a story, no progress bar.
    subtask_total = Column(Integer, nullable=False, default=0)
    subtask_done = Column(Integer, nullable=False, default=0)
    # Optional link to the Epic this story rolls up into (one level above story — see
    # Epic above). Nullable: most tasks (subtasks, and stories outside any initiative) have
    # no epic. Not restricted to top-level stories at the DB layer (a subtask CAN carry one
    # too) but the UI only offers the picker on stories, since a subtask's own progress
    # already rolls up into its parent story first.
    epic_id = Column(
        String(64),
        ForeignKey("epics.id", ondelete="SET NULL", name="fk_tasks_epic_id"),
        nullable=True, index=True,
    )
    # Optional link to the Sprint/Cycle this task is scoped to (see Sprint below). Nullable —
    # most orgs running continuously (todo->done per task, no time-boxing) never set this;
    # it's additive for the ones that DO plan in cycles.
    sprint_id = Column(
        String(64),
        ForeignKey("sprints.id", ondelete="SET NULL", name="fk_tasks_sprint_id"),
        nullable=True, index=True,
    )

    @property
    def remaining_seconds(self):
        try:
            if not self.task_duration:
                return 0.0
            
            # Simple parse duration logic duplicated here or imported? 
            # Better to be self-contained or use a naive check if simple
            d_str = str(self.task_duration)
            total_hours = 0.0
            if ":" in d_str:
                parts = d_str.split(":")
                h = int(parts[0])
                m = int(parts[1]) if len(parts) > 1 else 0
                total_hours = h + (m / 60.0)
            else:
                total_hours = float(d_str)
            
            total_seconds = total_hours * 3600.0
            spent_seconds = (self.time_spent or 0.0) * 3600.0
            rem = max(0.0, total_seconds - spent_seconds)
            
            # Floor logic if in progress (from user req)
            if self.task_status and self.task_status.lower() in ["in progress", "in-progress"] and rem <= 0:
                return 1800.0 # 30 mins floor
            
            if self.task_status and self.task_status.lower() in ["done", "completed"]:
                return 0.0

            return rem
        except (ValueError, TypeError):
            return 0.0
            
class Epic(Base):
    """One level above a story (`Task`) — a cross-team initiative (e.g. "Q3 migration")
    that a set of stories roll up into. Deliberately a separate table rather than raising
    the existing 2-level subtask depth cap: keeps the subtask rollup (`tasks.subtask_total`/
    `subtask_done`, recomputed on every write that touches a child) untouched, and epic
    progress is a much lower-frequency read (a dashboard/portfolio view, not the timeline's
    hot path) so it's computed live from `tasks.epic_id` on read rather than denormalized.
    """
    __tablename__ = "epics"

    id = Column(String(64), primary_key=True, index=True)
    # Human-facing reference, e.g. "E-04821" — same pattern as tasks.ticket_id.
    ticket_id = Column(String(16), unique=True, nullable=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(String(1024), nullable=True)
    status = Column(String(64), nullable=True)  # free text, mirrors tasks.task_status
    owner_id = Column(
        String(64),
        ForeignKey("users.emp_id", ondelete="SET NULL", name="fk_epics_owner_id"),
        nullable=True,
    )
    # Informational only — an epic spans teams by definition, so this is NOT a scoping
    # filter (unlike users.emp_department, which IS used to filter GET /tasks). Lets a list
    # of epics be labeled/grouped by the team that owns/drives it.
    department = Column(String(128), nullable=True)
    # Date range for the roadmap/Gantt view (scale-gaps-plan.md §B.4) — "these 12 stories run
    # Jul-Sep across 4 teams". Both optional: an epic with neither set just doesn't render a
    # bar on the roadmap (it still appears in the Epics list). Named distinctly from a task's
    # `task_due_date` since this is the INITIATIVE's own planned window, not any one story's.
    start_date = Column(DateTime(timezone=True), nullable=True)
    target_date = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(
        String(64),
        ForeignKey("users.emp_id", ondelete="SET NULL", name="fk_epics_created_by"),
        nullable=True,
    )
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)


class Sprint(Base):
    """A time-boxed cycle (e.g. "Sprint 24") that tasks can optionally be scoped to — lets an
    org that plans in cycles see burndown/velocity (scale-gaps-plan.md §B.5), which nothing in
    this app's continuous todo->done model previously supported. Independent of Epic: a sprint
    is a slice of TIME, an epic is a slice of SCOPE — a task can carry either, both, or
    neither. No `status` column — "upcoming"/"active"/"completed" is derived from
    start_date/end_date vs now on read (recompute-from-truth, matching this codebase's own
    convention for subtask/epic rollups, rather than a column that could drift stale)."""
    __tablename__ = "sprints"

    id = Column(String(64), primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    start_date = Column(DateTime(timezone=True), nullable=False)
    end_date = Column(DateTime(timezone=True), nullable=False)
    created_by = Column(
        String(64),
        ForeignKey("users.emp_id", ondelete="SET NULL", name="fk_sprints_created_by"),
        nullable=True,
    )
    created_at = Column(DateTime(timezone=True), nullable=True)


class TaskComment(Base):
    __tablename__ = "task_comments"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(
        String(64),
        ForeignKey("tasks.id", ondelete="CASCADE", name="fk_task_comments_task_id"),
        nullable=False, index=True,
    )
    # NOTE: author_id is intentionally NOT a FK — it can be the sentinel "system"
    # (auto activity-log entries), which is not a real users.emp_id.
    author_id = Column(String(64), nullable=True)             # users.emp_id, or "system"
    author_name = Column(String(255), nullable=True)          # denormalized for display
    body = Column(String(2048), nullable=False)
    is_system = Column(Boolean, nullable=False, default=False)  # True = auto activity-log entry
    created_at = Column(DateTime(timezone=True), nullable=True)


class TaskLink(Base):
    __tablename__ = "task_links"

    id = Column(Integer, primary_key=True, index=True)
    # Edge semantics (both ids are tasks.id):
    #   link_type="subtask"    → from_task_id is a SUBTASK of to_task_id (to = parent)
    #   link_type="depends_on" → from_task_id DEPENDS ON to_task_id (to must finish first)
    from_task_id = Column(
        String(64),
        ForeignKey("tasks.id", ondelete="CASCADE", name="fk_task_links_from_task_id"),
        nullable=False, index=True,
    )
    to_task_id = Column(
        String(64),
        ForeignKey("tasks.id", ondelete="CASCADE", name="fk_task_links_to_task_id"),
        nullable=False, index=True,
    )
    link_type = Column(String(32), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        # Closes a TOCTOU race: the app-level duplicate check in add_task_link() ran a
        # SELECT-then-INSERT with no DB backing, so two concurrent requests could both pass
        # the check and insert the same edge twice.
        UniqueConstraint("from_task_id", "to_task_id", "link_type", name="uq_task_links_edge"),
        # Covers the two access patterns that actually run: "children of parent X"
        # (completion_blockers, subtask-progress recompute) and "parent/dependents of child X".
        Index("ix_task_links_to_type", "to_task_id", "link_type"),
        Index("ix_task_links_from_type", "from_task_id", "link_type"),
        CheckConstraint("link_type IN ('subtask', 'depends_on')", name="ck_task_links_type"),
    )


class TaskAttachment(Base):
    __tablename__ = "task_attachments"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(
        String(64),
        ForeignKey("tasks.id", ondelete="CASCADE", name="fk_task_attachments_task_id"),
        nullable=False, index=True,
    )
    filename = Column(String(255), nullable=True)
    content_type = Column(String(128), nullable=True)   # e.g. image/png
    data = Column(Text, nullable=False)                 # base64 (data URI), stored inline
    uploaded_by = Column(String(64), nullable=True)     # users.emp_id
    created_at = Column(DateTime(timezone=True), nullable=True)


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        String(64),
        ForeignKey("users.emp_id", ondelete="CASCADE", name="fk_push_subscriptions_user_id"),
        nullable=False, index=True,
    )
    endpoint = Column(Text, nullable=False, unique=True)
    p256dh = Column(String(255), nullable=False)
    auth = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=True)


class AuditLog(Base):
    """Org-wide log of *admin* actions (scale-gaps-plan.md Phase 3, item 2) — distinct from
    `task_comments.is_system`, which is a per-task activity thread. This is cross-cutting:
    user create/update/delete (+ bulk), manager/role changes, and CSV bulk imports (users +
    tasks). Append-only — nothing ever updates or deletes a row here. `actor_emp_id` is a FK
    with `SET NULL` (not `CASCADE`) so a row survives the actor's own account being deleted
    later; `actor_name`/`actor_designation` are denormalized snapshots of who they were AT THE
    TIME, so the log stays readable even after that."""
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    actor_emp_id = Column(
        String(64),
        ForeignKey("users.emp_id", ondelete="SET NULL", name="fk_audit_log_actor_emp_id"),
        nullable=True, index=True,
    )
    actor_name = Column(String(255), nullable=True)
    actor_designation = Column(String(128), nullable=True)
    action = Column(String(64), nullable=False, index=True)   # e.g. "user.create", "user.delete"
    target_type = Column(String(32), nullable=True)           # e.g. "user", "task"
    target_id = Column(String(64), nullable=True, index=True)
    # Free-form JSON summary — e.g. {"before": {...}, "after": {...}} for an update,
    # {"added": 12, "skipped": 3} for a CSV import. Never holds secrets (passwords/tokens).
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        String(64),
        ForeignKey("users.emp_id", ondelete="CASCADE", name="fk_notifications_user_id"),
        nullable=False, index=True,
    )  # recipient users.emp_id
    type = Column(String(64), nullable=True)                  # assigned | status | reassigned | ...
    message = Column(String(512), nullable=False)
    task_id = Column(
        String(64),
        ForeignKey("tasks.id", ondelete="SET NULL", name="fk_notifications_task_id"),
        nullable=True,
    )               # deep-link target
    is_read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=True)


# Database engine/session setup
# Prefer DATABASE_URL env var. Example: postgresql+psycopg://user:pass@localhost:5432/taskboard
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    # Fallback to SQLite for dev if Postgres URL is not configured
    DATABASE_URL = "sqlite:///./taskboard_dev.db"

# SQLite needs check_same_thread=False here because FastAPI/Starlette runs sync request
# handlers in a threadpool — a request's DB session may be opened/used on a different
# thread than the one that created the underlying connection's pool checkout. This only
# affects the SQLite fallback (e.g. local dev / the test suite); Postgres is unaffected.
_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    echo=False,
    future=True,
    connect_args=_connect_args,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Pydantic schemas

# Skills are free-text tags editable straight through PUT /profile / PUT /user/{emp_id},
# which land directly in a JSON column — cap list length and per-tag length so that path
# can't be used to smuggle an arbitrarily large payload into the DB. Rejected (422), not
# silently truncated.
MAX_SKILLS = 20
MAX_SKILL_LENGTH = 40


def _validate_skills(v: list | None) -> list | None:
    if v is None:
        return v
    if len(v) > MAX_SKILLS:
        raise ValueError(f"a maximum of {MAX_SKILLS} skill tags is allowed (got {len(v)})")
    for tag in v:
        if not isinstance(tag, str):
            raise ValueError("each skill tag must be a string")
        if len(tag) > MAX_SKILL_LENGTH:
            raise ValueError(
                f"each skill tag must be at most {MAX_SKILL_LENGTH} characters "
                f"(got {len(tag)} chars: {tag!r})"
            )
    return v


def _validate_timezone(v: str | None) -> str | None:
    """Reject anything that isn't a real IANA timezone name — accepting garbage here
    would silently break the /capacity day-boundary math later (ZoneInfo() would raise
    at read time instead, deep inside a request that has nothing to do with the bad
    write). Rejected up front with a 422, not silently accepted or normalized."""
    if v is None:
        return v
    try:
        ZoneInfo(v)
    except ZoneInfoNotFoundError as e:
        raise ValueError(f"{v!r} is not a recognized IANA timezone name") from e
    return v


SPECIAL_ROLES = {"dept_admin", "auditor"}


def _validate_special_role(v: str | None) -> str | None:
    if v is None:
        return v
    if v not in SPECIAL_ROLES:
        raise ValueError(f"special_role must be one of {sorted(SPECIAL_ROLES)} or null (got {v!r})")
    return v


class UserCreate(BaseModel):
    emp_name: str
    emp_id: str
    emp_email: str
    emp_phone: str | None = None
    emp_designation: str | None = None
    emp_department: str | None = None
    emp_hierarchy: str | None = None  # legacy — unused by the real-role model; kept optional
    manager_id: str | None = None
    password: str | None = None  # optional; defaults in main logic if missing
    # Enriched HRIS profile (all optional at creation)
    company: str | None = None
    legal_entity: str | None = None
    gender: str | None = None
    work_location: str | None = None
    date_of_joining: str | None = None
    date_of_birth: str | None = None
    blood_group: str | None = None
    payscale: str | None = None
    education: list | None = None
    linkedin: str | None = None
    profile_pic: str | None = None
    skills: list[str] | None = None
    timezone: str | None = None
    # Only settable by a full (rank-based) admin — enforced in main.py's create_user, not here.
    special_role: str | None = None

    @field_validator("skills")
    @classmethod
    def _check_skills(cls, v):
        return _validate_skills(v)

    @field_validator("timezone")
    @classmethod
    def _check_timezone(cls, v):
        return _validate_timezone(v)

    @field_validator("special_role")
    @classmethod
    def _check_special_role(cls, v):
        return _validate_special_role(v)

class UserRead(BaseModel):
    id: int
    emp_name: str
    emp_id: str
    emp_email: str
    emp_phone: str | None = None
    emp_designation: str | None = None
    emp_department: str | None = None
    emp_hierarchy: str | None = None
    manager_id: str | None = None
    # Enriched HRIS profile
    node_id: str | None = None
    hris_user_id: str | None = None
    company: str | None = None
    legal_entity: str | None = None
    gender: str | None = None
    work_location: str | None = None
    date_of_joining: str | None = None
    date_of_birth: str | None = None
    blood_group: str | None = None
    payscale: str | None = None
    education: list | None = None
    linkedin: str | None = None
    profile_pic: str | None = None
    skills: list[str] | None = None
    timezone: str | None = None
    special_role: str | None = None

    class Config:
        from_attributes = True  # Pydantic v2 ORM mode


class UserDirectory(BaseModel):
    """Lean shape for GET /user's company-wide directory listing.

    GET /user with no user_id (or a user_id whose subordinates are requested) is
    intentionally open to every authenticated user — the org chart is shared company
    info and open task-assignment needs an any-to-any picker (see plan.md §2/§10).
    But that means this payload reaches every employee's browser for every other
    employee, so it must NOT carry personal HRIS fields (DOB, blood group, phone,
    education, LinkedIn, …) — only what the org chart / assignee picker / hierarchy
    popover actually render. Full UserRead stays reserved for /profile (self) and
    admin-gated user-management endpoints.

    `skills` IS included here despite the "lean" rule above: unlike DOB/blood-group/
    phone/education/linkedin, skill tags aren't personal — they're work-relevant
    metadata (what someone can be staffed on), and the upcoming Org Resource View
    needs exactly this company-wide directory to render them. Keeping them out would
    mean duplicating this whole endpoint for that feature.

    `timezone` is included for the same reason as `skills`: it isn't personal HRIS data
    (unlike DOB/blood-group/phone), it's scheduling metadata — the Team Saturation Heatmap
    (built on top of this same company-wide directory + GET /capacity) needs each
    employee's timezone to label/group the heatmap, and that view is rendered for
    managers/ICs who hit this lean path, not just admins. Same "duplicate the endpoint"
    argument as skills applies: keeping it out here would force a second, admin-only round
    trip just to get a field every viewer of the heatmap needs.
    """
    id: int
    emp_id: str
    emp_name: str
    emp_designation: str | None = None
    emp_department: str | None = None
    manager_id: str | None = None
    profile_pic: str | None = None
    skills: list[str] | None = None
    timezone: str | None = None

    class Config:
        from_attributes = True  # Pydantic v2 ORM mode


class ProfileSelfUpdate(BaseModel):
    """Fields a user may edit on their OWN profile (contact/personal only — never
    emp_id / designation / manager / department, which are HR-controlled)."""
    emp_phone: str | None = None
    work_location: str | None = None
    gender: str | None = None
    date_of_birth: str | None = None
    blood_group: str | None = None
    linkedin: str | None = None
    profile_pic: str | None = None
    # Free-text self-service skill tags (not HR-controlled, unlike designation/dept/manager).
    skills: list[str] | None = None
    # Scheduling metadata, not HR-controlled either — a person knows their own timezone.
    timezone: str | None = None

    @field_validator("skills")
    @classmethod
    def _check_skills(cls, v):
        return _validate_skills(v)

    @field_validator("timezone")
    @classmethod
    def _check_timezone(cls, v):
        return _validate_timezone(v)

class AttachmentCreate(BaseModel):
    filename: str | None = None
    content_type: str | None = None
    data: str  # base64 data URI, e.g. "data:image/png;base64,...."

class SubtaskCreate(BaseModel):
    """One row of the create-modal's Subtasks panel — filled out via its own full-detail
    sub-modal (same fields as the parent create form, minus a nested subtasks panel, since
    nesting is capped at 1 level). Each becomes its own `tasks` row, single-assignee, linked
    to the parent via task_links(link_type="subtask")."""
    task_name: str
    task_assigned_to: str
    task_description: str | None = None
    task_status: str | None = None
    task_priority: str | None = None
    task_tags: str | None = None
    task_duration: str | None = None
    task_due_date: datetime | None = None
    attachments: list[AttachmentCreate] | None = None

class TaskCreate(BaseModel):
    id: str | None = None
    task_name: str
    task_description: str | None = None
    task_status: str | None = None
    task_assigned_to: str | None = None
    task_assigned_by: str | None = None
    task_assigned_date: datetime | None = None
    task_due_date: datetime | None = None
    task_priority: str | None = None
    task_tags: str | None = None
    task_notes: str | None = None
    task_created_at: datetime | None = None
    task_updated_at: datetime | None = None
    task_duration: str | None = None
    time_spent: float | None = 0.0
    task_sessions: list | None = []
    completed_at: datetime | None = None
    # Images picked before the task existed (create flow) — saved atomically with the task so
    # the assignment-notification email can include them (avoids the create -> notify -> upload
    # race where a separate post-create upload call would always land too late).
    attachments: list[AttachmentCreate] | None = None
    # Subtasks staged in the create modal, created atomically with the parent (a half-created
    # story — collaborator told they own a piece that doesn't exist — is worse than the
    # best-effort staged-dependency-link pattern used elsewhere, so this gets a real transaction).
    subtasks: list[SubtaskCreate] | None = None
    # Optional Epic this story rolls up into (see models.Epic). Only meaningful on a
    # top-level story — the create-modal's Epic picker isn't shown on a subtask's own form.
    epic_id: str | None = None
    # Optional Sprint/Cycle this task is scoped to (see models.Sprint).
    sprint_id: str | None = None

class TaskStatusUpdate(BaseModel):
    task_status: str

class TaskRead(BaseModel):
    id: str
    ticket_id: str | None = None
    task_name: str
    task_description: str | None = None
    task_status: str | None = None
    task_assigned_to: str | None = None
    task_assigned_by: str | None = None
    task_assigned_date: datetime | None = None
    task_due_date: datetime | None = None
    task_priority: str | None = None
    task_tags: str | None = None
    task_notes: str | None = None
    task_created_at: datetime | None = None
    task_updated_at: datetime | None = None
    task_duration: str | None = None
    time_spent: float | None = None
    remaining_seconds: float | None = None # New Field
    task_sessions: list | None = None
    completed_at: datetime | None = None
    # 0 total = leaf task (no progress bar). subtask_done <= subtask_total always.
    subtask_total: int = 0
    subtask_done: int = 0
    epic_id: str | None = None
    sprint_id: str | None = None

    class Config:
        from_attributes = True  # Pydantic v2 ORM mode

class CommentCreate(BaseModel):
    body: str

class CommentRead(BaseModel):
    id: int
    task_id: str
    author_id: str | None = None
    author_name: str | None = None
    body: str
    is_system: bool = False
    created_at: datetime | None = None

    class Config:
        from_attributes = True

class EpicCreate(BaseModel):
    name: str
    description: str | None = None
    status: str | None = None
    # Defaults to the creator when omitted — see POST /epics.
    owner_id: str | None = None
    department: str | None = None
    # Roadmap/Gantt date range (see models.Epic) — both optional.
    start_date: datetime | None = None
    target_date: datetime | None = None

class EpicUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    owner_id: str | None = None
    department: str | None = None
    start_date: datetime | None = None
    target_date: datetime | None = None

class EpicRead(BaseModel):
    id: str
    ticket_id: str | None = None
    name: str
    description: str | None = None
    status: str | None = None
    owner_id: str | None = None
    department: str | None = None
    start_date: datetime | None = None
    target_date: datetime | None = None
    created_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    # Rollup across linked stories — computed live from `tasks.epic_id` on read (see
    # main.py's epic endpoints), not denormalized like tasks.subtask_total/subtask_done,
    # since this is a low-frequency dashboard read rather than the timeline's hot path.
    story_total: int = 0
    story_done: int = 0
    progress_pct: float = 0.0

    class Config:
        from_attributes = True  # Pydantic v2 ORM mode

class SprintCreate(BaseModel):
    name: str
    start_date: datetime
    end_date: datetime

class SprintUpdate(BaseModel):
    name: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None

class SprintRead(BaseModel):
    id: str
    name: str
    start_date: datetime
    end_date: datetime
    created_by: str | None = None
    created_at: datetime | None = None
    # "upcoming" | "active" | "completed" — derived from start_date/end_date vs now at read
    # time (see main.py's _sprint_status), never stored.
    status_label: str = "upcoming"
    # Scope/velocity rollup across linked tasks — computed live from `tasks.sprint_id`, same
    # "not denormalized" reasoning as Epic's story_total/story_done/progress_pct.
    task_total: int = 0
    task_done: int = 0
    total_hours: float = 0.0
    completed_hours: float = 0.0

    class Config:
        from_attributes = True  # Pydantic v2 ORM mode

class BurndownPoint(BaseModel):
    date: str  # YYYY-MM-DD
    ideal_remaining_hours: float
    actual_remaining_hours: float | None = None  # None for future dates (not yet knowable)

class BurndownResponse(BaseModel):
    sprint_id: str
    total_hours: float
    points: list[BurndownPoint]

class LinkCreate(BaseModel):
    to_task_id: str
    link_type: str  # "subtask" | "depends_on"

class LinkedTask(BaseModel):
    link_id: int
    link_type: str
    task_id: str
    task_ticket_id: str | None = None
    task_name: str | None = None
    task_status: str | None = None
    task_priority: str | None = None
    task_assigned_to: str | None = None
    # Only meaningful when this row is a "subtask" (a child) — lets a subtask's own row show its
    # own rollup if it somehow has one (it won't, depth is capped at 2 levels, but harmless to
    # include) and lets the frontend skip a second round trip for the common "show child's own
    # progress under its row" case.
    subtask_total: int = 0
    subtask_done: int = 0
    direction: str  # "outgoing" | "incoming"

class AttachmentRead(BaseModel):
    id: int
    task_id: str
    filename: str | None = None
    content_type: str | None = None
    data: str
    uploaded_by: str | None = None
    created_at: datetime | None = None

    class Config:
        from_attributes = True

class AuditLogRead(BaseModel):
    id: int
    actor_emp_id: str | None = None
    actor_name: str | None = None
    actor_designation: str | None = None
    action: str
    target_type: str | None = None
    target_id: str | None = None
    details: dict | None = None
    created_at: datetime | None = None

    class Config:
        from_attributes = True

class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str

class PushSubscriptionCreate(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys

class PushUnsubscribe(BaseModel):
    endpoint: str

class NotificationRead(BaseModel):
    id: int
    user_id: str
    type: str | None = None
    message: str
    task_id: str | None = None
    is_read: bool = False
    created_at: datetime | None = None

    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    emp_name: str | None = None
    emp_id: str | None = None
    emp_email: str | None = None
    emp_phone: str | None = None
    emp_designation: str | None = None
    emp_department: str | None = None
    emp_hierarchy: str | None = None
    manager_id: str | None = None
    # Admin-editable skill tags (mirrors ProfileSelfUpdate.skills; admins edit anyone's here).
    skills: list[str] | None = None
    # Admin-editable timezone (mirrors ProfileSelfUpdate.timezone; admins edit anyone's here).
    timezone: str | None = None
    # Only a full (rank-based) admin may change this — enforced in main.py's update_user.
    special_role: str | None = None

    @field_validator("skills")
    @classmethod
    def _check_skills(cls, v):
        return _validate_skills(v)

    @field_validator("timezone")
    @classmethod
    def _check_timezone(cls, v):
        return _validate_timezone(v)

    @field_validator("special_role")
    @classmethod
    def _check_special_role(cls, v):
        return _validate_special_role(v)

def init_db() -> None:
    Base.metadata.create_all(bind=engine)
