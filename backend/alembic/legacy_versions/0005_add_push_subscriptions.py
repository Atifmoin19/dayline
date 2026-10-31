"""add push_subscriptions table

Adds the push_subscriptions table for browser web-push (VAPID). One row per subscribed
browser/device; endpoint is unique so re-subscribing the same browser upserts in place.

Revision ID: 0005_add_push_subscriptions
Revises: 0004_add_task_attachments
Create Date: 2026-07-26
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005_add_push_subscriptions"
down_revision: str | Sequence[str] | None = "0004_add_task_attachments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "user_id", sa.String(64),
            sa.ForeignKey("users.emp_id", ondelete="CASCADE", name="fk_push_subscriptions_user_id"),
            nullable=False, index=True,
        ),
        sa.Column("endpoint", sa.Text(), nullable=False, unique=True),
        sa.Column("p256dh", sa.String(255), nullable=False),
        sa.Column("auth", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("push_subscriptions")
