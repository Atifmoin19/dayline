"""In-process scheduling for single-process hosting (e.g. Render's free web service).

With CELERY_ENABLED unset/false (the default), the FastAPI process itself runs the periodic
jobs that Celery Beat runs otherwise:

    overdue_sweep   every OVERDUE_SWEEP_INTERVAL_SECONDS (default 60)
    demo_purge      every DEMO_PURGE_INTERVAL_SECONDS (default 3600)

Each job also runs once at startup, so an instance waking from sleep catches up at once.
On Postgres every run takes a session-level advisory lock and is skipped if another
instance already holds it, so two web instances never double-process a sweep. With
CELERY_ENABLED=true nothing here starts; Celery Beat owns the schedule (celery_app.py).
"""
import asyncio
import logging
import os
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy import text

logger = logging.getLogger(__name__)


def celery_enabled() -> bool:
    return os.getenv("CELERY_ENABLED", "").strip().lower() in ("1", "true", "yes", "on")


def _interval(name: str, default: float) -> float:
    try:
        return max(float(os.getenv(name, "") or default), 0.01)
    except ValueError:
        return default


@dataclass
class Job:
    name: str
    lock_key: int  # Postgres advisory lock id, unique per job
    interval_seconds: float
    run: Callable[[], dict]


def _overdue_sweep() -> dict:
    import main
    import tasks_celery

    result = tasks_celery.sweep_overdue_tasks()
    if result.get("auto_held") or result.get("backlogged"):
        main.notify_change()  # in-memory WebSocket fan-out, no Redis needed
    return result


def _demo_purge() -> dict:
    import tasks_celery

    return tasks_celery.purge_expired_demo_workspaces()


def default_jobs() -> list[Job]:
    return [
        Job("overdue_sweep", 72_310_001, _interval("OVERDUE_SWEEP_INTERVAL_SECONDS", 60), _overdue_sweep),
        Job("demo_purge", 72_310_002, _interval("DEMO_PURGE_INTERVAL_SECONDS", 3600), _demo_purge),
    ]


def _uses_advisory_locks() -> bool:
    from models import engine

    return engine.dialect.name == "postgresql"


def _try_lock(conn, key: int) -> bool:
    return bool(conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": key}).scalar())


def run_job(job: Job) -> dict | None:
    """Run `job` unless another instance holds its lock. Returns the job result, or None
    when skipped or failed (failures are logged, never raised)."""
    try:
        if not _uses_advisory_locks():
            result = job.run()
        else:
            from models import engine

            with engine.connect() as conn:
                if not _try_lock(conn, job.lock_key):
                    logger.info("Scheduled job %s skipped: another instance is running it", job.name)
                    return None
                try:
                    result = job.run()
                finally:
                    conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": job.lock_key})
                    conn.commit()
        logger.info("Scheduled job %s ran: %s", job.name, result)
        return result
    except Exception:
        logger.exception("Scheduled job %s failed", job.name)
        return None


def run_all_once(jobs: list[Job] | None = None) -> dict:
    return {job.name: run_job(job) for job in (jobs or default_jobs())}


async def _loop(job: Job) -> None:
    while True:
        await asyncio.to_thread(run_job, job)
        await asyncio.sleep(job.interval_seconds)


def start_background_jobs(jobs: list[Job] | None = None) -> list[asyncio.Task]:
    """Start one asyncio task per job on the running loop (each runs immediately, then on
    its interval). Call from the app's startup; cancel the returned tasks on shutdown."""
    return [asyncio.create_task(_loop(job), name=f"job:{job.name}") for job in (jobs or default_jobs())]
