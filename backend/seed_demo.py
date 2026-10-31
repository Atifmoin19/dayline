"""Load the fictional demo organisation (seed/quillbrook_labs.json) into the database.

Quillbrook Labs is an invented company: 12 people across three teams (Platform, Mobile,
Quality & Ops), two epics, one sprint and 25 tasks in mixed states. No real data.

DESTRUCTIVE: wipes existing users, credentials, tasks, comments, links, notifications,
epics and sprints first. Dry-run by default (prints the plan, writes nothing).

    python seed_demo.py                      # dry run
    python seed_demo.py --yes                # wipe + load (uses $DATABASE_URL, else SQLite)
    python seed_demo.py --yes --password 'S3cret!'
    python seed_demo.py --yes --file path/to/other_seed.json

Any JSON with the same shape works, so this doubles as the generic org/team import path.
"""
import json
import os
import sys
from datetime import timedelta

from models import (
    Epic,
    Foundation,
    Notification,
    SessionLocal,
    Sprint,
    Task,
    TaskComment,
    TaskLink,
    User,
    engine,
    init_db,
)
from security import hash_password
from task_helpers import utc_now

DEFAULT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed", "quillbrook_labs.json")
USER_FIELDS = (
    "emp_id", "emp_name", "emp_email", "emp_phone", "emp_designation", "emp_department",
    "manager_id", "company", "work_location", "skills", "timezone",
)


def _arg(flag: str, default=None):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default


def topo_order(users: list) -> list:
    """Managers before their reports (needed when the manager_id FK is enforced)."""
    by_id = {u["emp_id"]: u for u in users}

    def depth(u, seen=()):
        mgr = u.get("manager_id")
        if not mgr or mgr not in by_id or u["emp_id"] in seen:
            return 0
        return 1 + depth(by_id[mgr], seen + (u["emp_id"],))

    return sorted(users, key=depth)


def main() -> int:
    path = _arg("--file", DEFAULT_FILE)
    with open(path) as f:
        data = json.load(f)
    password = _arg("--password", data.get("default_password", "ChangeMe123!"))
    users, tasks = data["users"], data["tasks"]

    print(f"Target DB : {engine.url}")
    print(f"Company   : {data['company']['name']}")
    print(f"Plan      : {len(users)} users, {len(data.get('epics', []))} epics, "
          f"{len(data.get('sprints', []))} sprints, {len(tasks)} tasks")
    if "--yes" not in sys.argv:
        print("\nDRY RUN: nothing written. Re-run with --yes to wipe + load.")
        return 0

    init_db()
    now = utc_now()
    db = SessionLocal()
    try:
        for model in (Notification, TaskLink, TaskComment, Task, Sprint, Epic, Foundation, User):
            db.query(model).delete()
        db.commit()

        for u in topo_order(users):
            db.add(User(**{k: u.get(k) for k in USER_FIELDS}))
            db.flush()
        pw_hash = hash_password(password)
        for u in users:
            db.add(Foundation(emp_id=u["emp_id"], password=pw_hash, token=None, is_onboarded=True))
        db.commit()

        for e in data.get("epics", []):
            db.add(Epic(
                id=e["id"], ticket_id=e.get("ticket_id"), name=e["name"],
                description=e.get("description"), status=e.get("status"),
                owner_id=e.get("owner_id"), department=e.get("department"),
                start_date=now + timedelta(days=e.get("start_offset_days", 0)),
                target_date=now + timedelta(days=e.get("target_offset_days", 30)),
                created_by=e.get("owner_id"), created_at=now, updated_at=now,
            ))
        for s in data.get("sprints", []):
            db.add(Sprint(
                id=s["id"], name=s["name"],
                start_date=now + timedelta(days=s["start_offset_days"]),
                end_date=now + timedelta(days=s["end_offset_days"]),
                created_by=s.get("created_by"), created_at=now,
            ))
        db.commit()

        key_to_id = {}
        for i, t in enumerate(tasks):
            task_id = f"seed-{t['key']}"
            key_to_id[t["key"]] = task_id
            due = now + timedelta(days=t.get("due_offset_days", 7))
            finished = t["task_status"] in ("done", "completed")
            db.add(Task(
                id=task_id, ticket_id=t.get("ticket_id"), task_name=t["task_name"],
                task_description=t.get("task_description"), task_status=t["task_status"],
                task_assigned_to=t["task_assigned_to"], task_assigned_by=t["task_assigned_by"],
                task_assigned_date=due - timedelta(days=3), task_due_date=due,
                task_priority=t.get("task_priority"), task_tags=t.get("task_tags"),
                task_duration=t.get("task_duration"), time_spent=0.0, task_sessions=[],
                task_created_at=now - timedelta(days=14, minutes=i), task_updated_at=now,
                completed_at=due if finished else None,
                epic_id=t.get("epic_id"), sprint_id=t.get("sprint_id"),
            ))
        db.commit()

        # Subtask edges (child -> parent) and the denormalised parent counters.
        for t in tasks:
            parent = t.get("subtask_of")
            if parent:
                db.add(TaskLink(from_task_id=key_to_id[t["key"]], to_task_id=key_to_id[parent],
                                link_type="subtask", created_at=now))
        db.commit()
        for t in tasks:
            children = [c for c in tasks if c.get("subtask_of") == t["key"]]
            if children:
                parent = db.get(Task, key_to_id[t["key"]])
                parent.subtask_total = len(children)
                parent.subtask_done = sum(c["task_status"] in ("done", "completed") for c in children)
        db.commit()

        print(f"\nLoaded {len(users)} users (password: {password!r}) and {len(tasks)} tasks.")
        return 0
    except Exception as e:  # noqa: BLE001 — CLI script: report, roll back, exit non-zero
        db.rollback()
        print(f"\nSeed failed, rolled back: {e}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
