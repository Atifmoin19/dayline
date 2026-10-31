"""
Completion is blocked (409) while a `depends_on` or `subtask` link is unfinished
(main.py's `completion_blockers`), exercised through both PUT /tasks/{id} and
PATCH /tasks/{id}/status.
"""


def create_task(client, headers, task_id, assigned_to="SE001"):
    payload = {
        "id": task_id, "task_name": task_id, "task_assigned_to": assigned_to,
        "task_assigned_by": assigned_to, "task_duration": "1:00", "task_status": "todo",
    }
    r = client.post("/tasks", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def add_link(client, headers, from_task_id, to_task_id, link_type):
    r = client.post(f"/tasks/{from_task_id}/links", json={
        "to_task_id": to_task_id, "link_type": link_type,
    }, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def set_status(client, headers, task_id, status):
    return client.patch(f"/tasks/{task_id}/status", json={"task_status": status}, headers=headers)


def test_depends_on_blocks_completion_until_dependency_done(client, org, auth_as):
    headers = auth_as("SE001")
    create_task(client, headers, "DEP-X")
    create_task(client, headers, "DEP-Y")
    # X depends_on Y -> Y must finish first.
    add_link(client, headers, "DEP-X", "DEP-Y", "depends_on")

    blocked = set_status(client, headers, "DEP-X", "done")
    assert blocked.status_code == 409
    assert "DEP-Y" in blocked.json()["message"] or "DEP-Y" in str(blocked.json())

    # Finish the dependency, then completion succeeds.
    ok_dep = set_status(client, headers, "DEP-Y", "done")
    assert ok_dep.status_code == 200

    ok_x = set_status(client, headers, "DEP-X", "done")
    assert ok_x.status_code == 200
    assert ok_x.json()["data"]["task_status"] == "done"


def test_subtask_blocks_parent_completion_until_child_done(client, org, auth_as):
    headers = auth_as("SE001")
    create_task(client, headers, "PARENT-1")
    create_task(client, headers, "CHILD-1")
    # CHILD-1 is a subtask OF PARENT-1 (from=child, to=parent).
    add_link(client, headers, "CHILD-1", "PARENT-1", "subtask")

    blocked = set_status(client, headers, "PARENT-1", "done")
    assert blocked.status_code == 409

    finish_child = set_status(client, headers, "CHILD-1", "done")
    assert finish_child.status_code == 200

    ok_parent = set_status(client, headers, "PARENT-1", "done")
    assert ok_parent.status_code == 200


def test_put_endpoint_also_enforces_completion_blockers(client, org, auth_as):
    headers = auth_as("SE001")
    create_task(client, headers, "PUT-X")
    create_task(client, headers, "PUT-Y")
    add_link(client, headers, "PUT-X", "PUT-Y", "depends_on")

    r = client.put("/tasks/PUT-X", json={
        "task_name": "PUT-X", "task_assigned_to": "SE001", "task_duration": "1:00",
        "task_status": "done",
    }, headers=headers)
    assert r.status_code == 409


def test_unrelated_task_completion_not_blocked(client, org, auth_as):
    """Sanity check: a task with no links at all completes normally."""
    headers = auth_as("SE001")
    create_task(client, headers, "FREE-1")
    r = set_status(client, headers, "FREE-1", "done")
    assert r.status_code == 200
