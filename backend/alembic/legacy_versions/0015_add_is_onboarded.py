"""add foundation.is_onboarded — onboarding-wizard status

Adds `foundation.is_onboarded` (default false). Backfilled in the same migration: every
existing row is marked onboarded (true) unless its current password still verifies against
the org-wide bulk-reset default ("123456") — same check `register`'s first-login guard
already uses (main.py) — in which case it's left false so the admin panel and the
onboarding wizard both see it as pending. Drives the new admin employee-overview listing
without a per-row bcrypt check on every page load.

Revision ID: 0015_add_is_onboarded
Revises: 0014_add_special_role
Create Date: 2026-07-31
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0015_add_is_onboarded"
down_revision: str | Sequence[str] | None = "0014_add_special_role"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_cols = {c["name"] for c in inspector.get_columns("foundation")}
    if "is_onboarded" not in existing_cols:
        op.add_column(
            "foundation",
            sa.Column("is_onboarded", sa.Boolean(), nullable=False, server_default=sa.false()),
        )

    # Backfill: mark every row onboarded unless its password still equals the bulk-reset
    # default — done here (Python + bcrypt), not a bulk SQL UPDATE, since bcrypt hashes are
    # salted and there's no way to express "hashes to 123456" in SQL.
    from security import verify_password  # local import — module lives at repo root

    foundation = sa.table(
        "foundation",
        sa.column("id", sa.Integer),
        sa.column("password", sa.String),
        sa.column("is_onboarded", sa.Boolean),
    )
    rows = bind.execute(sa.select(foundation.c.id, foundation.c.password)).fetchall()
    still_default_ids = [row.id for row in rows if verify_password("123456", row.password)]
    if still_default_ids:
        bind.execute(
            foundation.update()
            .where(foundation.c.id.in_(still_default_ids))
            .values(is_onboarded=False)
        )
    onboarded_ids = [row.id for row in rows if row.id not in set(still_default_ids)]
    if onboarded_ids:
        bind.execute(
            foundation.update()
            .where(foundation.c.id.in_(onboarded_ids))
            .values(is_onboarded=True)
        )


def downgrade() -> None:
    op.drop_column("foundation", "is_onboarded")
