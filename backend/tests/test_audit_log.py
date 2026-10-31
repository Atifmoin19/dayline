"""
Org-wide audit log (scale-gaps-plan.md Phase 3, item 2). Covers every write path wired to
`record_audit` (audit_util.py): user create/update/delete/bulk-delete/CSV-import, task
CSV-import. `GET /audit-log` is admin-only, newest-first, filterable by action/actor.
"""


def test_audit_log_requires_admin(client, org, auth_as):
    headers = auth_as("SE001")  # pure IC, not admin (see conftest's `org` docstring)
    r = client.get("/audit-log", headers=headers)
    assert r.status_code == 403


def test_create_user_logs_audit_entry(client, org, auth_as):
    headers = auth_as("EM001")  # rank 4, admin
    r = client.post("/user", json={
        "emp_name": "New Hire", "emp_id": "NEWH01", "emp_email": "newh01@example.com",
        "emp_designation": "SOFTWARE ENGINEER",
    }, headers=headers)
    assert r.status_code == 201, r.text

    log = client.get("/audit-log", headers=headers).json()["data"]
    entries = log["entries"]
    assert any(
        e["action"] == "user.create" and e["target_id"] == "NEWH01" and e["actor_emp_id"] == "EM001"
        for e in entries
    )


def test_update_user_manager_change_logs_diff(client, org, auth_as):
    headers = auth_as("EM001")
    # SE001 currently reports to TL001 (see conftest's `org` fixture) — reassign to EM001.
    r = client.put("/user/SE001", json={"manager_id": "EM001"}, headers=headers)
    assert r.status_code == 200, r.text

    log = client.get("/audit-log?action=user.update", headers=headers).json()["data"]
    entry = next(e for e in log["entries"] if e["target_id"] == "SE001")
    assert entry["details"]["manager_id"]["before"] == "TL001"
    assert entry["details"]["manager_id"]["after"] == "EM001"


def test_update_user_no_change_logs_nothing(client, org, auth_as):
    headers = auth_as("EM001")
    # Re-submitting the same manager_id is a no-op -> no diff -> no audit entry.
    r = client.put("/user/SE001", json={"manager_id": "TL001"}, headers=headers)
    assert r.status_code == 200

    log = client.get("/audit-log?action=user.update", headers=headers).json()["data"]
    assert not any(e["target_id"] == "SE001" for e in log["entries"])


def test_delete_user_logs_audit_entry(client, org, auth_as):
    headers = auth_as("EM001")
    r = client.delete("/user/SE002", headers=headers)
    assert r.status_code == 200, r.text

    log = client.get("/audit-log?action=user.delete", headers=headers).json()["data"]
    assert any(e["target_id"] == "SE002" for e in log["entries"])


def test_bulk_delete_logs_audit_entry(client, org, auth_as):
    headers = auth_as("EM001")
    r = client.post("/users/bulk-delete", json={"emp_ids": ["SE001", "SSE001"]}, headers=headers)
    assert r.status_code == 200, r.text

    log = client.get("/audit-log?action=user.bulk_delete", headers=headers).json()["data"]
    entry = log["entries"][0]
    assert set(entry["details"]["emp_ids"]) == {"SE001", "SSE001"}
    assert entry["details"]["count"] == 2


def test_users_csv_upload_logs_audit_entry(client, org, auth_as):
    headers = auth_as("EM001")
    csv_body = "emp_id,emp_name,emp_email,emp_designation\nCSV001,Csv User,csv001@example.com,SOFTWARE ENGINEER\n"
    r = client.post(
        "/users/upload",
        files={"file": ("users.csv", csv_body, "text/csv")},
        headers=headers,
    )
    assert r.status_code == 200, r.text

    log = client.get("/audit-log?action=user.csv_import", headers=headers).json()["data"]
    assert log["entries"][0]["details"]["added"] == 1


def test_audit_log_newest_first_and_pagination(client, org, auth_as):
    headers = auth_as("EM001")
    for i in range(3):
        client.post("/user", json={
            "emp_name": f"Bulk {i}", "emp_id": f"BULK0{i}", "emp_email": f"bulk0{i}@example.com",
            "emp_designation": "SOFTWARE ENGINEER",
        }, headers=headers)

    log = client.get("/audit-log?limit=2", headers=headers).json()["data"]
    assert len(log["entries"]) == 2
    assert log["entries"][0]["id"] > log["entries"][1]["id"]  # newest first
    assert log["total"] >= 3
