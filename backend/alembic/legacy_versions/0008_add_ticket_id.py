"""add ticket_id column to tasks

Adds a human-facing ticket reference (e.g. "T-38291") shown in the UI as a clickable link
that opens the task-detail modal, separate from the internal `id` primary key. Nullable +
unique, backfilled here for existing rows since new rows get one assigned at creation time
(see main.py create_task).

Revision ID: 0008_add_ticket_id
Revises: 0007_add_timezone
Create Date: 2026-07-27
"""
import secrets
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008_add_ticket_id"
down_revision: str | Sequence[str] | None = "0007_add_timezone"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("ticket_id", sa.String(length=16), nullable=True))
    op.create_index("ix_tasks_ticket_id", "tasks", ["ticket_id"], unique=True)

    # Backfill existing rows with a unique "T-#####" reference.
    conn = op.get_bind()
    tasks = sa.table("tasks", sa.column("id", sa.String), sa.column("ticket_id", sa.String))
    existing_ids = {row[0] for row in conn.execute(sa.select(tasks.c.id))}
    used: set[str] = set()
    for task_id in existing_ids:
        ticket_id = f"T-{secrets.randbelow(100000):05d}"
        while ticket_id in used:
            ticket_id = f"T-{secrets.randbelow(100000):05d}"
        used.add(ticket_id)
        conn.execute(tasks.update().where(tasks.c.id == task_id).values(ticket_id=ticket_id))


def downgrade() -> None:
    op.drop_index("ix_tasks_ticket_id", table_name="tasks")
    op.drop_column("tasks", "ticket_id")
