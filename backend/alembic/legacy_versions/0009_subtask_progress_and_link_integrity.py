"""subtask progress rollup + task_links integrity

Adds denormalized tasks.subtask_total/subtask_done (recomputed from truth on every write
that touches a subtask edge or a child's status — see main.py recompute_subtask_counters —
never incremented in place, so it can't drift). Backfills both from whatever "subtask"
task_links already exist. Also closes gaps that predate this revision: task_links never had
a uniqueness guarantee (the app-level duplicate check in add_task_link() was SELECT-then-INSERT
with no DB backing — a real TOCTOU race under concurrent writes) or composite indexes for the
"children of parent X" / "parent of child X" lookups completion_blockers() and the new counter
recompute both run. Dedupes any accidental duplicate edges before adding the unique constraint,
since none existed before this revision to prevent them.

Revision ID: 0009_subtask_progress
Revises: 0008_add_ticket_id
Create Date: 2026-07-27
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009_subtask_progress"
down_revision: str | Sequence[str] | None = "0008_add_ticket_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tasks", sa.Column("subtask_total", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "tasks", sa.Column("subtask_done", sa.Integer(), nullable=False, server_default="0")
    )

    conn = op.get_bind()

    # Backfill counters from any subtask links that already exist (created manually via
    # TaskLinks.tsx's "subtask-child"/"parent" kind selector before this feature existed).
    conn.execute(
        sa.text(
            """
            UPDATE tasks t SET
                subtask_total = sub.total,
                subtask_done  = sub.done
            FROM (
                SELECT tl.to_task_id AS parent_id,
                       COUNT(*) AS total,
                       COUNT(*) FILTER (
                           WHERE LOWER(c.task_status) IN ('done', 'completed')
                       ) AS done
                FROM task_links tl
                JOIN tasks c ON c.id = tl.from_task_id
                WHERE tl.link_type = 'subtask'
                GROUP BY tl.to_task_id
            ) sub
            WHERE t.id = sub.parent_id
            """
        )
    )

    # Dedupe any accidental duplicate edges (keep lowest id) before the unique constraint
    # below — none existed before this revision to prevent them from ever being created.
    conn.execute(
        sa.text(
            """
            DELETE FROM task_links a USING task_links b
            WHERE a.id > b.id
              AND a.from_task_id = b.from_task_id
              AND a.to_task_id = b.to_task_id
              AND a.link_type = b.link_type
            """
        )
    )

    op.create_unique_constraint(
        "uq_task_links_edge", "task_links", ["from_task_id", "to_task_id", "link_type"]
    )
    op.create_index("ix_task_links_to_type", "task_links", ["to_task_id", "link_type"])
    op.create_index("ix_task_links_from_type", "task_links", ["from_task_id", "link_type"])
    op.create_check_constraint(
        "ck_task_links_type", "task_links", "link_type IN ('subtask', 'depends_on')"
    )


def downgrade() -> None:
    op.drop_constraint("ck_task_links_type", "task_links", type_="check")
    op.drop_index("ix_task_links_from_type", table_name="task_links")
    op.drop_index("ix_task_links_to_type", table_name="task_links")
    op.drop_constraint("uq_task_links_edge", "task_links", type_="unique")
    op.drop_column("tasks", "subtask_done")
    op.drop_column("tasks", "subtask_total")
