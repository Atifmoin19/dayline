"""
SSO/OIDC (scale-gaps-plan.md Phase 3). /auth/sso/status and /auth/sso/login are pure
config-gates (OIDC_ISSUER unset by default in tests, see conftest), so those need no
mocking. The callback does a real network round-trip (discovery + token exchange + JWKS)
against a real IdP, which this suite cannot reach — so callback tests monkeypatch the
functions `main.py` imports from `sso_util` directly (`main.consume_state`,
`main.exchange_code_and_verify`), the same "swap the function main.py actually calls"
approach test_insights.py uses for Gemini. `main.sso_configured()` still runs for real:
since it's read live off `sso_util`'s module-level OIDC_* constants at call time,
monkeypatching those constants (not the function) is enough to flip it on.
"""
import sso_util


def _enable_sso(monkeypatch):
    monkeypatch.setattr(sso_util, "OIDC_ISSUER", "https://idp.example.test")
    monkeypatch.setattr(sso_util, "OIDC_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(sso_util, "OIDC_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setattr(sso_util, "OIDC_REDIRECT_URI", "http://backend.test/auth/sso/callback")


def test_sso_status_disabled_by_default(client):
    r = client.get("/auth/sso/status")
    assert r.status_code == 200
    assert r.json()["data"]["enabled"] is False


def test_sso_status_enabled_once_configured(client, monkeypatch):
    _enable_sso(monkeypatch)
    r = client.get("/auth/sso/status")
    assert r.json()["data"]["enabled"] is True


def test_sso_login_404_when_not_configured(client):
    r = client.get("/auth/sso/login", follow_redirects=False)
    assert r.status_code == 404


def test_sso_login_redirects_to_idp_when_configured(client, monkeypatch):
    _enable_sso(monkeypatch)
    monkeypatch.setattr(
        sso_util,
        "_fetch_discovery",
        lambda: {"authorization_endpoint": "https://idp.example.test/authorize"},
    )
    r = client.get("/auth/sso/login?next=/tasks/abc123", follow_redirects=False)
    assert r.status_code in (302, 307)
    assert r.headers["location"].startswith("https://idp.example.test/authorize?")


def test_sso_callback_missing_code_redirects_with_error(client):
    r = client.get("/auth/sso/callback", follow_redirects=False)
    assert r.status_code in (302, 307)
    assert "sso_error=missing_code_or_state" in r.headers["location"]


def test_sso_callback_idp_error_param_redirects_with_reason(client):
    r = client.get(
        "/auth/sso/callback?error=access_denied&state=x", follow_redirects=False
    )
    assert "sso_error=access_denied" in r.headers["location"]


def test_sso_callback_invalid_state_rejected(client, monkeypatch):
    import main

    monkeypatch.setattr(main, "consume_state", lambda state: None)
    r = client.get(
        "/auth/sso/callback?code=abc&state=bogus", follow_redirects=False
    )
    assert "sso_error=invalid_or_expired_state" in r.headers["location"]


def test_sso_callback_rejects_unmatched_email(client, org, monkeypatch):
    """No `users.emp_email` row matches the IdP's claim -> rejected, not auto-provisioned
    (this app's directory is admin-provisioned only, see sso_util's module docstring)."""
    import main

    monkeypatch.setattr(main, "consume_state", lambda state: "/")
    monkeypatch.setattr(
        main, "exchange_code_and_verify", lambda code: {"email": "nobody@nowhere.test"}
    )
    r = client.get("/auth/sso/callback?code=abc&state=s", follow_redirects=False)
    assert "sso_error=no_matching_account" in r.headers["location"]


def test_sso_callback_success_issues_working_session(client, org, monkeypatch):
    import main

    monkeypatch.setattr(main, "consume_state", lambda state: "/task-list")
    monkeypatch.setattr(
        main, "exchange_code_and_verify", lambda code: {"email": "se001@example.com"}
    )
    r = client.get("/auth/sso/callback?code=abc&state=s", follow_redirects=False)
    assert r.status_code in (302, 307)
    location = r.headers["location"]
    assert location.endswith("/task-list") is False  # token fragment comes after the path
    assert "/task-list#sso_token=" in location

    token = location.split("#sso_token=")[1]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["data"]["emp_id"] == "SE001"


def test_sso_callback_token_verification_failure_rejected(client, monkeypatch):
    import main

    monkeypatch.setattr(main, "consume_state", lambda state: "/")

    def _boom(code):
        raise ValueError("bad signature")

    monkeypatch.setattr(main, "exchange_code_and_verify", _boom)
    r = client.get("/auth/sso/callback?code=abc&state=s", follow_redirects=False)
    assert "sso_error=token_verification_failed" in r.headers["location"]


def test_auth_me_requires_auth(client, org):
    r = client.get("/auth/me")
    assert r.status_code == 401


def test_auth_me_returns_current_user(client, org, auth_as):
    headers = auth_as("SE001")
    r = client.get("/auth/me", headers=headers)
    assert r.status_code == 200
    assert r.json()["data"]["emp_id"] == "SE001"
