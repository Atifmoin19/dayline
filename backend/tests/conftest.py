"""
Shared pytest fixtures for the TaskAutomation backend test suite.

IMPORTANT — env vars must be set BEFORE any app module is imported, because:
  - models.py reads DATABASE_URL at import time to build its engine.
  - email_util.py / slack_util.py / push_util.py read their credentials at import time.
`python-dotenv`'s `load_dotenv()` (called by models.py/main.py) defaults to
`override=False`, so anything we set here first "wins" over .env.

This is what keeps the test run from touching:
  - the real Postgres database (falls back to a throwaway SQLite file instead),
  - the real Mandrill/SMTP account,
  - the real Slack webhook,
  - real web-push subscriptions.
"""
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TEST_DB_PATH = Path(__file__).resolve().parent / "_test_taskboard.db"

# --- Isolate the test run BEFORE importing any app module -------------------------------
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"
os.environ["EMAIL_HOST_PASSWORD"] = ""   # email_configured() must be False in tests
os.environ["SLACK_WEBHOOK_URL"] = ""     # slack_configured() must be False in tests
os.environ["VAPID_PRIVATE_KEY"] = ""     # push_configured() must be False in tests
os.environ["VAPID_PUBLIC_KEY"] = ""
os.environ["GEMINI_API_KEY"] = ""        # gemini_configured() must be False in tests —
os.environ["GEMINI_API_KEY_2"] = ""      # no test may ever make a real Gemini API call.
os.environ["GEMINI_API_KEY_3"] = ""
os.environ["OIDC_ISSUER"] = ""            # sso_configured() must be False in tests by
os.environ["OIDC_CLIENT_ID"] = ""         # default — individual SSO tests monkeypatch
os.environ["OIDC_CLIENT_SECRET"] = ""     # sso_util's module-level constants directly to
os.environ["OIDC_REDIRECT_URI"] = ""      # opt a specific test back into "configured".
os.environ.setdefault("FRONTEND_ORIGIN", "")

sys.path.insert(0, str(REPO_ROOT))

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import main  # imports the FastAPI `app` — must happen after env overrides above
import redis_client
from models import Base, Foundation, SessionLocal, engine

DEFAULT_PASSWORD = "TestPass123!"


# ---------------------------------------------------------------------------------------
# Redis is intentionally forced "unavailable" for the whole suite. `verify_token` then
# always takes the DB-fallback path (Foundation.token + last_active_at), which is the ONLY
# path that lets tests manipulate inactivity-expiry deterministically (no real 15-minute
# sleep). It also guarantees the suite never writes session keys into a real local Redis.
# ---------------------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _force_redis_unavailable(monkeypatch):
    monkeypatch.setattr(redis_client, "get_redis_client", lambda: None)
    redis_client._client = None
    yield


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """/login and /register are rate-limited to 10/minute per client IP (main.py's
    `limiter`). The FastAPI `app` object — and therefore its limiter's in-memory counters —
    is a module-level singleton shared by every test in the process, so without a reset
    the whole suite would collectively share one 10-calls-per-minute budget and later
    tests would spuriously start getting 429s instead of the responses they're asserting."""
    main.limiter.reset()
    yield


@pytest.fixture()
def db_session():
    """Fresh schema for every test — full isolation, no cross-test leakage."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db_session):
    """
    Plain (non-context-manager) TestClient: FastAPI/Starlette only run `@app.on_event
    ("startup")` handlers when the TestClient is entered via `with`. We deliberately do
    NOT do that here, because startup also spins up `_ws_redis_listener`, a background
    thread with no shutdown hook (it subscribes to Redis pub/sub to forward the overdue
    sweep's WebSocket notifications across processes — see main.py) — starting one per
    test would leak threads across the suite for no test benefit. (The overdue sweep
    itself now runs as tasks_celery.sweep_overdue_tasks under Celery Beat, not from
    on_startup at all; its LOGIC is covered directly in test_overdue_sweep_celery.py.)
    Table creation is handled by `db_session` instead of the app's own `init_db()`.
    """
    return TestClient(main.app)


def _fast_hash(password: str) -> str:
    """A real bcrypt hash (works with security.verify_password unchanged — bcrypt embeds
    its own cost factor, so a cheap hash verifies exactly like a cost-12 one), just at a
    much lower cost factor. Test fixtures create many users per test; at the production
    cost (12) that alone dominated the suite's runtime. Test-only — security.py/hash_password
    (cost 12) is untouched for anything that exercises the real hashing path (e.g. /register)."""
    import bcrypt
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt(rounds=4)).decode("utf-8")


def make_user(db, emp_id, name, designation, manager_id=None, email=None, password=DEFAULT_PASSWORD):
    """Create a User + matching Foundation (credentials) row, hashed password, no token yet."""
    user = main.UserModel(
        emp_name=name,
        emp_id=emp_id,
        emp_email=email or f"{emp_id.lower()}@example.com",
        emp_designation=designation,
        manager_id=manager_id,
    )
    db.add(user)
    db.add(Foundation(emp_id=emp_id, password=_fast_hash(password), token=None))
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def org(db_session):
    """
    A small, real org hierarchy for RBAC / org-tree tests:

        EM001 (Engineering Manager, rank 4, admin)         <- top, no manager
          └── TL001 (Team Lead, rank 3, NOT admin)         <- has reports, sees subtree
                ├── SE001 (Software Engineer, rank 1)      <- pure IC, no reports
                └── SSE001 (Senior Software Engineer, rank 2)  <- pure IC, no reports
          └── SE002 (Software Engineer, rank 1)             <- EM001's other report;
                                                                a PEER of TL001, sibling
                                                                branch — must stay invisible
                                                                to TL001/SE001/SSE001.

    Two different ranks report to TL001 (1 and 2) per the task's fixture requirement,
    and EM001/SE002 exist so peer/senior leakage is actually checkable.
    """
    em = make_user(db_session, "EM001", "Emma Manager", "ENGINEERING MANAGER", manager_id=None)
    tl = make_user(db_session, "TL001", "Tom Lead", "TEAM LEAD", manager_id="EM001")
    se = make_user(db_session, "SE001", "Sam Engineer", "SOFTWARE ENGINEER", manager_id="TL001")
    sse = make_user(db_session, "SSE001", "Sally Senior Engineer", "SENIOR SOFTWARE ENGINEER", manager_id="TL001")
    se2 = make_user(db_session, "SE002", "Sue Engineer", "SOFTWARE ENGINEER", manager_id="EM001")
    return {"em": em, "tl": tl, "se": se, "sse": sse, "se2": se2}


def login(client, emp_id, password=DEFAULT_PASSWORD):
    resp = client.post("/login", json={"emp_id": emp_id, "password": password})
    assert resp.status_code == 200, resp.text
    token = resp.json()["data"]["token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def auth_as(client):
    """Factory fixture: auth_as("EM001") -> auth header dict for that user."""
    def _auth_as(emp_id, password=DEFAULT_PASSWORD):
        return login(client, emp_id, password)
    return _auth_as


# ---------------------------------------------------------------------------------------
# Deterministic clock. Capacity / insights math depends on "now" relative to the business
# day (BUSINESS_TZ, 10:00-19:00) and calendar-day boundaries, so tests that touch it must
# not read the wall clock. `freeze_now(dt)` pins every utc_now() the app (and the test
# module itself) sees to `dt`, which must be timezone-aware.
# ---------------------------------------------------------------------------------------
# Representative instants (UTC) for BUSINESS_TZ=Asia/Kolkata (UTC+5:30):
CLOCK_SAMPLES = {
    "business_hours": datetime(2026, 3, 11, 5, 0, tzinfo=timezone.utc),   # 10:30 local
    "after_hours": datetime(2026, 3, 11, 16, 30, tzinfo=timezone.utc),    # 22:00 local
    "just_after_midnight": datetime(2026, 3, 11, 19, 0, tzinfo=timezone.utc),  # 00:30 local
}


@pytest.fixture
def freeze_now(monkeypatch, request):
    def _freeze(dt):
        import audit_util
        import task_helpers
        targets = [task_helpers, main, audit_util]
        if request.module is not None:
            targets.append(request.module)
        for mod in targets:
            if hasattr(mod, "utc_now"):
                monkeypatch.setattr(mod, "utc_now", lambda: dt)
        return dt
    return _freeze
