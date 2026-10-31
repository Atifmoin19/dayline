"""fk_preflight_audit.py — READ-ONLY orphan report for the add-foreign-keys migration.

Run this against the target database BEFORE `alembic upgrade head` to see exactly how
many rows the migration's cleanup would touch. It makes NO changes.

    DATABASE_URL=postgresql+psycopg2://... python fk_preflight_audit.py

Rows counted under "SET NULL" would have that column nulled; rows under "DELETE" would be
removed (their NOT-NULL parent no longer exists). If any DELETE count is non-zero and
unexpected, investigate the data before migrating.
"""
import os
import sys

from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL") or "sqlite:///./taskboard_dev.db"

# (label, action, count_sql)
CHECKS = [
    ("users.manager_id -> users.emp_id", "SET NULL",
     ("SELECT COUNT(*) FROM users WHERE manager_id IS NOT NULL "
      "AND manager_id NOT IN (SELECT emp_id FROM users)")),
    ("tasks.task_assigned_to -> users.emp_id", "SET NULL",
     ("SELECT COUNT(*) FROM tasks WHERE task_assigned_to IS NOT NULL "
      "AND task_assigned_to NOT IN (SELECT emp_id FROM users)")),
    ("tasks.task_assigned_by -> users.emp_id", "SET NULL",
     ("SELECT COUNT(*) FROM tasks WHERE task_assigned_by IS NOT NULL "
      "AND task_assigned_by NOT IN (SELECT emp_id FROM users)")),
    ("notifications.task_id -> tasks.id", "SET NULL",
     ("SELECT COUNT(*) FROM notifications WHERE task_id IS NOT NULL "
      "AND task_id NOT IN (SELECT id FROM tasks)")),
    ("foundation.emp_id -> users.emp_id", "DELETE",
     "SELECT COUNT(*) FROM foundation WHERE emp_id NOT IN (SELECT emp_id FROM users)"),
    ("task_comments.task_id -> tasks.id", "DELETE",
     "SELECT COUNT(*) FROM task_comments WHERE task_id NOT IN (SELECT id FROM tasks)"),
    ("task_links.from/to_task_id -> tasks.id", "DELETE",
     ("SELECT COUNT(*) FROM task_links WHERE from_task_id NOT IN (SELECT id FROM tasks) "
      "OR to_task_id NOT IN (SELECT id FROM tasks)")),
    ("notifications.user_id -> users.emp_id", "DELETE",
     "SELECT COUNT(*) FROM notifications WHERE user_id NOT IN (SELECT emp_id FROM users)"),
]


def main() -> int:
    engine = create_engine(DATABASE_URL)
    print(f"DB: {engine.url}\n")
    print(f"{'relation':<44} {'action':<9} {'orphans':>8}")
    print("-" * 63)
    total_null = total_delete = 0
    with engine.connect() as conn:
        for label, action, sql in CHECKS:
            n = conn.execute(text(sql)).scalar() or 0
            if action == "DELETE":
                total_delete += n
            else:
                total_null += n
            flag = "  <-- destructive" if action == "DELETE" and n else ""
            print(f"{label:<44} {action:<9} {n:>8}{flag}")
    print("-" * 63)
    print(f"total rows to be NULLed:  {total_null}")
    print(f"total rows to be DELETED: {total_delete}")
    if total_delete:
        print("\n⚠ DELETEs are non-zero — review these rows before running the migration.")
    else:
        print("\n✓ No rows would be deleted. Safe to migrate.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
