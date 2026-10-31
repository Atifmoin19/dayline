"""
GET /tasks/assignee-suggestions: candidate ranking for the create-task modal's "who should I
assign this to?" prompt (main.py's get_assignee_suggestions — pending.md's "Must Have"
AI-powered smart-assignment feature).

Covers:
  - auth is required, like every other endpoint here.
  - the candidate pool is NOT scoped to the caller's org subtree (open assignment — see
    permissions.can_assign_task_to / plan.md) ...
  - ... but IS filtered by seniority: permissions.get_rank(designation) >= 3 (Sr PM/Lead/Tech
    Lead/Team Lead and up) is excluded from the suggestion list entirely — a UX quality
    filter, not a change to who can actually be assigned a task.
  - works with no tags/priority at all -> a reasonable load+org-tree ranking.
  - tag-matching historical velocity: an experienced candidate (completed tasks tagged the
    same as the request) outscores an equally-available but inexperienced peer.
  - returns at most 5 candidates even with a bigger company.
  - domain-affinity: when a `description` is supplied, Gemini (mocked) is used to classify
    it into domain/skill keywords, matched against `skills` (falling back to
    `emp_designation` when skills are empty/sparse).
  - graceful degradation: no `description`, a too-short `description`, or a failing/mocked
    Gemini call must never touch/break the pre-existing deterministic formula.
  - caching: two calls with the same description within the TTL only invoke the mocked
    Gemini call once (mirrors GET /insights' Redis caching pattern/tests).
"""
import json

from conftest import make_user

import gemini_util
import main
import redis_client


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


class _FakeRedisClient:
    """Minimal in-memory stand-in for the subset of the redis.Redis API this app uses — same
    helper as tests/test_insights.py's _FakeRedisClient, duplicated here so this test module
    stays self-contained (matches this suite's per-file convention). Lets the caching test
    exercise the real Redis-backed code path without a real Redis server."""

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


def _mock_domain_keywords(keywords):
    """gemini_util._call_gemini_once replacement returning a strict-JSON keyword array,
    matching main.py's _parse_gemini_domain_keywords expectations."""
    def _fake_call(api_key, prompt):
        return json.dumps(keywords)
    return _fake_call


LONG_DESCRIPTION = (
    "Build a new customer-facing dashboard widget using React and TypeScript, wiring it up "
    "to the existing REST API."
)


def test_assignee_suggestions_requires_auth(client, org):
    r = client.get("/tasks/assignee-suggestions")
    assert r.status_code == 401


def test_assignee_suggestions_never_calls_gemini(client, org, auth_as, monkeypatch):
    """This endpoint must be usable even with zero Gemini configuration, and must NEVER
    invoke the Gemini fallback chain at all (not just gracefully degrade like /insights
    does) — it needs to answer fast for a live create-task-modal UI. Monkeypatch
    call_gemini_with_fallback to explode if it's ever called."""
    def _boom(prompt):
        raise AssertionError("call_gemini_with_fallback must never be invoked by this endpoint")

    monkeypatch.setattr(main, "call_gemini_with_fallback", _boom)

    r = client.get("/tasks/assignee-suggestions", headers=auth_as("EM001"))
    assert r.status_code == 200, r.text


def test_assignee_suggestions_open_pool_not_scoped_to_subtree(client, org, auth_as):
    """Unlike /tasks and /capacity, the candidate pool is not scoped to the requester's own
    org subtree — TL001's peer branch (SE002) must be an eligible candidate when TL001 asks,
    since assignment itself is open (plan.md SS2/SS4). EM001 (Engineering Manager, rank 4)
    and TL001 (Team Lead, rank 3) are excluded by the seniority/UX filter regardless of who
    is asking — see test_assignee_suggestions_excludes_senior_designations."""
    r = client.get("/tasks/assignee-suggestions", headers=auth_as("TL001"))
    assert r.status_code == 200, r.text
    emp_ids = {c["emp_id"] for c in r.json()["data"]}
    # Only the rank-1/2 individual contributors remain: EM001/TL001 are filtered out by rank.
    assert emp_ids == {"SE001", "SSE001", "SE002"}


def test_assignee_suggestions_excludes_senior_designations(client, org, auth_as):
    """Candidates with permissions.get_rank(designation) >= 3 (Sr PM/Lead/Tech Lead/Team
    Lead and up) must never appear in suggestions, regardless of load/tags — this app's
    fixture already includes EM001 (ENGINEERING MANAGER, rank 4) and TL001 (TEAM LEAD, rank
    3), both 0% utilized (the most "available"-looking candidates by load alone), yet neither
    may show up. Rank 1-2 individual contributors (SE001, SSE001, SE002) must still appear."""
    r = client.get("/tasks/assignee-suggestions", headers=auth_as("SE001"))
    assert r.status_code == 200, r.text
    emp_ids = {c["emp_id"] for c in r.json()["data"]}
    assert "EM001" not in emp_ids
    assert "TL001" not in emp_ids
    assert emp_ids == {"SE001", "SSE001", "SE002"}


def test_assignee_suggestions_no_params_returns_reasonable_shape(client, org, auth_as):
    r = client.get("/tasks/assignee-suggestions", headers=auth_as("SE001"))
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert 1 <= len(data) <= 5
    for row in data:
        assert set(row.keys()) == {"emp_id", "emp_name", "score", "reasons"}
        assert isinstance(row["score"], (int, float))
        assert isinstance(row["reasons"], list) and row["reasons"]
        assert isinstance(row["reasons"][0], str)
    # Highest score first.
    scores = [row["score"] for row in data]
    assert scores == sorted(scores, reverse=True)


def test_assignee_suggestions_prefers_available_over_loaded(client, org, auth_as):
    """SE001 (no assigned work) should outrank SSE001 once SSE001 is loaded up with a big
    backlog task pushing them toward at_capacity/over_capacitated — current load is the
    heaviest scoring signal."""
    headers = auth_as("EM001")
    create_task(client, headers, "SSE001", "LOAD-SSE", duration="40:00")

    r = client.get("/tasks/assignee-suggestions", headers=headers)
    assert r.status_code == 200, r.text
    by_id = {c["emp_id"]: c["score"] for c in r.json()["data"]}
    assert by_id["SE001"] > by_id["SSE001"]


def test_assignee_suggestions_tag_history_breaks_a_load_tie(client, org, auth_as):
    """SE001 and SSE001 both start with zero currently-assigned work (equal utilization,
    0%) and are equally close in the org tree to the requester (both in EM001's subtree via
    TL001) — so with no tag history, their scores should already be equal or very close.
    Once SE001 picks up completed, 'backend'-tagged history, requesting suggestions for a
    'backend'-tagged task must rank SE001 above SSE001."""
    headers = auth_as("EM001")

    # Baseline: equal load, equal org distance -> equal score with no tags requested.
    baseline = client.get("/tasks/assignee-suggestions", headers=headers)
    assert baseline.status_code == 200, baseline.text
    baseline_by_id = {c["emp_id"]: c["score"] for c in baseline.json()["data"]}
    assert baseline_by_id["SE001"] == baseline_by_id["SSE001"]

    # Give SE001 (only) some completed history tagged "backend". Tasks are created "done"
    # directly (no session ever opened), so this can't affect SE001's current utilization.
    create_task(
        client, headers, "SE001", "HIST-1", task_status="done", task_tags="backend,api",
    )
    create_task(
        client, headers, "SE001", "HIST-2", task_status="completed", task_tags="backend",
    )

    r = client.get("/tasks/assignee-suggestions?tags=backend", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    by_id = {c["emp_id"]: c for c in data}

    assert by_id["SE001"]["score"] > by_id["SSE001"]["score"]
    assert any("backend" in reason and "completed task" in reason for reason in by_id["SE001"]["reasons"])


def test_assignee_suggestions_capped_at_five(client, org, auth_as, db_session):
    """The 5-person org fixture plus two more employees must still only return 5 rows."""
    make_user(db_session, "SE003", "Extra Engineer Three", "SOFTWARE ENGINEER", manager_id="EM001")
    make_user(db_session, "SE004", "Extra Engineer Four", "SOFTWARE ENGINEER", manager_id="EM001")

    r = client.get("/tasks/assignee-suggestions", headers=auth_as("EM001"))
    assert r.status_code == 200, r.text
    assert len(r.json()["data"]) == 5


# ---------------------------------------------------------------------------------------
# Graceful degradation — the domain-affinity feature must never turn "no description" /
# "description too short" / "Gemini unconfigured" / "Gemini call fails" into anything but
# the pre-existing deterministic formula.
# ---------------------------------------------------------------------------------------
def test_assignee_suggestions_no_description_never_calls_gemini(client, org, auth_as, monkeypatch):
    """No `description` at all -> call_gemini_with_fallback must never be invoked (same
    "never touches Gemini" pattern as this endpoint's pre-existing contract)."""
    def _boom(prompt):
        raise AssertionError("call_gemini_with_fallback must never be invoked with no description")

    monkeypatch.setattr(main, "call_gemini_with_fallback", _boom)

    r = client.get("/tasks/assignee-suggestions", headers=auth_as("EM001"))
    assert r.status_code == 200, r.text


def test_assignee_suggestions_short_description_never_calls_gemini(client, org, auth_as, monkeypatch):
    """A `description` under ASSIGNEE_DOMAIN_MIN_DESCRIPTION_LENGTH isn't worth an AI call —
    call_gemini_with_fallback must never be invoked."""
    def _boom(prompt):
        raise AssertionError("call_gemini_with_fallback must never be invoked for a too-short description")

    monkeypatch.setattr(main, "call_gemini_with_fallback", _boom)

    assert len("fix bug") < main.ASSIGNEE_DOMAIN_MIN_DESCRIPTION_LENGTH
    r = client.get(
        "/tasks/assignee-suggestions", params={"description": "fix bug"}, headers=auth_as("EM001"),
    )
    assert r.status_code == 200, r.text


def test_assignee_suggestions_unconfigured_gemini_never_called(client, org, auth_as, monkeypatch):
    """A long-enough description but Gemini unconfigured (conftest blanks every key for the
    whole suite) -> still never calls call_gemini_with_fallback, just skips the bonus."""
    def _boom(prompt):
        raise AssertionError("call_gemini_with_fallback must never be invoked when Gemini isn't configured")

    monkeypatch.setattr(main, "call_gemini_with_fallback", _boom)

    r = client.get(
        "/tasks/assignee-suggestions", params={"description": LONG_DESCRIPTION}, headers=auth_as("EM001"),
    )
    assert r.status_code == 200, r.text


def test_assignee_suggestions_gemini_failure_falls_back_to_formula(client, org, auth_as, monkeypatch):
    """Gemini IS configured but the mocked call raises -> suggestions still return using the
    pre-existing formula, never an error, and no domain-affinity reason is added."""
    monkeypatch.setattr(gemini_util, "GEMINI_API_KEYS", ["only-key"])

    def _fake_call(api_key, prompt):
        raise RuntimeError("503 service unavailable")

    monkeypatch.setattr(gemini_util, "_call_gemini_once", _fake_call)

    r = client.get(
        "/tasks/assignee-suggestions", params={"description": LONG_DESCRIPTION}, headers=auth_as("EM001"),
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert 1 <= len(data) <= 5
    for row in data:
        assert not any("skills match" in reason.lower() for reason in row["reasons"])
        assert not any("focused role" in reason.lower() for reason in row["reasons"])


# ---------------------------------------------------------------------------------------
# Domain-affinity matching (mocked Gemini) — see _classify_task_domain / _domain_affinity_
# bonus in main.py.
# ---------------------------------------------------------------------------------------
def test_assignee_suggestions_domain_match_via_skills(client, org, auth_as, monkeypatch):
    """SE001 and SSE001 start at equal (0%) utilization and equal org distance from EM001, so
    with no description their scores tie (see test_assignee_suggestions_tag_history_breaks_a_
    load_tie's baseline). Give SE001 a skill that overlaps the mocked Gemini domain keywords
    ("fastapi" contains "api") — SE001 must now outrank SSE001 and carry a "Skills match"
    reason."""
    headers = auth_as("EM001")
    client.put("/user/SE001", json={"skills": ["FastAPI"]}, headers=headers)

    monkeypatch.setattr(gemini_util, "GEMINI_API_KEYS", ["only-key"])
    monkeypatch.setattr(gemini_util, "_call_gemini_once", _mock_domain_keywords(["backend", "api", "database"]))

    r = client.get(
        "/tasks/assignee-suggestions", params={"description": LONG_DESCRIPTION}, headers=headers,
    )
    assert r.status_code == 200, r.text
    by_id = {c["emp_id"]: c for c in r.json()["data"]}

    assert by_id["SE001"]["score"] > by_id["SSE001"]["score"]
    assert any("skills match" in reason.lower() and "fastapi" in reason.lower() for reason in by_id["SE001"]["reasons"])


def test_assignee_suggestions_domain_match_via_designation_fallback(client, org, auth_as, db_session, monkeypatch):
    """A candidate with NO skills set but a designation that naturally signals the domain
    (a "QA Engineer") must still get a domain-affinity bonus/reason, as a fallback signal —
    per the real feedback example (no tags typed yet shouldn't blind-side a QA-shaped task
    toward a 0%-utilized senior instead of an actual QA IC)."""
    make_user(db_session, "QA001", "Quinn Tester", "QA ENGINEER", manager_id="EM001")

    headers = auth_as("EM001")
    monkeypatch.setattr(gemini_util, "GEMINI_API_KEYS", ["only-key"])
    monkeypatch.setattr(gemini_util, "_call_gemini_once", _mock_domain_keywords(["qa", "testing", "automation"]))

    r = client.get(
        "/tasks/assignee-suggestions",
        params={"description": "Write and run a full regression test pass across the checkout flow."},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    by_id = {c["emp_id"]: c for c in r.json()["data"]}

    assert "QA001" in by_id
    # SE002 has no skills and a non-matching designation -> no domain reason, lower score.
    assert by_id["QA001"]["score"] > by_id["SE002"]["score"]
    assert any("focused role" in reason.lower() for reason in by_id["QA001"]["reasons"])


# ---------------------------------------------------------------------------------------
# Caching — mirrors GET /insights' Redis caching pattern/tests exactly.
# ---------------------------------------------------------------------------------------
def test_assignee_suggestions_domain_classification_cached(client, org, auth_as, monkeypatch):
    """Two calls with the same description text within the TTL must only invoke the mocked
    Gemini call once — the second is served from the Redis cache. conftest's autouse fixture
    forces Redis "unavailable" for the whole suite; this test opts back in with an in-memory
    fake so the real Redis-backed caching code path in main.py's _classify_task_domain is
    actually exercised."""
    fake_redis = _FakeRedisClient()
    monkeypatch.setattr(redis_client, "get_redis_client", lambda: fake_redis)

    monkeypatch.setattr(gemini_util, "GEMINI_API_KEYS", ["only-key"])
    call_count = {"n": 0}

    def _fake_call(api_key, prompt):
        call_count["n"] += 1
        return json.dumps(["backend", "api"])

    monkeypatch.setattr(gemini_util, "_call_gemini_once", _fake_call)

    headers = auth_as("EM001")
    r1 = client.get("/tasks/assignee-suggestions", params={"description": LONG_DESCRIPTION}, headers=headers)
    r2 = client.get("/tasks/assignee-suggestions", params={"description": LONG_DESCRIPTION}, headers=headers)

    assert r1.status_code == 200 and r2.status_code == 200
    assert call_count["n"] == 1  # second call was served from cache, not Gemini
