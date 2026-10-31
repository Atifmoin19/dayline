"""
Slack notification utility — posts to a Slack Incoming Webhook. Configured via env:

    SLACK_WEBHOOK_URL   (e.g. https://hooks.slack.com/services/T000/B000/XXXX)

If unset, send_slack is a no-op returning success=False — callers treat Slack as best-effort
and never fail the main request because of it. Built on urllib (stdlib), with certifi supplying
the CA bundle for TLS verification (some macOS python.org builds don't auto-link the system CA
store, which breaks HTTPS entirely without it). Incoming webhooks post to the single channel the
webhook is bound to, so the recipient's name is included in the text.
"""
import json
import os
import ssl
import urllib.request

try:
    import certifi
    _SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    # certifi not installed — fall back to the system default (may fail on some macOS
    # python.org builds that don't auto-link the system CA store; `pip install certifi` fixes it).
    _SSL_CONTEXT = ssl.create_default_context()

SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")


def slack_configured() -> bool:
    return bool(SLACK_WEBHOOK_URL)


def send_slack(text: str) -> dict:
    """Post a message to the configured Slack webhook. Never raises."""
    if not SLACK_WEBHOOK_URL:
        return {"success": False, "error": "SLACK_WEBHOOK_URL not configured"}
    try:
        payload = json.dumps({"text": text}).encode("utf-8")
        req = urllib.request.Request(
            SLACK_WEBHOOK_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10, context=_SSL_CONTEXT) as resp:
            ok = 200 <= resp.status < 300
            return {"success": ok, "status": resp.status}
    except Exception as exc:  # noqa: BLE001 — best-effort, never raise to caller
        return {"success": False, "error": str(exc)}
