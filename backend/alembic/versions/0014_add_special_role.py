"""add special_role column to users — scoped-admin grants

Adds `users.special_role` (scale-gaps-plan.md Phase 3, item 3): NULL by default, "dept_admin"
(user-management scoped to the employee's own emp_department) or "auditor" (read-only visibility
into admin surfaces, no mutation rights). Independent of emp_designation/rank — a grant, not a
job title. A CHECK constraint backs the same allow-list `models.py`'s Pydantic validator
enforces at the API layer, since this column can also be touched by anything writing directly
to the DB (CSV import tooling, manual fixes).

Revision ID: 0014_add_special_role
Revises: 0013_add_audit_log
Create Date: 2026-07-27
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0014_add_special_role"
down_revision: str | Sequence[str] | None = "0013_add_audit_log"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_cols = {c["name"] for c in inspector.get_columns("users")}
    if "special_role" not in existing_cols:
        op.add_column("users", sa.Column("special_role", sa.String(length=32), nullable=True))
        op.create_check_constraint(
            "ck_users_special_role", "users", "special_role IN ('dept_admin', 'auditor')",
        )


def downgrade() -> None:
    op.drop_constraint("ck_users_special_role", "users", type_="check")
    op.drop_column("users", "special_role")
