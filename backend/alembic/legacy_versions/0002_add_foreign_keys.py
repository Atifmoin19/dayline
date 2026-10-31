"""add foreign keys / referential integrity

Adds FK constraints to the previously string-keyed schema (relations were emp_id /
task_id by convention only). Before creating each constraint the migration cleans up
orphaned rows so the ADD CONSTRAINT cannot fail on live data:

  * nullable references (users.manager_id, tasks.task_assigned_to / task_assigned_by,
    notifications.task_id)          -> orphans set to NULL
  * NOT-NULL references (foundation.emp_id, task_comments.task_id, task_links.*,
    notifications.user_id)          -> orphaned rows DELETED (they point at a parent
                                       that no longer exists and are unreachable)

⚠ REVIEW BEFORE RUNNING ON PRODUCTION. Run `python fk_preflight_audit.py` first to see
exactly how many rows each cleanup step would touch. The DELETEs are destructive; if the
audit reports unexpected orphans, resolve the data before upgrading.

`task_comments.author_id` is deliberately NOT constrained — it can hold the sentinel
"system" for auto activity-log entries, which is not a real users.emp_id.

Revision ID: 0002_add_foreign_keys
Revises: 8d840365c088
Create Date: 2026-07-25
"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002_add_foreign_keys"
down_revision: str | Sequence[str] | None = "8d840365c088"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# (constraint_name, source_table, [source_cols], ref_table, [ref_cols], ondelete)
FKS = [
    ("fk_users_manager_id",        "users",         ["manager_id"],      "users", ["emp_id"], "SET NULL"),
    ("fk_foundation_emp_id",       "foundation",    ["emp_id"],          "users", ["emp_id"], "CASCADE"),
    ("fk_tasks_assigned_to",       "tasks",         ["task_assigned_to"], "users", ["emp_id"], "SET NULL"),
    ("fk_tasks_assigned_by",       "tasks",         ["task_assigned_by"], "users", ["emp_id"], "SET NULL"),
    ("fk_task_comments_task_id",   "task_comments", ["task_id"],         "tasks", ["id"],     "CASCADE"),
    ("fk_task_links_from_task_id", "task_links",    ["from_task_id"],    "tasks", ["id"],     "CASCADE"),
    ("fk_task_links_to_task_id",   "task_links",    ["to_task_id"],      "tasks", ["id"],     "CASCADE"),
    ("fk_notifications_user_id",   "notifications", ["user_id"],         "users", ["emp_id"], "CASCADE"),
    ("fk_notifications_task_id",   "notifications", ["task_id"],         "tasks", ["id"],     "SET NULL"),
]

# Orphan cleanup, run before constraints are created. Order: NULL-out nullable refs,
# then DELETE rows whose NOT-NULL parent is missing.
NULL_ORPHANS = [
    ("UPDATE users SET manager_id = NULL "
     "WHERE manager_id IS NOT NULL AND manager_id NOT IN (SELECT emp_id FROM users)"),
    ("UPDATE tasks SET task_assigned_to = NULL "
     "WHERE task_assigned_to IS NOT NULL AND task_assigned_to NOT IN (SELECT emp_id FROM users)"),
    ("UPDATE tasks SET task_assigned_by = NULL "
     "WHERE task_assigned_by IS NOT NULL AND task_assigned_by NOT IN (SELECT emp_id FROM users)"),
    ("UPDATE notifications SET task_id = NULL "
     "WHERE task_id IS NOT NULL AND task_id NOT IN (SELECT id FROM tasks)"),
]
DELETE_ORPHANS = [
    "DELETE FROM foundation WHERE emp_id NOT IN (SELECT emp_id FROM users)",
    "DELETE FROM task_comments WHERE task_id NOT IN (SELECT id FROM tasks)",
    ("DELETE FROM task_links WHERE from_task_id NOT IN (SELECT id FROM tasks) "
     "OR to_task_id NOT IN (SELECT id FROM tasks)"),
    "DELETE FROM notifications WHERE user_id NOT IN (SELECT emp_id FROM users)",
]


def _is_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


def upgrade() -> None:
    # 1. Clean orphaned rows so no ADD CONSTRAINT can fail.
    for sql in NULL_ORPHANS + DELETE_ORPHANS:
        op.execute(sql)

    # 2. Create the foreign keys. SQLite can't ALTER-ADD a constraint, so use batch
    #    (table-rebuild) there; Postgres/other get a plain ALTER TABLE ADD CONSTRAINT.
    if _is_sqlite():
        by_table: dict = {}
        for name, src, scols, ref, rcols, ondelete in FKS:
            by_table.setdefault(src, []).append((name, scols, ref, rcols, ondelete))
        for src, specs in by_table.items():
            with op.batch_alter_table(src) as batch:
                for name, scols, ref, rcols, ondelete in specs:
                    batch.create_foreign_key(name, ref, scols, rcols, ondelete=ondelete)
    else:
        for name, src, scols, ref, rcols, ondelete in FKS:
            op.create_foreign_key(name, src, ref, scols, rcols, ondelete=ondelete)


def downgrade() -> None:
    if _is_sqlite():
        by_table: dict = {}
        for name, src, *_ in FKS:
            by_table.setdefault(src, []).append(name)
        for src, names in by_table.items():
            with op.batch_alter_table(src) as batch:
                for name in names:
                    batch.drop_constraint(name, type_="foreignkey")
    else:
        for name, src, *_ in FKS:
            op.drop_constraint(name, src, type_="foreignkey")
