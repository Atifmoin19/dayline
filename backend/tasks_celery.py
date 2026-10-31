"""Celery tasks. Currently just the overdue-task sweep.

This module is a separate OS PROCESS from the FastAPI app (a Celery worker), so it:
  - Cannot use FastAPI's request-scoped `get_db` dependency (that only exists inside a
    request). It opens its own `SessionLocal()` directly and closes it when done, the
    same pattern standalone scripts in this repo already use (fk_preflight_audit.py,
    seed_demo.py) for DB access outside the request/response cycle.
  - Cannot call `main.py`'s in-memory `ws_manager.broadcast` directly (that object only
    exists inside the FastAPI process). See redis_client.publish_ws_event /
    main.py's `_ws_redis_listener` for how the two processes are bridged instead.

sweep_overdue_tasks is registered with Celery Beat (see celery_app.py's beat_schedule)
to run on a periodic schedule (default 60s) — this REPLACES the old in-process
`main.py: check_overdue_tasks`, a `while True: await asyncio.sleep(60)` asyncio task.
The old function has been deleted from main.py; only one of the two must ever run, or
overdue/auto-hold mutations would be double-processed (double-holding sessions,
duplicate backlog moves, duplicate notifications).
"""
import logging
from datetime import timedelta, timezone
from zoneinfo import ZoneInfo

from celery_app import celery_app
from models import SessionLocal
from models import Task as TaskModel
from redis_client import publish_ws_event
from task_helpers import (
    BUSINESS_END_HOUR,
    BUSINESS_TZ,
    MAX_OPEN_SESSION_HOURS,
    close_current_session,
    close_session_at,
    parse_dt,
    utc_now,
)

logger = logging.getLogger(__name__)

_ACTIVE_STATUSES_EXCLUDED = [
    "done", "completed", "backlog", "Done", "Completed", "Backlog",
    "on-hold", "on hold", "On-Hold", "On Hold",
]


@celery_app.task(name="tasks_celery.sweep_overdue_tasks")
def sweep_overdue_tasks() -> dict:
    """One sweep pass: auto-hold runaway open sessions (crossed-day / past-EOD / max-hours,
    business tz) and move overdue non-open tasks to backlog. Identical logic to the old
    `main.py: check_overdue_tasks` loop body — this is a straight move, not a rewrite —
    minus the `while True: await asyncio.sleep(60)` wrapper, which Celery Beat now owns.

    Returns a small dict (auto-held count, backlogged count) — mostly useful for the test
    that calls this function directly/synchronously (Celery tasks are plain callables;
    calling `sweep_overdue_tasks()` runs the body immediately, bypassing the broker) and
    for worker log/introspection via the Celery result backend.
    """
    auto_held = 0
    backlogged = 0
    db = SessionLocal()
    try:
        tasks = db.query(TaskModel).filter(
            TaskModel.task_status.notin_(_ACTIVE_STATUSES_EXCLUDED)
        ).all()

        now = utc_now()

        for task in tasks:
            try:
                # Support both "HH:MM" (e.g. "01:30") and legacy decimal strings (e.g. "1.5").
                if not task.task_duration or task.task_duration == "0":
                    continue

                if ":" in str(task.task_duration):
                    try:
                        parts = task.task_duration.split(":")
                        int(parts[0])
                        int(parts[1])
                    except ValueError:
                        logger.warning(f"Invalid duration format for task {task.id}: {task.task_duration}")
                        continue
                else:
                    # Legacy float fallback — value itself unused below, but the
                    # cast's ValueError-on-malformed-data is load-bearing, so keep it.
                    float(task.task_duration)

                # Find an open (live) session, if any.
                open_s = next(
                    (s for s in (task.task_sessions or []) if s.get("end_time") is None),
                    None,
                )

                # ── Fix 2: cap runaway open sessions ─────────────────────────────
                # An open session left running overnight / on logout accrues huge
                # time_spent. Auto-hold it if it crossed a calendar day, sits past EOD,
                # or exceeds the hard cap — ending it at that boundary (business tz).
                if open_s is not None:
                    sess_start = parse_dt(open_s.get("start_time"))
                    if sess_start:
                        biz = ZoneInfo(BUSINESS_TZ)
                        start_local = sess_start.astimezone(biz)
                        now_local = now.astimezone(biz)
                        open_hours = (now - sess_start).total_seconds() / 3600.0
                        crossed_day = start_local.date() < now_local.date()
                        past_eod = now_local.hour >= BUSINESS_END_HOUR
                        if crossed_day or open_hours > MAX_OPEN_SESSION_HOURS or (past_eod and open_hours > 0.02):
                            eod_utc = start_local.replace(
                                hour=BUSINESS_END_HOUR, minute=0, second=0, microsecond=0
                            ).astimezone(timezone.utc)
                            cap_end = min(now, eod_utc, sess_start + timedelta(hours=MAX_OPEN_SESSION_HOURS))
                            cap_end = max(cap_end, sess_start)
                            logger.info(f"Task {task.id} ({task.task_name}): auto-holding runaway open session (capped at {cap_end.isoformat()}).")
                            close_session_at(task, cap_end, completion_status="on-hold")
                            task.task_status = "on-hold"
                            task.task_updated_at = now
                            auto_held += 1
                    # Actively-worked (open) tasks are never swept to backlog mid-work.
                    continue

                # ── Fix 1: overdue based on REMAINING work (or the hard due date) ─
                # realign_user_tasks (main.py) reserves remaining, so a near-done task must
                # not be swept on full-duration math. Only non-open tasks (e.g. idle todo)
                # reach here.
                due = parse_dt(task.task_due_date)
                if due is not None:
                    deadline = due
                else:
                    ref_time = parse_dt(task.task_updated_at) or parse_dt(task.task_created_at)
                    if not ref_time:
                        continue
                    remaining_hours = (task.remaining_seconds or 0) / 3600.0
                    deadline = ref_time + timedelta(hours=remaining_hours)

                if now > deadline:
                    logger.info(f"Task {task.id} ({task.task_name}) is overdue. Moving to backlog.")
                    close_current_session(task, completion_status="backlog")
                    task.task_status = "backlog"
                    backlogged += 1

            except ValueError as e:
                # Conversion error for float or date
                logger.warning(f"Skipping task {task.id} due to value error: {e}")
                continue

        db.commit()

    except Exception as e:  # noqa: BLE001 — periodic Celery sweep: must never crash the worker,
        logger.error(f"Error processing matching tasks: {e}")  # log and roll back, retry next cycle
        db.rollback()
    finally:
        db.close()

    # Only ping connected WebSocket clients if the sweep actually changed something —
    # avoids a pointless broadcast (and Redis publish) every single cycle when idle.
    if auto_held or backlogged:
        publish_ws_event({"event": "tasks_changed"})

    return {"auto_held": auto_held, "backlogged": backlogged}


@celery_app.task(name="tasks_celery.purge_expired_demo_workspaces")
def purge_expired_demo_workspaces() -> dict:
    """Hourly: delete "Try the demo" workspaces past their expiry (see demo.py). Runs even
    when demo mode is off, so turning it off still cleans up what was created."""
    import demo
    import task_helpers

    db = SessionLocal()
    try:
        return {"purged": demo.purge_expired(db, task_helpers.utc_now())}
    finally:
        db.close()

