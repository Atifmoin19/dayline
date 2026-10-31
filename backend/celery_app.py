"""Celery application: Redis as both broker and result backend.

Replaces the old in-process `asyncio` loop (`main.py`'s `check_overdue_tasks`, a
`while True: await asyncio.sleep(60)`) with Celery Beat driving a proper periodic task
(`tasks_celery.sweep_overdue_tasks`) on the same ~60s cadence, run by a separate worker
process instead of inside the FastAPI event loop.

Env vars (matching this codebase's "explicit env var, sensible default" pattern — see
redis_client.py, task_helpers.py):
  - REDIS_HOST / REDIS_PORT / REDIS_DB_CELERY / REDIS_PASSWORD: reuse the SAME Redis
    instance already used for the session store (REDIS_HOST/REDIS_PORT — see
    redis_client.py), but on a separate logical DB index (REDIS_DB_CELERY, default 1,
    vs. the session store's REDIS_DB default 0) so broker/result keys never collide with
    session keys.
  - CELERY_BROKER_URL / CELERY_RESULT_BACKEND: optional full overrides, for anyone who
    wants to point Celery at a different Redis instance than the session store. If unset
    (the expected case), both are derived from REDIS_HOST/REDIS_PORT/REDIS_DB_CELERY.
  - OVERDUE_SWEEP_INTERVAL_SECONDS: how often Beat fires the sweep (default 60, matching
    the old asyncio loop's `await asyncio.sleep(60)`).

Run:
    celery -A celery_app.celery_app worker --loglevel=info
    celery -A celery_app.celery_app beat --loglevel=info
"""
import os

from celery import Celery
from dotenv import load_dotenv

load_dotenv()

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
# Separate DB index from the session store (redis_client.REDIS_DB, default 0) — same
# Redis instance, no key collisions between the two.
REDIS_DB_CELERY = int(os.getenv("REDIS_DB_CELERY", "1"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", None)


def _default_redis_url() -> str:
    auth = f":{REDIS_PASSWORD}@" if REDIS_PASSWORD else ""
    return f"redis://{auth}{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB_CELERY}"


CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", _default_redis_url())
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", CELERY_BROKER_URL)

OVERDUE_SWEEP_INTERVAL_SECONDS = float(os.getenv("OVERDUE_SWEEP_INTERVAL_SECONDS", "60"))

celery_app = Celery(
    "taskboard",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
    include=["tasks_celery"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # Celery Beat drives the periodic schedule (NOT a manual while-True/sleep inside the
    # task itself — that would just reinvent the old asyncio loop on top of Celery).
    beat_schedule={
        "sweep-overdue-tasks": {
            "task": "tasks_celery.sweep_overdue_tasks",
            "schedule": OVERDUE_SWEEP_INTERVAL_SECONDS,
        },
    },
)
