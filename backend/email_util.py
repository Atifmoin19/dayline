"""
SMTP email utility — Mandrill / any SMTP. Credentials are read from environment variables
(standard Django-style names, so existing keys drop in unchanged):

    EMAIL_HOST, EMAIL_PORT, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD, DEFAULT_FROM_EMAIL

If EMAIL_HOST_PASSWORD is unset, send_email is a no-op that returns success=False — callers
treat email as best-effort and never fail the main request because of it.
"""
import base64
import logging
import os
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)

SMTP_HOST = os.getenv("EMAIL_HOST", "smtp.mandrillapp.com")
SMTP_PORT = int(os.getenv("EMAIL_PORT", "587"))
SMTP_USER = os.getenv("EMAIL_HOST_USER", "")
SMTP_PASS = os.getenv("EMAIL_HOST_PASSWORD", "")
FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "noreply@example.com")


def email_configured() -> bool:
    return bool(SMTP_PASS)


PRIORITY_STYLE = {
    "P0": ("#dc2626", "Critical"),
    "P1": ("#ea580c", "High"),
    "P2": ("#ca8a04", "Medium"),
    "P3": ("#2563eb", "Low"),
    "P4": ("#64748b", "Lowest"),
}

APP_URL = os.getenv("FRONTEND_APP_URL", "http://localhost:5173/")


def app_link(path: str = "app") -> str:
    """Absolute frontend link. FRONTEND_APP_URL is the site root (the landing page lives at
    "/"); the signed-in app home is "/app" and tasks deep-link at "/tasks/<id>"."""
    return APP_URL.rstrip("/") + "/" + path.lstrip("/")


def _esc(value) -> str:
    """Minimal HTML-escape for values interpolated into the email template."""
    if value is None:
        return ""
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def build_task_email_html(
    *,
    heading: str,
    actor_name: str,
    task_name: str,
    task_id: str,
    description: str | None = None,
    priority: str | None = None,
    status: str | None = None,
    assignee_name: str | None = None,
    assigner_name: str | None = None,
    due_date: str | None = None,
    duration: str | None = None,
    tags: str | None = None,
    notes: str | None = None,
    attachment_names: list | None = None,
) -> str:
    """Build a styled HTML task-notification email with the full task detail card."""
    color, label = PRIORITY_STYLE.get((priority or "").upper(), ("#64748b", priority or "—"))

    def row(icon: str, name: str, value):
        if not value:
            return ""
        return f"""
        <tr>
          <td style="padding:6px 0;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top;">{icon}&nbsp;{_esc(name)}</td>
          <td style="padding:6px 0 6px 12px;color:#1e293b;font-size:13px;font-weight:500;">{_esc(value)}</td>
        </tr>"""

    attachments_html = ""
    if attachment_names:
        chips = "".join(
            f'<span style="display:inline-block;background:#eef2ff;color:#4338ca;'
            f'border-radius:6px;padding:4px 10px;font-size:12px;margin:2px 6px 2px 0;">'
            f'📎 {_esc(name)}</span>'
            for name in attachment_names
        )
        attachments_html = f"""
        <tr>
          <td style="padding:12px 0 0;color:#64748b;font-size:13px;vertical-align:top;">📎 Attachments</td>
          <td style="padding:12px 0 0 12px;">{chips}</td>
        </tr>"""

    return f"""
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;">
      <div style="background:linear-gradient(135deg,#2563eb,#4f46e5);border-radius:10px 10px 0 0;padding:20px 24px;">
        <div style="color:#dbeafe;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;">Dayline</div>
        <div style="color:#ffffff;font-size:18px;font-weight:700;margin-top:4px;">{_esc(heading)}</div>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;padding:20px 24px;">
        <p style="color:#334155;font-size:14px;margin:0 0 16px;">
          <strong>{_esc(actor_name)}</strong> assigned you a task.
        </p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 18px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <span style="background:{color};color:#fff;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;">{_esc(label)}</span>
            <span style="color:#0f172a;font-size:16px;font-weight:700;">{_esc(task_name)}</span>
          </div>
          {f'<p style="color:#475569;font-size:13px;margin:0 0 12px;line-height:1.5;">{_esc(description)}</p>' if description else ''}
          <table style="width:100%;border-collapse:collapse;">
            {row("🧭", "Status", status)}
            {row("👤", "Assigned to", assignee_name)}
            {row("🧑‍💼", "Assigned by", assigner_name)}
            {row("⏱️", "Duration", duration)}
            {row("📅", "Due date", due_date)}
            {row("🏷️", "Tags", tags)}
            {row("📝", "Notes", notes)}
            {attachments_html}
          </table>
        </div>
        <div style="margin-top:20px;text-align:center;">
          <a href="{_esc(app_link(f'tasks/{task_id}') if task_id else app_link())}" style="background:#2563eb;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 22px;border-radius:8px;display:inline-block;">Open in Dayline</a>
        </div>
        <p style="color:#94a3b8;font-size:11px;margin:20px 0 0;text-align:center;">Task ID: {_esc(task_id)}</p>
      </div>
    </div>
    """


def _decode_attachment_data(data: str) -> bytes:
    """Attachment `data` is stored as a base64 data URI ("data:image/png;base64,....")
    or plain base64 — strip the prefix if present, then decode."""
    if "," in data and data.strip().lower().startswith("data:"):
        data = data.split(",", 1)[1]
    return base64.b64decode(data)


def send_email(to: str, subject: str, body: str, attachments: list | None = None) -> dict:
    """Send a plain+HTML email, optionally with file attachments. Returns
    {"success": bool, ...}. Never raises.

    attachments: optional list of dicts {"filename": str, "content_type": str, "data": str}
    where `data` is base64 (data URI or bare) — the shape task_attachments rows are stored in.
    """
    if not SMTP_PASS:
        return {"success": False, "error": "SMTP credentials not configured"}
    if not to:
        return {"success": False, "error": "No recipient"}

    try:
        outer = MIMEMultipart("mixed")
        outer["Subject"] = subject
        outer["From"] = FROM_EMAIL
        outer["To"] = to

        alt = MIMEMultipart("alternative")
        text_body = body.replace("<br>", "\n").replace("<br/>", "\n")
        alt.attach(MIMEText(text_body, "plain", "utf-8"))
        html_body = body if "<" in body else body.replace("\n", "<br>\n")
        alt.attach(
            MIMEText(
                f"<html><body style='font-family:sans-serif'>{html_body}</body></html>",
                "html",
                "utf-8",
            )
        )
        outer.attach(alt)

        for att in (attachments or []):
            try:
                payload = _decode_attachment_data(att["data"])
                part = MIMEApplication(payload)
                filename = att.get("filename") or "attachment"
                part.add_header("Content-Disposition", "attachment", filename=filename)
                content_type = att.get("content_type")
                if content_type:
                    part.set_type(content_type)
                outer.attach(part)
            except Exception as e:  # noqa: BLE001 — malformed/corrupt attachment data can fail in
                # many ways (base64, MIME); a single bad one must not sink the whole email.
                logger.warning(f"Skipping unattachable file {att.get('filename')!r}: {e}")
                continue

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(FROM_EMAIL, [to], outer.as_string())

        return {"success": True, "to": to, "from": FROM_EMAIL}
    except smtplib.SMTPAuthenticationError:
        return {"success": False, "error": "SMTP authentication failed"}
    except Exception as exc:  # noqa: BLE001 — best-effort, never raise to caller
        return {"success": False, "error": str(exc)}
