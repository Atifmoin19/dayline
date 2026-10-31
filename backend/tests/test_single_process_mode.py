"""Single-process hosting (Render free tier): no Celery, no Redis.

Covers the in-process scheduler (runs both jobs once at startup and on intervals, skips a
run when another instance holds the lock), Redis being off unless configured, and the
WebSocket broadcast working in-memory without Redis pub/sub.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import main
import redis_client
import scheduler
from models import DemoWorkspace, Task


@pytest.fixture
def no_celery(monkeypatch):
    monkeypatch.delenv("CELERY_ENABLED", raising=False)


def test_celery_is_off_by_default(monkeypatch):
    monkeypatch.delenv("CELERY_ENABLED", raising=False)
    assert scheduler.celery_enabled() is False
    monkeypatch.setenv("CELERY_ENABLED", "true")
    assert scheduler.celery_enabled() is True


def test_redis_is_off_unless_configured(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("REDIS_HOST", raising=False)

    def boom(*a, **k):
        raise AssertionError("must not try to connect when Redis is not configured")

    monkeypatch.setattr(redis_client.redis, "Redis", boom)
    monkeypatch.setattr(redis_client.redis, "from_url", boom)
    assert redis_client.redis_configured() is False
    assert redis_client._build_client() is None


def test_redis_url_is_used_when_set(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "rediss://user:pw@cache.example:6380/0")
    seen = {}

    class Fake:
        def ping(self):
            return True

    def from_url(url, **kwargs):
        seen["url"] = url
        return Fake()

    monkeypatch.setattr(redis_client.redis, "from_url", from_url)
    assert redis_client.redis_configured() is True
    assert isinstance(redis_client._build_client(), Fake)
    assert seen["url"] == "rediss://user:pw@cache.example:6380/0"


def test_run_all_once_runs_sweep_and_demo_purge(client, org, auth_as, db_session, freeze_now, monkeypatch):
    monkeypatch.setenv("DEMO_MODE_ENABLED", "true")
    t0 = freeze_now(datetime(2026, 3, 11, 5, 0, tzinfo=timezone.utc))
    assert client.post("/demo", json={}).status_code == 200
    # An overdue, never-started task for the real org: the sweep moves it to backlog.
    r = client.post("/tasks", json={
        "id": "OVERDUE-1", "task_name": "late", "task_assigned_to": "SE001",
        "task_assigned_by": "SE001", "task_duration": "1:00", "task_status": "todo",
        "task_due_date": (t0 - timedelta(days=2)).isoformat(),
    }, headers=auth_as("SE001"))
    assert r.status_code == 201, r.text

    pings = []
    monkeypatch.setattr(main, "notify_change", lambda *a, **k: pings.append(a))
    freeze_now(t0 + timedelta(hours=25))
    results = scheduler.run_all_once()
    assert results["demo_purge"] == {"purged": 1}
    assert "auto_held" in results["overdue_sweep"]
    db_session.expire_all()
    assert db_session.query(DemoWorkspace).count() == 0
    assert db_session.get(Task, "OVERDUE-1").task_status == "backlog"
    assert pings, "a sweep that changed tasks must ping WebSocket clients in-process"


def test_job_is_skipped_when_another_instance_holds_the_lock(monkeypatch):
    calls = []
    monkeypatch.setattr(scheduler, "_try_lock", lambda conn, key: False)
    monkeypatch.setattr(scheduler, "_uses_advisory_locks", lambda: True)
    job = scheduler.Job("x", 42, 60, lambda: calls.append(1) or {"ok": 1})
    assert scheduler.run_job(job) is None
    assert calls == []


def test_background_loop_runs_each_job_on_startup_then_on_interval(monkeypatch):
    runs = []
    jobs = [scheduler.Job("a", 1, 0.05, lambda: runs.append("a") or {}),
            scheduler.Job("b", 2, 10, lambda: runs.append("b") or {})]

    async def scenario():
        tasks = scheduler.start_background_jobs(jobs)
        await asyncio.sleep(0.2)
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    asyncio.run(scenario())
    assert runs.count("b") == 1  # once at startup, interval not reached
    assert runs.count("a") >= 2  # startup + at least one interval tick


def test_websocket_broadcast_works_without_redis(db_session, org, no_celery, monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("REDIS_HOST", raising=False)
    with TestClient(main.app) as c:
        token = c.post("/login", json={"emp_id": "SE001", "password": "TestPass123!"}).json()["data"]["token"]
        with c.websocket_connect("/ws") as ws:
            r = c.post("/tasks", json={
                "task_name": "ping me", "task_assigned_to": "SE001", "task_assigned_by": "SE001",
                "task_duration": "1:00", "task_status": "todo",
            }, headers={"Authorization": f"Bearer {token}"})
            assert r.status_code == 201, r.text
            assert ws.receive_json()["type"] == "tasks_changed"
