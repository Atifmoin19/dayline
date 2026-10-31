"""Shared date/session-mutation helpers used by BOTH the FastAPI request handlers
(main.py) and the standalone Celery overdue-sweep task (tasks_celery.py).

Split out of main.py so the Celery worker process (a separate OS process — see
tasks_celery.py) can reuse this logic without importing all of main.py (FastAPI app
construction, every route, the rate limiter, Sentry init, etc.) just to get a handful
of pure/db-row helpers. This mirrors the existing pattern in this repo of standalone
scripts (seed_demo.py, fk_preflight_audit.py) importing directly from
models.py rather than from main.py.

No behavior here changed from what previously lived inline in main.py — this is a
pure move, not a rewrite.
"""
import copy
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm.attributes import flag_modified


def utc_now() -> datetime:
    """Current time as a timezone-aware UTC datetime (for DateTime columns)."""
    return datetime.now(timezone.utc)


def get_utc_now_iso() -> str:
    """UTC ISO 8601 string — used for timestamps stored inside the task_sessions JSON."""
    return utc_now().isoformat()


# Business calendar (single company timezone). The frontend timeline renders in the same tz
# (VITE_BUSINESS_TZ). Used by the overdue sweeper to enforce end-of-day and cap runaway sessions.
BUSINESS_TZ = os.getenv("BUSINESS_TIMEZONE", "Asia/Kolkata")
# The backend historically only tracked the END of the business day (needed by the overdue
# sweeper to cap runaway sessions) — there was no paired START hour anywhere in this file or
# main.py. The frontend scheduler's default company config (src/app/slices/scheduler.slice.ts:
# `config: { startHour: 10, endHour: 19 }`) has always paired a startHour=10 with the same
# endHour=19 this backend defaults to, so 10 is mirrored here as the single backend source of
# truth for "when the business day begins" — used by the /capacity endpoint (main.py) to size
# a business day (BUSINESS_END_HOUR - BUSINESS_START_HOUR) for utilization math.
BUSINESS_START_HOUR = int(os.getenv("BUSINESS_START_HOUR", "10"))
BUSINESS_END_HOUR = int(os.getenv("BUSINESS_END_HOUR", "19"))
# Hard ceiling for a single open session (safety net for "left it running overnight / on logout").
MAX_OPEN_SESSION_HOURS = float(os.getenv("MAX_OPEN_SESSION_HOURS", "12"))


def business_now():
    """Current time in the business timezone (aware)."""
    return utc_now().astimezone(ZoneInfo(BUSINESS_TZ))


def parse_dt(value) -> datetime | None:
    """Coerce a value (datetime, ISO string, or None/empty) to an aware UTC datetime.
    Used for CSV imports and any legacy string input. Returns None if unparseable."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def recalculate_total_time(task):
    sessions = task.task_sessions if task.task_sessions else []
    total_seconds = 0
    for s in sessions:
        start = s.get("start_time")
        end = s.get("end_time")
        if start and end:
            try:
                t1 = datetime.fromisoformat(start)
                t2 = datetime.fromisoformat(end)
                total_seconds += (t2 - t1).total_seconds()
            except ValueError:
                pass

    # Update time_spent in Hours
    task.time_spent = total_seconds / 3600.0


def close_session_at(task, end_dt: datetime, completion_status: str):
    """Close any open session at a SPECIFIC time (not 'now') and re-accrue time_spent.
    Used to cap runaway sessions at end-of-day / a max duration."""
    sessions = copy.deepcopy(task.task_sessions if task.task_sessions else [])
    changed = False
    for s in sessions:
        if s.get("end_time") is None:
            s["end_time"] = end_dt.isoformat()
            s["status"] = completion_status
            changed = True
    if changed:
        task.task_sessions = sessions
        flag_modified(task, "task_sessions")
        recalculate_total_time(task)


def close_current_session(task, completion_status=None):
    # Retrieve current sessions, default to empty list if None
    current_sessions = task.task_sessions if task.task_sessions else []
    # Create a deep copy to ensure we are modifying a new object structure
    # This helps SQLAlchemy detect changes when we reassign it back
    sessions = copy.deepcopy(current_sessions)

    changed = False
    now_str = get_utc_now_iso()

    for s in sessions:
        if s.get("end_time") is None:
            s["end_time"] = now_str
            if completion_status:
                s["status"] = completion_status
            changed = True

    if changed:
        task.task_sessions = sessions
        flag_modified(task, "task_sessions")
        recalculate_total_time(task)
