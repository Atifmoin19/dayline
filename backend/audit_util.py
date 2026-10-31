"""Org-wide audit log for admin actions (scale-gaps-plan.md Phase 3, item 2) — distinct from
`task_comments.is_system`, which is a per-task activity thread, not a cross-cutting one.

`record_audit` only stages the row (`db.add`) — it does not commit. Callers already commit
their own mutation in the same request; folding the audit row into that same transaction
means a rolled-back mutation never leaves an orphan "it happened" entry behind."""
from typing import Any

from models import AuditLog
from task_helpers import utc_now


def record_audit(
    db,
    actor,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """`actor` is a `UserModel` instance (whatever `verify_token`/`require_admin` resolved) —
    its name/designation are snapshotted onto the row so the log stays readable even after
    the actor's own account is later deleted (`actor_emp_id` is `SET NULL`, not `CASCADE`)."""
    db.add(AuditLog(
        actor_emp_id=getattr(actor, "emp_id", None),
        actor_name=getattr(actor, "emp_name", None),
        actor_designation=getattr(actor, "emp_designation", None),
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=details,
        created_at=utc_now(),
    ))
