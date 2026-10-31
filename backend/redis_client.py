import json
import logging
import os
from typing import Optional

import redis
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Check for REDIS_URL in env, else default
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", None)

# Sliding-window session lifetime (matches the previous 15-min inactivity policy).
SESSION_TTL_SECONDS = 15 * 60
_SESSION_PREFIX = "session:"

# Cached client so we don't reconnect + PING on every request.
_client: Optional["redis.Redis"] = None


def get_redis_client():
    """Return a cached Redis client, or None if Redis is unavailable."""
    global _client
    if _client is not None:
        return _client
    try:
        r = redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            db=REDIS_DB,
            password=REDIS_PASSWORD,
            decode_responses=True,  # String responses instead of bytes
        )
        r.ping()  # Test connection
        _client = r
        return _client
    except redis.RedisError as e:
        logger.warning("Error connecting to Redis: %s", e)
        return None


def set_value(key: str, value: str, expiration: int | None = None):
    r = get_redis_client()
    if r:
        r.set(key, value, ex=expiration)


def get_value(key: str):
    r = get_redis_client()
    if r:
        return r.get(key)
    return None


# ── Session store ────────────────────────────────────────────────────────────
def session_set(token: str, emp_id: str) -> bool:
    """Store token -> emp_id with a sliding TTL. Returns False if Redis is down."""
    r = get_redis_client()
    if not r:
        return False
    r.setex(f"{_SESSION_PREFIX}{token}", SESSION_TTL_SECONDS, emp_id)
    return True


def session_get(token: str) -> str | None:
    """Return the emp_id for a token and refresh its TTL (sliding window).
    Returns None if the token is missing/expired. Callers should first check
    redis_available() to distinguish 'expired' from 'Redis down'."""
    r = get_redis_client()
    if not r:
        return None
    key = f"{_SESSION_PREFIX}{token}"
    emp_id = r.get(key)
    if emp_id:
        r.expire(key, SESSION_TTL_SECONDS)
    return emp_id


def session_delete(token: str) -> None:
    r = get_redis_client()
    if r:
        r.delete(f"{_SESSION_PREFIX}{token}")


def redis_available() -> bool:
    return get_redis_client() is not None


# ── Cross-process WebSocket broadcast (pub/sub) ─────────────────────────────────────────
# The Celery worker running tasks_celery.sweep_overdue_tasks is a SEPARATE OS process from
# the FastAPI app, so it cannot call main.py's in-memory `ConnectionManager.broadcast`
# directly (see main.py's ConnectionManager docstring — single-instance, in-memory fan-out
# is a deliberate simplicity choice, not an oversight). Redis pub/sub bridges the two
# processes: the worker publishes a small JSON event here after a sweep commits changes;
# main.py runs a background thread (`_ws_redis_listener`) subscribed to this channel that
# forwards each event onto its in-memory WebSocket connections via `notify_change`.
WS_BROADCAST_CHANNEL = "taskboard:ws_broadcast"


def publish_ws_event(payload: dict) -> bool:
    """Publish a JSON-encoded event for `_ws_redis_listener` (main.py) to pick up and
    fan out to connected WebSocket clients. Best-effort: returns False (no-op) if Redis
    is unavailable — same "unset/unavailable = degrade gracefully" pattern as every other
    optional integration in this codebase, not a hard dependency for the sweep to work."""
    r = get_redis_client()
    if not r:
        return False
    try:
        r.publish(WS_BROADCAST_CHANNEL, json.dumps(payload))
        return True
    except redis.RedisError as e:
        logger.warning("Error publishing WS event to Redis: %s", e)
        return False
