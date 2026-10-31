"""
GET /insights: AI-generated decision-support summary (short plain-language summary + 2-4
recommendations) sitting on top of /capacity + /tasks, powered by Gemini (main.py's
`get_insights`, gemini_util.py).

No test here ever makes a real network/Gemini call — conftest.py forces GEMINI_API_KEY(_2/_3)
blank for the whole suite, and every test that needs a "configured" Gemini exercises the
fallback-chain by monkeypatching gemini_util.GEMINI_API_KEYS + gemini_util._call_gemini_once
(the one function that would actually touch the network).

Covers:
  - auth is required, like every other endpoint here.
  - unconfigured (no key at all) -> available: false with a clear reason, still HTTP 200.
  - a mocked successful Gemini response -> correct response shape.
  - key #1 failing falls back to key #2.
  - all configured keys failing -> graceful available: false (never a 500).
  - a malformed (non-JSON / wrong-shape) Gemini response -> graceful available: false.
  - org-tree scoping: the DATA actually sent to Gemini reflects only the caller's subtree
    (verified by inspecting the captured prompt, not the mocked AI output).
  - caching: a second call within the TTL does not re-invoke the (mocked) Gemini call.
"""
import json

import gemini_util
import redis_client


def _mock_ok(summary="Team is mostly on track.", recommendations=None):
    recommendations = recommendations if recommendations is not None else [
        "Reassign the overdue task to someone with headroom.",
        "Check in with the over-capacitated employee.",
    ]

    def _fake_call(api_key, prompt):
        return json.dumps({"summary": summary, "recommendations": recommendations})

    return _fake_call


class _FakeRedisClient:
    """Minimal in-memory stand-in for the subset of the redis.Redis API this app uses (not
    just get_value/set_value's .get/.set — replacing get_redis_client() wholesale also
    reroutes /login's session_set/session_get, which use .setex/.expire/.delete). Lets the
    caching test exercise the real Redis-backed code path without a real Redis server —
    conftest's autouse `_force_redis_unavailable` fixture forces every OTHER test's Redis
    calls to be a no-op, so this is deliberately opted back in only where caching itself is
    under test."""

    def __init__(self):
        self.store = {}

    def get(self, key):
        return self.store.get(key)

    def set(self, key, value, ex=None):
        self.store[key] = value

    def setex(self, key, ttl, value):
        self.store[key] = value

    def expire(self, key, ttl):
        pass

    def delete(self, key):
        self.store.pop(key, None)


def test_insights_requires_auth(client, org):
    r = client.get("/insights")
    assert r.status_code == 401


def assert_rules_insight(data):
    """The deterministic fallback: a real summary and 2-4 recommendations, never an error."""
    assert data["available"] is True
    assert data["source"] == "rules"
    assert data["reason"] is None
    assert isinstance(data["summary"], str) and data["summary"]
    assert 2 <= len(data["recommendations"]) <= 4
    assert all(isinstance(r, str) and r for r in data["recommendations"])
    assert "generated_at" in data


def test_insights_unconfigured_falls_back_to_rules(client, org, auth_as):
    """No GEMINI_API_KEY(_2/_3) at all (conftest blanks them) -> a rules-based insight,
    still HTTP 200 — never a 500 or an error for an optional integration."""
    r = client.get("/insights", headers=auth_as("SE001"))
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert_rules_insight(data)
    assert data["scope_employee_count"] == 1


def test_rules_insight_is_deterministic_and_reflects_the_data(client, org, auth_as, db_session):
    from datetime import timedelta
    from models import Task
    from task_helpers import utc_now
    now = utc_now()
    db_session.add(Task(
        id="late-1", ticket_id="T-90001", task_name="Late thing", task_status="todo",
        task_assigned_to="SE001", task_assigned_by="TL001", task_duration="01:00",
        task_due_date=now - timedelta(days=1), task_assigned_date=now - timedelta(days=2),
        time_spent=0.0, task_sessions=[], task_created_at=now - timedelta(days=3),
    ))
    db_session.commit()
    h = auth_as("TL001")
    first = client.get("/insights", headers=h).json()["data"]
    second = client.get("/insights", headers=h).json()["data"]
    assert_rules_insight(first)
    assert (first["summary"], first["recommendations"]) == (second["summary"], second["recommendations"])
    assert "1 overdue" in first["summary"]
    assert any("overdue" in rec.lower() for rec in first["recommendations"])


def test_insights_success_shape(client, org, auth_as, monkeypatch):
    """A mocked successful Gemini call -> the documented response shape."""
    monkeypatch.setattr(gemini_util, "GEMINI_API_KEYS", ["only-key"])
    monkeypatch.setattr(gemini_util, "_call_gemini_once", _mock_ok())

    r = client.get("/insights", headers=auth_as("TL001"))
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["available"] is True
    assert data["source"] == "ai"
    assert data["reason"] is None
    assert isinstance(data["summary"], str) and data["summary"]
    assert isinstance(data["recommendations"], list)
    assert 2 <= len(data["recommendations"]) <= 4
    assert all(isinstance(rec, str) for rec in data["recommendations"])
    assert data["scope_employee_count"] == 3  # TL001 + SE001 + SSE001
    assert "generated_at" in data


def test_insights_falls_back_to_second_key_on_failure(client, org, auth_as, monkeypatch):
    """Key #1 fails (rate limit / bad key / network error) -> key #2 is tried and used."""
    monkeypatch.setattr(gemini_util, "GEMINI_API_KEYS", ["bad-key-1", "good-key-2"])
    attempts = []

    def fake_call(api_key, prompt):
        attempts.append(api_key)
        if api_key == "bad-key-1":
            raise RuntimeError("429 rate limited")
        return json.dumps({"summary": "All good.", "recommendations": ["Keep it up", "Review overdue items"]})

    monkeypatch.setattr(gemini_util, "_call_gemini_once", fake_call)

    r = client.get("/insights", headers=auth_as("SE001"))
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["available"] is True
    assert attempts == ["bad-key-1", "good-key-2"]


def test_insights_all_keys_fail_falls_back_to_rules(client, org, auth_as, monkeypatch):
    """Every configured key fails -> the rules-based insight, never a 500 or the raw error."""
    monkeypatch.setattr(gemini_util, "GEMINI_API_KEYS", ["k1", "k2", "k3"])
    attempts = []

    def fake_call(api_key, prompt):
        attempts.append(api_key)
        raise RuntimeError(f"boom-{api_key}")

    monkeypatch.setattr(gemini_util, "_call_gemini_once", fake_call)

    r = client.get("/insights", headers=auth_as("SE001"))
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert_rules_insight(data)
    assert "boom" not in r.text  # raw API errors never reach the user
    assert attempts == ["k1", "k2", "k3"]  # all three were tried, in order


def test_insights_malformed_gemini_response_is_graceful(client, org, auth_as, monkeypatch):
    """A successful API call that returns something that ISN'T the expected
    {"summary", "recommendations"} JSON shape must still degrade gracefully."""
    monkeypatch.setattr(gemini_util, "GEMINI_API_KEYS", ["only-key"])
    monkeypatch.setattr(gemini_util, "_call_gemini_once", lambda api_key, prompt: "not json at all")

    r = client.get("/insights", headers=auth_as("SE001"))
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert_rules_insight(data)


def test_insights_scope_matches_org_subtree(client, org, auth_as, monkeypatch):
    """The DATA actually sent to Gemini must reflect only the caller's org subtree — verified
    by inspecting the captured prompt, not the (mocked) AI output. Mirrors
    tests/test_capacity.py's / tests/test_org_scope.py's scoping pattern: TL001 sees self +
    SE001 + SSE001, never the sibling branch (SE002) or their own manager (EM001)."""
    monkeypatch.setattr(gemini_util, "GEMINI_API_KEYS", ["only-key"])
    captured = {}

    def fake_call(api_key, prompt):
        captured["prompt"] = prompt
        return json.dumps({"summary": "Scoped view.", "recommendations": ["a", "b"]})

    monkeypatch.setattr(gemini_util, "_call_gemini_once", fake_call)

    r = client.get("/insights", headers=auth_as("TL001"))
    assert r.status_code == 200, r.text
    assert r.json()["data"]["scope_employee_count"] == 3

    payload = json.loads(captured["prompt"].split("DATA:\n", 1)[1])
    emp_ids = {e["emp_id"] for e in payload["employees"]}
    assert emp_ids == {"TL001", "SE001", "SSE001"}
    assert "SE002" not in emp_ids  # peer branch under EM001 — must not leak
    assert "EM001" not in emp_ids  # TL001's own manager — must not leak
    assert payload["scope_employee_count"] == 3


def test_insights_ic_scope_is_self_only(client, org, auth_as, monkeypatch):
    """SE001 is a pure IC with no reports — their insight scope is just themselves."""
    monkeypatch.setattr(gemini_util, "GEMINI_API_KEYS", ["only-key"])
    captured = {}

    def fake_call(api_key, prompt):
        captured["prompt"] = prompt
        return json.dumps({"summary": "Just you.", "recommendations": ["a", "b"]})

    monkeypatch.setattr(gemini_util, "_call_gemini_once", fake_call)

    r = client.get("/insights", headers=auth_as("SE001"))
    assert r.status_code == 200, r.text
    assert r.json()["data"]["scope_employee_count"] == 1

    payload = json.loads(captured["prompt"].split("DATA:\n", 1)[1])
    emp_ids = {e["emp_id"] for e in payload["employees"]}
    assert emp_ids == {"SE001"}


def test_insights_caching_skips_second_gemini_call(client, org, auth_as, monkeypatch):
    """Two calls within the TTL must only invoke the (mocked) Gemini call once — the second
    is served from the Redis cache. conftest's autouse fixture forces Redis "unavailable" for
    the whole suite; this test deliberately opts back in with an in-memory fake so the real
    Redis-backed caching code path in main.py's get_insights is actually exercised."""
    fake_redis = _FakeRedisClient()
    monkeypatch.setattr(redis_client, "get_redis_client", lambda: fake_redis)

    monkeypatch.setattr(gemini_util, "GEMINI_API_KEYS", ["only-key"])
    call_count = {"n": 0}

    def fake_call(api_key, prompt):
        call_count["n"] += 1
        return json.dumps({"summary": "Cached me.", "recommendations": ["a", "b"]})

    monkeypatch.setattr(gemini_util, "_call_gemini_once", fake_call)

    headers = auth_as("SE001")
    r1 = client.get("/insights", headers=headers)
    r2 = client.get("/insights", headers=headers)

    assert r1.status_code == 200 and r2.status_code == 200
    assert call_count["n"] == 1  # second call was served from cache, not Gemini
    assert r1.json()["data"]["generated_at"] == r2.json()["data"]["generated_at"]
    assert r1.json()["data"] == r2.json()["data"]


def test_insights_cache_is_per_caller(client, org, auth_as, monkeypatch):
    """Two different callers (different scopes) must not share a cache entry."""
    fake_redis = _FakeRedisClient()
    monkeypatch.setattr(redis_client, "get_redis_client", lambda: fake_redis)

    monkeypatch.setattr(gemini_util, "GEMINI_API_KEYS", ["only-key"])
    call_count = {"n": 0}

    def fake_call(api_key, prompt):
        call_count["n"] += 1
        return json.dumps({"summary": "ok", "recommendations": ["a", "b"]})

    monkeypatch.setattr(gemini_util, "_call_gemini_once", fake_call)

    r1 = client.get("/insights", headers=auth_as("SE001"))
    r2 = client.get("/insights", headers=auth_as("TL001"))

    assert r1.status_code == 200 and r2.status_code == 200
    assert call_count["n"] == 2  # each caller's first call is its own cache miss
