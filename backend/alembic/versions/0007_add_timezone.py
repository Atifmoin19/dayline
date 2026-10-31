"""add timezone column to users

Adds a per-employee IANA timezone column (e.g. "Asia/Kolkata", "America/New_York") — mirrors
how `skills` was added in 0006. Self-editable via PUT /profile, admin-editable via
PUT /user/{emp_id}. Nullable, no data backfill required: GET /capacity falls back to the
global BUSINESS_TIMEZONE (task_helpers.BUSINESS_TZ) for any employee with this unset.

Revision ID: 0007_add_timezone
Revises: 0006_add_skills
Create Date: 2026-07-26
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_add_timezone"
down_revision: str | Sequence[str] | None = "0006_add_skills"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("timezone", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "timezone")
