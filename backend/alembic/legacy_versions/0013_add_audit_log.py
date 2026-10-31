"""audit_log — org-wide log of admin actions

Adds the `audit_log` table (scale-gaps-plan.md Phase 3, item 2): user create/update/delete
(+ bulk), manager/role changes, and CSV bulk imports (users + tasks). Append-only, company-wide
— distinct from the existing per-task `task_comments.is_system` activity thread.

Revision ID: 0013_add_audit_log
Revises: 0012_sprints
Create Date: 2026-07-27
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0013_add_audit_log"
down_revision: str | Sequence[str] | None = "0012_sprints"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Guarded the same way migrations 0010/0012 are — a --reload dev server's own
    # on_startup -> init_db() (Base.metadata.create_all()) can win the race and create
    # audit_log before this migration runs against the same dev DB.
    if not inspector.has_table("audit_log"):
        op.create_table(
            "audit_log",
            sa.Column("id", sa.Integer, primary_key=True, index=True),
            sa.Column(
                "actor_emp_id", sa.String(64),
                sa.ForeignKey("users.emp_id", ondelete="SET NULL", name="fk_audit_log_actor_emp_id"),
                nullable=True,
            ),
            sa.Column("actor_name", sa.String(255), nullable=True),
            sa.Column("actor_designation", sa.String(128), nullable=True),
            sa.Column("action", sa.String(64), nullable=False),
            sa.Column("target_type", sa.String(32), nullable=True),
            sa.Column("target_id", sa.String(64), nullable=True),
            sa.Column("details", sa.JSON, nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_audit_log_actor_emp_id", "audit_log", ["actor_emp_id"])
        op.create_index("ix_audit_log_action", "audit_log", ["action"])
        op.create_index("ix_audit_log_target_id", "audit_log", ["target_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_log_target_id", table_name="audit_log")
    op.drop_index("ix_audit_log_action", table_name="audit_log")
    op.drop_index("ix_audit_log_actor_emp_id", table_name="audit_log")
    op.drop_table("audit_log")
