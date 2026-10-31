"""epic date range — roadmap/Gantt view

Adds `epics.start_date`/`target_date` (both nullable timestamptz) — the initiative's own
planned window, distinct from any one story's `task_due_date`. Powers the roadmap/Gantt view
(scale-gaps-plan.md §B.4): "these 12 stories run Jul-Sep across 4 teams." An epic with neither
set simply doesn't render a bar on the roadmap; it still appears in the plain Epics list.

`create_all()` never ALTERs an existing table, so unlike migration `0010` (which raced a
--reload dev server's own table-creation), there's no race here to guard against — `epics`
already exists by the time this runs.

Revision ID: 0011_epic_date_range
Revises: 0010_epics
Create Date: 2026-07-27
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011_epic_date_range"
down_revision: str | Sequence[str] | None = "0010_epics"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("epics", sa.Column("start_date", sa.DateTime(timezone=True), nullable=True))
    op.add_column("epics", sa.Column("target_date", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("epics", "target_date")
    op.drop_column("epics", "start_date")
