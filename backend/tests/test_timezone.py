"""
Per-employee timezone (v1, see models.py User.timezone):
  - Self-edit via PUT /profile (ProfileSelfUpdate.timezone).
  - Admin edit (anyone) via PUT /user/{emp_id} (UserUpdate.timezone).
  - Validated as a real IANA tz name (zoneinfo.ZoneInfo) — rejected with 422, not silently
    accepted, since a garbage value would otherwise break the /capacity day-boundary math.
  - Visibility: timezone IS included in both UserRead (admin path) and UserDirectory
    (non-admin path) of GET /user — same "work-relevant scheduling metadata, not personal
    HRIS data" reasoning as `skills`. See UserDirectory's docstring in models.py.
  - GET /capacity becomes genuinely timezone-aware: each employee's "today"/"tomorrow"
    boundaries (and therefore committed_seconds/utilization) are computed in THEIR OWN
    timezone (falling back to the global BUSINESS_TIMEZONE when unset), not the single
    global business timezone for everyone.
"""
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm.attributes import flag_modified

import main
import task_helpers
from models import Task as TaskModel
from task_helpers import BUSINESS_TZ, utc_now


def employee_row(payload, emp_id):
    return next(e for e in payload["data"]["employees"] if e["emp_id"] == emp_id)


def create_task_with_session(client, headers, assigned_to, task_id, db_session, start_dt, end_dt):
    """A task with exactly one CLOSED session spanning [start_dt, end_dt) — kept out of the
    "not-yet-worked backlog" bucket entirely (it has a session), so committed_seconds for a
    given day is driven purely by whether `start_dt` falls on that day in the employee's
    resolved timezone."""
    payload = {
        "id": task_id, "task_name": task_id, "task_assigned_to": assigned_to,
        "task_assigned_by": assigned_to, "task_duration": "1:00",
        "task_status": "done",
    }
    r = client.post("/tasks", json=payload, headers=headers)
    assert r.status_code == 201, r.text

    task = db_session.query(TaskModel).filter(TaskModel.id == task_id).first()
    task.task_sessions = [
        {"start_time": start_dt.isoformat(), "end_time": end_dt.isoformat(), "status": "done"}
    ]
    flag_modified(task, "task_sessions")
    db_session.commit()


# --- (a) no timezone set -> falls back to the global BUSINESS_TIMEZONE default ----------

def test_no_timezone_falls_back_to_business_timezone_default(client, org, auth_as, db_session):
    headers = auth_as("SE001")
    start = utc_now() - timedelta(hours=2)
    end = utc_now() - timedelta(hours=1)
    create_task_with_session(client, headers, "SE001", "TZ-FALLBACK", db_session, start, end)

    r = client.get("/capacity", headers=headers)
    assert r.status_code == 200, r.text
    row = employee_row(r.json(), "SE001")

    # SE001 never set a timezone -> the response reports the global default, and the
    # worked hour lands in "today" exactly as it would have before this field existed.
    assert row["timezone"] == BUSINESS_TZ
    assert 3500 <= row["days"][0]["committed_seconds"] <= 3700


def test_get_user_reports_business_timezone_default_when_unset(client, org, auth_as):
    listing = client.get("/user", headers=auth_as("EM001")).json()["data"]
    se001 = next(u for u in listing if u["emp_id"] == "SE001")
    assert se001["timezone"] is None  # column itself is null; /capacity does the fallback


# --- (b) two employees in different real timezones get different day-boundary buckets ---

def test_two_employees_in_different_timezones_get_different_day_buckets(
    client, org, auth_as, db_session, monkeypatch
):
    """Freeze "now" at 2026-01-15T14:00:00Z, a UTC hour where Kolkata (+05:30) and
    Honolulu (-10:00, no DST -> deterministic year-round) both currently read the SAME
    calendar date (2026-01-15) as "today". Construct a session starting at Kolkata's
    midnight for that date:
      - In Asia/Kolkata, that instant IS 2026-01-15 -> "today" for the Kolkata employee.
      - In Pacific/Honolulu (15.5h behind Kolkata), that same instant is still 2026-01-14
        -> "yesterday" relative to the Honolulu employee's own "today" (2026-01-15), so it
        falls entirely outside their {today, tomorrow} capacity window.
    Same absolute session, two employees, two different resolved committed_seconds.
    """
    frozen_now = datetime(2026, 1, 15, 14, 0, 0, tzinfo=dt_timezone.utc)
    monkeypatch.setattr(main, "utc_now", lambda: frozen_now)
    monkeypatch.setattr(task_helpers, "utc_now", lambda: frozen_now)

    kol_headers = auth_as("SE001")
    hon_headers = auth_as("SSE001")
    client.put("/profile", json={"timezone": "Asia/Kolkata"}, headers=kol_headers)
    client.put("/profile", json={"timezone": "Pacific/Honolulu"}, headers=hon_headers)

    kolkata_midnight = datetime(2026, 1, 15, 0, 0, 0, tzinfo=ZoneInfo("Asia/Kolkata"))
    session_end = kolkata_midnight + timedelta(hours=1)

    # Sanity-check the construction itself before trusting the assertions built on it.
    assert kolkata_midnight.astimezone(ZoneInfo("Asia/Kolkata")).date().isoformat() == "2026-01-15"
    assert kolkata_midnight.astimezone(ZoneInfo("Pacific/Honolulu")).date().isoformat() == "2026-01-14"

    create_task_with_session(
        client, kol_headers, "SE001", "TZ-KOL", db_session, kolkata_midnight, session_end
    )
    create_task_with_session(
        client, hon_headers, "SSE001", "TZ-HON", db_session, kolkata_midnight, session_end
    )

    r = client.get("/capacity", headers=auth_as("EM001"))
    assert r.status_code == 200, r.text
    payload = r.json()

    kol_row = employee_row(payload, "SE001")
    hon_row = employee_row(payload, "SSE001")

    assert kol_row["timezone"] == "Asia/Kolkata"
    assert hon_row["timezone"] == "Pacific/Honolulu"

    # Kolkata employee: the session's start_time IS "today" in their timezone -> counted.
    assert 3500 <= kol_row["days"][0]["committed_seconds"] <= 3700
    # Honolulu employee: the very same absolute session is "yesterday" in their timezone,
    # so it lands in neither the today nor the tomorrow bucket -> zero committed seconds.
    assert hon_row["days"][0]["committed_seconds"] == 0
    assert hon_row["days"][1]["committed_seconds"] == 0


# --- (c) invalid timezone strings are rejected with 422 on both edit paths --------------

def test_invalid_timezone_rejected_on_self_profile_update(client, org, auth_as):
    resp = client.put(
        "/profile", json={"timezone": "Not/A_Real_Zone"}, headers=auth_as("SE001")
    )
    assert resp.status_code == 422, resp.text


def test_invalid_timezone_rejected_on_admin_user_update(client, org, auth_as):
    resp = client.put(
        "/user/SE001", json={"timezone": "Mars/Olympus_Mons"}, headers=auth_as("EM001")
    )
    assert resp.status_code == 422, resp.text


def test_valid_timezone_accepted_on_both_edit_paths(client, org, auth_as):
    r1 = client.put("/profile", json={"timezone": "America/New_York"}, headers=auth_as("SE001"))
    assert r1.status_code == 200, r1.text
    assert r1.json()["data"]["timezone"] == "America/New_York"

    r2 = client.put(
        "/user/SE001", json={"timezone": "Asia/Kolkata"}, headers=auth_as("EM001")
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["data"]["timezone"] == "Asia/Kolkata"


# --- (d) timezone visible in GET /user for both admin and non-admin ---------------------

def test_timezone_visible_in_get_user_for_admin_path(client, org, auth_as):
    client.put("/profile", json={"timezone": "America/New_York"}, headers=auth_as("SE001"))
    listing = client.get("/user", headers=auth_as("EM001")).json()["data"]
    se001 = next(u for u in listing if u["emp_id"] == "SE001")
    assert se001["timezone"] == "America/New_York"


def test_timezone_visible_in_get_user_for_non_admin_directory_path(client, org, auth_as):
    client.put("/profile", json={"timezone": "America/New_York"}, headers=auth_as("SE001"))

    # TL001 is a Team Lead, not in ADMIN_DESIGNATIONS -> gets UserDirectory, not UserRead.
    listing = client.get("/user", headers=auth_as("TL001")).json()["data"]
    se001 = next(u for u in listing if u["emp_id"] == "SE001")
    assert se001["timezone"] == "America/New_York"
    # Confirm this really is the lean shape (personal fields absent).
    assert "date_of_birth" not in se001
    assert "blood_group" not in se001
