"""
Web-push notification utility (browser push via VAPID). Configured via env:

    VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_CLAIMS_EMAIL

If VAPID_PRIVATE_KEY is unset, send_push is a no-op that returns success=False — callers
treat push as best-effort and never fail the main request because of it.
"""
import json
import os

from pywebpush import WebPushException, webpush

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_CLAIMS_EMAIL = os.getenv("VAPID_CLAIMS_EMAIL", "noreply@example.com")


def push_configured() -> bool:
    return bool(VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY)


def send_push(subscription_info: dict, title: str, body: str, url: str | None = None, task_id: str | None = None) -> dict:
    """Send one browser push notification. Never raises.

    subscription_info: {"endpoint": str, "keys": {"p256dh": str, "auth": str}}
    Returns {"success": bool, "gone": bool, ...} — "gone" (410/404) tells the caller the
    subscription is stale and should be deleted.
    """
    if not push_configured():
        return {"success": False, "error": "VAPID keys not configured"}
    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps({"title": title, "body": body, "url": url, "task_id": task_id}),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": f"mailto:{VAPID_CLAIMS_EMAIL}"},
        )
        return {"success": True}
    except WebPushException as exc:
        status_code = getattr(exc.response, "status_code", None)
        return {"success": False, "gone": status_code in (404, 410), "error": str(exc)}
    except Exception as exc:  # noqa: BLE001 — best-effort, never raise to caller
        return {"success": False, "gone": False, "error": str(exc)}
