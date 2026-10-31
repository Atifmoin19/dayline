"""
Comments and links: view/comment gated by the same org-tree scope as can_view_task;
deleting a comment gated by can_delete_comment (author or admin).
"""


def create_task(client, headers, task_id, assigned_to):
    payload = {
        "id": task_id, "task_name": task_id, "task_assigned_to": assigned_to,
        "task_assigned_by": assigned_to, "task_duration": "1:00", "task_status": "todo",
    }
    r = client.post("/tasks", json=payload, headers=headers)
    assert r.status_code == 201, r.text


def test_comment_add_and_list_by_in_scope_user(client, org, auth_as):
    create_task(client, auth_as("SE001"), "CMT-1", "SE001")

    r = client.post("/tasks/CMT-1/comments", json={"body": "hello"}, headers=auth_as("TL001"))
    assert r.status_code == 201, r.text

    listing = client.get("/tasks/CMT-1/comments", headers=auth_as("SE001"))
    assert listing.status_code == 200
    bodies = [c["body"] for c in listing.json()["data"]]
    assert "hello" in bodies


def test_comment_denied_for_out_of_scope_user(client, org, auth_as):
    create_task(client, auth_as("SE001"), "CMT-2", "SE001")
    r = client.post("/tasks/CMT-2/comments", json={"body": "sneaky"}, headers=auth_as("SE002"))
    assert r.status_code == 403


def test_comment_empty_body_rejected(client, org, auth_as):
    create_task(client, auth_as("SE001"), "CMT-3", "SE001")
    r = client.post("/tasks/CMT-3/comments", json={"body": "   "}, headers=auth_as("SE001"))
    assert r.status_code == 400


def test_delete_comment_by_author(client, org, auth_as):
    create_task(client, auth_as("SE001"), "CMT-4", "SE001")
    add = client.post("/tasks/CMT-4/comments", json={"body": "mine"}, headers=auth_as("SE001"))
    comment_id = add.json()["data"]["id"]

    r = client.delete(f"/comments/{comment_id}", headers=auth_as("SE001"))
    assert r.status_code == 200


def test_delete_comment_by_non_author_non_admin_denied(client, org, auth_as):
    create_task(client, auth_as("SE001"), "CMT-5", "SE001")
    add = client.post("/tasks/CMT-5/comments", json={"body": "mine"}, headers=auth_as("TL001"))
    comment_id = add.json()["data"]["id"]

    r = client.delete(f"/comments/{comment_id}", headers=auth_as("SSE001"))
    assert r.status_code == 403


def test_delete_comment_by_admin_allowed(client, org, auth_as):
    create_task(client, auth_as("SE001"), "CMT-6", "SE001")
    add = client.post("/tasks/CMT-6/comments", json={"body": "mine"}, headers=auth_as("SE001"))
    comment_id = add.json()["data"]["id"]

    r = client.delete(f"/comments/{comment_id}", headers=auth_as("EM001"))
    assert r.status_code == 200


def test_links_list_reflects_added_link(client, org, auth_as):
    headers = auth_as("SE001")
    create_task(client, headers, "LNK-1", "SE001")
    create_task(client, headers, "LNK-2", "SE001")
    client.post("/tasks/LNK-1/links", json={"to_task_id": "LNK-2", "link_type": "depends_on"}, headers=headers)

    r = client.get("/tasks/LNK-1/links", headers=headers)
    assert r.status_code == 200
    out = r.json()["data"]
    assert len(out) == 1
    assert out[0]["task_id"] == "LNK-2"
    assert out[0]["link_type"] == "depends_on"
    assert out[0]["direction"] == "outgoing"

    r2 = client.get("/tasks/LNK-2/links", headers=headers)
    assert r2.json()["data"][0]["direction"] == "incoming"


def test_links_add_rejects_self_link(client, org, auth_as):
    headers = auth_as("SE001")
    create_task(client, headers, "LNK-3", "SE001")
    r = client.post("/tasks/LNK-3/links", json={"to_task_id": "LNK-3", "link_type": "depends_on"}, headers=headers)
    assert r.status_code == 400


def test_links_delete_requires_modify_rights(client, org, auth_as):
    create_task(client, auth_as("SE001"), "LNK-4", "SE001")
    create_task(client, auth_as("SE001"), "LNK-5", "SE001")
    add = client.post("/tasks/LNK-4/links", json={"to_task_id": "LNK-5", "link_type": "depends_on"},
                       headers=auth_as("SE001"))
    link_id = add.json()["data"]["id"]

    denied = client.delete(f"/links/{link_id}", headers=auth_as("SE002"))
    assert denied.status_code == 403

    allowed = client.delete(f"/links/{link_id}", headers=auth_as("SE001"))
    assert allowed.status_code == 200
