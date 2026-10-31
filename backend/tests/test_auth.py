"""
Auth flow: register -> login -> token issued -> authed request works -> invalid/expired
token rejected. Also covers the 15-minute inactivity expiry (main.py's verify_token
DB-fallback path, ~lines 342-381), exercised directly by rewinding Foundation.last_active_at
in the DB rather than sleeping for real.
"""
from datetime import timedelta

from main import parse_dt, utc_now
from models import Foundation


def test_register_then_login_then_authed_request(client, db_session):
    # A pre-provisioned user (HR/admin already created the User row) with the default
    # Foundation password ("123456") is the only state /register requires to succeed.
    import main
    from security import hash_password

    user = main.UserModel(emp_name="New Hire", emp_id="NEW001", emp_email="new001@example.com",
                           emp_designation="SOFTWARE ENGINEER")
    db_session.add(user)
    db_session.add(Foundation(emp_id="NEW001", password=hash_password("123456"), token=None))
    db_session.commit()

    r = client.post("/register", json={
        "emp_id": "NEW001", "emp_email": "new001@example.com", "password": "MyNewPass1!",
    })
    assert r.status_code == 200, r.text
    token = r.json()["data"]["token"]
    assert token

    # Token from /register works immediately.
    me = client.get("/user", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200

    # Re-registering is blocked once a real password is set.
    r2 = client.post("/register", json={
        "emp_id": "NEW001", "emp_email": "new001@example.com", "password": "AnotherPass1!",
    })
    assert r2.status_code == 400

    # And the fresh password now works via /login.
    r3 = client.post("/login", json={"emp_id": "NEW001", "password": "MyNewPass1!"})
    assert r3.status_code == 200, r3.text


def test_login_success_and_authed_request(client, org, auth_as):
    headers = auth_as("SE001")
    r = client.get("/user", headers=headers)
    assert r.status_code == 200


def test_login_invalid_password_rejected(client, org):
    r = client.post("/login", json={"emp_id": "SE001", "password": "wrong-password"})
    assert r.status_code == 401


def test_login_unknown_user_rejected(client, org):
    r = client.post("/login", json={"emp_id": "GHOST", "password": "whatever"})
    assert r.status_code == 401


def test_missing_token_rejected(client, org):
    r = client.get("/user")
    assert r.status_code == 401


def test_garbage_token_rejected(client, org):
    r = client.get("/user", headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code == 401


def test_logout_invalidates_token(client, org, auth_as):
    headers = auth_as("SE001")
    ok = client.get("/user", headers=headers)
    assert ok.status_code == 200

    out = client.post("/logout", headers=headers)
    assert out.status_code == 200

    after = client.get("/user", headers=headers)
    assert after.status_code == 401


def test_token_expires_after_15_minutes_inactivity(client, org, auth_as, db_session):
    """Redis is forced unavailable for the whole suite (see conftest), so verify_token's
    DB-fallback inactivity check (main.py ~192-208 / 342-381) is what's actually exercised
    here: last_active_at older than 15 minutes -> 401, and the token+timestamp get cleared."""
    headers = auth_as("SE001")

    # Rewind last_active_at to 16 minutes ago directly in the DB - no real sleep needed.
    foundation = db_session.query(Foundation).filter(Foundation.emp_id == "SE001").first()
    foundation.last_active_at = utc_now() - timedelta(minutes=16)
    db_session.commit()

    r = client.get("/user", headers=headers)
    assert r.status_code == 401
    assert "expired" in r.json()["message"].lower() or "expired" in r.json()["data"]["details"].lower()

    # Token was cleared server-side on expiry -> reusing it again still 401s.
    r2 = client.get("/user", headers=headers)
    assert r2.status_code == 401


def test_token_survives_just_under_15_minutes(client, org, auth_as, db_session):
    headers = auth_as("SE001")
    foundation = db_session.query(Foundation).filter(Foundation.emp_id == "SE001").first()
    foundation.last_active_at = utc_now() - timedelta(minutes=14)
    db_session.commit()

    r = client.get("/user", headers=headers)
    assert r.status_code == 200


def test_activity_refreshes_last_active_at(client, org, auth_as, db_session):
    """Each authed request slides the inactivity window forward (main.py sets
    last_active_at = utc_now() on every successful DB-fallback verify_token call).
    Rewind to a deliberately old (but still valid, <15min) timestamp first so the
    "did it move forward" assertion isn't sensitive to microsecond-scale timing."""
    headers = auth_as("SE001")

    foundation = db_session.query(Foundation).filter(Foundation.emp_id == "SE001").first()
    old_last_active = utc_now() - timedelta(minutes=5)
    foundation.last_active_at = old_last_active
    db_session.commit()

    r = client.get("/user", headers=headers)
    assert r.status_code == 200

    db_session.refresh(foundation)
    # SQLite (unlike Postgres) hands back a naive datetime even for a
    # DateTime(timezone=True) column; parse_dt() (the same helper main.py itself uses
    # before every comparison of these columns) re-attaches UTC so the comparison is valid.
    assert parse_dt(foundation.last_active_at) > old_last_active
