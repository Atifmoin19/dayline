"""POST /demo: disposable, isolated "Try the demo" workspaces.

Covers: feature flag, the returned login, a full Quillbrook Labs copy per call, isolation
between two demos and from the real org, guards on admin/outbound features for demo users,
per-IP and live-workspace limits, and TTL-based purging.
"""
from datetime import datetime, timedelta, timezone

import pytest

import main
from models import DemoWorkspace, Epic, Sprint, Task, User


@pytest.fixture
def demo_on(monkeypatch):
    monkeypatch.setenv("DEMO_MODE_ENABLED", "true")
    monkeypatch.delenv("DEMO_TTL_HOURS", raising=False)
    monkeypatch.delenv("DEMO_MAX_PER_IP_PER_HOUR", raising=False)
    monkeypatch.delenv("DEMO_MAX_LIVE_WORKSPACES", raising=False)


def start_demo(client, persona=None, ip=None):
    body = {"persona": persona} if persona else {}
    if ip:
        from fastapi.testclient import TestClient
        client = TestClient(main.app, client=(ip, 50000))
    return client.post("/demo", json=body)


def bearer(resp):
    return {"Authorization": f"Bearer {resp.json()['data']['token']}"}


def task_items(resp):
    data = resp.json()["data"]
    return data["items"] if isinstance(data, dict) else data


def test_demo_is_404_when_disabled(client, monkeypatch):
    monkeypatch.delenv("DEMO_MODE_ENABLED", raising=False)
    assert start_demo(client).status_code == 404
    monkeypatch.setenv("DEMO_MODE_ENABLED", "false")
    assert start_demo(client).status_code == 404


def test_demo_creates_full_workspace_and_logs_in_as_manager(client, demo_on, db_session):
    r = start_demo(client)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    user = data["userData"]
    assert user["is_demo"] is True
    assert user["emp_designation"] == "Chief Technology Officer"
    assert data["demo"]["persona"] == "manager"
    assert data["demo"]["expires_at"]

    h = bearer(r)
    directory = client.get("/user", headers=h).json()["data"]
    assert len(directory) == 12
    assert {u["emp_department"] for u in directory} == {"Platform", "Mobile", "Quality & Ops"}
    assert len(task_items(client.get("/tasks", headers=h))) == 25
    assert len(client.get("/epics", headers=h).json()["data"]) == 2
    assert len(client.get("/sprints", headers=h).json()["data"]) == 1


def test_developer_persona(client, demo_on):
    r = start_demo(client, persona="developer")
    assert r.status_code == 200, r.text
    assert r.json()["data"]["userData"]["emp_designation"] == "Senior Software Engineer"
    assert r.json()["data"]["demo"]["persona"] == "developer"


def test_unknown_persona_is_rejected(client, demo_on):
    assert start_demo(client, persona="ceo").status_code == 422


def test_two_demos_cannot_see_or_touch_each_other(client, demo_on, db_session):
    a, b = start_demo(client), start_demo(client)
    ha, hb = bearer(a), bearer(b)
    a_tasks = {t["id"] for t in task_items(client.get("/tasks", headers=ha))}
    b_tasks = {t["id"] for t in task_items(client.get("/tasks", headers=hb))}
    assert len(a_tasks) == len(b_tasks) == 25
    assert a_tasks.isdisjoint(b_tasks)

    a_users = {u["emp_id"] for u in client.get("/user", headers=ha).json()["data"]}
    b_users = {u["emp_id"] for u in client.get("/user", headers=hb).json()["data"]}
    assert a_users.isdisjoint(b_users)

    a_epics = {e["id"] for e in client.get("/epics", headers=ha).json()["data"]}
    b_epics = {e["id"] for e in client.get("/epics", headers=hb).json()["data"]}
    assert a_epics.isdisjoint(b_epics)
    b_sprint = client.get("/sprints", headers=hb).json()["data"][0]["id"]

    # Direct access by id across workspaces is refused.
    b_task = next(iter(b_tasks))
    a_epic = next(iter(a_epics))
    b_epic = next(iter(b_epics))
    assert client.get(f"/epics/{b_epic}", headers=ha).status_code == 404
    assert client.get(f"/sprints/{b_sprint}", headers=ha).status_code == 404
    assert client.put(f"/epics/{b_epic}", json={"name": "x"}, headers=ha).status_code == 404
    assert client.patch(
        f"/tasks/{b_task}/status", json={"task_status": "done"}, headers=ha
    ).status_code in (403, 404)
    assert client.delete(f"/tasks/{b_task}", headers=ha).status_code in (403, 404)
    assert client.get(f"/tasks/{b_task}/comments", headers=ha).status_code in (403, 404)

    # A cannot hand work to B's people, or attach B's epic.
    me_a = a.json()["data"]["userData"]["emp_id"]
    b_person = next(iter(b_users))
    r = client.post("/tasks", json={
        "task_name": "cross", "task_assigned_to": b_person, "task_assigned_by": me_a,
        "task_duration": "1:00", "task_status": "todo",
    }, headers=ha)
    assert r.status_code in (400, 403), r.text
    r = client.post("/tasks", json={
        "task_name": "cross-epic", "task_assigned_to": me_a, "task_assigned_by": me_a,
        "task_duration": "1:00", "task_status": "todo", "epic_id": b_epic,
    }, headers=ha)
    assert r.status_code in (400, 404), r.text
    r = client.post("/tasks", json={
        "task_name": "own-epic", "task_assigned_to": me_a, "task_assigned_by": me_a,
        "task_duration": "1:00", "task_status": "todo", "epic_id": a_epic,
    }, headers=ha)
    assert r.status_code == 201, r.text
    a_task = r.json()["data"]["id"]
    r = client.post(f"/tasks/{a_task}/links", json={"to_task_id": b_task, "link_type": "depends_on"}, headers=ha)
    assert r.status_code in (400, 403, 404), r.text


def test_demo_and_real_org_are_isolated(client, demo_on, org, auth_as, db_session):
    real = auth_as("EM001")
    demo = bearer(start_demo(client))
    real_ids = {u["emp_id"] for u in client.get("/user", headers=real).json()["data"]}
    demo_ids = {u["emp_id"] for u in client.get("/user", headers=demo).json()["data"]}
    assert real_ids == {"EM001", "TL001", "SE001", "SSE001", "SE002"}
    assert real_ids.isdisjoint(demo_ids)
    assert len(client.get("/epics", headers=real).json()["data"]) == 0
    # Global stats ignore demo data.
    m = client.get("/metrics", headers=real).json()["data"]
    assert m["open_task_count"] == 0


@pytest.mark.parametrize("method,path,body", [
    ("post", "/user", {"emp_name": "X", "emp_id": "X1", "emp_email": "x1@example.com",
                       "emp_designation": "Software Engineer"}),
    ("post", "/users/bulk-delete", {"emp_ids": ["nobody"]}),
    ("get", "/audit-log", None),
    ("get", "/admin/employee-overview", None),
    ("post", "/push/subscribe", {"endpoint": "https://push.example/x", "keys": {"p256dh": "a", "auth": "b"}}),
])
def test_demo_users_are_blocked_from_admin_and_outbound_features(client, demo_on, method, path, body):
    h = bearer(start_demo(client))
    kwargs = {"headers": h}
    if body is not None:
        kwargs["json"] = body
    r = getattr(client, method)(path, **kwargs)
    assert r.status_code == 403, r.text


def test_demo_users_cannot_bulk_upload_or_set_passwords(client, demo_on):
    r = start_demo(client)
    h = bearer(r)
    me = r.json()["data"]["userData"]
    files = {"file": ("u.csv", b"emp_id,emp_name\n", "text/csv")}
    assert client.post("/users/upload", files=files, headers=h).status_code == 403
    assert client.post("/tasks/upload", files=files, headers=h).status_code == 403
    r = client.post("/register", json={
        "emp_id": me["emp_id"], "emp_email": me["emp_email"], "password": "NewPass123!",
    })
    assert r.status_code == 403


def test_demo_never_sends_email_slack_or_push(client, demo_on, monkeypatch):
    sent = []
    monkeypatch.setattr(main, "email_configured", lambda: True)
    monkeypatch.setattr(main, "slack_configured", lambda: True)
    monkeypatch.setattr(main, "push_configured", lambda: True)
    monkeypatch.setattr(main, "send_email", lambda *a, **k: sent.append("email"))
    monkeypatch.setattr(main, "send_slack", lambda *a, **k: sent.append("slack"))
    monkeypatch.setattr(main, "send_push", lambda *a, **k: sent.append("push") or {})
    r = start_demo(client)
    h = bearer(r)
    me = r.json()["data"]["userData"]["emp_id"]
    someone = next(u["emp_id"] for u in client.get("/user", headers=h).json()["data"] if u["emp_id"] != me)
    r = client.post("/tasks", json={
        "task_name": "notify me", "task_assigned_to": someone, "task_assigned_by": me,
        "task_duration": "1:00", "task_status": "todo",
    }, headers=h)
    assert r.status_code == 201, r.text
    assert sent == []


def test_per_ip_limit(client, demo_on, monkeypatch):
    monkeypatch.setenv("DEMO_MAX_PER_IP_PER_HOUR", "2")
    assert start_demo(client, ip="203.0.113.7").status_code == 200
    assert start_demo(client, ip="203.0.113.7").status_code == 200
    assert start_demo(client, ip="203.0.113.7").status_code == 429
    assert start_demo(client, ip="198.51.100.9").status_code == 200


def test_live_workspace_cap(client, demo_on, monkeypatch):
    monkeypatch.setenv("DEMO_MAX_LIVE_WORKSPACES", "2")
    assert start_demo(client, ip="203.0.113.1").status_code == 200
    assert start_demo(client, ip="203.0.113.2").status_code == 200
    assert start_demo(client, ip="203.0.113.3").status_code == 429


def test_expired_workspaces_are_purged_on_next_call(client, demo_on, db_session, freeze_now, monkeypatch):
    monkeypatch.setenv("DEMO_TTL_HOURS", "24")
    t0 = freeze_now(datetime(2026, 3, 11, 5, 0, tzinfo=timezone.utc))
    first = start_demo(client)
    old_ws = db_session.query(DemoWorkspace).one().id
    old_token = bearer(first)
    # Add some activity so purge has comments/links/notifications to clear too.
    task_id = task_items(client.get("/tasks", headers=old_token))[0]["id"]
    assert client.post(f"/tasks/{task_id}/comments", json={"body": "hi"}, headers=old_token).status_code == 201

    freeze_now(t0 + timedelta(hours=25))
    assert start_demo(client).status_code == 200
    db_session.expire_all()
    assert db_session.query(DemoWorkspace).filter(DemoWorkspace.id == old_ws).count() == 0
    assert db_session.query(User).filter(User.workspace_id == old_ws).count() == 0
    assert db_session.query(Epic).filter(Epic.workspace_id == old_ws).count() == 0
    assert db_session.query(Sprint).filter(Sprint.workspace_id == old_ws).count() == 0
    assert db_session.query(Task).count() == 25  # only the new workspace's tasks remain
    assert client.get("/tasks", headers=old_token).status_code == 401


def test_celery_beat_purges_expired_demo_workspaces_hourly(client, demo_on, db_session, freeze_now):
    import celery_app
    import tasks_celery

    entry = celery_app.celery_app.conf.beat_schedule["purge-expired-demo-workspaces"]
    assert entry["task"] == "tasks_celery.purge_expired_demo_workspaces"
    assert entry["schedule"] == 3600

    t0 = freeze_now(datetime(2026, 3, 11, 5, 0, tzinfo=timezone.utc))
    assert start_demo(client).status_code == 200
    assert tasks_celery.purge_expired_demo_workspaces() == {"purged": 0}
    freeze_now(t0 + timedelta(hours=25))
    assert tasks_celery.purge_expired_demo_workspaces() == {"purged": 1}
    db_session.expire_all()
    assert db_session.query(DemoWorkspace).count() == 0
    assert db_session.query(User).count() == 0
