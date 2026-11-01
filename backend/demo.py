"""The "Try the demo" sandboxes behind POST /demo.

Each call gets its own copy of the fictional Quillbrook Labs org (seed_loader), tagged with a
fresh workspace id. Isolation is enforced by `users.workspace_id` / `epics.workspace_id` /
`sprints.workspace_id` (see permissions.workspace_clause and friends). Workspaces expire after
DEMO_TTL_HOURS and are purged lazily at the start of every POST /demo.

Settings (read on every call, so tests and ops can change them without a restart):
    DEMO_MODE_ENABLED          "true" to expose POST /demo (404 otherwise)
    DEMO_TTL_HOURS             lifetime of a workspace, default 24
    DEMO_MAX_PER_IP_PER_HOUR   new workspaces per client IP per hour, default 5
    DEMO_MAX_LIVE_WORKSPACES   cap on unexpired workspaces, default 100
    DEMO_IP_SALT               salt for the stored IP hash (set a random value in prod)
"""
import hashlib
import os
import secrets
from datetime import timedelta

from models import (
    AuditLog,
    DemoWorkspace,
    Epic,
    Foundation,
    Notification,
    PushSubscription,
    Sprint,
    Task,
    TaskAttachment,
    TaskComment,
    TaskLink,
    User,
)
from security import hash_password
from seed_loader import insert_seed, load_seed

# Persona -> seed emp_id. manager = the CTO (whole org); team_lead = a tech lead with two
# reports; employee_1 / employee_2 = ICs on different teams. "developer" is the pre-persona
# name for employee_1, kept so older clients keep working.
PERSONAS = {
    "manager": "QB0001",      # Odile Marchetti, VP of Engineering
    "team_lead": "QB0003",    # Wren Takahashi, Tech Lead (Platform): Mira + Tomas
    "employee_1": "QB0004",   # Mira Okafor, Senior Software Engineer (Platform)
    "employee_2": "QB0008",   # Saoirse Brannigan, UI/UX Designer (Mobile)
    "developer": "QB0004",
}


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        return default


def enabled() -> bool:
    return os.getenv("DEMO_MODE_ENABLED", "").strip().lower() in ("1", "true", "yes", "on")


def ttl() -> timedelta:
    try:
        hours = float(os.getenv("DEMO_TTL_HOURS", "") or 24)
    except ValueError:
        hours = 24.0
    return timedelta(hours=max(hours, 0.1))


def max_per_ip_per_hour() -> int:
    return _env_int("DEMO_MAX_PER_IP_PER_HOUR", 5)


def max_live_workspaces() -> int:
    return _env_int("DEMO_MAX_LIVE_WORKSPACES", 100)


def hash_ip(ip: str) -> str:
    salt = os.getenv("DEMO_IP_SALT", "taskboard-demo")
    return hashlib.sha256(f"{salt}:{ip}".encode()).hexdigest()


def recent_count_for_ip(db, ip_hash: str, now) -> int:
    return db.query(DemoWorkspace).filter(
        DemoWorkspace.ip_hash == ip_hash, DemoWorkspace.created_at >= now - timedelta(hours=1)
    ).count()


def live_count(db, now) -> int:
    return db.query(DemoWorkspace).filter(DemoWorkspace.expires_at > now).count()


def purge_workspaces(db, workspace_ids: list[str]) -> None:
    """Delete everything that belongs to the given workspaces, children first."""
    if not workspace_ids:
        return
    user_ids = [r[0] for r in db.query(User.emp_id).filter(User.workspace_id.in_(workspace_ids))]
    task_ids = [r[0] for r in db.query(Task.id).filter(
        Task.task_assigned_to.in_(user_ids) | Task.task_assigned_by.in_(user_ids)
    )] if user_ids else []

    def delete(query):
        query.delete(synchronize_session=False)

    if task_ids:
        delete(db.query(Notification).filter(Notification.task_id.in_(task_ids)))
        delete(db.query(TaskAttachment).filter(TaskAttachment.task_id.in_(task_ids)))
        delete(db.query(TaskComment).filter(TaskComment.task_id.in_(task_ids)))
        delete(db.query(TaskLink).filter(
            TaskLink.from_task_id.in_(task_ids) | TaskLink.to_task_id.in_(task_ids)
        ))
    if user_ids:
        delete(db.query(Notification).filter(Notification.user_id.in_(user_ids)))
        delete(db.query(PushSubscription).filter(PushSubscription.user_id.in_(user_ids)))
        delete(db.query(AuditLog).filter(AuditLog.actor_emp_id.in_(user_ids)))
    if task_ids:
        delete(db.query(Task).filter(Task.id.in_(task_ids)))
    delete(db.query(Epic).filter(Epic.workspace_id.in_(workspace_ids)))
    delete(db.query(Sprint).filter(Sprint.workspace_id.in_(workspace_ids)))
    if user_ids:
        delete(db.query(Foundation).filter(Foundation.emp_id.in_(user_ids)))
        db.query(User).filter(User.emp_id.in_(user_ids)).update(
            {User.manager_id: None}, synchronize_session=False
        )
        delete(db.query(User).filter(User.emp_id.in_(user_ids)))
    delete(db.query(DemoWorkspace).filter(DemoWorkspace.id.in_(workspace_ids)))
    db.commit()


def purge_expired(db, now) -> int:
    expired = [r[0] for r in db.query(DemoWorkspace.id).filter(DemoWorkspace.expires_at <= now)]
    purge_workspaces(db, expired)
    return len(expired)


def create_workspace(db, now, persona: str, ip_hash: str):
    """Create a workspace with a full seed copy; returns (DemoWorkspace, persona User)."""
    workspace_id = secrets.token_hex(6)
    workspace = DemoWorkspace(
        id=workspace_id, persona_emp_id=None, ip_hash=ip_hash,
        created_at=now, expires_at=now + ttl(),
    )
    db.add(workspace)
    db.flush()
    # Nobody can log in to a demo account with a password: the hash is of a throwaway secret.
    emp_map = insert_seed(
        db, load_seed(), now,
        password_hash=hash_password(secrets.token_urlsafe(24)), workspace_id=workspace_id,
    )
    workspace.persona_emp_id = emp_map[PERSONAS[persona]]
    db.commit()
    user = db.query(User).filter(User.emp_id == workspace.persona_emp_id).one()
    return workspace, user
