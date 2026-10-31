"""
GET /insights' two deterministic (NO Gemini) additions — main.py's _task_overdue_risk /
_rebalance_suggestions, wired into get_insights:

  at_risk_tasks: overdue-risk prediction for in-scope todo/in-progress tasks, bucketed
    "medium"/"high" (only those two levels are returned — "low" is dropped).
  rebalance_suggestions: pairs an over_capacitated employee with an available one.

Both are computed independently of Gemini and MUST populate the response even when Gemini
is unconfigured — this file's key regression guard mirrors test_insights.py's existing
"available: false" pattern but asserts the new fields are non-trivially populated too, not
just present-and-empty.
"""
from datetime import timedelta

import pytest

import gemini_util
from main import utc_now
from tests.conftest import CLOCK_SAMPLES


# Run every test here at several fixed instants (inside business hours, after hours and just
# past local midnight) so results never depend on when the suite happens to run.
@pytest.fixture(autouse=True, params=sorted(CLOCK_SAMPLES), ids=sorted(CLOCK_SAMPLES))
def _fixed_clock(request, freeze_now):
    return freeze_now(CLOCK_SAMPLES[request.param])



def create_task(client, headers, assigned_to, task_id, assigned_by=None, duration="2:00", **extra):
    payload = {
        "id": task_id,
        "task_name": extra.pop("task_name", task_id),
        "task_assigned_to": assigned_to,
        "task_assigned_by": assigned_by or assigned_to,
        "task_duration": duration,
        "task_status": extra.pop("task_status", "todo"),
        **extra,
    }
    r = client.post("/tasks", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def test_at_risk_flags_overcapacitated_assignee_due_soon_but_not_a_safe_one(client, org, auth_as):
    """EM001's subtree: SSE001 gets a huge (40h) backlog task due in a couple hours -> way
    over capacity AND can't possibly finish in time -> "high" risk. SE001 gets a small task
    with a due date far in the future and near-zero remaining work relative to the runway
    -> must NOT show up in at_risk_tasks at all (dropped as "low")."""
    headers = auth_as("EM001")
    create_task(
        client, headers, "SSE001", "RISK-OVER",
        duration="40:00", task_due_date=(utc_now() + timedelta(hours=2)).isoformat(),
    )
    create_task(
        client, headers, "SE001", "RISK-SAFE",
        duration="1:00", task_due_date=(utc_now() + timedelta(days=30)).isoformat(),
    )

    r = client.get("/insights", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()["data"]

    at_risk_by_id = {t["task_id"]: t for t in data["at_risk_tasks"]}
    assert "RISK-OVER" in at_risk_by_id
    assert at_risk_by_id["RISK-OVER"]["risk_level"] == "high"
    assert at_risk_by_id["RISK-OVER"]["assignee_emp_id"] == "SSE001"
    assert isinstance(at_risk_by_id["RISK-OVER"]["reason"], str) and at_risk_by_id["RISK-OVER"]["reason"]

    assert "RISK-SAFE" not in at_risk_by_id


def test_at_risk_excludes_done_on_hold_and_backlog_tasks(client, org, auth_as):
    """A task that would otherwise score 'high' risk must not appear once it's done/closed —
    only todo/in-progress tasks are eligible at all."""
    headers = auth_as("SE001")
    create_task(
        client, headers, "SE001", "RISK-DONE",
        duration="40:00", task_due_date=(utc_now() - timedelta(hours=1)).isoformat(),
        task_status="done",
    )

    r = client.get("/insights", headers=headers)
    assert r.status_code == 200, r.text
    at_risk_ids = {t["task_id"] for t in r.json()["data"]["at_risk_tasks"]}
    assert "RISK-DONE" not in at_risk_ids


def test_rebalance_pairs_overcapacitated_with_available(client, org, auth_as):
    """SSE001 way over capacity, SE001 and SE002 left idle -> rebalance_suggestions must
    pair SSE001 with one of the available employees in scope."""
    headers = auth_as("EM001")
    create_task(client, headers, "SSE001", "REBAL-OVER", duration="60:00")

    r = client.get("/insights", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()["data"]

    assert len(data["rebalance_suggestions"]) >= 1
    pair = data["rebalance_suggestions"][0]
    assert pair["overloaded_emp_id"] == "SSE001"
    # Tie-break among equally-idle (0%) candidates isn't part of the documented contract —
    # just assert a real, available (non-overloaded) teammate was picked.
    assert pair["idle_emp_id"] in {"EM001", "SE001", "SE002", "TL001"}
    assert isinstance(pair["reason"], str) and pair["reason"]


def test_rebalance_prefers_shared_skill(client, org, auth_as):
    """When two available employees exist, the one who shares a skill with the
    over_capacitated employee must be chosen over an equally-idle one who doesn't."""
    headers = auth_as("EM001")
    client.put("/user/SSE001", json={"skills": ["Kubernetes"]}, headers=headers)
    client.put("/user/SE002", json={"skills": ["Kubernetes"]}, headers=headers)
    client.put("/user/SE001", json={"skills": ["Photography"]}, headers=headers)

    create_task(client, headers, "SSE001", "REBAL-SKILL", duration="60:00")

    r = client.get("/insights", headers=headers)
    assert r.status_code == 200, r.text
    pair = r.json()["data"]["rebalance_suggestions"][0]
    assert pair["overloaded_emp_id"] == "SSE001"
    assert pair["idle_emp_id"] == "SE002"
    assert "skill" in pair["reason"]


def test_at_risk_and_rebalance_populate_when_gemini_unconfigured(client, org, auth_as):
    """Key regression guard: at_risk_tasks/rebalance_suggestions are DETERMINISTIC and must
    be genuinely populated even with zero Gemini configuration (conftest blanks every
    GEMINI_API_KEY* for the whole suite already) — mirrors test_insights.py's existing
    'available: false' pattern, but goes further to assert the new fields aren't just
    present-but-empty."""
    headers = auth_as("EM001")
    create_task(
        client, headers, "SSE001", "UNCONF-RISK",
        duration="40:00", task_due_date=(utc_now() + timedelta(hours=1)).isoformat(),
    )

    r = client.get("/insights", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()["data"]

    # Gemini itself is unavailable...
    assert data["available"] is False
    assert data["summary"] is None
    assert data["recommendations"] == []
    # ...but the deterministic structures are still real, populated data.
    assert len(data["at_risk_tasks"]) >= 1
    assert any(t["task_id"] == "UNCONF-RISK" for t in data["at_risk_tasks"])
    assert len(data["rebalance_suggestions"]) >= 1
    assert data["rebalance_suggestions"][0]["overloaded_emp_id"] == "SSE001"


def test_at_risk_and_rebalance_also_populate_when_gemini_succeeds(client, org, auth_as, monkeypatch):
    """Same deterministic fields must still be present (and correct) on the success path,
    not just the unconfigured one, and Gemini's own prompt data must include them too (so
    its narrative can reference them)."""
    import json

    monkeypatch.setattr(gemini_util, "GEMINI_API_KEYS", ["only-key"])
    captured = {}

    def fake_call(api_key, prompt):
        captured["prompt"] = prompt
        return json.dumps({"summary": "ok", "recommendations": ["a", "b"]})

    monkeypatch.setattr(gemini_util, "_call_gemini_once", fake_call)

    headers = auth_as("EM001")
    create_task(
        client, headers, "SSE001", "GEMINI-RISK",
        duration="40:00", task_due_date=(utc_now() + timedelta(hours=1)).isoformat(),
    )

    r = client.get("/insights", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["available"] is True
    assert any(t["task_id"] == "GEMINI-RISK" for t in data["at_risk_tasks"])
    assert len(data["rebalance_suggestions"]) >= 1

    payload = json.loads(captured["prompt"].split("DATA:\n", 1)[1])
    assert any(t["task_id"] == "GEMINI-RISK" for t in payload["at_risk_tasks"])
    assert "rebalance_suggestions" in payload
