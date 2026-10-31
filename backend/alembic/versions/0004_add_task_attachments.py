"""add task_attachments table

Adds the task_attachments table for image attachments on tasks. Images are stored inline as
base64 (data URI) in a Text column — no object storage / S3 needed for this feature. Enforced
image-only + size cap live in the app layer (main.py), not the DB.

Revision ID: 0004_add_task_attachments
Revises: 0003_add_hris_profile_fields
Create Date: 2026-07-26
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_add_task_attachments"
down_revision: str | Sequence[str] | None = "0003_add_hris_profile_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "task_attachments",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "task_id", sa.String(64),
            sa.ForeignKey("tasks.id", ondelete="CASCADE", name="fk_task_attachments_task_id"),
            nullable=False, index=True,
        ),
        sa.Column("filename", sa.String(255), nullable=True),
        sa.Column("content_type", sa.String(128), nullable=True),
        sa.Column("data", sa.Text(), nullable=False),
        sa.Column("uploaded_by", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("task_attachments")
