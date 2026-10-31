"""
GET /capacity: per-employee capacity/utilization derived from the scheduler + task_sessions
(main.py's `get_capacity` / `_capacity_for_employee`) — foundational data for the future
Organization Resource View / Team Saturation Heatmap (see pending.md).

Covers:
  - auth is required, like every other endpoint here.
  - scoping mirrors GET /tasks: a manager sees only self + their org subtree, not peers or
    seniors (see tests/test_org_scope.py for the same pattern against /tasks).
  - zero assigned work -> 0% utilization, "available".
  - committed time exceeding the business day -> "over_capacitated".
  - actual logged session time is reflected in today's committed_seconds.
  - the aggregate summary's counts agree with the per-employee status buckets.
"""
from datetime import timedelta

from sqlalchemy.orm.attributes import flag_modified

from models import Task as TaskModel
from task_helpers import BUSINESS_END_HOUR, BUSINESS_START_HOUR, utc_now

BUSINESS_DAY_SECONDS = (BUSINESS_END_HOUR - BUSINESS_START_HOUR) * 3600.0


def create_task(client, headers, assigned_to, task_id, assigned_by=None, duration="2:00"):
    payload = {
        "id": task_id, "task_name": task_id, "task_assigned_to": assigned_to,
        "task_assigned_by": assigned_by or assigned_to, "task_duration": duration,
        "task_status": "todo",
    }
    r = client.post("/tasks", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def employee_row(payload, emp_id):
    return next(e for e in payload["data"]["employees"] if e["emp_id"] == emp_id)


def test_capacity_requires_auth(client, org):
    r = client.get("/capacity")
    assert r.status_code == 401


def test_capacity_scoped_to_managers_subtree(client, org, auth_as):
    """Mirrors test_org_scope.py's pattern against /tasks: TL001 (a manager with two direct
    reports) must see self + subtree only — not the sibling branch (SE002) or their own
    manager (EM001)."""
    r = client.get("/capacity", headers=auth_as("TL001"))
    assert r.status_code == 200, r.text
    ids = {e["emp_id"] for e in r.json()["data"]["employees"]}
    assert ids == {"TL001", "SE001", "SSE001"}
    assert "SE002" not in ids  # peer branch under EM001 — must not leak
    assert "EM001" not in ids  # TL001's own manager — must not leak


def test_report_sees_only_self_in_capacity(client, org, auth_as):
    """SE001 is a pure IC with no reports — their capacity scope is just themselves."""
    r = client.get("/capacity", headers=auth_as("SE001"))
    assert r.status_code == 200
    ids = {e["emp_id"] for e in r.json()["data"]["employees"]}
    assert ids == {"SE001"}


def test_zero_assigned_work_is_zero_pct_and_available(client, org, auth_as):
    r = client.get("/capacity", headers=auth_as("SE001"))
    row = employee_row(r.json(), "SE001")
    assert row["utilization_pct"] == 0.0
    assert row["status"] == "available"
    for day in row["days"]:
        assert day["committed_seconds"] == 0
        assert day["utilization_pct"] == 0.0


def test_open_session_worked_time_counts_toward_todays_committed_seconds(
    client, org, auth_as, db_session
):
    """A task with real, already-logged time (an open in-progress session, in this case)
    should show up in today's committed_seconds even before any "not-yet-worked" backlog
    math applies — i.e. actual worked seconds are never ignored."""
    headers = auth_as("SE001")
    create_task(client, headers, "SE001", "CAP-WORKED", duration="6:00")
    set_status = client.patch(
        "/tasks/CAP-WORKED/status", json={"task_status": "in-progress"}, headers=headers
    )
    assert set_status.status_code == 200, set_status.text

    # Backdate the (still-open) session's start_time to 3h ago so there is a known,
    # non-trivial amount of "already worked today" time to assert on.
    db_session.expire_all()
    task = db_session.query(TaskModel).filter(TaskModel.id == "CAP-WORKED").first()
    sessions = task.task_sessions
    assert len(sessions) == 1 and sessions[0]["end_time"] is None
    sessions[0]["start_time"] = (utc_now() - timedelta(hours=3)).isoformat()
    task.task_sessions = sessions
    flag_modified(task, "task_sessions")
    db_session.commit()

    r = client.get("/capacity", headers=headers)
    row = employee_row(r.json(), "SE001")
    today = row["days"][0]
    # ~3h = 10800s worked so far today; allow slack for wall-clock drift while the test ran.
    assert 10700 <= today["committed_seconds"] <= 10900
    expected_pct = round((today["committed_seconds"] / BUSINESS_DAY_SECONDS) * 100, 1)
    assert today["utilization_pct"] == expected_pct


def test_large_unworked_backlog_exceeding_business_day_is_over_capacitated(client, org, auth_as):
    """A single not-yet-worked task (no sessions at all) with a duration far beyond one
    business day must overflow into tomorrow's bucket past 100% and bucket as
    over_capacitated — the "committed time exceeds the business day" case."""
    headers = auth_as("SE001")
    create_task(client, headers, "SE001", "CAP-BIG", duration="40:00")  # 40h, no sessions

    r = client.get("/capacity", headers=headers)
    row = employee_row(r.json(), "SE001")
    assert row["status"] == "over_capacitated"

    today, tomorrow = row["days"]
    # Today absorbs at most one full business day's worth...
    assert today["committed_seconds"] <= today["available_seconds"]
    # ...and the remainder overflows into tomorrow, past what a single business day can hold.
    assert tomorrow["committed_seconds"] > tomorrow["available_seconds"]
    assert tomorrow["utilization_pct"] > 100.0


def test_aggregate_summary_counts_match_per_employee_statuses(client, org, auth_as):
    """EM001 is the admin/root of the fixture org, so their subtree (self + everyone) gives
    a scope with a genuine mix of the three status buckets to check the summary against."""
    # TL001: a single ~8h/9h-day task, no sessions -> ~88.9% -> at_capacity.
    create_task(client, auth_as("TL001"), "TL001", "CAP-SUMM-ATCAP", duration="8:00")
    # SE001: a 40h task, no sessions -> massively over one business day -> over_capacitated.
    create_task(client, auth_as("SE001"), "SE001", "CAP-SUMM-OVER", duration="40:00")
    # EM001, SSE001, SE002 are left with zero assigned work -> available.

    r = client.get("/capacity", headers=auth_as("EM001"))
    assert r.status_code == 200, r.text
    payload = r.json()["data"]
    employees, summary = payload["employees"], payload["summary"]

    assert summary["total_employees"] == len(employees) == 5

    actual_available = sum(1 for e in employees if e["status"] == "available")
    actual_at_capacity = sum(1 for e in employees if e["status"] == "at_capacity")
    actual_over = sum(1 for e in employees if e["status"] == "over_capacitated")

    assert summary["available_count"] == actual_available == 3
    assert summary["at_capacity_count"] == actual_at_capacity == 1
    assert summary["over_capacitated_count"] == actual_over == 1

    expected_avg = round(sum(e["utilization_pct"] for e in employees) / len(employees), 1)
    assert summary["avg_utilization_pct"] == expected_avg
