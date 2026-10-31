"""Generic OIDC SSO client (Okta / Azure AD / Google Workspace / any OIDC-compliant IdP).

Single-provider, config-driven (env vars, see .env.example) — no per-tenant code branching,
since Okta/Azure AD/Google all speak the same discovery + authorization-code + JWKS protocol.
Unset OIDC_ISSUER => sso_configured() is False and every route in main.py that gates on it
404s/no-ops, same "unset = silent no-op" convention as Slack/web-push/Sentry elsewhere in this
app (see plan.md §12).

Deliberately does NOT auto-provision users: this app's directory is admin-provisioned only
(seed_demo.py, see docs/plan.md). A successful IdP login for an email with no
matching `users.emp_email` row is rejected with a clear reason — the account still has to
exist first. This mirrors bugs.md S5 (open self-registration is a separate, already-flagged
gap) by refusing to let SSO become a second, uncontrolled account-creation path.
"""
import logging
import os
import time
from urllib.parse import urlencode

import httpx
import jwt
from jwt import PyJWKClient

from redis_client import get_value as redis_get_value
from redis_client import redis_available
from redis_client import set_value as redis_set_value

logger = logging.getLogger(__name__)

OIDC_ISSUER = os.getenv("OIDC_ISSUER", "").rstrip("/")
OIDC_CLIENT_ID = os.getenv("OIDC_CLIENT_ID", "")
OIDC_CLIENT_SECRET = os.getenv("OIDC_CLIENT_SECRET", "")
OIDC_REDIRECT_URI = os.getenv("OIDC_REDIRECT_URI", "")
OIDC_SCOPES = os.getenv("OIDC_SCOPES", "openid email profile")
OIDC_PROVIDER_LABEL = os.getenv("OIDC_PROVIDER_LABEL", "Single Sign-On")

# State/nonce entries only need to survive the redirect round-trip.
_STATE_TTL_SECONDS = 10 * 60
_STATE_PREFIX = "sso_state:"

# Discovery doc + JWKS client are re-fetched at most once per process per this interval —
# an IdP's metadata is effectively static, no need to hit it on every login.
_DISCOVERY_CACHE_TTL_SECONDS = 60 * 60
_discovery_cache: dict | None = None
_discovery_cache_at: float = 0.0
_jwks_client: PyJWKClient | None = None


def sso_configured() -> bool:
    return bool(OIDC_ISSUER and OIDC_CLIENT_ID and OIDC_CLIENT_SECRET and OIDC_REDIRECT_URI)


def _fetch_discovery() -> dict:
    global _discovery_cache, _discovery_cache_at
    now = time.time()
    if _discovery_cache and (now - _discovery_cache_at) < _DISCOVERY_CACHE_TTL_SECONDS:
        return _discovery_cache
    resp = httpx.get(f"{OIDC_ISSUER}/.well-known/openid-configuration", timeout=10)
    resp.raise_for_status()
    _discovery_cache = resp.json()
    _discovery_cache_at = now
    return _discovery_cache


def _jwks_client_for(jwks_uri: str) -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None or _jwks_client.uri != jwks_uri:
        _jwks_client = PyJWKClient(jwks_uri)
    return _jwks_client


def _store_state(state: str, value: str) -> None:
    # Redis-only (matches the session store's own "Redis down => degrade" stance elsewhere,
    # but state is short-lived enough that we don't bother with a DB fallback here — if Redis
    # is down, SSO login fails closed with a clear error rather than skipping CSRF checks).
    redis_set_value(f"{_STATE_PREFIX}{state}", value, expiration=_STATE_TTL_SECONDS)


def _pop_state(state: str) -> str | None:
    value = redis_get_value(f"{_STATE_PREFIX}{state}")
    if value is not None:
        from redis_client import get_redis_client

        r = get_redis_client()
        if r:
            r.delete(f"{_STATE_PREFIX}{state}")
    return value


def build_authorize_url(state: str, next_path: str) -> str:
    """`next_path` (the frontend route to return to post-login) rides alongside the CSRF
    state in the same Redis entry, so the callback can recover it without a second param
    an attacker could tamper with independently of the signed state."""
    if not sso_configured():
        raise RuntimeError("SSO is not configured (OIDC_ISSUER/CLIENT_ID/SECRET/REDIRECT_URI)")
    discovery = _fetch_discovery()
    _store_state(state, next_path or "/")
    params = {
        "response_type": "code",
        "client_id": OIDC_CLIENT_ID,
        "redirect_uri": OIDC_REDIRECT_URI,
        "scope": OIDC_SCOPES,
        "state": state,
    }
    return f"{discovery['authorization_endpoint']}?{urlencode(params)}"


def consume_state(state: str) -> str | None:
    """Validates + burns a state token, returning the `next_path` to redirect to, or None
    if the state is missing/expired/already used (replay)."""
    if not redis_available():
        return None
    return _pop_state(state)


def exchange_code_and_verify(code: str) -> dict:
    """Exchanges an authorization code for tokens, verifies the id_token's signature/iss/aud/
    exp against the IdP's published JWKS, and returns its claims. Raises on any failure —
    callers treat that as a rejected login, never a partial/best-effort success (unlike this
    app's other optional integrations, a forged token is a security issue, not a degraded UX)."""
    discovery = _fetch_discovery()
    token_resp = httpx.post(
        discovery["token_endpoint"],
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": OIDC_REDIRECT_URI,
            "client_id": OIDC_CLIENT_ID,
            "client_secret": OIDC_CLIENT_SECRET,
        },
        timeout=10,
    )
    token_resp.raise_for_status()
    id_token = token_resp.json().get("id_token")
    if not id_token:
        raise ValueError("IdP token response had no id_token")

    jwks_client = _jwks_client_for(discovery["jwks_uri"])
    signing_key = jwks_client.get_signing_key_from_jwt(id_token)
    claims = jwt.decode(
        id_token,
        signing_key.key,
        algorithms=["RS256"],
        audience=OIDC_CLIENT_ID,
        issuer=OIDC_ISSUER,
        options={"require": ["exp", "iat", "iss", "aud"]},
    )
    return claims
