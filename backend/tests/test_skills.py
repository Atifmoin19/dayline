"""
Skills tagging (v1 free-text tags, see models.py User.skills):
  - Self-edit via PUT /profile (ProfileSelfUpdate.skills).
  - Admin edit (anyone) via PUT /user/{emp_id} (UserUpdate.skills).
  - Server-side validation caps list length (MAX_SKILLS) and per-tag length
    (MAX_SKILL_LENGTH) — rejected with 422, not silently truncated.
  - Visibility: skills ARE included in both UserRead (admin path) and UserDirectory
    (non-admin path) of GET /user — unlike DOB/blood-group/phone/education/linkedin,
    skills are work-relevant (not personal), and the org-wide directory is exactly what
    the upcoming Org Resource View needs to render them. See UserDirectory's docstring
    in models.py for the full reasoning.
"""
from models import MAX_SKILL_LENGTH, MAX_SKILLS


def test_self_update_adds_skills_via_profile(client, org, auth_as):
    resp = client.put(
        "/profile",
        json={"skills": ["Python", "FastAPI", "SQL"]},
        headers=auth_as("SE001"),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"]["skills"] == ["Python", "FastAPI", "SQL"]


def test_self_update_replaces_existing_skills(client, org, auth_as):
    headers = auth_as("SE001")
    r1 = client.put("/profile", json={"skills": ["Python"]}, headers=headers)
    assert r1.status_code == 200, r1.text

    r2 = client.put("/profile", json={"skills": ["Go", "Kubernetes"]}, headers=headers)
    assert r2.status_code == 200, r2.text
    assert r2.json()["data"]["skills"] == ["Go", "Kubernetes"]


def test_self_update_can_clear_skills_with_empty_list(client, org, auth_as):
    headers = auth_as("SE001")
    client.put("/profile", json={"skills": ["Python"]}, headers=headers)
    r = client.put("/profile", json={"skills": []}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["skills"] == []


def test_admin_can_edit_any_users_skills_via_put_user(client, org, auth_as):
    admin_headers = auth_as("EM001")  # ENGINEERING MANAGER -> admin (permissions.ADMIN_DESIGNATIONS)
    resp = client.put(
        "/user/SE001",
        json={"skills": ["Docker", "AWS"]},
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"]["skills"] == ["Docker", "AWS"]

    # Persisted, visible on a fresh GET too.
    listing = client.get("/user", headers=admin_headers).json()["data"]
    se001 = next(u for u in listing if u["emp_id"] == "SE001")
    assert se001["skills"] == ["Docker", "AWS"]


def test_non_admin_cannot_edit_others_skills_via_put_user(client, org, auth_as):
    # SE001 is a plain IC, not in ADMIN_DESIGNATIONS -> require_admin should 403.
    resp = client.put(
        "/user/SSE001",
        json={"skills": ["Rust"]},
        headers=auth_as("SE001"),
    )
    assert resp.status_code == 403, resp.text


def test_oversized_skills_list_rejected(client, org, auth_as):
    too_many = [f"skill{i}" for i in range(MAX_SKILLS + 1)]
    resp = client.put("/profile", json={"skills": too_many}, headers=auth_as("SE001"))
    assert resp.status_code == 422, resp.text


def test_oversized_skill_tag_length_rejected(client, org, auth_as):
    too_long = "x" * (MAX_SKILL_LENGTH + 1)
    resp = client.put("/profile", json={"skills": [too_long]}, headers=auth_as("SE001"))
    assert resp.status_code == 422, resp.text


def test_oversized_skills_rejected_via_admin_put_user_too(client, org, auth_as):
    too_many = [f"skill{i}" for i in range(MAX_SKILLS + 1)]
    resp = client.put("/user/SE001", json={"skills": too_many}, headers=auth_as("EM001"))
    assert resp.status_code == 422, resp.text


def test_skills_at_the_limit_are_accepted(client, org, auth_as):
    exactly_max = [f"s{i}" for i in range(MAX_SKILLS)]
    resp = client.put("/profile", json={"skills": exactly_max}, headers=auth_as("SE001"))
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["data"]["skills"]) == MAX_SKILLS


def test_skills_visible_in_get_user_for_admin_path(client, org, auth_as):
    """Admins get the full UserRead — skills must be present there."""
    client.put("/profile", json={"skills": ["Python", "SQL"]}, headers=auth_as("SE001"))
    listing = client.get("/user", headers=auth_as("EM001")).json()["data"]
    se001 = next(u for u in listing if u["emp_id"] == "SE001")
    assert se001["skills"] == ["Python", "SQL"]


def test_skills_visible_in_get_user_for_non_admin_directory_path(client, org, auth_as):
    """Non-admins get the lean UserDirectory — skills ARE included there (work-relevant
    metadata, not personal HRIS data), even though other personal fields are stripped."""
    client.put("/profile", json={"skills": ["Python", "SQL"]}, headers=auth_as("SE001"))

    # TL001 is a Team Lead, not in ADMIN_DESIGNATIONS -> gets UserDirectory, not UserRead.
    listing = client.get("/user", headers=auth_as("TL001")).json()["data"]
    se001 = next(u for u in listing if u["emp_id"] == "SE001")
    assert se001["skills"] == ["Python", "SQL"]
    # Confirm this really is the lean shape (personal fields absent), so the skills
    # assertion above is meaningfully testing the lean directory path, not the admin one.
    assert "date_of_birth" not in se001
    assert "blood_group" not in se001
