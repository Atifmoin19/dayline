"""epics — cross-team initiative one level above a story

Adds the `epics` table (id, ticket_id, name, description, status, owner_id, department,
created_by, created_at, updated_at) and `tasks.epic_id` (nullable FK, SET NULL on epic
delete — deleting an epic detaches its stories rather than deleting them, same pattern as
deleting a user detaches their tasks). A separate table rather than raising the existing
2-level subtask depth cap (scale-gaps-plan.md §A.1/§A.7) — keeps the subtask rollup
untouched, epic progress is computed live on read (see main.py's epic endpoints), not
denormalized like tasks.subtask_total/subtask_done.

Revision ID: 0010_epics
Revises: 0009_subtask_progress
Create Date: 2026-07-27
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010_epics"
down_revision: str | Sequence[str] | None = "0009_subtask_progress"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Guarded rather than unconditional: a --reload dev server's own on_startup -> init_db()
    # (Base.metadata.create_all(), which creates any table declared in models.py that doesn't
    # exist yet — see models.py's own note on this pattern) can win the race and create
    # `epics` before this migration runs against the same dev DB. create_all() never ALTERs
    # an existing table, though, so tasks.epic_id still needs adding either way.
    if not inspector.has_table("epics"):
        op.create_table(
            "epics",
            sa.Column("id", sa.String(64), primary_key=True, index=True),
            sa.Column("ticket_id", sa.String(16), unique=True, nullable=True, index=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("description", sa.String(1024), nullable=True),
            sa.Column("status", sa.String(64), nullable=True),
            sa.Column(
                "owner_id", sa.String(64),
                sa.ForeignKey("users.emp_id", ondelete="SET NULL", name="fk_epics_owner_id"),
                nullable=True,
            ),
            sa.Column("department", sa.String(128), nullable=True),
            sa.Column(
                "created_by", sa.String(64),
                sa.ForeignKey("users.emp_id", ondelete="SET NULL", name="fk_epics_created_by"),
                nullable=True,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )
        # op.create_table() already emits CREATE INDEX for every Column(index=True) above
        # (unlike a bare CREATE TABLE) — an explicit op.create_index("ix_epics_ticket_id", ...)
        # here would duplicate it and fail with DuplicateTable.

    existing_task_cols = {c["name"] for c in inspector.get_columns("tasks")}
    if "epic_id" not in existing_task_cols:
        op.add_column("tasks", sa.Column("epic_id", sa.String(64), nullable=True))
        op.create_foreign_key(
            "fk_tasks_epic_id", "tasks", "epics", ["epic_id"], ["id"], ondelete="SET NULL"
        )
        op.create_index("ix_tasks_epic_id", "tasks", ["epic_id"])


def downgrade() -> None:
    op.drop_index("ix_tasks_epic_id", table_name="tasks")
    op.drop_constraint("fk_tasks_epic_id", "tasks", type_="foreignkey")
    op.drop_column("tasks", "epic_id")

    op.drop_table("epics")
