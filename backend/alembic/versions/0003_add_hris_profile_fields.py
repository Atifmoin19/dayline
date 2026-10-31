"""add enriched HRIS profile fields to users

Adds the columns that store an enriched HR-system profile (imported for future use):
external HR ids, company / legal entity, work location, joining / birth dates, blood group,
payscale, education, linkedin, profile picture. All nullable — no data backfill required.

Revision ID: 0003_add_hris_profile_fields
Revises: 0002_add_foreign_keys
Create Date: 2026-07-25
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003_add_hris_profile_fields"
down_revision: str | Sequence[str] | None = "0002_add_foreign_keys"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# (column_name, type)
COLUMNS = [
    ("node_id", sa.String(64)),
    ("hris_user_id", sa.String(64)),
    ("company", sa.String(128)),
    ("legal_entity", sa.String(255)),
    ("gender", sa.String(32)),
    ("work_location", sa.String(255)),
    ("date_of_joining", sa.String(32)),
    ("date_of_birth", sa.String(32)),
    ("blood_group", sa.String(8)),
    ("payscale", sa.String(64)),
    ("education", sa.JSON()),
    ("linkedin", sa.String(512)),
    ("profile_pic", sa.String(1024)),
]


def upgrade() -> None:
    for name, coltype in COLUMNS:
        op.add_column("users", sa.Column(name, coltype, nullable=True))
    op.create_index("ix_users_node_id", "users", ["node_id"])


def downgrade() -> None:
    op.drop_index("ix_users_node_id", table_name="users")
    for name, _ in reversed(COLUMNS):
        op.drop_column("users", name)
