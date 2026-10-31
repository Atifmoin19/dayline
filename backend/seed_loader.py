"""Shared loader for the fictional demo organisation (seed/quillbrook_labs.json).

Used by seed_demo.py (load it as THE org, real workspace) and by POST /demo (load an
isolated copy per visitor, with workspace-scoped ids). Inserting never deletes anything.
"""
import json
import os
import secrets
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from models import Epic, Foundation, Sprint, Task, TaskComment, TaskLink, User
from task_helpers import BUSINESS_END_HOUR, BUSINESS_START_HOUR, BUSINESS_TZ, recalculate_total_time

SEED_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed", "quillbrook_labs.json")
USER_FIELDS = (
    "emp_name", "emp_phone", "emp_designation", "emp_department",
    "company", "work_location", "skills", "timezone",
)
_FINISHED = ("done", "completed")


def load_seed(path: str = SEED_FILE) -> dict:
    with open(path) as f:
        return json.load(f)


def _topo_order(users: list) -> list:
    """Managers before their reports (needed when the manager_id FK is enforced)."""
    by_id = {u["emp_id"]: u for u in users}

    def depth(u, seen=()):
        mgr = u.get("manager_id")
        if not mgr or mgr not in by_id or u["emp_id"] in seen:
            return 0
        return 1 + depth(by_id[mgr], seen + (u["emp_id"],))

    return sorted(users, key=depth)


def _unique_ticket(db, model, prefix: str, digits: int, taken: set) -> str:
    """A random ticket id that is neither stored yet nor already handed out in this batch.

    `taken` matters: the session runs with autoflush=False, so rows added earlier in the same
    insert are invisible to the query and two of them could draw the same number."""
    while True:
        ticket = f"{prefix}-{secrets.randbelow(10 ** digits):0{digits}d}"
        if ticket in taken:
            continue
        if not db.query(model.id).filter(model.ticket_id == ticket).first():
            taken.add(ticket)
            return ticket


# Today's sessions need some of the working day behind them; before this many minutes have
# passed, the "today" work is laid out on the previous day instead.
_MIN_DAY_MINUTES = 30


class _Clock:
    """Places the seed's relative times on the wall clock of the business timezone.

    "Today" is the working day so far: BUSINESS_START_HOUR to min(now, BUSINESS_END_HOUR).
    Early in the morning there is no such window yet, so the previous working day stands in
    for it, and nothing is left running. Every session lands inside working hours and before
    `now`, wherever `now` falls."""

    def __init__(self, now):
        self.now = now
        self.tz = ZoneInfo(BUSINESS_TZ)
        local_now = now.astimezone(self.tz)
        start = self._at(local_now.date(), BUSINESS_START_HOUR)
        end = min(now, self._at(local_now.date(), BUSINESS_END_HOUR))
        if end - start < timedelta(minutes=_MIN_DAY_MINUTES):
            self.day = local_now.date() - timedelta(days=1)
            start, end = self._at(self.day, BUSINESS_START_HOUR), self._at(self.day, BUSINESS_END_HOUR)
        else:
            self.day = local_now.date()
        self.win_start, self.win_end = start, end
        self.can_run = end == now  # a timer can only still be running during working hours
        local_today = local_now.date()
        # End of the working day for due dates; late in the day use midnight so a task due
        # "today" is not already overdue.
        self.eod_hour = BUSINESS_END_HOUR if local_now.hour < BUSINESS_END_HOUR - 1 else None
        self.local_today = local_today

    def _at(self, day, hour, minute=0):
        return datetime.combine(day, time(hour, minute), tzinfo=self.tz).astimezone(timezone.utc)

    def frac(self, f: float):
        span = (self.win_end - self.win_start).total_seconds()
        return (self.win_start + timedelta(seconds=round(span * f / 60) * 60)).replace(microsecond=0)

    def due_eod(self, days: int):
        day = self.local_today + timedelta(days=days)
        if self.eod_hour is None:
            return self._at(day, 23, 59)
        return self._at(day, self.eod_hour)

    def sessions(self, specs: list) -> list:
        out = []
        for sp in specs:
            if "days_ago" in sp:
                hh, mm = (int(x) for x in sp["at"].split(":"))
                start = self._at(self.day - timedelta(days=sp["days_ago"]), hh, mm)
                end = start + timedelta(minutes=sp["minutes"])
            else:
                start = self.frac(sp["from"])
                end = self.frac(sp["to"]) if sp.get("to") is not None else (None if self.can_run else self.win_end)
            out.append({
                "start_time": start.isoformat(),
                "end_time": end.isoformat() if end else None,
                "status": "in-progress" if end is None else "on-hold",
            })
        return sorted(out, key=lambda x: x["start_time"])


def insert_seed(db, data: dict, now, *, password_hash: str, workspace_id: str | None = None) -> dict:
    """Insert users, credentials, epics, sprints, tasks and subtask links from `data`.

    With `workspace_id`, every id/email/ticket is made unique for that workspace and the
    users/epics/sprints are tagged with it. Returns {seed emp_id: stored emp_id}.
    Commits once at the end.
    """
    ws = workspace_id
    taken: set = set()

    def emp(seed_id):
        return f"{ws}-{seed_id}" if ws and seed_id else seed_id

    def obj_id(seed_id):
        return f"{ws}-{seed_id}" if ws else seed_id

    emp_map = {u["emp_id"]: emp(u["emp_id"]) for u in data["users"]}
    for u in _topo_order(data["users"]):
        email = u["emp_email"]
        if ws:
            local, domain = email.split("@", 1)
            email = f"{local}+{ws}@{domain}"
        db.add(User(
            emp_id=emp_map[u["emp_id"]], emp_email=email,
            manager_id=emp_map.get(u.get("manager_id")) if u.get("manager_id") else None,
            workspace_id=ws, **{k: u.get(k) for k in USER_FIELDS},
        ))
        db.flush()
    for u in data["users"]:
        db.add(Foundation(emp_id=emp_map[u["emp_id"]], password=password_hash, token=None, is_onboarded=True))

    epic_ids = {}
    for e in data.get("epics", []):
        epic_ids[e["id"]] = obj_id(e["id"])
        db.add(Epic(
            id=epic_ids[e["id"]],
            ticket_id=_unique_ticket(db, Epic, "E", 5, taken) if ws else e.get("ticket_id"),
            name=e["name"], description=e.get("description"), status=e.get("status"),
            owner_id=emp_map.get(e.get("owner_id")), department=e.get("department"),
            start_date=now + timedelta(days=e.get("start_offset_days", 0)),
            target_date=now + timedelta(days=e.get("target_offset_days", 30)),
            created_by=emp_map.get(e.get("owner_id")), created_at=now, updated_at=now,
            workspace_id=ws,
        ))
    sprint_ids = {}
    for s in data.get("sprints", []):
        sprint_ids[s["id"]] = obj_id(s["id"])
        db.add(Sprint(
            id=sprint_ids[s["id"]], name=s["name"],
            start_date=now + timedelta(days=s["start_offset_days"]),
            end_date=now + timedelta(days=s["end_offset_days"]),
            created_by=emp_map.get(s.get("created_by")), created_at=now, workspace_id=ws,
        ))
    db.flush()

    clock = _Clock(now)
    tasks = data["tasks"]
    task_ids = {t["key"]: (f"{ws}-{t['key']}" if ws else f"seed-{t['key']}") for t in tasks}
    for i, t in enumerate(tasks):
        if t.get("due_eod_days") is not None:
            due = clock.due_eod(t["due_eod_days"])
        else:
            due = now + timedelta(days=t.get("due_offset_days", 7))
        sessions = clock.sessions(t.get("sessions", []))
        finished = t["task_status"] in _FINISHED
        if finished and sessions:
            completed_at = datetime.fromisoformat(sessions[-1]["end_time"])
            sessions[-1]["status"] = t["task_status"]
        else:
            completed_at = due if finished else None
        task = Task(
            id=task_ids[t["key"]],
            ticket_id=_unique_ticket(db, Task, "T", 5, taken) if ws else t.get("ticket_id"),
            task_name=t["task_name"], task_description=t.get("task_description"),
            task_status=t["task_status"],
            task_assigned_to=emp_map[t["task_assigned_to"]], task_assigned_by=emp_map[t["task_assigned_by"]],
            task_assigned_date=due - timedelta(days=3), task_due_date=due,
            task_priority=t.get("task_priority"), task_tags=t.get("task_tags"),
            task_duration=t.get("task_duration"), time_spent=0.0, task_sessions=sessions,
            task_created_at=now - timedelta(days=14, minutes=i), task_updated_at=now,
            completed_at=completed_at,
            epic_id=epic_ids.get(t.get("epic_id")), sprint_id=sprint_ids.get(t.get("sprint_id")),
        )
        recalculate_total_time(task)
        db.add(task)
    db.flush()

    names = {u["emp_id"]: u["emp_name"] for u in data["users"]}
    for t in tasks:
        for c in t.get("comments", []):
            db.add(TaskComment(
                task_id=task_ids[t["key"]], author_id=emp_map[c["author"]], author_name=names[c["author"]],
                body=c["body"], is_system=False, created_at=now - timedelta(minutes=c.get("minutes_ago", 0)),
            ))

    # Subtask edges (child -> parent) and the denormalised parent counters.
    for t in tasks:
        children = [c for c in tasks if c.get("subtask_of") == t["key"]]
        for c in children:
            db.add(TaskLink(from_task_id=task_ids[c["key"]], to_task_id=task_ids[t["key"]],
                            link_type="subtask", created_at=now))
        if children:
            parent = db.get(Task, task_ids[t["key"]])
            parent.subtask_total = len(children)
            parent.subtask_done = sum(c["task_status"] in _FINISHED for c in children)
    db.commit()
    return emp_map
