"""
Session transitions (main.py start_new_session / close_current_session, driven through
PATCH /tasks/{id}/status): start (in-progress) -> preemption (starting a second task
auto-holds the first, labeled "on-hold" not "completed") -> hold -> done (closes as
"completed", time_spent accrues).
"""
from datetime import timedelta

from main import utc_now
from models import Task as TaskModel


def create_task(client, headers, assigned_to, task_id, assigned_by=None, duration="2:00"):
    payload = {
        "id": task_id, "task_name": "Session task", "task_assigned_to": assigned_to,
        "task_assigned_by": assigned_by or assigned_to, "task_duration": duration,
        "task_status": "todo",
    }
    r = client.post("/tasks", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def set_status(client, headers, task_id, status):
    return client.patch(f"/tasks/{task_id}/status", json={"task_status": status}, headers=headers)


def open_sessions(task_data):
    return [s for s in (task_data.get("task_sessions") or []) if s.get("end_time") is None]


def test_start_session_opens_in_progress(client, org, auth_as):
    headers = auth_as("SE001")
    create_task(client, headers, "SE001", "SESS-A")

    r = set_status(client, headers, "SESS-A", "in-progress")
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["task_status"] == "in-progress"
    sessions = data["task_sessions"] or []
    assert len(sessions) == 1
    assert sessions[0]["end_time"] is None
    assert sessions[0]["status"] == "in-progress"


def test_starting_second_task_preempts_first_to_on_hold(client, org, auth_as):
    headers = auth_as("SE001")
    create_task(client, headers, "SE001", "SESS-B1")
    create_task(client, headers, "SE001", "SESS-B2")

    r1 = set_status(client, headers, "SESS-B1", "in-progress")
    assert r1.json()["data"]["task_status"] == "in-progress"

    r2 = set_status(client, headers, "SESS-B2", "in-progress")
    assert r2.status_code == 200
    assert r2.json()["data"]["task_status"] == "in-progress"
    assert len(open_sessions(r2.json()["data"])) == 1

    # SESS-B1 must now be auto-held — status "on-hold" and its session closed with
    # status "on-hold" (NOT "completed" — a preemption is a pause, not a completion).
    listing = client.get("/tasks", headers=headers).json()["data"]
    b1 = next(t for t in listing if t["id"] == "SESS-B1")
    assert b1["task_status"] == "on-hold"
    closed = [s for s in b1["task_sessions"] if s.get("end_time") is not None]
    assert len(closed) == 1
    assert closed[0]["status"] == "on-hold"
    assert closed[0]["status"] != "completed"
    assert open_sessions(b1) == []


def test_explicit_hold_closes_session_as_on_hold(client, org, auth_as):
    headers = auth_as("SE001")
    create_task(client, headers, "SE001", "SESS-C")
    set_status(client, headers, "SESS-C", "in-progress")

    r = set_status(client, headers, "SESS-C", "on-hold")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["task_status"] == "on-hold"
    assert open_sessions(data) == []
    closed = [s for s in data["task_sessions"] if s.get("end_time")]
    assert closed[-1]["status"] == "on-hold"


def test_done_closes_session_as_completed_and_accrues_time(client, org, auth_as, db_session):
    headers = auth_as("SE001")
    create_task(client, headers, "SE001", "SESS-D")
    set_status(client, headers, "SESS-D", "in-progress")

    # Backdate the just-opened session's start_time by 1 hour so time_spent has something
    # real to accrue (a real `sleep(3600)` isn't practical for a test).
    db_task = db_session.query(TaskModel).filter(TaskModel.id == "SESS-D").first()
    sessions = db_task.task_sessions
    assert len(sessions) == 1
    sessions[0]["start_time"] = (utc_now() - timedelta(hours=1)).isoformat()
    db_task.task_sessions = sessions
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(db_task, "task_sessions")
    db_session.commit()

    r = set_status(client, headers, "SESS-D", "done")
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["task_status"] == "done"
    assert data["completed_at"] is not None
    assert open_sessions(data) == []
    closed = [s for s in data["task_sessions"] if s.get("end_time")]
    assert closed[-1]["status"] == "completed"
    assert data["time_spent"] >= 0.9   # ~1 hour accrued (allow scheduling jitter)


def test_resuming_from_done_clears_completed_at(client, org, auth_as):
    headers = auth_as("SE001")
    create_task(client, headers, "SE001", "SESS-E")
    set_status(client, headers, "SESS-E", "in-progress")
    r = set_status(client, headers, "SESS-E", "done")
    assert r.json()["data"]["completed_at"] is not None

    # Move it back to todo -> completed_at should clear.
    r2 = set_status(client, headers, "SESS-E", "todo")
    assert r2.status_code == 200
    assert r2.json()["data"]["completed_at"] is None
