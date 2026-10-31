"""
Task CRUD: create -> list (org-tree scoped) -> update -> status PATCH -> delete
(ownership/rank check).
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


def test_create_task_requires_assignee(client, org, auth_as):
    headers = auth_as("TL001")
    r = create_task(client, headers, assigned_to=None)
    assert r.status_code == 400


def test_create_task_rejects_zero_duration(client, org, auth_as):
    headers = auth_as("TL001")
    r = create_task(client, headers, assigned_to="SE001", task_duration="0")
    assert r.status_code == 400


def test_create_task_success(client, org, auth_as):
    headers = auth_as("TL001")
    r = create_task(client, headers, assigned_to="SE001", assigned_by="TL001", task_id="T-CREATE-1")
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    assert data["id"] == "T-CREATE-1"
    assert data["task_assigned_to"] == "SE001"


def test_create_task_any_to_any_assignment_allowed(client, org, auth_as):
    """Since can_assign_task_to is now a permissive pass-through, a rank-1 IC can create
    a task assigned to their own grand-manager (rank 4). Previously this would 403."""
    headers = auth_as("SE001")
    r = create_task(client, headers, assigned_to="EM001", assigned_by="SE001", task_id="T-UPWARD")
    assert r.status_code == 201, r.text


def test_create_task_duplicate_id_rejected(client, org, auth_as):
    headers = auth_as("TL001")
    r1 = create_task(client, headers, assigned_to="SE001", task_id="DUP-1")
    assert r1.status_code == 201
    r2 = create_task(client, headers, assigned_to="SE001", task_id="DUP-1")
    assert r2.status_code == 400


def test_list_tasks_scoped_to_own_subtree(client, org, auth_as):
    headers_tl = auth_as("TL001")
    headers_em = auth_as("EM001")

    create_task(client, headers_tl, assigned_to="SE001", task_id="T-SE1")
    create_task(client, headers_em, assigned_to="SE002", task_id="T-SE2")

    # TL001 sees their own subtree's task, not SE002's (a sibling branch under EM001).
    r = client.get("/tasks", headers=headers_tl)
    assert r.status_code == 200
    ids = {t["id"] for t in r.json()["data"]}
    assert "T-SE1" in ids
    assert "T-SE2" not in ids

    # EM001 sees both (their whole subtree).
    r2 = client.get("/tasks", headers=headers_em)
    ids2 = {t["id"] for t in r2.json()["data"]}
    assert {"T-SE1", "T-SE2"} <= ids2


def test_list_tasks_by_user_id_denied_outside_scope(client, org, auth_as):
    """Passing ?user_id= for someone outside the caller's view scope returns an empty
    list rather than leaking data (main.py's get_tasks explicit scope check)."""
    headers_se = auth_as("SE001")
    create_task(client, auth_as("EM001"), assigned_to="SE002", task_id="T-OUTSIDE")

    r = client.get("/tasks", params={"user_id": "SE002"}, headers=headers_se)
    assert r.status_code == 200
    assert r.json()["data"] == []


def test_update_task_by_assignee(client, org, auth_as):
    headers = auth_as("TL001")
    create_task(client, headers, assigned_to="SE001", assigned_by="TL001", task_id="T-UPD-1")

    headers_se = auth_as("SE001")
    r = client.put("/tasks/T-UPD-1", json={
        "task_name": "Renamed", "task_assigned_to": "SE001", "task_duration": "3:00",
        "task_status": "todo",
    }, headers=headers_se)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["task_name"] == "Renamed"


def test_update_task_denied_for_unrelated_user(client, org, auth_as):
    create_task(client, auth_as("TL001"), assigned_to="SE001", assigned_by="TL001", task_id="T-UPD-2")

    headers_sse = auth_as("SSE001")   # peer of SE001 under the same lead, not assignee/assigner/admin
    r = client.put("/tasks/T-UPD-2", json={
        "task_name": "Hijacked", "task_assigned_to": "SE001", "task_duration": "3:00",
        "task_status": "todo",
    }, headers=headers_sse)
    assert r.status_code == 403


def test_status_patch_by_manager_of_assignee(client, org, auth_as):
    create_task(client, auth_as("TL001"), assigned_to="SE001", assigned_by="TL001", task_id="T-STATUS-1")
    r = client.patch("/tasks/T-STATUS-1/status", json={"task_status": "in-progress"}, headers=auth_as("TL001"))
    assert r.status_code == 200
    assert r.json()["data"]["task_status"] == "in-progress"


def test_status_patch_denied_for_unrelated_user(client, org, auth_as):
    create_task(client, auth_as("TL001"), assigned_to="SE001", assigned_by="TL001", task_id="T-STATUS-2")
    r = client.patch("/tasks/T-STATUS-2/status", json={"task_status": "in-progress"}, headers=auth_as("SE002"))
    assert r.status_code == 403


def test_delete_task_by_assignee_allowed(client, org, auth_as):
    create_task(client, auth_as("TL001"), assigned_to="SE001", assigned_by="TL001", task_id="T-DEL-1")
    r = client.delete("/tasks/T-DEL-1", headers=auth_as("SE001"))
    assert r.status_code == 200

    # Confirmed gone.
    r2 = client.get("/tasks", headers=auth_as("SE001"))
    ids = {t["id"] for t in r2.json()["data"]}
    assert "T-DEL-1" not in ids


def test_delete_task_denied_for_unrelated_user(client, org, auth_as):
    create_task(client, auth_as("TL001"), assigned_to="SE001", assigned_by="TL001", task_id="T-DEL-2")
    r = client.delete("/tasks/T-DEL-2", headers=auth_as("SE002"))
    assert r.status_code == 403


def test_delete_task_allowed_for_admin_even_if_unrelated(client, org, auth_as):
    create_task(client, auth_as("TL001"), assigned_to="SE001", assigned_by="TL001", task_id="T-DEL-3")
    r = client.delete("/tasks/T-DEL-3", headers=auth_as("EM001"))
    assert r.status_code == 200


def test_delete_task_not_found(client, org, auth_as):
    r = client.delete("/tasks/does-not-exist", headers=auth_as("EM001"))
    assert r.status_code == 404
