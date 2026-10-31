"""sprints — time-boxed cycles for burndown/velocity

Adds the `sprints` table (id, name, start_date, end_date, created_by, created_at) and
`tasks.sprint_id` (nullable FK, SET NULL on sprint delete — deleting a sprint detaches its
tasks rather than deleting them, same pattern as Epic). No `status` column: "upcoming" /
"active" / "completed" is derived from start_date/end_date vs now at read time (see
main.py's _sprint_status), matching this codebase's "recompute from truth, don't denormalize
a value that can drift" convention for Epic/subtask rollups.

Revision ID: 0012_sprints
Revises: 0011_epic_date_range
Create Date: 2026-07-27
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0012_sprints"
down_revision: str | Sequence[str] | None = "0011_epic_date_range"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Guarded the same way migration 0010 is — a --reload dev server's own on_startup ->
    # init_db() (Base.metadata.create_all()) can win the race and create `sprints` before
    # this migration runs against the same dev DB.
    if not inspector.has_table("sprints"):
        op.create_table(
            "sprints",
            sa.Column("id", sa.String(64), primary_key=True, index=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("start_date", sa.DateTime(timezone=True), nullable=False),
            sa.Column("end_date", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "created_by", sa.String(64),
                sa.ForeignKey("users.emp_id", ondelete="SET NULL", name="fk_sprints_created_by"),
                nullable=True,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )

    existing_task_cols = {c["name"] for c in inspector.get_columns("tasks")}
    if "sprint_id" not in existing_task_cols:
        op.add_column("tasks", sa.Column("sprint_id", sa.String(64), nullable=True))
        op.create_foreign_key(
            "fk_tasks_sprint_id", "tasks", "sprints", ["sprint_id"], ["id"], ondelete="SET NULL"
        )
        op.create_index("ix_tasks_sprint_id", "tasks", ["sprint_id"])


def downgrade() -> None:
    op.drop_index("ix_tasks_sprint_id", table_name="tasks")
    op.drop_constraint("fk_tasks_sprint_id", "tasks", type_="foreignkey")
    op.drop_column("tasks", "sprint_id")

    op.drop_table("sprints")
