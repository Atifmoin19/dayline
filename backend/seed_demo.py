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
The same data also backs POST /demo (see demo.py), which loads isolated copies instead.
"""
import sys

from models import (
    DemoWorkspace,
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
from seed_loader import SEED_FILE, insert_seed, load_seed
from task_helpers import utc_now


def _arg(flag: str, default=None):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default


def main() -> int:
    data = load_seed(_arg("--file", SEED_FILE))
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
    db = SessionLocal()
    try:
        for model in (Notification, TaskLink, TaskComment, Task, Sprint, Epic, Foundation,
                      DemoWorkspace):
            db.query(model).delete()
        db.query(User).update({User.manager_id: None})
        db.query(User).delete()
        db.commit()

        insert_seed(db, data, utc_now(), password_hash=hash_password(password))
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
