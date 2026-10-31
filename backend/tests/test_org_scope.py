"""
Org-tree scoping through the HTTP surface: a report only sees self, a manager sees
self+subtree, no peers/seniors leak through GET /tasks.

GET /tasks is properly scoped (main.py computes get_user_view_scope(current_user) and
intersects/denies against it) — verified below.

GET /user is intentionally NOT org-tree-scoped, unlike GET /tasks — the org chart and
the any-to-any assignee picker both need the full company directory (see the detailed
comment above the GET /user tests further down). What WAS a real gap, since fixed, is
serialization: the response now uses the PII-lean `UserDirectory` schema for non-admins
instead of the full `UserRead` — see those tests for the corrected behavior.
"""


def create_task(client, headers, task_id, assigned_to):
    payload = {
        "id": task_id, "task_name": task_id, "task_assigned_to": assigned_to,
        "task_assigned_by": assigned_to, "task_duration": "1:00", "task_status": "todo",
    }
    r = client.post("/tasks", json=payload, headers=headers)
    assert r.status_code == 201, r.text


# ---------------------------------------------------------------------------------------
# GET /tasks — correctly scoped.
# ---------------------------------------------------------------------------------------
def test_report_sees_only_own_tasks(client, org, auth_as):
    create_task(client, auth_as("SE001"), "T-SELF", "SE001")
    create_task(client, auth_as("SSE001"), "T-PEER", "SSE001")   # peer, same manager (TL001)
    create_task(client, auth_as("EM001"), "T-SENIOR", "EM001")  # senior/grand-manager's own task

    ids = {t["id"] for t in client.get("/tasks", headers=auth_as("SE001")).json()["data"]}
    assert ids == {"T-SELF"}


def test_manager_sees_self_plus_subtree_not_peers_or_seniors(client, org, auth_as):
    create_task(client, auth_as("TL001"), "T-TL", "TL001")
    create_task(client, auth_as("SE001"), "T-SE", "SE001")
    create_task(client, auth_as("SSE001"), "T-SSE", "SSE001")
    create_task(client, auth_as("SE002"), "T-SE2", "SE002")     # sibling branch under EM001
    create_task(client, auth_as("EM001"), "T-EM", "EM001")      # TL001's own manager

    ids = {t["id"] for t in client.get("/tasks", headers=auth_as("TL001")).json()["data"]}
    assert ids == {"T-TL", "T-SE", "T-SSE"}
    assert "T-SE2" not in ids   # no peer leak
    assert "T-EM" not in ids    # no senior/manager leak


def test_top_manager_sees_entire_subtree(client, org, auth_as):
    create_task(client, auth_as("TL001"), "T2-TL", "TL001")
    create_task(client, auth_as("SE001"), "T2-SE", "SE001")
    create_task(client, auth_as("SSE001"), "T2-SSE", "SSE001")
    create_task(client, auth_as("SE002"), "T2-SE2", "SE002")

    ids = {t["id"] for t in client.get("/tasks", headers=auth_as("EM001")).json()["data"]}
    assert ids == {"T2-TL", "T2-SE", "T2-SSE", "T2-SE2"}


def test_requesting_tasks_for_out_of_scope_user_id_returns_empty(client, org, auth_as):
    """SE001 asking GET /tasks?user_id=SE002 (a sibling branch, not their own subtree)
    must not leak SE002's tasks."""
    create_task(client, auth_as("SE002"), "T3-SE2", "SE002")

    r = client.get("/tasks", params={"user_id": "SE002"}, headers=auth_as("SE001"))
    assert r.status_code == 200
    assert r.json()["data"] == []


def test_manager_can_request_subordinate_scope_explicitly(client, org, auth_as):
    create_task(client, auth_as("SE001"), "T4-SE", "SE001")
    r = client.get("/tasks", params={"user_id": "SE001"}, headers=auth_as("TL001"))
    assert r.status_code == 200
    ids = {t["id"] for t in r.json()["data"]}
    assert "T4-SE" in ids


# ---------------------------------------------------------------------------------------
# GET /user — intentionally NOT org-tree-scoped (verified against frontend usage,
# 2026-07-26), unlike GET /tasks.
#
# main.py's `get_users` (`GET /user`) has none of the scope-checking logic that
# `get_tasks` (`GET /tasks`) has — with no `user_id` it returns every user in the
# company; with `user_id` it returns that person's subordinates regardless of the
# caller's relationship to them. That is BY DESIGN, not an oversight:
#   - `/organization` shows the full company hierarchy to everyone (plan.md §10 — org
#     structure is shared information, not access-gated, unlike task/timeline data).
#   - Open task assignment (plan.md §2/§4) needs an any-to-any assignee picker, which
#     needs the full directory to search/filter against.
#   - `Pages/dashboard.tsx` fetches the full list unconditionally with an explicit
#     comment: "Load the full user directory (any authed user may read it)."
# Restricting `GET /user` by org-tree like `GET /tasks` would break both features.
#
# What WAS a real gap: the response used the full enriched `UserRead` schema (DOB,
# blood group, personal phone, education, LinkedIn, …) even though nothing that reads
# this list (org chart, assignee picker, hierarchy popover) renders those fields. Fixed
# by serializing this endpoint through the lean `UserDirectory` schema instead — full
# `UserRead` stays reserved for `/profile` (self) and admin-gated user-management
# endpoints. These tests pin the (now intentional, and now PII-lean) behavior.
# ---------------------------------------------------------------------------------------
def test_get_user_without_user_id_returns_full_directory_by_design(client, org, auth_as):
    r = client.get("/user", headers=auth_as("SE001"))   # a rank-1 IC with zero reports
    assert r.status_code == 200
    seen_ids = {u["emp_id"] for u in r.json()["data"]}
    # Intentionally NOT scoped to {"SE001"} — the org chart / assignee picker need the
    # whole company directory regardless of the caller's own subtree.
    assert seen_ids == {"EM001", "TL001", "SE001", "SSE001", "SE002"}


def test_get_user_with_user_id_ignores_caller_relationship_by_design(client, org, auth_as):
    # SE002 and TL001 are peers (neither is the other's manager) — proves the directory
    # lookup by design doesn't require any relationship between caller and target.
    r = client.get("/user", params={"user_id": "EM001"}, headers=auth_as("SE002"))
    assert r.status_code == 200
    seen_ids = {u["emp_id"] for u in r.json()["data"]}
    assert seen_ids == {"TL001", "SE001", "SSE001", "SE002"}


def test_get_user_directory_excludes_pii_fields(client, org, auth_as):
    """The company-wide listing must never carry personal HRIS fields for other
    employees — only what the org chart / assignee picker actually render.
    `skills` and `timezone` are deliberate exceptions: both are work-relevant scheduling
    metadata (not personal, unlike DOB/blood-group/phone/education/linkedin) that the
    Org Resource View / Team Saturation Heatmap need from this same lean directory — see
    UserDirectory's docstring in models.py."""
    r = client.get("/user", headers=auth_as("SE001"))
    assert r.status_code == 200
    row = r.json()["data"][0]
    assert set(row.keys()) == {
        "id", "emp_id", "emp_name", "emp_designation", "emp_department",
        "manager_id", "profile_pic", "skills", "timezone",
    }
    for pii_field in ("emp_email", "emp_phone", "date_of_birth", "blood_group",
                      "education", "linkedin", "gender", "hris_user_id"):
        assert pii_field not in row


def test_get_user_directory_includes_pii_fields_for_admin(client, org, auth_as):
    """Admins (rank>=4, is_admin) still get the full enriched record — they need
    email/phone/etc. to manage users through this same endpoint (UserManagementPage)."""
    r = client.get("/user", headers=auth_as("EM001"))
    assert r.status_code == 200
    row = next(u for u in r.json()["data"] if u["emp_id"] == "SE001")
    assert "emp_email" in row
    assert "emp_phone" in row
