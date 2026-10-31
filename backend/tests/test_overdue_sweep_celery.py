"""Coverage for the overdue-sweep LOGIC now that it lives in tasks_celery.sweep_overdue_tasks
(moved off main.py's old in-process asyncio loop, see task 'Background jobs' in pending.md).

Celery tasks are plain callables: calling `sweep_overdue_tasks()` directly runs the task
body immediately and synchronously, bypassing the broker entirely — no running Celery
worker/beat/Redis is needed for these tests. That's deliberate: the periodic SCHEDULING
(Celery Beat firing this every 60s) isn't something a unit test can usefully exercise, but
the sweep LOGIC itself (what the DB looks like before/after one pass) absolutely can be,
against the same isolated SQLite test DB the rest of the suite uses (db_session/client
fixtures — see conftest.py).
"""
from datetime import timedelta

from sqlalchemy.orm.attributes import flag_modified

from main import utc_now
from models import Task as TaskModel
from tasks_celery import sweep_overdue_tasks


def create_task(client, headers, assigned_to, task_id, assigned_by=None, duration="1:00", **extra):
    payload = {
        "id": task_id,
        "task_name": extra.pop("task_name", "Sweep target"),
        "task_assigned_to": assigned_to,
        "task_assigned_by": assigned_by or assigned_to,
        "task_duration": duration,
        "task_status": extra.pop("task_status", "todo"),
        **extra,
    }
    r = client.post("/tasks", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def test_sweep_moves_overdue_idle_task_to_backlog(client, org, auth_as, db_session):
    """A 'todo' task with no open session whose due date is already in the past should be
    swept to 'backlog' — the same 'Fix 1' behavior the old asyncio loop implemented."""
    headers = auth_as("SE001")
    create_task(
        client, headers, "SE001", "SWEEP-OVERDUE-1",
        task_due_date=(utc_now() - timedelta(hours=2)).isoformat(),
    )

    result = sweep_overdue_tasks()

    assert result["backlogged"] >= 1
    db_session.expire_all()
    task = db_session.query(TaskModel).filter(TaskModel.id == "SWEEP-OVERDUE-1").first()
    assert task.task_status == "backlog"


def test_sweep_leaves_not_yet_due_task_alone(client, org, auth_as, db_session):
    headers = auth_as("SE001")
    create_task(
        client, headers, "SE001", "SWEEP-NOT-DUE",
        task_due_date=(utc_now() + timedelta(hours=2)).isoformat(),
    )

    sweep_overdue_tasks()

    db_session.expire_all()
    task = db_session.query(TaskModel).filter(TaskModel.id == "SWEEP-NOT-DUE").first()
    assert task.task_status == "todo"


def test_sweep_auto_holds_runaway_open_session(client, org, auth_as, db_session):
    """An 'in-progress' task whose open session crossed a calendar day should be
    auto-held ('Fix 2' — cap runaway open sessions), not left running forever."""
    headers = auth_as("SE001")
    create_task(client, headers, "SE001", "SWEEP-RUNAWAY")
    r = client.patch(
        "/tasks/SWEEP-RUNAWAY/status", json={"task_status": "in-progress"}, headers=headers,
    )
    assert r.status_code == 200, r.text

    # Backdate the open session's start_time to yesterday so it reads as "crossed a
    # calendar day" without a real multi-day sleep.
    task = db_session.query(TaskModel).filter(TaskModel.id == "SWEEP-RUNAWAY").first()
    sessions = task.task_sessions
    assert len(sessions) == 1 and sessions[0]["end_time"] is None
    sessions[0]["start_time"] = (utc_now() - timedelta(days=1)).isoformat()
    task.task_sessions = sessions
    flag_modified(task, "task_sessions")
    db_session.commit()

    result = sweep_overdue_tasks()

    assert result["auto_held"] >= 1
    db_session.expire_all()
    task = db_session.query(TaskModel).filter(TaskModel.id == "SWEEP-RUNAWAY").first()
    assert task.task_status == "on-hold"
    assert all(s.get("end_time") for s in task.task_sessions)


def test_sweep_leaves_freshly_opened_session_alone(client, org, auth_as, db_session):
    """A session opened moments ago (same business day, well under the max-hours cap)
    must NOT be touched — the sweeper only caps genuinely runaway sessions."""
    headers = auth_as("SE001")
    create_task(client, headers, "SE001", "SWEEP-FRESH")
    r = client.patch(
        "/tasks/SWEEP-FRESH/status", json={"task_status": "in-progress"}, headers=headers,
    )
    assert r.status_code == 200, r.text

    sweep_overdue_tasks()

    db_session.expire_all()
    task = db_session.query(TaskModel).filter(TaskModel.id == "SWEEP-FRESH").first()
    assert task.task_status == "in-progress"
    assert any(s.get("end_time") is None for s in task.task_sessions)


def test_sweep_returns_zero_counts_and_skips_publish_when_nothing_changed(client, monkeypatch):
    """Regression guard for the 'only publish a WS ping when something actually changed'
    optimization: with no eligible tasks, sweep_overdue_tasks must not attempt a Redis
    publish at all."""
    import tasks_celery

    called = []
    monkeypatch.setattr(tasks_celery, "publish_ws_event", lambda payload: called.append(payload))

    result = sweep_overdue_tasks()

    assert result == {"auto_held": 0, "backlogged": 0}
    assert called == []
