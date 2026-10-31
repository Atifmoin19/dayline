"""
Gemini AI-insight utility — powers GET /insights (main.py).

Env vars (see .env.example — "AI Insight" section). Multiple Gemini
keys may be provided:

    GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3   -- tried in order, first success wins
    GEMINI_MODEL                                          -- defaults to "gemini-2.0-flash" if unset

Follows this codebase's "unset env var = silent no-op / graceful degradation" idiom, same as
email_util.py/slack_util.py/push_util.py: if NO key is configured, `gemini_configured()` is
False and callers should short-circuit to an "AI insight not configured" response rather than
calling anything here. If keys ARE configured but every one of them fails (bad key, rate
limit, network error), `call_gemini_with_fallback` returns a structured failure rather than
raising — callers turn that into a graceful "insight generation failed" response, never a 500.

SDK choice: `google-genai` (the current, actively-maintained official Python SDK for the
Gemini API — see https://pypi.org/project/google-genai/). `google-generativeai` is Google's
OLDER SDK, now in legacy/maintenance mode with a Nov-2025 EOL notice pointing users at
`google-genai`, so it was deliberately not used here for a new feature. Pinned in
requirements.txt.
"""
import logging
import os

logger = logging.getLogger(__name__)

# First-set-wins order: GEMINI_API_KEY, then _2, then _3. Blank/unset entries are dropped so
# the fallback loop only ever tries real keys.
GEMINI_API_KEYS = [
    k for k in (
        os.getenv("GEMINI_API_KEY"),
        os.getenv("GEMINI_API_KEY_2"),
        os.getenv("GEMINI_API_KEY_3"),
    )
    if k
]

# No product spec pins a specific model yet; "flash" is the sensible default for a
# request-time (not batch) summarization call — fast + cheap relative to "pro" tiers.
GEMINI_MODEL = os.getenv("GEMINI_MODEL") or "gemini-2.0-flash"


def gemini_configured() -> bool:
    """True if at least one Gemini API key is configured."""
    return bool(GEMINI_API_KEYS)


def _call_gemini_once(api_key: str, prompt: str) -> str:
    """Single call to the Gemini API using ONE key. Raises on any failure (bad key, rate
    limit, network error, empty response, ...) — `call_gemini_with_fallback` is the layer
    that catches and advances to the next key.

    Isolated in its own function (rather than inlined in the fallback loop) so tests can
    monkeypatch JUST this — no real network/API call, no real key required — while still
    exercising the real fallback-chain logic in `call_gemini_with_fallback`.
    """
    from google import genai  # imported lazily: the app must still start with no Gemini
    # key/dependency friction if this feature is never invoked.

    client = genai.Client(api_key=api_key)
    resp = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
    text = getattr(resp, "text", None)
    if not text:
        raise ValueError("Empty response from Gemini")
    return text


def call_gemini_with_fallback(prompt: str) -> dict:
    """Try each configured key in order (GEMINI_API_KEY -> _2 -> _3), returning on the first
    success. Never raises — always returns a dict:

        {"success": True,  "text": "<raw model output>"}
        {"success": False, "reason": "<human-readable failure reason>"}

    This is a key fallback-chain pattern: a bad/rate-limited/invalid
    key just advances to the next one instead of failing the whole request.
    """
    if not GEMINI_API_KEYS:
        return {
            "success": False,
            "reason": "AI insight not configured (no GEMINI_API_KEY set).",
        }

    last_error: str | None = None
    for idx, key in enumerate(GEMINI_API_KEYS, start=1):
        try:
            text = _call_gemini_once(key, prompt)
            return {"success": True, "text": text}
        except Exception as exc:  # noqa: BLE001 — best-effort key fallback, never raise
            logger.warning("Gemini call failed with key #%d/%d: %s", idx, len(GEMINI_API_KEYS), exc)
            last_error = str(exc)

    return {
        "success": False,
        "reason": f"AI insight generation failed (all {len(GEMINI_API_KEYS)} key(s) failed): {last_error}",
    }
