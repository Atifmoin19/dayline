"""
GET /metrics: auth-gated operational metrics (process uptime, DB reachability, and live
task/session counts). Unlike /health (no auth, coarse up/down only), /metrics surfaces real
task-volume counts drawn from the same tables /tasks serves, so it requires a valid token.
"""


def create_task(client, headers, assigned_to, assigned_by=None, task_id=None, **extra):
    payload = {
        "id": task_id,
        "task_name": extra.pop("task_name", "Do the thing"),
        "task_assigned_to": assigned_to,
        "task_assigned_by": assigned_by,
        "task_duration": extra.pop("task_duration", "2:00"),
        "task_status": extra.pop("task_status", "todo"),
        **extra,
    }
    return client.post("/tasks", json=payload, headers=headers)


def test_metrics_requires_auth(client, org):
    r = client.get("/metrics")
    assert r.status_code == 401


def test_metrics_returns_expected_shape_with_valid_token(client, org, auth_as):
    headers = auth_as("SE001")
    r = client.get("/metrics", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    for key in (
        "uptime_seconds",
        "db",
        "open_task_count",
        "active_session_count",
        "overdue_task_count",
    ):
        assert key in data
    assert data["db"] is True
    assert isinstance(data["uptime_seconds"], (int, float))
    assert data["uptime_seconds"] >= 0


def test_metrics_open_task_count_reflects_live_tasks(client, org, auth_as):
    headers = auth_as("TL001")
    before = client.get("/metrics", headers=headers).json()["data"]["open_task_count"]

    r = create_task(client, headers, assigned_to="SE001", assigned_by="TL001", task_id="T-METRICS-1")
    assert r.status_code == 201, r.text

    after = client.get("/metrics", headers=headers).json()["data"]["open_task_count"]
    assert after == before + 1


def test_metrics_active_session_count_tracks_in_progress_tasks(client, org, auth_as):
    headers = auth_as("TL001")
    r = create_task(
        client, headers, assigned_to="SE001", assigned_by="TL001", task_id="T-METRICS-2",
    )
    assert r.status_code == 201, r.text

    before = client.get("/metrics", headers=headers).json()["data"]["active_session_count"]

    # Status PATCH (not creation) is what opens a work session (main.py's
    # update_task_status -> start_new_session), so flip todo -> in-progress here.
    patched = client.patch(
        "/tasks/T-METRICS-2/status", json={"task_status": "in-progress"}, headers=headers,
    )
    assert patched.status_code == 200, patched.text

    after = client.get("/metrics", headers=headers).json()["data"]["active_session_count"]
    assert after == before + 1
