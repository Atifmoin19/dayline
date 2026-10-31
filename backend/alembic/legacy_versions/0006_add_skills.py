"""add skills column to users

Adds a free-text skill-tags column (v1 tagging, not a normalized skills taxonomy) — mirrors
how `education` was added in 0003. Self-editable via PUT /profile, admin-editable via
PUT /user/{emp_id}. Nullable, no data backfill required.

Revision ID: 0006_add_skills
Revises: 0005_add_push_subscriptions
Create Date: 2026-07-26
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006_add_skills"
down_revision: str | Sequence[str] | None = "0005_add_push_subscriptions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("skills", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "skills")
