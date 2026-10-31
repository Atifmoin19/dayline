import base64
import copy
import csv
import io
import logging
import os
import secrets
import time
from collections.abc import Generator
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dotenv import load_dotenv
from fastapi import (
    Body,
    Depends,
    FastAPI,
    File,
    Header,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm.attributes import flag_modified

from audit_util import record_audit
from security import hash_password, is_hashed, verify_password
from sso_util import OIDC_PROVIDER_LABEL as SSO_PROVIDER_LABEL
from sso_util import (
    build_authorize_url,
    consume_state,
    exchange_code_and_verify,
    sso_configured,
)
from utils import response

# Load env vars first so models.py can see DATABASE_URL
load_dotenv()

# Error tracking (Sentry) --- unset SENTRY_DSN => silent no-op, matching every other optional
# integration in this codebase (Slack/email/push all follow "unset env var = no-op"; see
# slack_util.py / push_util.py). Initialized before app creation so it can catch startup errors
# too. traces_sample_rate is kept low (10%) since this is a request-heavy CRUD API — full tracing
# would be noisy/costly for little debugging value beyond error reporting.
if os.getenv("SENTRY_DSN"):
    import sentry_sdk

    sentry_sdk.init(
        dsn=os.getenv("SENTRY_DSN"),
        environment=os.getenv("ENVIRONMENT", "development"),
        traces_sample_rate=0.1,
        send_default_pii=False,
    )

# Central RBAC — single source of truth for ranks + every authorization decision.
# (Replaces the rank checks that were previously scattered through this file.)
import permissions as perms
from email_util import build_task_email_html, email_configured, send_email
from models import (
    AttachmentCreate,
    AttachmentRead,
    AuditLogRead,
    BurndownPoint,
    BurndownResponse,
    CommentCreate,
    CommentRead,
    EpicCreate,
    EpicRead,
    EpicUpdate,
    Foundation,
    LinkCreate,
    LinkedTask,
    NotificationRead,
    ProfileSelfUpdate,
    PushSubscriptionCreate,
    PushUnsubscribe,
    SessionLocal,
    SprintCreate,
    SprintRead,
    SprintUpdate,
    SubtaskCreate,
    TaskCreate,
    TaskRead,
    TaskStatusUpdate,
    UserCreate,
    UserDirectory,
    UserRead,
    UserUpdate,
    init_db,
)
from models import (
    AuditLog as AuditLogModel,
)
from models import (
    Epic as EpicModel,
)
from models import (
    Notification as NotificationModel,
)
from models import (
    PushSubscription as PushSubscriptionModel,
)
from models import (
    Sprint as SprintModel,
)
from models import (
    Task as TaskModel,
)
from models import (
    TaskAttachment as TaskAttachmentModel,
)
from models import (
    TaskComment as TaskCommentModel,
)
from models import (
    TaskLink as TaskLinkModel,
)
from models import (
    User as UserModel,
)
from permissions import (
    can_modify_epic,
    can_modify_sprint,
    get_all_subordinates,
    get_user_view_scope,
    validate_assignee_eligibility,
    validate_manager_hierarchy,
)
from push_util import VAPID_PUBLIC_KEY, push_configured, send_push
from slack_util import send_slack, slack_configured

# A reverse proxy typically maps https://<host>/api/ -> this app (prefix stripped),
# so root_path keeps the OpenAPI/docs server URL correct behind the proxy.
app = FastAPI(
    root_path=os.getenv("API_ROOT_PATH", "/api"),
    title="TaskBoard API",
    description=(
        "Role-based task/time-tracking backend: auth + sessions, task CRUD with an "
        "overdue sweeper and timeline realignment, comments/links/attachments, "
        "notifications (email/Slack/push), and org-hierarchy RBAC. "
        "Interactive docs: /docs (Swagger UI) and /redoc."
    ),
    version="1.0.0",
)

# Process start time (module import == process start for this single-process app) — used by
# GET /metrics to report uptime.
_process_start_time = time.time()

# CORS: production frontend origin(s) come from FRONTEND_ORIGIN. Extra origins
# can be added via FRONTEND_ORIGIN (comma-separated). Any localhost port is auto-allowed
# for Vite dev. Wildcard "*" is intentionally NOT used — it is invalid with
# allow_credentials=True.
DEFAULT_ORIGINS: list[str] = []
origins = DEFAULT_ORIGINS + [o.strip() for o in os.getenv("FRONTEND_ORIGIN", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
)
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# Rate limiting (per client IP). Applied to auth endpoints to stop credential-guessing.
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Global Exception Handler
@app.exception_handler(HTTPException)
async def custom_http_exception_handler(request: Request, exc: HTTPException):
    return response(
        status_code=exc.status_code,
        message=exc.detail,
        data={"details": exc.detail}
    )


# Hierarchy config, rank lookup, subordinate/scope walking, and the hierarchy/assignee
# validators now live in permissions.py (imported above) — the single RBAC source of truth.


# utc_now/get_utc_now_iso/business_now/parse_dt/close_session_at/recalculate_total_time/
# close_current_session used to be defined inline here. They now live in task_helpers.py so
# the Celery overdue-sweep task (tasks_celery.py — a separate worker process) can reuse the
# exact same logic without importing all of main.py. See task_helpers.py's module docstring.
from task_helpers import (
    BUSINESS_END_HOUR,
    BUSINESS_START_HOUR,
    BUSINESS_TZ,
    business_now,
    close_current_session,
    get_utc_now_iso,
    parse_dt,
    recalculate_total_time,
    utc_now,
)


def add_activity(db, task_id: str, actor_id: str, actor_name: str, text: str):
    """Append a system activity-log entry to a task's comment thread (status changes, etc.).
    Best-effort — never let logging break the main mutation."""
    try:
        db.add(TaskCommentModel(
            task_id=task_id,
            author_id=actor_id or "system",
            author_name=actor_name or "System",
            body=text,
            is_system=True,
            created_at=utc_now(),
        ))
    except Exception as e:  # noqa: BLE001 — best-effort per docstring above: never break the mutation
        logger.error(f"add_activity failed for task {task_id}: {e}")


def format_duration_label(duration_str) -> str | None:
    """"2:30" -> "2h 30m"; "0:45" -> "45m"; falsy/zero -> None."""
    hours = parse_duration(duration_str)
    if not hours:
        return None
    h = int(hours)
    m = round((hours - h) * 60)
    if h and m:
        return f"{h}h {m}m"
    if h:
        return f"{h}h"
    return f"{m}m"


def format_due_date_label(dt: datetime | None) -> str | None:
    """Render a due-date DateTime in the business timezone for emails."""
    if not dt:
        return None
    try:
        local = (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(ZoneInfo(BUSINESS_TZ))
        return local.strftime("%d %b %Y, %I:%M %p")
    except Exception:  # noqa: BLE001 — cosmetic email formatting; any failure just omits the label
        return None


def notify(
    db,
    recipient_id: str,
    ntype: str,
    message: str,
    task_id: str | None = None,
    send_mail: bool = True,
    actor_name: str | None = None,
):
    """Create an in-app notification for a user + a best-effort email (Mandrill SMTP via
    email_util). When task_id is given, the email is a full task-detail card (description,
    priority, status, due date, duration, tags, notes) with any task attachments included as
    real email attachments. Never raises — notifications must not break the main request."""
    if not recipient_id:
        return
    try:
        db.add(NotificationModel(
            user_id=recipient_id,
            type=ntype,
            message=message,
            task_id=task_id,
            is_read=False,
            created_at=utc_now(),
        ))
    except Exception as e:  # noqa: BLE001 — best-effort per docstring above: never break the request
        logger.error(f"notify (db) failed for {recipient_id}: {e}")

    if push_configured():
        try:
            subs = db.query(PushSubscriptionModel).filter(
                PushSubscriptionModel.user_id == recipient_id
            ).all()
            for sub in subs:
                result = send_push(
                    {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                    title="TaskBoard",
                    body=message,
                    url=os.getenv("FRONTEND_APP_URL", "http://localhost:5173/"),
                    task_id=task_id,
                )
                if result.get("gone"):
                    db.delete(sub)
            if subs:
                db.commit()
        except Exception as e:  # noqa: BLE001 — best-effort push fan-out: unset/failed = silent no-op
            logger.error(f"notify (push) failed for {recipient_id}: {e}")

    if send_mail and (email_configured() or slack_configured()):
        try:
            user = db.query(UserModel).filter(UserModel.emp_id == recipient_id).first()
            if user and user.emp_email and email_configured():
                subject = "TaskBoard — new update"
                html_body = message
                mail_attachments = None

                task = db.query(TaskModel).filter(TaskModel.id == task_id).first() if task_id else None
                if task:
                    assigner = (
                        db.query(UserModel).filter(UserModel.emp_id == task.task_assigned_by).first()
                        if task.task_assigned_by else None
                    )
                    task_attachments = db.query(TaskAttachmentModel).filter(
                        TaskAttachmentModel.task_id == task_id
                    ).all()
                    heading = "Task Reassigned to You" if ntype == "reassigned" else "New Task Assigned"
                    subject = f"TaskBoard — {heading}: {task.task_name}"
                    html_body = build_task_email_html(
                        heading=heading,
                        actor_name=actor_name or (assigner.emp_name if assigner else "Someone"),
                        task_name=task.task_name,
                        task_id=task.id,
                        description=task.task_description,
                        priority=task.task_priority,
                        status=task.task_status,
                        assignee_name=user.emp_name,
                        assigner_name=assigner.emp_name if assigner else None,
                        due_date=format_due_date_label(task.task_due_date),
                        duration=format_duration_label(task.task_duration),
                        tags=task.task_tags,
                        notes=task.task_notes,
                        attachment_names=[a.filename for a in task_attachments if a.filename],
                    )
                    mail_attachments = [
                        {"filename": a.filename, "content_type": a.content_type, "data": a.data}
                        for a in task_attachments
                    ]

                send_email(user.emp_email, subject, html_body, attachments=mail_attachments)
            # Best-effort Slack (posts to the webhook's channel; name the recipient).
            if slack_configured():
                who = user.emp_name if user else recipient_id
                send_slack(f":bell: *{who}* — {message}")
        except Exception as e:  # noqa: BLE001 — best-effort email/Slack fan-out: unset/failed = silent no-op
            logger.error(f"notify (email/slack) failed for {recipient_id}: {e}")


def completion_blockers(db, task_id: str):
    """Names of tasks that must be done before this one can complete:
    its unfinished dependencies (depends_on) + its unfinished subtasks."""
    dep_links = db.query(TaskLinkModel).filter(
        TaskLinkModel.from_task_id == task_id,
        TaskLinkModel.link_type == "depends_on",
    ).all()
    sub_links = db.query(TaskLinkModel).filter(
        TaskLinkModel.to_task_id == task_id,
        TaskLinkModel.link_type == "subtask",
    ).all()
    ids = [l.to_task_id for l in dep_links] + [l.from_task_id for l in sub_links]
    if not ids:
        return []
    rows = db.query(TaskModel).filter(TaskModel.id.in_(ids)).all()
    return [
        (r.task_name or r.id)
        for r in rows
        if (r.task_status or "").lower() not in ["done", "completed"]
    ]


def recompute_subtask_counters(db, parent_id: str) -> tuple:
    """Recomputes tasks.subtask_total/subtask_done for `parent_id` from the current
    task_links + tasks rows (recompute-from-truth, not increment/decrement, so counters can't
    drift under concurrent edits or retries). One indexed aggregate query, caller commits.
    Returns (total, done)."""
    rows = (
        db.query(TaskModel.task_status)
        .join(TaskLinkModel, TaskLinkModel.from_task_id == TaskModel.id)
        .filter(TaskLinkModel.to_task_id == parent_id, TaskLinkModel.link_type == "subtask")
        .all()
    )
    total = len(rows)
    done = sum(1 for (status,) in rows if (status or "").lower() in ["done", "completed"])
    db.query(TaskModel).filter(TaskModel.id == parent_id).update(
        {"subtask_total": total, "subtask_done": done}, synchronize_session=False
    )
    return total, done


def check_subtask_depth(db, child_id: str, parent_id: str) -> str | None:
    """Subtasks are capped at 2 levels (story -> subtask, no grandchildren) so progress
    rollup never needs a recursive query. Returns an error message if adding a
    link_type="subtask" edge (child_id -> parent_id) would create a 3rd level, else None."""
    parent_has_its_own_parent = (
        db.query(TaskLinkModel)
        .filter(TaskLinkModel.from_task_id == parent_id, TaskLinkModel.link_type == "subtask")
        .first()
    )
    if parent_has_its_own_parent:
        return "That task is already a subtask of another task — subtasks can't be nested"
    child_already_has_children = (
        db.query(TaskLinkModel)
        .filter(TaskLinkModel.to_task_id == child_id, TaskLinkModel.link_type == "subtask")
        .first()
    )
    if child_already_has_children:
        return "That task already has its own subtasks — subtasks can't be nested"
    return None


# A single request creating many subtasks at once (each with its own attachments inlined as
# base64) can otherwise grow an unbounded request body and block on N sequential notify() calls
# in the request path — this caps it to a sane batch size rather than letting it grow unbounded.
MAX_SUBTASKS_PER_REQUEST = 25


def create_subtask_row(db, sub, parent_task, current_user) -> tuple:
    """Validates + builds (adds to the session, does not commit) a single subtask: a new
    `tasks` row of its own — distinct `id`/`ticket_id`, never shared with the parent or with
    any other subtask — linked to `parent_task` via task_links(link_type="subtask"). Shared by
    the bulk create-time path (`POST /tasks`'s `subtasks` field) and the add-to-existing-task
    path (`POST /tasks/{id}/subtasks`). Raises ValueError on a validation failure. Returns
    (subtask_id, assignee_emp_id, subtask_name) — caller commits once (per batch or singly) and
    recomputes the parent's counters after."""
    sub_assignee = db.query(UserModel).filter(UserModel.emp_id == sub.task_assigned_to).first()
    if not sub_assignee:
        raise ValueError(f"Assignee not found: {sub.task_assigned_to}")
    if not perms.can_assign_task_to(db, current_user, sub.task_assigned_to):
        raise ValueError(f"Not authorized to assign to {sub.task_assigned_to}")
    validate_assignee_eligibility(sub_assignee)

    sub_id = secrets.token_hex(8)
    sub_ticket_id = f"T-{secrets.randbelow(100000):05d}"
    while db.query(TaskModel).filter(TaskModel.ticket_id == sub_ticket_id).first():
        sub_ticket_id = f"T-{secrets.randbelow(100000):05d}"

    db.add(TaskModel(
        id=sub_id,
        ticket_id=sub_ticket_id,
        task_name=sub.task_name,
        task_description=sub.task_description,
        task_status=sub.task_status or "todo",
        task_assigned_to=sub.task_assigned_to,
        task_assigned_by=current_user.emp_id,
        task_assigned_date=utc_now(),
        task_due_date=sub.task_due_date,
        task_priority=sub.task_priority or parent_task.task_priority,
        task_tags=sub.task_tags,
        task_duration=sub.task_duration,
        task_created_at=utc_now(),
        task_updated_at=utc_now(),
    ))
    db.add(TaskLinkModel(
        from_task_id=sub_id,
        to_task_id=parent_task.id,
        link_type="subtask",
        created_at=utc_now(),
    ))
    if sub.attachments:
        for item in sub.attachments:
            att_row = build_task_attachment(sub_id, current_user.emp_id, item, strict=False)
            if att_row:
                db.add(att_row)
    return sub_id, sub.task_assigned_to, sub.task_name


def sync_parent_after_child_status_change(db, db_task, current_user) -> None:
    """If db_task is itself a subtask, recompute its parent's progress counters. Only notifies
    the parent's assignee/assigner once ALL subtasks are done — not on every partial tick,
    which would spam the story owner once per child."""
    parent_link = (
        db.query(TaskLinkModel)
        .filter(TaskLinkModel.from_task_id == db_task.id, TaskLinkModel.link_type == "subtask")
        .first()
    )
    if not parent_link:
        return
    total, done = recompute_subtask_counters(db, parent_link.to_task_id)
    if total and done == total:
        parent = db.query(TaskModel).filter(TaskModel.id == parent_link.to_task_id).first()
        if parent:
            for recipient in {parent.task_assigned_to, parent.task_assigned_by}:
                if recipient and recipient != current_user.emp_id:
                    notify(
                        db, recipient, "subtasks_complete",
                        f"All subtasks complete for: {parent.task_name}",
                        task_id=parent.id, actor_name=current_user.emp_name,
                    )


# parse_dt now lives in task_helpers.py (imported above), shared with tasks_celery.py.

# get_rank, validate_manager_hierarchy, get_all_subordinates, get_user_view_scope and
# validate_assignee_eligibility are imported from permissions.py (single RBAC source).


def get_db() -> Generator:
     db = SessionLocal()
     try:
         yield db
     finally:
         db.close()

# Auth Models and Dependency
class LoginRequest(BaseModel):
    emp_id: str
    password: str

class RegisterRequest(BaseModel):
    emp_id: str
    emp_email: str
    password: str

class OnboardingPreviewRequest(BaseModel):
    emp_id: str
    emp_email: str

def verify_token(authorization: str | None = Header(None), db=Depends(get_db)):
    if not authorization:
         raise HTTPException(status_code=401, detail="Missing Authorization Header")
    
    if authorization.startswith("Bearer "):
        token = authorization.replace("Bearer ", "")
    elif authorization.startswith("Token "):
        token = authorization.replace("Token ", "")
    else:
        token = authorization

    # Sessions live in Redis with a sliding 15-min TTL (authoritative when Redis is up).
    # session_get also refreshes the TTL. If Redis is down we fall back to the DB token
    # + last_active_at inactivity check so auth keeps working degraded.
    emp_id = None
    if redis_available():
        emp_id = session_get(token)
        if not emp_id:
            raise HTTPException(status_code=401, detail="Invalid or Expired Token")
    else:
        foundation_entry = db.query(Foundation).filter(Foundation.token == token).first()
        if not foundation_entry:
            raise HTTPException(status_code=401, detail="Invalid or Expired Token")
        now = utc_now()
        last_active = parse_dt(foundation_entry.last_active_at)
        if last_active and now - last_active > timedelta(minutes=15):
            foundation_entry.token = None
            foundation_entry.last_active_at = None
            db.commit()
            raise HTTPException(status_code=401, detail="Token expired due to inactivity")
        foundation_entry.last_active_at = utc_now()
        db.commit()
        emp_id = foundation_entry.emp_id

    user = db.query(UserModel).filter(UserModel.emp_id == emp_id).first()

    if not user:
        raise HTTPException(status_code=401, detail="User associated with token not found")

    return user


def require_admin(current_user=Depends(verify_token)):
    """FastAPI dependency gating user-management endpoints. The actual rule
    (rank >= L2 or an admin role) lives in permissions.can_manage_users."""
    if perms.can_manage_users(current_user):
        return current_user
    raise HTTPException(status_code=403, detail="Admin privileges required for this action")


def require_user_admin(current_user=Depends(verify_token)):
    """Gates the user-management MUTATION endpoints (create/update/delete/bulk-delete/CSV
    import). Broader than `require_admin` — also admits a `dept_admin` grant — but each
    endpoint body still enforces the actual department scope via
    `permissions.can_manage_department` before touching a specific target."""
    if perms.can_manage_users_at_all(current_user):
        return current_user
    raise HTTPException(status_code=403, detail="Admin privileges required for this action")


def require_admin_or_auditor(current_user=Depends(verify_token)):
    """Gates admin-only READ surfaces (audit log, enriched user directory): full admin,
    dept_admin, or auditor. Never used for a mutation endpoint — see require_user_admin."""
    if perms.can_view_admin_surfaces(current_user):
        return current_user
    raise HTTPException(status_code=403, detail="Admin privileges required for this action")


import asyncio
import hashlib
import json
import threading

from gemini_util import call_gemini_with_fallback, gemini_configured
from redis_client import (
    WS_BROADCAST_CHANNEL,
    get_redis_client,
    redis_available,
    session_delete,
    session_get,
    session_set,
)
from redis_client import (
    get_value as redis_get_value,
)
from redis_client import (
    set_value as redis_set_value,
)


@app.on_event("startup")
async def on_startup():
    # Initialize Postgres tables
    init_db()

    # Verify Redis Connection
    redis_conn = get_redis_client()
    if redis_conn:
        logger.info("Redis connected successfully")
    else:
        logger.warning("Redis connection failed")

    # Capture the running loop so sync endpoints (and the Redis pub/sub listener thread
    # started below) can push WebSocket broadcasts onto it.
    global _main_loop
    _main_loop = asyncio.get_running_loop()

    # The overdue sweeper used to be an in-process asyncio task started right here
    # (`asyncio.create_task(check_overdue_tasks())`, `while True: await asyncio.sleep(60)`).
    # It now runs as tasks_celery.sweep_overdue_tasks, scheduled every 60s by Celery Beat in
    # a separate worker process — see celery_app.py / tasks_celery.py. Do NOT re-add a call
    # here: running both would double-process the sweep (double-holding sessions, duplicate
    # backlog moves, duplicate notifications).

    # That move means the sweep now runs OUTSIDE this process, so it can no longer call
    # ws_manager.broadcast directly. Bridge the gap via Redis pub/sub (see
    # redis_client.publish_ws_event / WS_BROADCAST_CHANNEL and _ws_redis_listener below).
    threading.Thread(target=_ws_redis_listener, daemon=True, name="ws-redis-listener").start()


# ── Real-time (WebSocket) ────────────────────────────────────────────────────
# Single-instance, in-memory fan-out. Clients connect to /ws and receive a tiny
# {"type": "tasks_changed"} ping whenever task state mutates; the frontend then refetches.
# ConnectionManager itself stays single-instance/in-memory deliberately (still true even
# after the P3 background-jobs move to Celery) — it's simple and this app runs as one web
# process. What DID change: the overdue sweep now runs in a separate Celery worker process,
# which can't call ws_manager.broadcast directly. `_ws_redis_listener` below bridges that
# one gap via Redis pub/sub, rather than rearchitecting the whole WS layer for
# multi-instance fan-out (not needed yet — see redis_client.WS_BROADCAST_CHANNEL).
_main_loop = None


class ConnectionManager:
    def __init__(self):
        self.active: list = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, message: dict):
        for ws in list(self.active):
            try:
                await ws.send_json(message)
            except Exception:  # noqa: BLE001 — any send failure means treat this socket as dead
                self.disconnect(ws)


ws_manager = ConnectionManager()


def notify_change(event: str = "tasks_changed", **extra):
    """Fire-and-forget WebSocket broadcast, safe to call from sync request handlers
    (they run in a threadpool, so we hop back onto the main event loop). No-op if no
    clients or the loop isn't captured yet."""
    if _main_loop is None or not ws_manager.active:
        return
    try:
        asyncio.run_coroutine_threadsafe(
            ws_manager.broadcast({"type": event, **extra}), _main_loop
        )
    except Exception as e:  # noqa: BLE001 — fire-and-forget per docstring above: never break the caller
        logger.error(f"notify_change failed: {e}")


def _ws_redis_listener():
    """Background thread (started from on_startup): subscribes to the Redis pub/sub
    channel the Celery worker publishes to (tasks_celery.sweep_overdue_tasks, via
    redis_client.publish_ws_event) after it commits sweep mutations, and forwards each
    event onto THIS process's in-memory WebSocket connections via notify_change — the
    same run_coroutine_threadsafe bridge the synchronous HTTP handlers already use.

    Runs in a plain thread rather than an asyncio task because redis-py's
    pubsub.listen() is a blocking generator. Best-effort/degrade-gracefully: if Redis is
    down or the connection drops, it retries on a short backoff instead of crashing the
    app — matching every other optional Redis usage in this codebase (session store).
    """
    backoff_seconds = 2
    while True:
        r = get_redis_client()
        if not r:
            time.sleep(backoff_seconds)
            continue
        try:
            pubsub = r.pubsub()
            pubsub.subscribe(WS_BROADCAST_CHANNEL)
            for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    payload = json.loads(message["data"])
                except (TypeError, ValueError):
                    continue
                event = payload.pop("event", "tasks_changed")
                notify_change(event, **payload)
        except Exception as e:  # noqa: BLE001 — best-effort/degrade-gracefully per docstring: retry, don't crash
            logger.warning(f"WS redis listener error, retrying in {backoff_seconds}s: {e}")
            time.sleep(backoff_seconds)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            # We don't need client messages; this keeps the socket open (and drains pings).
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)
    except Exception:  # noqa: BLE001 — any other socket failure is also just a disconnect
        ws_manager.disconnect(ws)

def parse_duration(duration_str: str) -> float:
    """Parses duration string (HH:MM or float hours) into hours (float)."""
    if not duration_str or duration_str == "0":
        return 0.0
    
    if ":" in str(duration_str):
        try:
            parts = duration_str.split(":")
            h = int(parts[0])
            m = int(parts[1]) if len(parts) > 1 else 0
            return h + (m / 60.0)
        except ValueError:
            return 0.0
    else:
        try:
            return float(duration_str)
        except ValueError:
            return 0.0

def realign_user_tasks(db, emp_id: str):
    """
    Recalculates the timeline for standard tasks (Todo/In-Progress) for a specific user to be sequential.
    Logic:
    1. Fetch all non-completed tasks sorted by 'task_assigned_date'.
    2. Iterate through them. StartTime of Task[i] = Max(OriginalAssignment, EndTime of Task[i-1]).
    3. Update task_assigned_date if it overlaps.
    """
    tasks = db.query(TaskModel).filter(
        TaskModel.task_assigned_to == emp_id,
        TaskModel.task_status.notin_(["done", "completed", "backlog", "Done", "Completed", "Backlog", "on-hold", "on hold", "On-Hold", "On Hold"])
    ).order_by(TaskModel.task_created_at.asc()).all()

    if not tasks:
        return

    # Initialize "Timeline Cursor"
    # We start checking from the first task in the queue.
    # Note: If the first task is "In Progress", we shouldn't move its start time presumably, 
    # but the request asks to recalculate timeline.
    # We will assume earliest assigned date is the anchor.
    
    current_timeline_cursor = None

    for i, task in enumerate(tasks):
        # 1. Determine Start Time of this task (column is a tz-aware datetime or None)
        original_start = parse_dt(task.task_assigned_date)

        # If no valid date, we must assign one
        if original_start is None:
            if current_timeline_cursor:
                # Append to current timeline end
                effective_start = current_timeline_cursor
            else:
                # Start at creation time or now
                effective_start = parse_dt(task.task_created_at) or utc_now()

            # Assign content
            task.task_assigned_date = effective_start
            # Sync cursor to this new start (it will be advanced by duration below)
            current_timeline_cursor = effective_start

        else:
            # Start date exists
            if current_timeline_cursor is None:
                current_timeline_cursor = original_start

            if original_start < current_timeline_cursor:
                # Overlap detected! Shift this task to start at cursor.
                task.task_assigned_date = current_timeline_cursor
                effective_start = current_timeline_cursor
            else:
                # No overlap, it starts later. Move cursor to this gap.
                effective_start = original_start
                current_timeline_cursor = original_start

        # 2. Add REMAINING work to find End Time (Move Cursor Forward)
        # Reserve remaining (duration - time_spent), NOT the full block, so a resumed task
        # stops re-reserving its whole duration and drifting/overrunning. remaining_seconds
        # already subtracts time_spent (with a 30-min floor while in-progress); for a not-yet-
        # started task time_spent is 0, so remaining == full duration (no behavior change).
        remaining_hours = (task.remaining_seconds or 0) / 3600.0
        if remaining_hours > 0:
            current_timeline_cursor = effective_start + timedelta(hours=remaining_hours)
    
    # Commit changes
    try:
        db.commit()
    except Exception as e:  # noqa: BLE001 — secondary timeline reorder is best-effort, must not
        logger.error(f"Error realigning tasks for user {emp_id}: {e}")  # crash the primary op
        db.rollback()

def start_new_session(db, task, status_label="in-progress"):
    # 1. Enforce Single Active Session: Auto-Hold others
    try:
        others = db.query(TaskModel).filter(
            TaskModel.task_assigned_to == task.task_assigned_to,
            TaskModel.id != task.id,
            TaskModel.task_status.in_(["in progress", "in-progress", "In Progress"])
        ).with_for_update().all()
        for other in others:
            # Atomic Session Switching — this is a PAUSE, not a completion. Label the closed
            # session "on-hold" so a genuine completion stays distinguishable, and move the clock
            # so the sweeper/scheduler anchor on the real hold time.
            close_current_session(other, completion_status="on-hold")
            other.task_status = "on-hold"
            other.task_updated_at = utc_now()
    except Exception as e:  # noqa: BLE001 — auto-holding other sessions is best-effort; the new
        logger.error(f"Auto-hold error: {e}")  # session must still start even if this step fails

    current_sessions = task.task_sessions if task.task_sessions else []
    
    # Check if already open session
    for s in current_sessions:
        if s.get("end_time") is None:
             # Already open.
            return 
            
    # Create Deep Copy and Append
    sessions = copy.deepcopy(current_sessions)
    sessions.append({
        "start_time": get_utc_now_iso(),
        "end_time": None,
        "status": status_label
    })
    
    # Force SQLAlchemy to detect change
    task.task_sessions = sessions
    flag_modified(task, "task_sessions")

# close_current_session / recalculate_total_time now live in task_helpers.py (imported
# above), shared with tasks_celery.py.
#
# check_overdue_tasks (the old in-process `while True: await asyncio.sleep(60)` sweeper)
# has been replaced by tasks_celery.sweep_overdue_tasks, run on a 60s schedule by Celery
# Beat in a separate worker process — see tasks_celery.py and celery_app.py. It is no
# longer started from on_startup below; running both would double-process the sweep
# (double-holding sessions, duplicate backlog moves).


def get_redis():
    r = get_redis_client()
    try:
        yield r
    finally:
        # Redis client manages its own connection pool, but we can close it if needed.
        # usually for redis-py usage in dependency, we just yield it.
        pass


@app.get('/', summary="Welcome banner")
def welcome():
     """Trivial liveness check — not to be confused with /health (which also probes the DB)."""
     return response(status.HTTP_200_OK, message="Welcome to the Automation Backend")


@app.post('/login', status_code=200, summary="Log in with emp_id + password")
@limiter.limit("10/minute")
def login(request: Request, login_req: LoginRequest, db=Depends(get_db)):
    """Verifies credentials against the Foundation table (bcrypt, with transparent
    legacy-plaintext upgrade), then issues a session token (Redis-backed, DB fallback)."""
    # Check Foundation for password
    foundation = db.query(Foundation).filter(Foundation.emp_id == login_req.emp_id).first()

    # Verify against bcrypt hash (or legacy plaintext during migration window).
    if not foundation or not verify_password(login_req.password, foundation.password):
         raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    user = db.query(UserModel).filter(UserModel.emp_id == login_req.emp_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User details not found")

    # Transparent migration: if the stored password is still plaintext, upgrade it to a
    # bcrypt hash now that we've verified it.
    if not is_hashed(foundation.password):
        foundation.password = hash_password(login_req.password)

    token = secrets.token_hex(16)
    foundation.token = token
    foundation.last_active_at = utc_now()
    db.commit()

    # Primary session store: Redis with a sliding TTL. DB token above is the fallback.
    session_set(token, user.emp_id)
    
    user_data = UserRead.from_orm(user).dict()
    # Remove token/password if present? UserRead doesn't have password, Foundation has.
    # UserRead might have 'token' field if not updated properly in models, but we removed it or it is optional traverse.
    # Note: UserRead no longer has 'token' populated from User model since we removed it from User model.
    # If UserRead still has the field in Pydantic, it will be None.
    if "token" in user_data:
        del user_data["token"]

    data = {
        "token": token,
        "userData": user_data
    }
    return response(status.HTTP_200_OK, message="Login successful", data=data)


@app.post('/register', status_code=200, summary="Set a password for a pre-provisioned user")
@limiter.limit("10/minute")
def register(request: Request, reg_req: RegisterRequest, db=Depends(get_db)):
    """First-login flow: a User row must already exist (created by HR/admin); this sets a
    real password (replacing the default) and issues a session token, same as /login."""
    # 1. Verify User Exists with matching emp_id and email
    user = db.query(UserModel).filter(
        UserModel.emp_id == reg_req.emp_id,
        UserModel.emp_email == reg_req.emp_email
    ).first()

    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User validation failed. Invalid ID or Email.")

    # 2. Check/Create Foundation Entry
    foundation = db.query(Foundation).filter(Foundation.emp_id == reg_req.emp_id).first()

    token = secrets.token_hex(16)

    if foundation:
        # Allow (re)registration only while the account still has the default password.
        if not verify_password("123456", foundation.password):
            raise HTTPException(status_code=400, detail="User already registered. Kindly login.")

        # If entry exists (default pwd), update password and token
        foundation.password = hash_password(reg_req.password)
        foundation.token = token
        foundation.last_active_at = utc_now()
        foundation.is_onboarded = True
    else:
        # If for some reason it doesn't exist (legacy?), create it
        foundation = Foundation(
            emp_id=reg_req.emp_id,
            password=hash_password(reg_req.password),
            token=token,
            last_active_at=utc_now(),
            is_onboarded=True,
        )
        db.add(foundation)
    
    db.commit()

    # Primary session store: Redis with a sliding TTL. DB token above is the fallback.
    session_set(token, user.emp_id)

    # 3. Return Response (Same as Login)
    user_data = UserRead.from_orm(user).dict()
    if "token" in user_data:
        del user_data["token"]

    data = {
        "token": token,
        "userData": user_data
    }
    return response(status.HTTP_200_OK, message="Registration successful", data=data)


@app.post('/onboarding/preview', status_code=200, summary="Look up a pre-provisioned user's profile before setting a password")
@limiter.limit("10/minute")
def onboarding_preview(request: Request, preview_req: OnboardingPreviewRequest, db=Depends(get_db)):
    """Read-only step 1 of the onboarding wizard: same emp_id+email lookup and same
    still-has-the-default-password guard as /register (no mutation), so the wizard can show
    the user their own prefilled profile before asking them to set a real password."""
    user = db.query(UserModel).filter(
        UserModel.emp_id == preview_req.emp_id,
        UserModel.emp_email == preview_req.emp_email
    ).first()

    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User validation failed. Invalid ID or Email.")

    foundation = db.query(Foundation).filter(Foundation.emp_id == preview_req.emp_id).first()
    if foundation and not verify_password("123456", foundation.password):
        raise HTTPException(status_code=400, detail="User already registered. Kindly login.")

    data = {
        "emp_name": user.emp_name,
        "emp_id": user.emp_id,
        "emp_email": user.emp_email,
        "emp_phone": user.emp_phone,
        "emp_designation": user.emp_designation,
        "emp_department": user.emp_department,
        "profile_pic": user.profile_pic,
    }
    return response(status.HTTP_200_OK, message="Identity verified", data=data)


@app.get('/auth/sso/status', summary="Whether SSO login is configured (public, no auth)")
def sso_status():
    """Lets the frontend show/hide the SSO button without needing to be authed first."""
    return response(
        status.HTTP_200_OK,
        data={"enabled": sso_configured(), "provider_label": SSO_PROVIDER_LABEL},
    )


@app.get('/auth/sso/login', summary="Redirect to the IdP's authorization endpoint")
def sso_login(next: str = "/"):
    if not sso_configured():
        raise HTTPException(status_code=404, detail="SSO is not configured")
    state = secrets.token_urlsafe(24)
    try:
        url = build_authorize_url(state, next)
    except Exception:
        logger.exception("Failed building SSO authorize URL")
        raise HTTPException(status_code=502, detail="Could not reach identity provider")
    return RedirectResponse(url)


@app.get('/auth/sso/callback', summary="OIDC authorization-code callback")
def sso_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db=Depends(get_db),
):
    """Exchanges the code, verifies the id_token, and maps its email claim onto an existing
    `users` row (admin-provisioned only — see sso_util's module docstring for why this never
    auto-creates an account). On success, issues the same Redis/DB session /login does and
    redirects to the frontend with the token in a URL *fragment* (never sent to the server,
    unlike a query param) so the frontend can pick it up client-side, matching the
    `state={{from}}` deep-link-return pattern ProtectedRoute already uses."""
    frontend_base = os.getenv("FRONTEND_APP_URL", "http://localhost:5173/").rstrip("/")

    def _redirect_with_error(reason: str) -> RedirectResponse:
        return RedirectResponse(f"{frontend_base}/login?sso_error={quote(reason)}")

    if error:
        return _redirect_with_error(error)
    if not code or not state:
        return _redirect_with_error("missing_code_or_state")

    next_path = consume_state(state)
    if next_path is None:
        return _redirect_with_error("invalid_or_expired_state")

    try:
        claims = exchange_code_and_verify(code)
    except Exception:
        logger.exception("SSO token exchange/verification failed")
        return _redirect_with_error("token_verification_failed")

    email = (claims.get("email") or "").strip().lower()
    if not email:
        return _redirect_with_error("no_email_claim")

    user = db.query(UserModel).filter(func.lower(UserModel.emp_email) == email).first()
    if not user:
        return _redirect_with_error("no_matching_account")

    foundation = db.query(Foundation).filter(Foundation.emp_id == user.emp_id).first()
    if not foundation:
        # A Foundation row still holds the session token; local password login stays
        # unavailable for a pure-SSO user until they separately set one via /register.
        foundation = Foundation(emp_id=user.emp_id, password=hash_password(secrets.token_hex(32)))
        db.add(foundation)

    token = secrets.token_hex(16)
    foundation.token = token
    foundation.last_active_at = utc_now()
    db.commit()
    session_set(token, user.emp_id)

    safe_next = next_path if next_path.startswith("/") else "/"
    return RedirectResponse(f"{frontend_base}{safe_next}#sso_token={token}")


@app.get('/auth/me', summary="Fetch the caller's own user record for the given token")
def auth_me(current_user=Depends(verify_token)):
    """The SSO redirect only carries a token (in a URL fragment, so it never touches the
    server or logs) — the frontend calls this once to hydrate `currentUser`, mirroring what
    /login and /register already return inline for the password flow."""
    user_data = UserRead.from_orm(current_user).dict()
    if "token" in user_data:
        del user_data["token"]
    return response(status.HTTP_200_OK, message="OK", data=user_data)


@app.post('/logout', status_code=200, summary="Invalidate the current session token")
def logout(authorization: str | None = Header(None), db=Depends(get_db)):
    """Drops the Redis session (if any) and clears the DB-fallback token."""
    if not authorization:
        # If no token, just say logged out or error? Usually success if already "gone" logic, but checking token is safer.
        return response(status.HTTP_401_UNAUTHORIZED, message="Missing Token")

    if authorization.startswith("Bearer "):
        token = authorization.replace("Bearer ", "")
    elif authorization.startswith("Token "):
        token = authorization.replace("Token ", "")
    else:
        token = authorization

    # Drop the Redis session and clear the DB fallback token.
    session_delete(token)

    foundation = db.query(Foundation).filter(Foundation.token == token).first()
    if foundation:
        foundation.token = None # Mark as null/expired
        db.commit()

    return response(status.HTTP_200_OK, message="Logout successful")


@app.post('/user', status_code=201, summary="Create a user (admin, or a dept_admin within their own department)")
def create_user(user: UserCreate, db=Depends(get_db), current_user=Depends(require_user_admin)):
     """Creates the User row plus its Foundation (credentials) row, defaulting the
     password to "123456" if none is supplied.

     A `dept_admin` (scale-gaps-plan.md Phase 3, item 3) may only create users in their OWN
     `emp_department`, may never grant `special_role`, and may never create/promote someone
     into the rank>=EM management tier (that would let a department-scoped grant mint a new
     org-wide admin) — a full (rank-based) admin is unrestricted on all three."""
     if not perms.can_manage_department(current_user, user.emp_department):
         raise HTTPException(
             status_code=403,
             detail="Department admins may only create users in their own department.",
         )
     if user.special_role and not perms.can_grant_special_role(current_user):
         raise HTTPException(status_code=403, detail="Only a full admin may grant a special_role.")
     if not perms.can_assign_designation(current_user, user.emp_designation):
         raise HTTPException(
             status_code=403,
             detail="Department admins may not create or promote a user into the management tier.",
         )

     # Check uniqueness by emp_id
     existing = db.query(UserModel).filter(UserModel.emp_id == user.emp_id).first()
     if existing:
         raise HTTPException(status_code=400, detail="User with emp_id already exists")

     existing = db.query(UserModel).filter(UserModel.emp_email == user.emp_email).first()
     if existing:
         raise HTTPException(status_code=400, detail="User with emp_email already exists")

     if user.manager_id:
         validate_manager_hierarchy(db, user.manager_id, user.emp_designation, user.emp_id)

     db_user = UserModel(
         emp_name=user.emp_name,
         emp_id=user.emp_id,
         emp_email=user.emp_email,
         emp_phone=user.emp_phone,
         emp_designation=user.emp_designation,
         emp_department=user.emp_department,
         emp_hierarchy=user.emp_hierarchy,
         manager_id=user.manager_id,
         # Enriched HRIS profile
         company=user.company,
         legal_entity=user.legal_entity,
         gender=user.gender,
         work_location=user.work_location,
         date_of_joining=user.date_of_joining,
         date_of_birth=user.date_of_birth,
         blood_group=user.blood_group,
         payscale=user.payscale,
         education=user.education,
         linkedin=user.linkedin,
         profile_pic=user.profile_pic,
         skills=user.skills,
         timezone=user.timezone,
         special_role=user.special_role,
     )
     db.add(db_user)
     # Without this, Foundation's insert (below) can reach Postgres before this User's own
     # insert despite being add()ed second — SQLAlchemy doesn't guarantee cross-mapper flush
     # order from add() order alone — and Foundation.emp_id's FK requires the User row to
     # already exist. Was a real bug, only surfaced against real Postgres (SQLite, what the
     # test suite runs against, doesn't enforce FK constraints by default).
     db.flush()

     # Create Foundation Entry
     # Use provided password or default "123456" — always stored hashed.
     pwd = user.password if user.password else "123456"
     foundation_entry = Foundation(
         emp_id=user.emp_id,
         password=hash_password(pwd),
         token=None
     )
     db.add(foundation_entry)

     record_audit(
         db, current_user, "user.create",
         target_type="user", target_id=db_user.emp_id,
         details={"emp_name": db_user.emp_name, "emp_designation": db_user.emp_designation,
                  "manager_id": db_user.manager_id},
     )

     db.commit()
     db.refresh(db_user)
     logger.info("User created: %s", {
         "id": db_user.id,
         "emp_id": db_user.emp_id,
         "emp_email": db_user.emp_email,
     })

     data = UserRead.from_orm(db_user).dict()
     return response(status_code=status.HTTP_201_CREATED, message="User created successfully", data=data)


@app.get('/user', summary="List users (org directory or a subordinate subtree)")
def get_users(user_id: str | None = None, db=Depends(get_db), current_user=Depends(verify_token)):
    """Without user_id: every user in the company. With user_id: that user's recursive
    subordinates. Admins get the full HRIS-enriched record; everyone else gets a
    stripped directory view (no DOB/phone/etc.)."""
    if user_id:
        # Check if user exists (optional, but good for validation)
        # root_user = db.query(UserModel).filter(UserModel.emp_id == user_id).first()
        
        # Get all subordinates recursively (naturally excludes the user_id itself)
        subordinate_ids = get_all_subordinates(db, user_id)
        
        users = db.query(UserModel).filter(UserModel.emp_id.in_(subordinate_ids)).all()
    else:
        # Default behavior: fetch all users (or could be restricted to current_user scope if desired later)
        users = db.query(UserModel).all()

    # The directory listing is open to every authenticated user (org chart + the
    # any-to-any assignee picker need the full company directory), so it must not carry
    # personal HRIS fields (DOB, blood group, phone, education, …) for non-admins.
    # Admins get the full enriched UserRead, since UserManagementPage (admin-only,
    # SUPER_ADMIN_ROLES-gated) edits email/phone/etc. through this same endpoint. dept_admin/
    # auditor also get it — both need the enriched shape to do their (scoped or read-only)
    # job on the same page (scale-gaps-plan.md Phase 3, item 3).
    schema = UserRead if perms.can_view_admin_surfaces(current_user) else UserDirectory
    data = [schema.from_orm(user).dict() for user in users]
    return response(status.HTTP_200_OK, message="Users fetched successfully", data=data)


@app.put('/profile', status_code=200)
def update_own_profile(payload: ProfileSelfUpdate, db=Depends(get_db), current_user=Depends(verify_token)):
    """A user edits their OWN profile — contact/personal fields only. Org-controlled fields
    (emp_id, designation, department, manager) are NOT editable here (admins use PUT /user)."""
    db_user = db.query(UserModel).filter(UserModel.emp_id == current_user.emp_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(db_user, field, value)
    db.commit()
    db.refresh(db_user)
    return response(status.HTTP_200_OK, message="Profile updated", data=UserRead.from_orm(db_user).dict())


@app.put('/user/{emp_id}', status_code=200, summary="Update any user's profile (admin only)")
def update_user(emp_id: str, user_update: UserUpdate, db=Depends(get_db), current_user=Depends(require_user_admin)):
    """Edits org-controlled fields (designation, department, manager, etc.) — contrast with
    PUT /profile, which lets a user edit only their own contact/personal fields.

    A `dept_admin` may only touch users currently in their own department, may not move a
    user OUT of that department, may never change `special_role`, and may never promote
    someone into the rank>=EM management tier — a full admin is unrestricted (scale-gaps-plan.md
    Phase 3, item 3)."""
    db_user = db.query(UserModel).filter(UserModel.emp_id == emp_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    if not perms.can_manage_department(current_user, db_user.emp_department):
        raise HTTPException(
            status_code=403,
            detail="Department admins may only manage users in their own department.",
        )
    if user_update.emp_department is not None and user_update.emp_department != db_user.emp_department:
        if not perms.can_manage_department(current_user, user_update.emp_department):
            raise HTTPException(
                status_code=403,
                detail="Department admins may not move a user out of their own department.",
            )
    if "special_role" in user_update.model_fields_set and not perms.can_grant_special_role(current_user):
        raise HTTPException(status_code=403, detail="Only a full admin may change special_role.")
    if user_update.emp_designation is not None and not perms.can_assign_designation(
        current_user, user_update.emp_designation
    ):
        raise HTTPException(
            status_code=403,
            detail="Department admins may not promote a user into the management tier.",
        )

    # Snapshot the fields worth auditing before mutating, so the audit-log entry can name
    # exactly what changed (role/manager changes are the ones scale-gaps-plan.md calls out
    # specifically, but any of these drifting silently is the actual compliance gap).
    _audit_tracked_fields = (
        "emp_name", "emp_email", "emp_designation", "emp_department", "manager_id", "special_role",
    )
    _before = {f: getattr(db_user, f) for f in _audit_tracked_fields}

    # Validate uniqueness if changing emp_id
    if user_update.emp_id and user_update.emp_id != emp_id:
        existing_user = db.query(UserModel).filter(UserModel.emp_id == user_update.emp_id).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="New emp_id already exists")
    
    # Validate uniqueness if changing emp_email
    if user_update.emp_email and user_update.emp_email != db_user.emp_email:
        existing_email = db.query(UserModel).filter(UserModel.emp_email == user_update.emp_email).first()
        if existing_email:
            raise HTTPException(status_code=400, detail="New emp_email already exists")

    # Validate manager if changed
    if user_update.manager_id and user_update.manager_id != db_user.manager_id:
         # Check hierarchy with Current designation (or new if provided)
         designation = user_update.emp_designation or db_user.emp_designation
         validate_manager_hierarchy(db, user_update.manager_id, designation, db_user.emp_id)

    # Update fields if provided
    if user_update.emp_name is not None:
        db_user.emp_name = user_update.emp_name
    if user_update.emp_id is not None:
        db_user.emp_id = user_update.emp_id
    if user_update.emp_email is not None:
        db_user.emp_email = user_update.emp_email
    if user_update.emp_phone is not None:
        db_user.emp_phone = user_update.emp_phone
    if user_update.emp_designation is not None:
        db_user.emp_designation = user_update.emp_designation
    if user_update.emp_department is not None:
        db_user.emp_department = user_update.emp_department
    if user_update.emp_hierarchy is not None:
        db_user.emp_hierarchy = user_update.emp_hierarchy
    if user_update.manager_id is not None:
        db_user.manager_id = user_update.manager_id
    if user_update.skills is not None:
        db_user.skills = user_update.skills
    if user_update.timezone is not None:
        db_user.timezone = user_update.timezone
    # `special_role` uses explicit-field-set (not `is not None`) so sending it as `null` can
    # actually REVOKE a grant — the only field here where "clear it back out" needs to be
    # reachable at all (a dept_admin/auditor grant that can only ever be added, never
    # removed, isn't a real permission boundary).
    if "special_role" in user_update.model_fields_set:
        db_user.special_role = user_update.special_role

    changed = {
        f: {"before": _before[f], "after": getattr(db_user, f)}
        for f in _audit_tracked_fields
        if _before[f] != getattr(db_user, f)
    }
    if changed:
        record_audit(db, current_user, "user.update", target_type="user", target_id=emp_id, details=changed)

    try:
        db.commit()
        db.refresh(db_user)
    except SQLAlchemyError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Database update failed: {e!s}")

    data = UserRead.from_orm(db_user).dict()
    # Ensure token is not returned or handled appropriately if needed (usually not needed in update profile response unless refreshed)
    if "token" in data:
        del data["token"]


    return response(status.HTTP_200_OK, message="User updated successfully", data=data)


@app.delete('/user/{emp_id}', status_code=200, summary="Delete a user (admin only)")
def delete_user(emp_id: str, db=Depends(get_db), current_user=Depends(require_user_admin)):
    """Removes the User row and its Foundation (credentials) row. A `dept_admin` may only
    delete users in their own department (scale-gaps-plan.md Phase 3, item 3)."""
    # Check if user exists
    db_user = db.query(UserModel).filter(UserModel.emp_id == emp_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    if not perms.can_manage_department(current_user, db_user.emp_department):
        raise HTTPException(
            status_code=403,
            detail="Department admins may only delete users in their own department.",
        )

    # Check/Delete Foundation entry
    foundation = db.query(Foundation).filter(Foundation.emp_id == emp_id).first()
    if foundation:
        db.delete(foundation)

    record_audit(
        db, current_user, "user.delete", target_type="user", target_id=emp_id,
        details={"emp_name": db_user.emp_name, "emp_designation": db_user.emp_designation},
    )

    db.delete(db_user)

    try:
        db.commit()
    except SQLAlchemyError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Database deletion failed: {e!s}")


    return response(status.HTTP_200_OK, message="User deleted successfully", data={"deleted_id": emp_id})

class BulkDeleteUsersRequest(BaseModel):
    emp_ids: list[str]

@app.post('/users/bulk-delete', status_code=200, summary="Delete multiple users at once (admin only)")
def bulk_delete_users(payload: BulkDeleteUsersRequest, db=Depends(get_db), current_user=Depends(require_user_admin)):
    """Deletes the given emp_ids' User + Foundation rows in bulk. A `dept_admin` may only
    bulk-delete users who are ALL in their own department — one out-of-scope id 403s the
    whole batch rather than silently dropping it (scale-gaps-plan.md Phase 3, item 3)."""
    if not payload.emp_ids:
         raise HTTPException(status_code=400, detail="No emp_ids provided")

    if not perms.is_admin(current_user):
        targets = db.query(UserModel).filter(UserModel.emp_id.in_(payload.emp_ids)).all()
        out_of_scope = [
            u.emp_id for u in targets if not perms.can_manage_department(current_user, u.emp_department)
        ]
        if out_of_scope:
            raise HTTPException(
                status_code=403,
                detail=f"Department admins may only delete users in their own department "
                       f"(out of scope: {', '.join(out_of_scope)}).",
            )

    record_audit(
        db, current_user, "user.bulk_delete", target_type="user",
        details={"emp_ids": payload.emp_ids, "count": len(payload.emp_ids)},
    )

    # 1. Delete Foundation Entries
    db.query(Foundation).filter(Foundation.emp_id.in_(payload.emp_ids)).delete(synchronize_session=False)

    # 2. Delete Users
    # We want to know how many were deleted, but bulk delete usually returns count
    result = db.query(UserModel).filter(UserModel.emp_id.in_(payload.emp_ids)).delete(synchronize_session=False)
    
    try:
        db.commit()
    except SQLAlchemyError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Database bulk deletion failed: {e!s}")

    return response(status.HTTP_200_OK, message="Bulk delete successful", data={"deleted_count": result})


@app.get('/audit-log', summary="Org-wide admin action log (admin only)")
def get_audit_log(
    action: str | None = None,
    actor_emp_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
    db=Depends(get_db),
    current_user=Depends(require_admin_or_auditor),
):
    """Newest first. `action`/`actor_emp_id` are exact-match filters (e.g. `action=user.delete`)
    — this is an audit trail, not a search index, so no free-text matching. `limit` capped at
    500 so a careless admin request can't pull the entire table in one response."""
    limit = max(1, min(limit, 500))
    query = db.query(AuditLogModel)
    if action:
        query = query.filter(AuditLogModel.action == action)
    if actor_emp_id:
        query = query.filter(AuditLogModel.actor_emp_id == actor_emp_id)
    total = query.count()
    rows = query.order_by(AuditLogModel.id.desc()).offset(offset).limit(limit).all()
    data = [AuditLogRead.from_orm(row).dict() for row in rows]
    return response(
        status.HTTP_200_OK, message="Audit log fetched successfully",
        data={"entries": data, "total": total, "limit": limit, "offset": offset},
    )


@app.post('/tasks', status_code=201, summary="Create a task")
def create_task(task: TaskCreate, db=Depends(get_db), current_user=Depends(verify_token)):
    """Creates a task, appending it to the assignee's timeline (after their current active
    queue) unless an explicit future date was given, then notifies the assignee."""

    # Generate Task ID if not provided
    if not task.id:
        task.id = secrets.token_hex(8)

    existing = db.query(TaskModel).filter(TaskModel.id == task.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Task with this ID already exists")

    # Human-facing ticket reference, e.g. "T-38291". Retried on the (rare) collision since
    # it's a 5-digit space and must stay unique.
    ticket_id = f"T-{secrets.randbelow(100000):05d}"
    while db.query(TaskModel).filter(TaskModel.ticket_id == ticket_id).first():
        ticket_id = f"T-{secrets.randbelow(100000):05d}"

    if task.task_duration == "0":
        raise HTTPException(status_code=400, detail="Task duration cannot be 0")

    if not task.task_assigned_to:
        raise HTTPException(status_code=400, detail="Task must be assigned to a user")

    assigned_user = db.query(UserModel).filter(UserModel.emp_id == task.task_assigned_to).first()
    if not assigned_user:
        raise HTTPException(status_code=400, detail="Assigned user not found")

    # Authorization: non-admins may only assign to self or a subordinate (backend
    # enforcement of the frontend's "assignee locking").
    if not perms.can_assign_task_to(db, current_user, task.task_assigned_to):
        raise HTTPException(status_code=403, detail="Not authorized to assign a task to this user")

    # Validate Rank Logic
    validate_assignee_eligibility(assigned_user)

    if task.epic_id and not db.query(EpicModel).filter(EpicModel.id == task.epic_id).first():
        raise HTTPException(status_code=400, detail="Epic not found")
    if task.sprint_id and not db.query(SprintModel).filter(SprintModel.id == task.sprint_id).first():
        raise HTTPException(status_code=400, detail="Sprint not found")

    # Logic to Append New Task to End of Timeline
    # If the user provides a task assigned date that is effectively "now" (default), we want to append it to the end of the existing queue.
    # Otherwise, it might insert itself in the middle of active tasks.
    
    # 1. Fetch active tasks for this user
    active_tasks = db.query(TaskModel).filter(
        TaskModel.task_assigned_to == task.task_assigned_to,
        TaskModel.task_status.notin_(["done", "completed", "backlog", "Done", "Completed", "Backlog", "on-hold", "on hold", "On-Hold", "On Hold"])
    ).all()

    # 2. Find the latest end time
    max_end_time = utc_now()
    has_active_tasks = False

    for t in active_tasks:
        t_start = parse_dt(t.task_assigned_date)
        if t_start:
            t_dur = parse_duration(t.task_duration)
            t_end = t_start + timedelta(hours=t_dur)

            if t_end > max_end_time:
                max_end_time = t_end
                has_active_tasks = True
    
    # 3. Determine if we should override the incoming date
    # Only override if the incoming date is roughly "Now" (or earlier).
    # If the user explicitly scheduled it for next week, we shouldn't move it to today.
    should_append = False
    incoming_date = parse_dt(task.task_assigned_date)

    if incoming_date:
        # If the incoming date is before the end of the active queue, append instead of
        # overlapping. (Explicit future scheduling is left where the user put it.)
        if has_active_tasks and incoming_date < max_end_time:
            should_append = True
    else:
        should_append = True

    final_assigned_date = task.task_assigned_date
    if should_append and has_active_tasks:
        final_assigned_date = max_end_time

    db_task = TaskModel(
        id=task.id,
        ticket_id=ticket_id,
        task_name=task.task_name,
        task_description=task.task_description,
        task_status=task.task_status,
        task_assigned_to=task.task_assigned_to,
        task_assigned_by=task.task_assigned_by,
        task_assigned_date=final_assigned_date,
        task_due_date=task.task_due_date,
        task_priority=task.task_priority,
        task_tags=task.task_tags,
        task_notes=task.task_notes,
        task_created_at=task.task_created_at,
        task_updated_at=task.task_updated_at,
        task_duration=task.task_duration,
        time_spent=task.time_spent,
        completed_at=task.completed_at,
        epic_id=task.epic_id,
        sprint_id=task.sprint_id,
    )
    db.add(db_task)
    db.commit()
    db.refresh(db_task)

    # Save any images picked before the task existed (create-flow staged attachments), so they
    # land in the DB before notify() below queries them for the assignment email — avoids the
    # create -> notify -> separate-upload race where attachments always arrived too late.
    if task.attachments:
        for item in task.attachments:
            row = build_task_attachment(db_task.id, current_user.emp_id, item, strict=False)
            if row:
                db.add(row)
        db.commit()

    # Subtasks staged in the create modal — created as one atomic batch (all N subtasks +
    # their subtask-links succeed together or none do). A failure here doesn't roll back the
    # parent: the story existing without its subtasks is recoverable (retry from the detail
    # view's own "+ Add dependency"-style subtask affordance), unlike the parent never
    # existing at all — so it's surfaced as a warning on the response, not a 500.
    subtask_warning = None
    if task.subtasks:
        if len(task.subtasks) > MAX_SUBTASKS_PER_REQUEST:
            raise HTTPException(
                status_code=400,
                detail=f"Too many subtasks in one request (max {MAX_SUBTASKS_PER_REQUEST}) — "
                "add the rest from the task detail view once it's created.",
            )
        try:
            created = [  # (subtask_id, assignee_emp_id, subtask_name)
                create_subtask_row(db, sub, db_task, current_user) for sub in task.subtasks
            ]
            recompute_subtask_counters(db, db_task.id)
            db.commit()
            db.refresh(db_task)

            for sub_id, sub_assignee_id, sub_name in created:
                if sub_assignee_id != current_user.emp_id:
                    notify(
                        db, sub_assignee_id, "assigned",
                        f"{current_user.emp_name} assigned you a subtask: {sub_name}",
                        task_id=sub_id, actor_name=current_user.emp_name,
                    )
            for distinct_assignee in {a for _, a, _ in created}:
                realign_user_tasks(db, distinct_assignee)
            if created:
                db.commit()
        except (ValueError, SQLAlchemyError) as e:
            db.rollback()
            db.refresh(db_task)
            subtask_warning = str(e)

    # Notify the assignee (unless they created it themselves).
    if db_task.task_assigned_to and db_task.task_assigned_to != current_user.emp_id:
        notify(
            db,
            db_task.task_assigned_to,
            "assigned",
            f"{current_user.emp_name} assigned you a task: {db_task.task_name}",
            task_id=db_task.id,
            actor_name=current_user.emp_name,
        )
        db.commit()

    # Realign Timeline
    realign_user_tasks(db, task.task_assigned_to)

    notify_change()
    data = TaskRead.from_orm(db_task).dict()
    if subtask_warning:
        data["subtask_warning"] = (
            f"Task created, but one or more subtasks failed: {subtask_warning}"
        )
    return response(status_code=status.HTTP_201_CREATED, message="Task created successfully", data=data)


@app.get('/tasks')
def get_tasks(
    user_id: str | None = None,
    page: int | None = None,
    page_size: int | None = None,
    department: str | None = None,
    db=Depends(get_db),
    current_user=Depends(verify_token)
):
    """
    Get tasks.
    - If user_id is NOT provided: Returns tasks for Current User + Subordinates (if applicable).
    - If user_id IS provided: Returns tasks for Target User + Target User's Subordinates (if applicable).
      (Only if Current User has permission to view Target User).
    - Supports Pagination: pass 'page' and 'page_size' query params.
    - `department` (optional): filter to tasks whose ASSIGNEE is in that department — a
      first-class cross-cutting filter alongside org-tree scoping (scale-gaps-plan.md §B.2),
      since org-tree scope alone can't answer "all Payments team work" across managers'
      subtrees. Applied on top of, not instead of, the caller's view scope below.
    """
    
    # 1. Determine Access Scope of Current User
    # What is the MAX set of users this person is allowed to see data for?
    current_user_scope = get_user_view_scope(db, current_user.emp_id)
    
    # 2. Determine the Root of the Query
    target_root_id = user_id if user_id else current_user.emp_id
    
    # 3. Security Check
    # Ensure current user is allowed to view the target root user
    if target_root_id not in current_user_scope:
         # If trying to view someone outside their hierarchy, deny access (return empty)
         return response(status.HTTP_200_OK, message="Tasks fetched successfully", data=[])

    # 4. Calculate the Final Display Scope
    # We want the tree *rooted* at target_root_id
    display_scope = get_user_view_scope(db, target_root_id)
    
    query = db.query(TaskModel).filter(TaskModel.task_assigned_to.in_(display_scope))

    if department:
        dept_emp_ids = {
            eid for (eid,) in db.query(UserModel.emp_id)
            .filter(UserModel.emp_department == department).all()
        }
        query = query.filter(TaskModel.task_assigned_to.in_(dept_emp_ids))

    # Pagination Logic
    if page is not None and page_size is not None:
        total_count = query.count()
        offset = (page - 1) * page_size
        tasks = query.offset(offset).limit(page_size).all()
        
        # Serialize
        items = [TaskRead.from_orm(t).dict() for t in tasks]
        
        data = {
            "items": items,
            "total": total_count,
            "page": page,
            "page_size": page_size,
            "total_pages": (total_count + page_size - 1) // page_size if page_size > 0 else 0
        }
    else:
        # Full Data
        tasks = query.all()
        data = [TaskRead.from_orm(t).dict() for t in tasks]

    return response(status.HTTP_200_OK, message="Tasks fetched successfully", data=data)


@app.post(
    '/tasks/{task_id}/subtasks', status_code=201,
    summary="Add a subtask to an already-existing task",
)
def add_subtask(
    task_id: str, sub: SubtaskCreate, db=Depends(get_db), current_user=Depends(verify_token)
):
    """Creates one subtask immediately against a task that already exists — the common case at
    real-org scale (scope usually grows after a story is created, not all upfront). Unlike the
    bulk `subtasks` field on `POST /tasks` (which has to stage everything for one atomic create
    since the parent doesn't exist yet), this parent already exists, so there's nothing to stage:
    the subtask is created and linked in one request, with its own real id/ticket_id — not the
    "NEW" placeholder the create-modal shows pre-submission."""
    parent = db.query(TaskModel).filter(TaskModel.id == task_id).with_for_update().first()
    if not parent:
        raise HTTPException(status_code=404, detail="Task not found")

    if not perms.can_modify_task(db, current_user, parent):
        raise HTTPException(status_code=403, detail="Not authorized to modify this task")

    # Depth guard: capped at 2 levels (story -> subtask), so progress rollup never needs a
    # recursive query. A brand-new subtask can't already have children of its own, so the only
    # check that applies is "is the parent itself already someone else's subtask?".
    parent_has_its_own_parent = db.query(TaskLinkModel).filter(
        TaskLinkModel.from_task_id == task_id, TaskLinkModel.link_type == "subtask",
    ).first()
    if parent_has_its_own_parent:
        raise HTTPException(
            status_code=409,
            detail="That task is already a subtask of another task — subtasks can't be nested",
        )

    try:
        sub_id, sub_assignee_id, sub_name = create_subtask_row(db, sub, parent, current_user)
        recompute_subtask_counters(db, parent.id)
        db.commit()
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    sub_row = db.query(TaskModel).filter(TaskModel.id == sub_id).first()
    if sub_assignee_id != current_user.emp_id:
        notify(
            db, sub_assignee_id, "assigned",
            f"{current_user.emp_name} assigned you a subtask: {sub_name}",
            task_id=sub_id, actor_name=current_user.emp_name,
        )
        db.commit()
    realign_user_tasks(db, sub_assignee_id)

    notify_change()
    data = TaskRead.from_orm(sub_row).dict()
    return response(status.HTTP_201_CREATED, message="Subtask added", data=data)


@app.put('/tasks/{task_id}', summary="Replace a task's editable fields")
def update_task(task_id: str, task: TaskCreate, db=Depends(get_db), current_user=Depends(verify_token)):
    """Full-record update (name/description/status/assignee/dates/etc.). Status changes here
    also drive session start/stop and timeline realignment, same as PATCH .../status."""
    db_task = db.query(TaskModel).filter(TaskModel.id == task_id).with_for_update().first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Authorization: caller must be able to modify this task (checked against the
    # CURRENT assignee, before any reassignment below).
    if not perms.can_modify_task(db, current_user, db_task):
        raise HTTPException(status_code=403, detail="Not authorized to modify this task")

    if task.task_duration == "0":
        raise HTTPException(status_code=400, detail="Task duration cannot be 0")

    if not task.task_assigned_to:
        raise HTTPException(status_code=400, detail="Task must be assigned to a user")

    assigned_user = db.query(UserModel).filter(UserModel.emp_id == task.task_assigned_to).first()
    if not assigned_user:
            raise HTTPException(status_code=400, detail="Assigned user not found")

    # If reassigning to a different user, the caller must be allowed to assign to them.
    if task.task_assigned_to != db_task.task_assigned_to and not perms.can_assign_task_to(
        db, current_user, task.task_assigned_to
    ):
        raise HTTPException(status_code=403, detail="Not authorized to assign a task to this user")

    # Validate Rank Logic
    validate_assignee_eligibility(assigned_user)

    if task.epic_id and not db.query(EpicModel).filter(EpicModel.id == task.epic_id).first():
        raise HTTPException(status_code=400, detail="Epic not found")
    if task.sprint_id and not db.query(SprintModel).filter(SprintModel.id == task.sprint_id).first():
        raise HTTPException(status_code=400, detail="Sprint not found")

    # Capture old status + assignee before assignments
    old_status = db_task.task_status
    old_assignee = db_task.task_assigned_to

    # Perform Assignments
    db_task.task_name = task.task_name
    db_task.task_description = task.task_description
    db_task.task_status = task.task_status
    db_task.task_assigned_to = task.task_assigned_to
    db_task.task_assigned_by = task.task_assigned_by
    db_task.task_assigned_date = task.task_assigned_date
    db_task.task_due_date = task.task_due_date
    db_task.task_priority = task.task_priority
    db_task.task_tags = task.task_tags
    db_task.task_notes = task.task_notes
    db_task.task_created_at = task.task_created_at
    db_task.task_updated_at = task.task_updated_at
    db_task.task_duration = task.task_duration
    # db_task.time_spent = task.time_spent # Backend manages this
    db_task.completed_at = task.completed_at
    db_task.epic_id = task.epic_id
    db_task.sprint_id = task.sprint_id
    
    # Session & Status Logic (Applied AFTER assignments to override if needed)
    if task.task_status:
        new_status = task.task_status
        ns = new_status.lower()
        os_ = (old_status or "").lower()
        was_active = os_ in ["in progress", "in-progress"]
        now_active = ns in ["in progress", "in-progress"]
        is_done = ns in ["done", "completed"]

        # Block completion while dependencies / subtasks are unfinished.
        if is_done and os_ not in ["done", "completed"]:
            blockers = completion_blockers(db, db_task.id)
            if blockers:
                raise HTTPException(
                    status_code=409,
                    detail=f"Finish these first: {', '.join(blockers[:5])}",
                )

        # If changing TO in-progress (pick / resume)
        if now_active and not was_active:
            start_new_session(db, db_task, status_label="in-progress")
            # Restart BOTH clocks from NOW so the schedule slot (assigned_date) and the overdue
            # sweeper (updated_at) measure from the same instant.
            db_task.task_assigned_date = utc_now()
            db_task.task_updated_at = utc_now()

        # If changing FROM in-progress TO anything else — a PAUSE and a COMPLETION differ.
        elif was_active and not now_active:
            close_current_session(db_task, completion_status="completed" if is_done else "on-hold")
            db_task.task_updated_at = utc_now()

        # If returning from Backlog to Todo (Active)
        if os_ == "backlog" and ns == "todo":
             db_task.task_assigned_date = utc_now()
             db_task.task_updated_at = utc_now()

        # Own completion timestamp server-side (frontend now sends status only).
        if is_done:
             close_current_session(db_task, completion_status="completed")
             db_task.completed_at = utc_now()
        elif os_ in ["done", "completed"]:
             db_task.completed_at = None

        # Activity log (status change only)
        if os_ != ns:
            add_activity(
                db, db_task.id, current_user.emp_id, current_user.emp_name,
                f"Status: {old_status or '—'} → {task.task_status}",
            )
            sync_parent_after_child_status_change(db, db_task, current_user)

    # IMPORTANT: Do NOT blindly overwrite task_sessions from frontend if backend logic is active
    # The frontend is sending the OLD session list which overrides the new session we just created above!
    # db_task.task_sessions = task.task_sessions
    
    # Realign Timeline
    realign_user_tasks(db, db_task.task_assigned_to)

    # Notify on reassignment (new assignee, not self-assignment).
    if (
        db_task.task_assigned_to
        and db_task.task_assigned_to != old_assignee
        and db_task.task_assigned_to != current_user.emp_id
    ):
        notify(
            db,
            db_task.task_assigned_to,
            "reassigned",
            f"{current_user.emp_name} assigned you a task: {db_task.task_name}",
            task_id=db_task.id,
            actor_name=current_user.emp_name,
        )

    db.commit()
    db.refresh(db_task)

    notify_change()
    data = TaskRead.from_orm(db_task).dict()
    return response(status_code=status.HTTP_200_OK, message="Task updated successfully", data=data)


@app.patch('/tasks/{task_id}/status', status_code=200, summary="Change a task's status")
def update_task_status(task_id: str, status_update: TaskStatusUpdate, db=Depends(get_db), current_user=Depends(verify_token)):
    """Lightweight status-only transition (todo/in-progress/on-hold/done/backlog). Opens or
    closes a work session as needed and blocks completion while dependencies are unfinished."""
    db_task = db.query(TaskModel).filter(TaskModel.id == task_id).with_for_update().first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Authorization: assignee, assigner, admin, or a manager of the assignee.
    if not perms.can_modify_task(db, current_user, db_task):
        raise HTTPException(status_code=403, detail="Not authorized to modify this task")

    # Session Logic
    if status_update.task_status:
        new_status = status_update.task_status
        old_status = db_task.task_status
        ns = new_status.lower()
        os_ = (old_status or "").lower()
        was_active = os_ in ["in progress", "in-progress"]
        now_active = ns in ["in progress", "in-progress"]
        is_done = ns in ["done", "completed"]

        # Block completion while dependencies / subtasks are unfinished.
        if is_done and os_ not in ["done", "completed"]:
            blockers = completion_blockers(db, db_task.id)
            if blockers:
                raise HTTPException(
                    status_code=409,
                    detail=f"Finish these first: {', '.join(blockers[:5])}",
                )

        # If changing TO in-progress (pick / resume)
        if now_active and not was_active:
            start_new_session(db, db_task, status_label="in-progress")
            # Restart the schedule slot from NOW.
            db_task.task_assigned_date = utc_now()

        # If changing FROM in-progress TO anything else — a PAUSE and a COMPLETION differ.
        elif was_active and not now_active:
            close_current_session(db_task, completion_status="completed" if is_done else "on-hold")

        # If returning from Backlog to Todo (Active)
        if os_ == "backlog" and ns == "todo":
             db_task.task_assigned_date = utc_now()

        # Update updated_at (keeps the overdue sweeper anchored with the schedule slot)
        db_task.task_updated_at = utc_now()

        if is_done:
             # Ensure sessions are closed (safe if already closed above). Label "completed"
             # (not "done") to match the session status vocabulary the scheduler expects.
             close_current_session(db_task, completion_status="completed")
             db_task.completed_at = utc_now()
        else:
             # Moving out of / not in done state — clear completion timestamp.
             db_task.completed_at = None

        # Persist the status change itself (was previously only driving session logic).
        db_task.task_status = new_status

        # Activity log
        if os_ != ns:
            add_activity(
                db, db_task.id, current_user.emp_id, current_user.emp_name,
                f"Status: {old_status or '—'} → {new_status}",
            )
            sync_parent_after_child_status_change(db, db_task, current_user)

    # Realign Timeline
    realign_user_tasks(db, db_task.task_assigned_to)

    try:
        db.commit()
        db.refresh(db_task)
    except SQLAlchemyError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Database update failed: {e!s}")

    notify_change()
    data = TaskRead.from_orm(db_task).dict()
    return response(status.HTTP_200_OK, message="Task status updated successfully", data=data)


@app.delete('/tasks/{task_id}', status_code=200, summary="Delete a task")
def delete_task(
    task_id: str, cascade: bool = False, db=Depends(get_db), current_user=Depends(verify_token)
):
    """Permanently removes the task (its comments/links/attachments cascade per the DB schema).
    If it has subtasks, refuses unless `cascade=true` — deleting a story silently orphaning
    its subtasks (or silently deleting collaborators' work) would surprise whoever owns them."""
    db_task = db.query(TaskModel).filter(TaskModel.id == task_id).with_for_update().first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Authorization: assignee, assigner, admin, or a manager of the assignee.
    if not perms.can_modify_task(db, current_user, db_task):
        raise HTTPException(status_code=403, detail="Not authorized to delete this task")

    # Check real task_links rows, not the denormalized subtask_total column — the column can
    # drift stale (e.g. a subtask deleted directly, elsewhere, without going through THIS
    # task's own recompute) and a false-positive 409 here is worse than the extra query.
    children = db.query(TaskModel).join(
        TaskLinkModel, TaskLinkModel.from_task_id == TaskModel.id
    ).filter(
        TaskLinkModel.to_task_id == task_id, TaskLinkModel.link_type == "subtask"
    ).all()

    if children and not cascade:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{len(children)} subtask(s) depend on this — "
                "delete them first or pass ?cascade=true"
            ),
        )
    if cascade and children:
        # Notify each subtask's assignee before deleting — someone may have logged real work
        # (time_spent, sessions) on it; silently vanishing that without a word is the kind of
        # thing that reads as a bug report at any org size. task_id=None (not the child's own
        # id) since there's nothing left to deep-link into once it's gone.
        for child in children:
            if child.task_assigned_to and child.task_assigned_to != current_user.emp_id:
                notify(
                    db, child.task_assigned_to, "subtask_deleted",
                    f"{current_user.emp_name} deleted \"{db_task.task_name}\" — your subtask "
                    f"\"{child.task_name}\" was removed with it.",
                    task_id=None, actor_name=current_user.emp_name,
                )
        if children:
            db.query(TaskModel).filter(
                TaskModel.id.in_([c.id for c in children])
            ).delete(synchronize_session=False)

    # If db_task is itself a subtask, its parent's counters must be recomputed after it's gone —
    # the task_links row referencing it cascades away at the DB level (FK ondelete="CASCADE" on
    # from_task_id), silently, with nothing else to catch it. Read the parent id BEFORE deleting
    # (the link disappears the instant db_task does).
    parent_link = db.query(TaskLinkModel).filter(
        TaskLinkModel.from_task_id == task_id, TaskLinkModel.link_type == "subtask"
    ).first()
    parent_id = parent_link.to_task_id if parent_link else None

    db.delete(db_task)
    if parent_id:
        recompute_subtask_counters(db, parent_id)
    db.commit()

    notify_change()
    return response(status.HTTP_200_OK, message="Task deleted successfully")


@app.get('/health', status_code=200)
def health(db=Depends(get_db)):
    """Liveness + DB connectivity probe (no auth) for load balancers / uptime checks."""
    db_ok = True
    try:
        db.query(UserModel).limit(1).all()
    except SQLAlchemyError:
        db_ok = False
    return response(
        status.HTTP_200_OK,
        message="ok",
        data={"status": "healthy" if db_ok else "degraded", "db": db_ok},
    )


# Statuses that mean "no longer live work" — the same case variants already used by
# create_task/realign_user_tasks/tasks_celery.sweep_overdue_tasks, kept here as a plain
# literal (not imported from the sweeper) so this stays read-only w.r.t. that code.
_CLOSED_TASK_STATUSES = ["done", "completed", "backlog", "Done", "Completed", "Backlog"]
_SWEEPER_EXCLUDED_STATUSES = _CLOSED_TASK_STATUSES + ["on-hold", "on hold", "On-Hold", "On Hold"]


def _count_overdue_tasks(db, emp_ids: set | None = None) -> int:
    """Read-only count of tasks the overdue sweeper (tasks_celery.sweep_overdue_tasks, run
    by Celery Beat — see celery_app.py) would consider overdue right now. Deliberately
    reimplemented rather than calling into the sweeper task, so this metrics endpoint
    (called on every /metrics request, in-process) never touches or depends on the
    Celery task's internals/DB session.

    `emp_ids`, if given, restricts the count to tasks assigned to one of those emp_ids
    (GET /insights uses this to get an org-tree-scoped overdue count; GET /metrics passes
    None for the unscoped, company-wide figure)."""
    now = utc_now()
    overdue = 0
    query = db.query(TaskModel).filter(
        TaskModel.task_status.notin_(_SWEEPER_EXCLUDED_STATUSES)
    )
    if emp_ids is not None:
        query = query.filter(TaskModel.task_assigned_to.in_(emp_ids))
    tasks = query.all()
    for task in tasks:
        if not task.task_duration or task.task_duration == "0":
            continue
        # Actively-worked (open-session) tasks are never overdue, same as the sweeper.
        if any(s.get("end_time") is None for s in (task.task_sessions or [])):
            continue
        due = parse_dt(task.task_due_date)
        if due is not None:
            deadline = due
        else:
            ref_time = parse_dt(task.task_updated_at) or parse_dt(task.task_created_at)
            if not ref_time:
                continue
            remaining_hours = (task.remaining_seconds or 0) / 3600.0
            deadline = ref_time + timedelta(hours=remaining_hours)
        if now > deadline:
            overdue += 1
    return overdue


@app.get('/metrics', status_code=200, summary="Operational metrics for dashboards/alerting")
def metrics(db=Depends(get_db), current_user=Depends(verify_token)):
    """Lightweight JSON metrics: process uptime, DB reachability (same probe as /health), and
    live task/session counts. Auth-gated (any authenticated user) — unlike /health's coarse
    up/down signal, this exposes real task-volume counts drawn from the same tables /tasks
    itself serves, so it does NOT get the no-auth treatment /health has."""
    db_ok = True
    try:
        db.query(UserModel).limit(1).all()
    except SQLAlchemyError:
        db_ok = False

    open_tasks = db.query(TaskModel).filter(
        TaskModel.task_status.notin_(_CLOSED_TASK_STATUSES)
    ).all()
    active_session_count = sum(
        1 for t in open_tasks if any(s.get("end_time") is None for s in (t.task_sessions or []))
    )

    return response(
        status.HTTP_200_OK,
        message="ok",
        data={
            "uptime_seconds": round(time.time() - _process_start_time, 1),
            "db": db_ok,
            "open_task_count": len(open_tasks),
            "active_session_count": active_session_count,
            "overdue_task_count": _count_overdue_tasks(db),
        },
    )


# ---------------------------------------------------------------------------------------
# GET /capacity — per-employee capacity & utilization (foundational data for the future
# "Organization Resource View" / "Team Saturation Heatmap" dashboards described in
# pending.md). Kept as its OWN top-level route rather than folded into /metrics: /metrics
# is unscoped operational data (any authenticated user sees the same company-wide
# uptime/DB/overdue counters — there is no per-caller view), whereas capacity is real
# business data about specific employees' workload, so — like /tasks and /user — it MUST
# be scoped to the caller's org subtree. Nesting it under /metrics would visually imply it
# inherits /metrics's "no scoping" semantics, which would be actively misleading.
#
# Business-day window: BUSINESS_START_HOUR..BUSINESS_END_HOUR (task_helpers.py). Only
# BUSINESS_END_HOUR existed before this feature; BUSINESS_START_HOUR=10 was added mirroring
# the frontend scheduler's default company config (scheduler.slice.ts: startHour=10,
# endHour=19) — see task_helpers.py's comment for the full rationale.
# ---------------------------------------------------------------------------------------

# Capacity status thresholds. Deliberately simple, named bands for a first implementation —
# there is no product spec for these yet, so pick sane defaults and document the reasoning
# rather than inventing something unlabeled:
#   > 100%   -> "over_capacitated": committed time already exceeds what the business day
#               (or the next one) can hold — a real overcommit, not just "busy".
#   < 70%    -> "available": enough headroom that more work can land without crunch. 70%
#               (not 100%) is used so "available" doesn't flip to "no longer available"
#               only at the exact moment someone tips over — a person sitting at 85% still
#               isn't a safe pick for new work, so they should read as loaded, not available.
#   70-100%  -> "at_capacity": loaded but not (yet) overcommitted — the middle band between
#               the two above.
# Revisit these once the Org Resource View / Saturation Heatmap are built and real usage
# data exists to tune them against.
CAPACITY_AVAILABLE_BELOW_PCT = 70.0
CAPACITY_OVER_ABOVE_PCT = 100.0

_CLOSED_TASK_STATUSES_LOWER = {s.lower() for s in _CLOSED_TASK_STATUSES}


def _capacity_status(utilization_pct: float) -> str:
    """Status bucket for a utilization percentage — see the threshold comment above."""
    if utilization_pct > CAPACITY_OVER_ABOVE_PCT:
        return "over_capacitated"
    if utilization_pct < CAPACITY_AVAILABLE_BELOW_PCT:
        return "available"
    return "at_capacity"


def _sessions_seconds_on_date(sessions, target_date, now_dt, tz_name: str = BUSINESS_TZ) -> float:
    """Sum of session durations (seconds) whose start_time falls on `target_date` (a date
    in `tz_name` — defaults to the global BUSINESS_TZ, but /capacity passes each employee's
    own resolved timezone so day-boundaries are computed per employee, not org-wide). An
    open session (no end_time yet) is clipped at `now_dt` — this is what makes an
    in-progress task's elapsed time count toward "committed" load."""
    total = 0.0
    tz = ZoneInfo(tz_name)
    # Count only the part of each session that overlaps target_date's local calendar day,
    # so a session that crosses midnight is split between the two days instead of being
    # attributed wholly to the day it started on.
    day_start = datetime.combine(target_date, datetime.min.time(), tzinfo=tz)
    day_end = day_start + timedelta(days=1)
    for s in sessions or []:
        start = parse_dt(s.get("start_time"))
        if not start:
            continue
        end = parse_dt(s.get("end_time")) or now_dt
        overlap = (min(end, day_end) - max(start, day_start)).total_seconds()
        total += max(0.0, overlap)
    return total


def _resolve_employee_tz_name(emp) -> str:
    """The timezone GET /capacity should use for THIS employee's day-boundary math: their
    own `timezone` column when set and a real IANA name, else the global BUSINESS_TZ
    fallback. Defensive against a bad value slipping in some other way than the validated
    PUT /profile / PUT /user/{emp_id} paths (e.g. a direct DB edit or CSV import) — such a
    value should degrade to the org default rather than crash the whole /capacity response."""
    tz_name = getattr(emp, "timezone", None)
    if not tz_name:
        return BUSINESS_TZ
    try:
        ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        return BUSINESS_TZ
    return tz_name


def _capacity_for_employee(
    db, emp, now_dt, today_date, available_seconds_per_day, tz_name: str | None = None,
    num_days: int = 2,
):
    """`num_days`-day (default 2, i.e. today/tomorrow) committed-vs-available breakdown for
    one employee.

    `tz_name`: the IANA timezone whose "today" boundary applies to THIS employee. When
    given, today_date is RECOMPUTED from `now_dt` in that timezone (overriding whatever the
    caller passed) — this is what lets two employees in different timezones see different
    day boundaries in the same GET /capacity call. When None (the default), behavior is
    unchanged from before this field existed: the caller's own today_date/BUSINESS_TZ apply,
    which is exactly what GET /insights relies on (it doesn't pass tz_name and must keep
    using the single global BUSINESS_TIMEZONE — see the module comment above that endpoint).

    committed_seconds(day) = actual worked seconds that day, from open+closed task_sessions
    (an open session's elapsed time counts toward TODAY; sessions can't exist for a future
    date) + the FULL remaining duration of any assigned, not-yet-closed task that has never
    had a session started at all ("not-yet-worked" backlog — task.remaining_seconds is
    effectively its full duration since no time has been logged against it).

    Partially-worked tasks (already have a session, but remaining_seconds > 0) contribute
    only their logged time here, not their remaining balance — a deliberate v1
    simplification: projecting a partially-done task's remaining time onto a specific future
    day would require re-implementing the frontend's multi-day sequential timeline
    scheduler (src/Utils/scheduler.ts) backend-side, which is out of scope for this first
    cut. Only the not-yet-worked backlog is bin-packed across the 48h window below.

    The not-yet-worked backlog is spread with a simple sequential bin-pack across
    `num_days` business days starting today: fill whatever business-day headroom remains
    TODAY first (already-worked seconds eat into that headroom), then let any excess spill
    into each subsequent day's full bucket in order. This is intentionally NOT the
    frontend's full multi-day sequential scheduler — just enough to produce a defensible
    multi-day capacity signal (originally "next-48h" only, i.e. num_days=2 — the default,
    so every existing caller's numbers are unchanged; GET /capacity's own `days` query
    param is what lets a caller ask for a longer horizon, up to multi-week, for resourcing
    forecasts — see scale-gaps-plan.md §B.6).
    """
    if tz_name is not None:
        # Per-employee mode: THIS employee's "today" is in their own timezone, not
        # whatever today_date the caller precomputed globally.
        local_now = now_dt.astimezone(ZoneInfo(tz_name))
        today_date = local_now.date()

    resolved_tz = tz_name or BUSINESS_TZ
    tasks = db.query(TaskModel).filter(TaskModel.task_assigned_to == emp.emp_id).all()

    worked_today = 0.0
    backlog_seconds = 0.0
    for t in tasks:
        sessions = t.task_sessions or []
        worked_today += _sessions_seconds_on_date(sessions, today_date, now_dt, tz_name=resolved_tz)
        is_closed = (t.task_status or "").lower() in _CLOSED_TASK_STATUSES_LOWER
        if not is_closed and not sessions:
            backlog_seconds += t.remaining_seconds or 0.0

    def pct(committed):
        if available_seconds_per_day <= 0:
            return 0.0
        return round((committed / available_seconds_per_day) * 100, 1)

    days = []
    remaining_backlog = backlog_seconds
    horizon = max(1, num_days)
    for i in range(horizon):
        day_date = today_date + timedelta(days=i)
        is_last_day = i == horizon - 1
        if i == 0:
            headroom = max(0.0, available_seconds_per_day - worked_today)
            allocated = remaining_backlog if is_last_day else min(remaining_backlog, headroom)
            committed = worked_today + allocated
        else:
            # Sessions can't be logged against a future date — every subsequent day's
            # "committed" figure is purely spilled-over backlog.
            allocated = (
                remaining_backlog if is_last_day
                else min(remaining_backlog, available_seconds_per_day)
            )
            committed = allocated
        # The LAST day of the horizon absorbs whatever backlog is still unallocated, so
        # work that cannot fit inside the window shows up as >100% (over_capacitated)
        # instead of being silently dropped.
        remaining_backlog -= allocated
        days.append({
            "date": day_date.isoformat(),
            "committed_seconds": round(committed),
            "available_seconds": int(available_seconds_per_day),
            "utilization_pct": pct(committed),
        })

    # "Current" utilization is TODAY's figure. The status bucket, however, looks at the
    # WORST day across the whole requested horizon — "available" means no day in the
    # window is a problem, and a person fully booked today but wildly overbooked later is
    # still a real signal a resource planner needs to see, not something today's number
    # alone would surface.
    utilization_pct_today = days[0]["utilization_pct"]
    worst_utilization_pct = max(d["utilization_pct"] for d in days)

    return {
        "emp_id": emp.emp_id,
        "emp_name": emp.emp_name,
        "utilization_pct": utilization_pct_today,
        "days": days,
        "status": _capacity_status(worst_utilization_pct),
        # Resolved timezone used for THIS employee's day-boundary math above (their own
        # `timezone` when set, else BUSINESS_TZ) — lets the frontend heatmap label/group by
        # it. Present regardless of whether tz_name was passed (falls back to BUSINESS_TZ),
        # so GET /insights' summary_payload (which cherry-picks specific keys off this dict,
        # see below) is unaffected by this addition.
        "timezone": resolved_tz,
    }


MAX_CAPACITY_HORIZON_DAYS = 28  # ~4 weeks — "multi-week", not unbounded


@app.get('/capacity', status_code=200, summary="Per-employee capacity & utilization (org-tree scoped)")
def get_capacity(days: int = 2, db=Depends(get_db), current_user=Depends(verify_token)):
    """Capacity/utilization derived from the scheduler + task_sessions — see the module
    comment above this route for the full definition and thresholds.

    `days` (query param, default 2 — the original "next-48h" behavior, unchanged for any
    caller that doesn't pass it): the horizon length in days starting today. Clamped to
    [1, MAX_CAPACITY_HORIZON_DAYS] so a caller can ask for a multi-week resourcing forecast
    (scale-gaps-plan.md §B.6) without being able to request an unbounded computation.

    Scoping mirrors every other endpoint in this app (see GET /tasks): the caller sees
    self + their full org subtree via permissions.get_user_view_scope. This is PURE
    org-tree visibility — there is no separate "admins see the whole company" special
    case anywhere else in this codebase (permissions.get_user_view_scope's own docstring:
    visibility is driven purely by the org tree, not designation rank), and this endpoint
    doesn't invent one either. In practice this still gives company-wide admins
    (EM001-style roles sitting at the top of the org, per test_org_scope.py) the full
    picture, because their subtree already covers everyone below them.
    """
    num_days = max(1, min(days, MAX_CAPACITY_HORIZON_DAYS))
    scope = get_user_view_scope(db, current_user.emp_id)
    employees = (
        db.query(UserModel)
        .filter(UserModel.emp_id.in_(scope))
        .order_by(UserModel.emp_id)
        .all()
    )

    now_dt = utc_now()
    today_date = business_now().date()
    available_seconds_per_day = max(0, BUSINESS_END_HOUR - BUSINESS_START_HOUR) * 3600.0

    # Per-employee timezone-aware: each employee's own `timezone` (falling back to the
    # global BUSINESS_TZ when unset) drives THEIR day-boundary math below, so two
    # employees in different timezones can land in different "today"s — see
    # _capacity_for_employee's tz_name docstring.
    rows = [
        _capacity_for_employee(
            db, emp, now_dt, today_date, available_seconds_per_day,
            tz_name=_resolve_employee_tz_name(emp), num_days=num_days,
        )
        for emp in employees
    ]

    total = len(rows)
    available_count = sum(1 for r in rows if r["status"] == "available")
    at_capacity_count = sum(1 for r in rows if r["status"] == "at_capacity")
    over_capacitated_count = sum(1 for r in rows if r["status"] == "over_capacitated")
    avg_utilization_pct = (
        round(sum(r["utilization_pct"] for r in rows) / total, 1) if total else 0.0
    )

    return response(
        status.HTTP_200_OK,
        message="Capacity metrics fetched successfully",
        data={
            "employees": rows,
            "summary": {
                "total_employees": total,
                "available_count": available_count,
                "at_capacity_count": at_capacity_count,
                "over_capacitated_count": over_capacitated_count,
                "avg_utilization_pct": avg_utilization_pct,
            },
        },
    )


def _employee_task_bucket(status_value: str | None) -> str:
    """Coarse status bucket for the admin overview's per-employee task-count columns."""
    s = (status_value or "").lower()
    if s in ("done", "completed"):
        return "done"
    if s in ("on-hold", "on hold"):
        return "on_hold"
    if s in ("in-progress", "in progress"):
        return "in_progress"
    return "open"  # todo / backlog / blank


def _is_task_overdue(task, now_dt) -> bool:
    """Same overdue predicate as `_count_overdue_tasks` (main.py:2117-2152), applied to one
    task at a time — that helper only returns an aggregate count, not per-task/per-employee
    detail, which the admin overview below needs."""
    if not task.task_duration or task.task_duration == "0":
        return False
    if any(s.get("end_time") is None for s in (task.task_sessions or [])):
        return False
    due = parse_dt(task.task_due_date)
    if due is not None:
        deadline = due
    else:
        ref_time = parse_dt(task.task_updated_at) or parse_dt(task.task_created_at)
        if not ref_time:
            return False
        remaining_hours = (task.remaining_seconds or 0) / 3600.0
        deadline = ref_time + timedelta(hours=remaining_hours)
    return now_dt > deadline


@app.get('/admin/employee-overview', status_code=200, summary="Company-wide employee onboarding/task-load/availability overview (admin panel only)")
def admin_employee_overview(db=Depends(get_db), current_user=Depends(require_admin_or_auditor)):
    """Backs the separate admin panel's (reached only via /admin-login) landing dashboard.

    Deliberately company-wide — unlike every other endpoint here (GET /tasks, GET
    /capacity), this one is NOT scoped by permissions.get_user_view_scope. The admin panel
    is a dedicated surface meant to see every employee regardless of org tree, by explicit
    product requirement (unlike /capacity, which stays org-tree scoped like the rest of the
    app — see the comment on GET /capacity above)."""
    employees = db.query(UserModel).order_by(UserModel.emp_id).all()
    foundations = {f.emp_id: f for f in db.query(Foundation).all()}

    now_dt = utc_now()
    today_date = business_now().date()
    available_seconds_per_day = max(0, BUSINESS_END_HOUR - BUSINESS_START_HOUR) * 3600.0

    tasks_by_assignee: dict[str, list] = {}
    for t in db.query(TaskModel).all():
        tasks_by_assignee.setdefault(t.task_assigned_to, []).append(t)

    rows = []
    for emp in employees:
        foundation = foundations.get(emp.emp_id)
        emp_tasks = tasks_by_assignee.get(emp.emp_id, [])
        counts = {"open": 0, "in_progress": 0, "on_hold": 0, "done": 0, "overdue": 0, "total": len(emp_tasks)}
        for t in emp_tasks:
            counts[_employee_task_bucket(t.task_status)] += 1
            if _is_task_overdue(t, now_dt):
                counts["overdue"] += 1

        capacity = _capacity_for_employee(
            db, emp, now_dt, today_date, available_seconds_per_day,
            tz_name=_resolve_employee_tz_name(emp), num_days=1,
        )

        rows.append({
            "emp_id": emp.emp_id,
            "emp_name": emp.emp_name,
            "emp_designation": emp.emp_designation,
            "emp_department": emp.emp_department,
            "is_onboarded": bool(foundation.is_onboarded) if foundation else False,
            "tasks": counts,
            "utilization_pct": capacity["utilization_pct"],
            "availability_status": capacity["status"],
        })

    return response(
        status.HTTP_200_OK,
        message="Employee overview fetched successfully",
        data={"employees": rows, "total": len(rows)},
    )


# ---------------------------------------------------------------------------------------
# GET /tasks/assignee-suggestions — candidate ranking for the create-task modal's "who should
# I assign this to?" prompt (pending.md's "Must Have" AI-powered smart-assignment feature).
# Must respond fast enough for a live UI (called as someone types tags / picks a priority /
# blurs the description field) and must work with zero Gemini configuration at all — the
# Gemini-backed domain-classification step below is entirely OPTIONAL and best-effort; every
# other signal stays deterministic.
#
# Deliberately NOT scoped by get_user_view_scope the way /tasks and /capacity are: this app
# has OPEN task assignment (permissions.can_assign_task_to lets anyone assign to anyone —
# see plan.md SS2/SS4, and permissions.py's own permission matrix: "Assign a task to X |
# anyone"), so restricting the candidate pool to the caller's own subtree would silently
# contradict that and hide perfectly valid candidates. Every employee in the company STARTS
# as a candidate; auth is still required (any logged-in user may ask), matching /user's
# open-directory precedent. The one exception is the rank filter just below: this is a UX
# quality filter on the *suggestion list*, not an authorization rule (can_assign_task_to /
# open-assignment is untouched — a task can still be manually assigned to anyone).
#
# Rank filter (product feedback, 2026-07): senior/management-tier people (a CTO, an
# Engineering Manager, ...) were showing up as top suggestions purely because they were 0%
# utilized — a poor fit for hands-on task assignment. Candidates with
# `permissions.get_rank(designation) >= RANK_L2 (3)` are excluded from the pool entirely,
# per permissions.py's HIERARCHY_RANKS: rank 3 is "Sr Product Manager / Lead / Tech Lead /
# Team Lead" and up (ranks 4-5 are EM-tier and exec-tier, also excluded). Only rank 1-2
# individual-contributor designations (SWE/ASE/QA/Sr SWE I/Sr QA I/Sr DevOps/Sr Exec/UI-UX)
# remain suggestible. Unranked (rank 0 — blank/unrecognized designation) is NOT filtered;
# rank 0 doesn't mean "senior", it means "no HIERARCHY_RANKS entry".
#
# Scoring combines FOUR signals (see _score constants + helpers below for the exact formula):
# current load (heaviest weight — an available person is the most actionable suggestion), a
# modest org-tree-proximity bonus (tiebreaker, not a filter), a modest historical-velocity-
# on-similar-tags bonus, and — new — an optional domain-affinity bonus from classifying the
# task's free-text description via Gemini (see _classify_task_domain below). Top 5 by score
# wins.
# ---------------------------------------------------------------------------------------
ASSIGNEE_ORG_BONUS_SELF = 20.0        # the requester themself
ASSIGNEE_ORG_BONUS_SUBTREE = 15.0     # requester's own report, direct or indirect
ASSIGNEE_ORG_BONUS_ANCESTOR = 10.0    # somewhere in requester's management chain
ASSIGNEE_ORG_BONUS_PEER = 8.0         # shares the requester's direct manager
ASSIGNEE_VELOCITY_BONUS_PER_MATCH = 4.0
ASSIGNEE_VELOCITY_MAX_MATCHES = 5        # cap so a long history can't outweigh current load
ASSIGNEE_URGENT_PRIORITIES = {"P0", "P1"}    # per the frontend's Utils/priority.ts P0..P4 scale
ASSIGNEE_URGENT_LOAD_MULTIPLIER = 1.25       # urgent tasks lean harder toward availability
ASSIGNEE_SUGGESTION_LIMIT = 5
ASSIGNEE_SENIORITY_FILTER_MIN_RANK = perms.RANK_L2   # exclude Sr PM/Lead/Tech Lead/Team Lead+

# --- Domain-affinity (Gemini, optional/best-effort) -------------------------------------
ASSIGNEE_DOMAIN_BONUS_PER_SKILL_MATCH = 6.0
ASSIGNEE_DOMAIN_BONUS_MAX_SKILL_MATCHES = 3     # cap: mirrors the velocity bonus's cap style
ASSIGNEE_DOMAIN_BONUS_DESIGNATION_FALLBACK = 8.0   # single flat bonus — a weaker/less-certain
# signal than an explicit skills match, only used when skills are empty/sparse.
ASSIGNEE_DOMAIN_MIN_DESCRIPTION_LENGTH = 15   # shorter isn't worth an AI call (e.g. "TBD", "fix bug")
ASSIGNEE_DOMAIN_CACHE_TTL_SECONDS = 5 * 60     # mirrors GET /insights' INSIGHTS_CACHE_TTL_SECONDS
_ASSIGNEE_DOMAIN_CACHE_PREFIX = "assignee_domain:"


def _split_tags(raw: str | None) -> list:
    """`task_tags` (and this endpoint's `tags` query param) is a plain comma-separated
    string — matches the frontend's chip editor (frontend/src/Components/
    Timeline/TagsInput.tsx: tags are joined/split on "," with each chip trimmed). Splits,
    trims, lowercases (so matching is case-insensitive — the UI capitalizes chips for
    display only), and drops empties."""
    return [t.strip().lower() for t in (raw or "").split(",") if t.strip()]


def _manager_chain_ancestors(users_by_id: dict, start_emp_id: str) -> set:
    """Every emp_id in `start_emp_id`'s management chain (manager, manager's manager, ...),
    walked via the in-memory emp_id->User map already built for the candidate pool — O(depth),
    not a fresh query per candidate. Cycle-safe (stops once an emp_id repeats)."""
    ancestors: set = set()
    current = users_by_id.get(start_emp_id)
    while current and current.manager_id and current.manager_id not in ancestors:
        ancestors.add(current.manager_id)
        current = users_by_id.get(current.manager_id)
    return ancestors


def _org_proximity_bonus(
    requester_emp_id: str, requester_manager_id: str | None, requester_subtree: set,
    requester_ancestors: set, candidate,
) -> tuple:
    """Org-tree-proximity bonus + a short human-readable reason for one candidate, or
    (0.0, None) when unrelated. A tiebreaker/bonus only — NOT a filter, every employee stays
    in the candidate pool regardless (see the module comment above this endpoint)."""
    if candidate.emp_id == requester_emp_id:
        return ASSIGNEE_ORG_BONUS_SELF, "that's you"
    if candidate.emp_id in requester_subtree:
        return ASSIGNEE_ORG_BONUS_SUBTREE, "reports to you"
    if candidate.emp_id in requester_ancestors:
        return ASSIGNEE_ORG_BONUS_ANCESTOR, "in your management chain"
    if requester_manager_id and candidate.manager_id == requester_manager_id:
        return ASSIGNEE_ORG_BONUS_PEER, "same team as you"
    return 0.0, None


def _tag_velocity_bonus(requested_tags: list, candidate_completed_tag_sets: list) -> tuple:
    """Historical-velocity-on-similar-tags signal for one candidate.

    Formula (deliberately simple, per the "don't overengineer this" guidance — a fuller
    speed metric comparing `task_duration` (a self-reported estimate) against `time_spent`
    would need those estimates to be trustworthy/comparable across differently-scoped
    tasks, which nothing in this codebase enforces): for each requested tag, count how many
    of the candidate's DONE/COMPLETED tasks carry that tag (`candidate_completed_tag_sets`
    is a list of per-task tag-sets, precomputed ONCE for the whole candidate pool by the
    caller — see get_assignee_suggestions — to avoid an N+1 query loop). A simple count of
    relevant completed work is a cheap, robust "have they done this kind of task before"
    experience proxy.

    bonus = min(total matches across all requested tags, ASSIGNEE_VELOCITY_MAX_MATCHES)
            * ASSIGNEE_VELOCITY_BONUS_PER_MATCH
    (capped so a long task history can't outweigh current load, which must stay the
    dominant signal). Reasons are reported per-tag (e.g. "3 completed tasks tagged
    'backend'"), capped at 3 tags so a long tag list can't flood the response.
    """
    if not requested_tags:
        return 0.0, []
    reasons = []
    total_matches = 0
    for tag in requested_tags:
        count = sum(1 for tag_set in candidate_completed_tag_sets if tag in tag_set)
        if count:
            total_matches += count
            if len(reasons) < 3:
                plural = "s" if count != 1 else ""
                reasons.append(f"{count} completed task{plural} tagged '{tag}'")
    bonus = min(total_matches, ASSIGNEE_VELOCITY_MAX_MATCHES) * ASSIGNEE_VELOCITY_BONUS_PER_MATCH
    return bonus, reasons


def _build_domain_classification_prompt(title: str | None, description: str) -> str:
    """Prompt asking Gemini to reduce a task's free-text description (+ optional title) to a
    SHORT list of domain/skill keywords — NOT a summary — so they can be matched against
    `users.skills` tags/`emp_designation`. Strict-JSON-array output, same "no markdown, no
    commentary" convention as _build_insights_prompt."""
    return (
        "You are classifying a work task into short domain/skill keywords, for matching "
        "against employee skill tags (things like \"react\", \"backend\", \"qa\", "
        "\"devops\", \"ui\", \"database\"). Given the task title and description below, "
        "respond with STRICT JSON ONLY — no markdown, no code fences, no extra commentary — "
        "a JSON array of 2 to 6 short, lowercase, single-or-two-word keywords describing the "
        "domain/skills this task needs. Examples of the shape wanted: "
        '["frontend", "react", "ui"] or ["backend", "api", "database"] or '
        '["qa", "testing", "automation"]. Keywords only — no sentences, no explanations.\n\n'
        f"TITLE: {title or '(none)'}\nDESCRIPTION: {description}"
    )


def _parse_gemini_domain_keywords(text: str) -> list | None:
    """Parse Gemini's raw text into a list of lowercase keyword strings, or None if it isn't
    usable JSON of that shape. Strips a ```json ... ``` fence, mirroring _parse_gemini_insight."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()

    try:
        parsed = json.loads(cleaned)
    except (ValueError, TypeError):
        return None

    if not isinstance(parsed, list) or not all(isinstance(k, str) for k in parsed):
        return None
    keywords = [k.strip().lower() for k in parsed if k.strip()]
    return keywords or None


def _classify_task_domain(title: str | None, description: str | None) -> list | None:
    """Best-effort Gemini classification of a task's domain/skill keywords from its
    title/description, or None when the whole feature should be skipped (no description /
    description too short / Gemini unconfigured / Gemini call or parse fails). NEVER raises —
    every failure mode here means "the caller falls back to the pre-existing formula exactly",
    per this endpoint's degrade-gracefully contract.

    Caching: Redis, keyed on a hash of the (title, description) text, TTL
    ASSIGNEE_DOMAIN_CACHE_TTL_SECONDS — mirrors GET /insights' cache exactly (same
    redis_get_value/redis_set_value helpers, same "cache misses AND failures, so an outage
    doesn't get hammered with a fresh retry on every request within the window" policy). The
    frontend calls this on description-field blur (not every keystroke) but could still repeat
    the same text, so this avoids a redundant Gemini call for identical input.
    """
    if not description or len(description.strip()) < ASSIGNEE_DOMAIN_MIN_DESCRIPTION_LENGTH:
        return None
    if not gemini_configured():
        return None

    try:
        cache_input = f"{title or ''}|{description}"
        digest = hashlib.sha256(cache_input.encode()).hexdigest()
        cache_key = f"{_ASSIGNEE_DOMAIN_CACHE_PREFIX}{digest}"
        cached = redis_get_value(cache_key)
        if cached is not None:
            try:
                keywords = json.loads(cached)
            except (ValueError, TypeError):
                keywords = None
            return keywords or None

        result = call_gemini_with_fallback(_build_domain_classification_prompt(title, description))
        keywords = (
            _parse_gemini_domain_keywords(result["text"]) if result.get("success") else None
        )
        redis_set_value(cache_key, json.dumps(keywords or []), expiration=ASSIGNEE_DOMAIN_CACHE_TTL_SECONDS)
        return keywords
    except Exception as e:  # noqa: BLE001 — best-effort domain classification: any failure
        # (cache/hash/parse/network) just means "no domain bonus this request", never a 500.
        logger.warning("Assignee-suggestions domain classification failed: %s", e)
        return None


def _domain_affinity_bonus(domain_keywords: list | None, candidate) -> tuple:
    """Domain-affinity bonus + a short human-readable reason for one candidate, from matching
    Gemini-classified domain keywords against the candidate's `users.skills`, falling back to
    `emp_designation` when skills are empty/sparse (e.g. a "QA Engineer" designation is a
    natural QA-domain signal even with no skills tags set). Returns (0.0, None) when there are
    no keywords to match (Gemini classification was skipped/failed) or nothing matches.

    Matching is case-insensitive substring/overlap (same simple style as the tag-velocity
    bonus above) rather than exact equality, since a skill tag like "React.js" or a keyword
    like "frontend-ui" won't exactly equal a single-word keyword/skill.
    """
    if not domain_keywords:
        return 0.0, None

    skills = [s.strip() for s in (getattr(candidate, "skills", None) or []) if s and s.strip()]
    matched_skills = []
    for skill in skills:
        skill_lower = skill.lower()
        if any(kw in skill_lower or skill_lower in kw for kw in domain_keywords):
            matched_skills.append(skill)

    if matched_skills:
        bonus = (
            min(len(matched_skills), ASSIGNEE_DOMAIN_BONUS_MAX_SKILL_MATCHES)
            * ASSIGNEE_DOMAIN_BONUS_PER_SKILL_MATCH
        )
        reason = f"Skills match: {', '.join(matched_skills[:3])}"
        return bonus, reason

    # Fallback signal: skills are empty/sparse (no match above) — try the designation string.
    designation = (getattr(candidate, "emp_designation", None) or "").strip()
    if designation:
        designation_lower = designation.lower()
        matched_kw = next(
            (kw for kw in domain_keywords if kw in designation_lower or designation_lower in kw),
            None,
        )
        if matched_kw:
            label = matched_kw.upper() if len(matched_kw) <= 3 else matched_kw.capitalize()
            return ASSIGNEE_DOMAIN_BONUS_DESIGNATION_FALLBACK, f"{label}-focused role"

    return 0.0, None


@app.get(
    '/tasks/assignee-suggestions', status_code=200,
    summary="Assignee suggestions for the task-create flow (deterministic + optional Gemini domain match)",
)
def get_assignee_suggestions(
    tags: str | None = None,
    priority: str | None = None,
    title: str | None = None,
    description: str | None = None,
    db=Depends(get_db),
    current_user=Depends(verify_token),
):
    """Ranks individual-contributor employees in the company (open assignment — see the
    module comment above) as candidate assignees for a not-yet-created task, from
    deterministic signals (current load, org-tree proximity, historical tag velocity) PLUS
    an optional Gemini-powered domain-affinity signal when a `description` is supplied.

    Senior/management-tier designations (`permissions.get_rank(designation) >=
    ASSIGNEE_SENIORITY_FILTER_MIN_RANK`, i.e. rank 3 and up — Sr PM/Lead/Tech Lead/Team
    Lead/EM/execs) are excluded from the candidate pool entirely — a UX quality filter on
    this suggestion list only; it does NOT change who can actually be assigned a task
    (permissions.can_assign_task_to stays open to everyone).

    Query params:
      tags: comma-separated tag string, same format as `task_tags` (optional).
      priority: task_priority string, e.g. "P0".."P4" (optional). "P0"/"P1" lean the score
        harder toward availability — see ASSIGNEE_URGENT_LOAD_MULTIPLIER.
      title: task title text (optional). Only used, alongside `description`, as extra
        context for the Gemini domain-classification call below.
      description: task description text (optional). When present (and long enough to be
        worth an AI call — see ASSIGNEE_DOMAIN_MIN_DESCRIPTION_LENGTH) and Gemini is
        configured, it is classified into short domain/skill keywords (cached in Redis, see
        _classify_task_domain) and matched against each candidate's `skills` (falling back to
        `emp_designation`) for a `domain_affinity_bonus`. Any failure at any step (not
        provided, too short, unconfigured, Gemini error, unparsable response) just means this
        bonus is skipped — the rest of the formula is unaffected and the endpoint never
        errors because of it.

    Response (top ASSIGNEE_SUGGESTION_LIMIT candidates, highest score first):
        [{"emp_id": str, "emp_name": str, "score": float, "reasons": [str, ...]}, ...]
    """
    requested_tags = _split_tags(tags)

    all_users = db.query(UserModel).order_by(UserModel.emp_id).all()
    users_by_id = {u.emp_id: u for u in all_users}

    # Seniority/UX filter — see the module comment + this function's docstring above. Applied
    # unconditionally, independent of tags/priority/description.
    eligible_users = [
        u for u in all_users
        if perms.get_rank(u.emp_designation) < ASSIGNEE_SENIORITY_FILTER_MIN_RANK
    ]

    requester_subtree = get_all_subordinates(db, current_user.emp_id)
    requester_ancestors = _manager_chain_ancestors(users_by_id, current_user.emp_id)

    # Historical velocity data: ONE query for every DONE/COMPLETED task company-wide,
    # grouped by assignee -> list of that task's tag-set. Precomputed once for the whole
    # candidate pool (not once per candidate) to avoid an N+1 query loop. Skipped entirely
    # when no tags were requested — there is nothing to match against.
    completed_tag_sets_by_emp: dict = {}
    if requested_tags:
        completed_tasks = (
            db.query(TaskModel)
            .filter(TaskModel.task_status.in_(["done", "completed", "Done", "Completed"]))
            .all()
        )
        for t in completed_tasks:
            if not t.task_assigned_to:
                continue
            completed_tag_sets_by_emp.setdefault(t.task_assigned_to, []).append(
                set(_split_tags(t.task_tags))
            )

    # Domain-affinity classification: computed ONCE for the whole candidate pool (not per
    # candidate) — see _classify_task_domain for the degrade-gracefully + caching contract.
    domain_keywords = _classify_task_domain(title, description)

    now_dt = utc_now()
    today_date = business_now().date()
    available_seconds_per_day = max(0, BUSINESS_END_HOUR - BUSINESS_START_HOUR) * 3600.0

    urgent = bool(priority) and priority.strip().upper() in ASSIGNEE_URGENT_PRIORITIES

    candidates = []
    for candidate in eligible_users:
        capacity = _capacity_for_employee(
            db, candidate, now_dt, today_date, available_seconds_per_day,
            tz_name=_resolve_employee_tz_name(candidate),
        )
        utilization_pct = capacity["utilization_pct"]
        # Lower utilization = more available = higher score. Clamped at 0 for an
        # over-capacitated candidate rather than going negative.
        load_score = max(0.0, 100.0 - utilization_pct)
        if urgent:
            load_score *= ASSIGNEE_URGENT_LOAD_MULTIPLIER

        org_bonus, org_reason = _org_proximity_bonus(
            current_user.emp_id, current_user.manager_id, requester_subtree,
            requester_ancestors, candidate,
        )
        velocity_bonus, velocity_reasons = _tag_velocity_bonus(
            requested_tags, completed_tag_sets_by_emp.get(candidate.emp_id, []),
        )
        domain_bonus, domain_reason = _domain_affinity_bonus(domain_keywords, candidate)

        reasons = [f"{utilization_pct:.0f}% utilized today", *velocity_reasons]
        if domain_reason:
            reasons.append(domain_reason)
        if org_reason:
            reasons.append(org_reason)

        total_score = round(load_score + org_bonus + velocity_bonus + domain_bonus, 1)
        candidates.append({
            "emp_id": candidate.emp_id,
            "emp_name": candidate.emp_name,
            "score": total_score,
            "reasons": reasons,
        })

    candidates.sort(key=lambda c: (-c["score"], c["emp_id"]))
    return response(
        status.HTTP_200_OK,
        message="Assignee suggestions generated",
        data=candidates[:ASSIGNEE_SUGGESTION_LIMIT],
    )


# ---------------------------------------------------------------------------------------
# GET /insights — AI-generated decision-support summary sitting on top of /capacity and
# /tasks (the "Future UI / analytics" AI Insight panel in pending.md). Same org-tree scoping
# as every other endpoint (get_user_view_scope): a manager gets insight about their subtree,
# an IC gets insight about their own work. NOT a chatbot / free-form prompt endpoint — the
# only input Gemini sees is a compact, server-built JSON summary (overdue count, tasks by
# status, per-employee utilization straight from _capacity_for_employee, who's
# over-capacitated, and the two deterministic structures below); the narrative output is a
# short summary + 2-4 recommendations.
#
# Caching: generating this costs a real Gemini call, and this app can run multiple workers
# (see the Celery migration / redis_client.py), so the generated insight is cached in Redis
# — an in-process dict would give each worker its own cache and none of them would agree.
# Keyed by the REQUESTING user's emp_id (simplest option that's still correctly scoped: two
# users with different scopes never share a cache entry, and a scope changing e.g. via an
# org-hierarchy edit just means the next call past the TTL recomputes against fresh data).
# TTL is 5 minutes: long enough that a dashboard being refreshed/re-opened repeatedly doesn't
# re-call Gemini every time, short enough that the insight can't go stale for long relative
# to how often task/capacity data actually changes. Cache is skipped entirely for the (free,
# instant) "not configured" case so setting a key mid-session is picked up immediately, but
# IS used for actual Gemini attempts (including failures) so an outage/rate-limit doesn't
# get hammered with a fresh retry on every request within the window.
#
# Two deterministic (NO Gemini) computations feed BOTH the Gemini prompt AND the response's
# own top-level fields, and are computed unconditionally — BEFORE the gemini_configured()
# check — so `at_risk_tasks`/`rebalance_suggestions` are populated even when Gemini is
# unavailable/unconfigured. Only `summary`/`recommendations`/`available` depend on Gemini:
#
#   at_risk_tasks: overdue-risk prediction for every in-scope todo/in-progress task (not
#   done/on-hold/backlog — same exclusion set the overdue sweeper uses, _SWEEPER_EXCLUDED_
#   STATUSES). See _task_overdue_risk for the exact bucketing rule. Only "medium"/"high"
#   risk tasks are returned (an every-task list would flood the response with "low" noise).
#
#   rebalance_suggestions: pairs an over_capacitated employee with an available one who has
#   headroom, reusing the SAME capacity_rows this endpoint already computed for the Gemini
#   summary (no second /capacity-style query). See _rebalance_suggestions for the exact
#   pairing rule.
# ---------------------------------------------------------------------------------------
INSIGHTS_CACHE_TTL_SECONDS = 5 * 60
_INSIGHTS_CACHE_PREFIX = "insights:"
REBALANCE_SUGGESTION_LIMIT = 3


def _tasks_by_status_for_scope(db, emp_ids: set) -> dict:
    """{status: count} for every task assigned to someone in `emp_ids`."""
    rows = (
        db.query(TaskModel.task_status, func.count(TaskModel.id))
        .filter(TaskModel.task_assigned_to.in_(emp_ids))
        .group_by(TaskModel.task_status)
        .all()
    )
    return {(s or "unknown"): c for s, c in rows}


def _task_overdue_risk(task, now_dt, assignee_status: str | None) -> tuple | None:
    """Deterministic overdue-risk bucket + short reason for ONE in-scope todo/in-progress
    task, or None if it's "low" risk (the caller drops "low" tasks from the response).

    Heuristic (one clear, documented rule rather than a black-box score):
      1. No `task_due_date` at all: there's no deadline to measure against, so risk is
         driven purely by the ASSIGNEE's current overload — "high" if they're already
         over_capacitated, "medium" if at_capacity, else "low" (dropped).
      2. `task_due_date` set: compare the task's own remaining work
         (`task.remaining_seconds`, the same computed property /capacity's committed-time
         math is built on) against the wall-clock time actually left until the deadline:
           - deadline already passed AND no session is currently open on the task -> "high"
             (this mirrors _count_overdue_tasks' own overdue definition exactly).
           - deadline already passed but a session IS currently open -> "medium" (already
             late, but someone is actively on it right now — a smaller signal than a
             stalled task).
           - remaining work >= time left until due -> "high": mathematically can't finish
             even working non-stop from now.
           - remaining work >= 50% of time left until due -> "medium", ESCALATED to "high"
             if the assignee is already over_capacitated (an overloaded assignee is
             unlikely to find the time regardless of the raw math — the "over-capacitated
             assignee + task due soon" case pending.md calls out explicitly).
           - otherwise -> "low" (dropped): comfortable runway.
    """
    has_open_session = any(s.get("end_time") is None for s in (task.task_sessions or []))
    due = parse_dt(task.task_due_date)

    if due is None:
        if assignee_status == "over_capacitated":
            return "high", "no due date set, and the assignee is already over capacity"
        if assignee_status == "at_capacity":
            return "medium", "no due date set, and the assignee is at capacity"
        return None

    hours_left = (due - now_dt).total_seconds() / 3600.0
    remaining_hours = (task.remaining_seconds or 0.0) / 3600.0

    if hours_left <= 0:
        if has_open_session:
            return "medium", "already past its due date, but a session is currently open on it"
        return "high", "already past its due date"

    if remaining_hours >= hours_left:
        return "high", f"~{remaining_hours:.1f}h of work left but only ~{hours_left:.1f}h until due"

    if remaining_hours >= 0.5 * hours_left:
        if assignee_status == "over_capacitated":
            return "high", "due soon and the assignee is already over capacity"
        return "medium", f"due in ~{hours_left:.1f}h with meaningful work still remaining"

    return None


def _rebalance_suggestions(capacity_rows: list, users_by_id: dict) -> list:
    """Deterministic overloaded<->idle pairing (a suggestion surface, NOT a bin-packing
    optimizer — capped at REBALANCE_SUGGESTION_LIMIT pairs).

    Pairing rule: sort over_capacitated employees by utilization_pct DESCENDING (most
    overloaded first) and available employees by utilization_pct ASCENDING (least
    utilized/most idle first). Walk the overloaded list in that order; for each one, pick
    the first not-yet-suggested available employee who shares at least one `users.skills`
    entry with them (case-insensitive), falling back to simply the least-utilized
    not-yet-suggested available employee if none of the remaining idle pool shares a skill.
    Each available employee is suggested at most once (no double-booking the same idle
    person across multiple pairs).
    """
    overloaded = sorted(
        (r for r in capacity_rows if r["status"] == "over_capacitated"),
        key=lambda r: -r["utilization_pct"],
    )
    idle_pool = sorted(
        (r for r in capacity_rows if r["status"] == "available"),
        key=lambda r: r["utilization_pct"],
    )

    def _skills_of(emp_id: str) -> set:
        user = users_by_id.get(emp_id)
        return {s.strip().lower() for s in (getattr(user, "skills", None) or []) if s}

    used_idle_ids: set = set()
    suggestions = []
    for over in overloaded:
        if len(suggestions) >= REBALANCE_SUGGESTION_LIMIT:
            break
        remaining_idle = [r for r in idle_pool if r["emp_id"] not in used_idle_ids]
        if not remaining_idle:
            break
        over_skills = _skills_of(over["emp_id"])
        match = next(
            (idle for idle in remaining_idle if over_skills & _skills_of(idle["emp_id"])),
            None,
        )
        chosen = match or remaining_idle[0]

        reason = (
            f"{over['emp_name'] or over['emp_id']} is over capacity "
            f"({over['utilization_pct']:.0f}%); {chosen['emp_name'] or chosen['emp_id']} has "
            f"headroom ({chosen['utilization_pct']:.0f}%)"
        )
        if match is not None:
            reason += " and shares at least one skill"

        suggestions.append({
            "overloaded_emp_id": over["emp_id"],
            "idle_emp_id": chosen["emp_id"],
            "reason": reason,
        })
        used_idle_ids.add(chosen["emp_id"])
    return suggestions


def _parse_gemini_insight(text: str) -> dict | None:
    """Parse Gemini's raw text into {"summary": str, "recommendations": [str, ...]}, or None
    if the response isn't usable JSON of that shape. Strips a ```json ... ``` fence if the
    model wrapped its answer in one (common even when explicitly asked not to)."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()

    try:
        parsed = json.loads(cleaned)
    except (ValueError, TypeError):
        return None

    if not isinstance(parsed, dict):
        return None
    summary = parsed.get("summary")
    recommendations = parsed.get("recommendations")
    if not isinstance(summary, str) or not summary.strip():
        return None
    if not isinstance(recommendations, list) or not all(isinstance(r, str) for r in recommendations):
        return None
    return {"summary": summary.strip(), "recommendations": [r.strip() for r in recommendations if r.strip()]}


def _build_insights_prompt(summary_payload: dict) -> str:
    return (
        "You are a decision-support assistant for a team task-management dashboard. Below "
        "is a JSON summary of the current caller's workload scope (their own work, or their "
        "team's, depending on who they manage). Respond with STRICT JSON ONLY — no markdown, "
        "no code fences, no extra commentary — of exactly this shape:\n"
        '{"summary": "<2-3 sentence plain-language summary of the current state>", '
        '"recommendations": ["<short actionable recommendation>", ...]} '
        "with 2 to 4 items in \"recommendations\". Be concise and concrete: reference "
        "specific employees, counts, or statuses from the data where it helps.\n\n"
        f"DATA:\n{json.dumps(summary_payload)}"
    )


def _unavailable_insight(
    reason: str, scope_employee_count: int, at_risk_tasks: list, rebalance_suggestions: list
) -> dict:
    return {
        "available": False,
        "summary": None,
        "recommendations": [],
        "reason": reason,
        "generated_at": get_utc_now_iso(),
        "scope_employee_count": scope_employee_count,
        # Deterministic — populated regardless of Gemini's own availability; see the module
        # comment above this endpoint.
        "at_risk_tasks": at_risk_tasks,
        "rebalance_suggestions": rebalance_suggestions,
    }


@app.get('/insights', status_code=200, summary="AI-generated workload insight & recommendations (org-tree scoped)")
def get_insights(db=Depends(get_db), current_user=Depends(verify_token)):
    """Plain-language summary + 2-4 actionable recommendations for the caller's org-tree
    scope, generated by Gemini from a compact summary of overdue tasks, tasks-by-status, and
    per-employee capacity/utilization (reusing _capacity_for_employee — the exact same
    function GET /capacity uses, so the two endpoints never disagree on utilization math) —
    plus two deterministic (NO Gemini) structures computed independently of Gemini's own
    availability (see the module comment above for exactly why/how).

    Response shape:
        {"available": bool, "summary": str|None, "recommendations": [str], "reason": str|None,
         "generated_at": iso timestamp, "scope_employee_count": int,
         "at_risk_tasks": [{"task_id", "task_name", "assignee_emp_id", "risk_level", "reason"}],
         "rebalance_suggestions": [{"overloaded_emp_id", "idle_emp_id", "reason"}]}
    `available` is False (never a 500) when Gemini isn't configured or every configured key
    failed — `reason` explains why. `at_risk_tasks`/`rebalance_suggestions` are populated
    either way. See the module comment above for caching/TTL details.
    """
    cache_key = f"{_INSIGHTS_CACHE_PREFIX}{current_user.emp_id}"
    cached = redis_get_value(cache_key)
    if cached:
        try:
            return response(status.HTTP_200_OK, message="AI insight fetched (cached)", data=json.loads(cached))
        except (TypeError, ValueError):
            pass  # corrupt cache entry — fall through and regenerate

    scope = get_user_view_scope(db, current_user.emp_id)
    employees = (
        db.query(UserModel)
        .filter(UserModel.emp_id.in_(scope))
        .order_by(UserModel.emp_id)
        .all()
    )
    users_by_id = {e.emp_id: e for e in employees}

    now_dt = utc_now()
    today_date = business_now().date()
    available_seconds_per_day = max(0, BUSINESS_END_HOUR - BUSINESS_START_HOUR) * 3600.0

    # Same capacity data /capacity itself returns — computed unconditionally (Gemini or not)
    # since both deterministic structures below, and the Gemini prompt when it IS available,
    # all depend on it.
    capacity_rows = [
        _capacity_for_employee(db, emp, now_dt, today_date, available_seconds_per_day)
        for emp in employees
    ]
    capacity_by_emp = {r["emp_id"]: r for r in capacity_rows}
    overdue_count = _count_overdue_tasks(db, emp_ids=scope)
    tasks_by_status = _tasks_by_status_for_scope(db, scope)
    over_capacitated = [r for r in capacity_rows if r["status"] == "over_capacitated"]

    # --- Deterministic overdue-risk pass (NO Gemini) — see _task_overdue_risk. -----------
    open_scope_tasks = (
        db.query(TaskModel)
        .filter(
            TaskModel.task_assigned_to.in_(scope),
            TaskModel.task_status.notin_(_SWEEPER_EXCLUDED_STATUSES),
        )
        .all()
    )
    at_risk_tasks = []
    for t in open_scope_tasks:
        if not t.task_assigned_to:
            continue
        assignee_status = capacity_by_emp.get(t.task_assigned_to, {}).get("status")
        risk = _task_overdue_risk(t, now_dt, assignee_status)
        if risk is None:
            continue
        risk_level, reason = risk
        at_risk_tasks.append({
            "task_id": t.id,
            "task_name": t.task_name,
            "assignee_emp_id": t.task_assigned_to,
            "risk_level": risk_level,
            "reason": reason,
        })

    # --- Deterministic rebalance pass (NO Gemini) — see _rebalance_suggestions. -----------
    rebalance_suggestions = _rebalance_suggestions(capacity_rows, users_by_id)

    if not gemini_configured():
        data = _unavailable_insight(
            "AI insight not configured (no GEMINI_API_KEY set).",
            len(employees), at_risk_tasks, rebalance_suggestions,
        )
        return response(status.HTTP_200_OK, message="AI insight not configured", data=data)

    summary_payload = {
        "scope_employee_count": len(employees),
        "overdue_task_count": overdue_count,
        "tasks_by_status": tasks_by_status,
        "employees": [
            {
                "emp_id": r["emp_id"],
                "emp_name": r["emp_name"],
                "utilization_pct": r["utilization_pct"],
                "status": r["status"],
            }
            for r in capacity_rows
        ],
        "over_capacitated_employees": [r["emp_name"] or r["emp_id"] for r in over_capacitated],
        # Fed to Gemini so its narrative summary/recommendations can reference them in plain
        # language — the RESPONSE's own at_risk_tasks/rebalance_suggestions fields below are
        # populated from these same deterministic values regardless of what Gemini returns.
        "at_risk_tasks": at_risk_tasks,
        "rebalance_suggestions": rebalance_suggestions,
    }

    result = call_gemini_with_fallback(_build_insights_prompt(summary_payload))
    parsed = _parse_gemini_insight(result["text"]) if result.get("success") else None

    if parsed:
        data = {
            "available": True,
            "summary": parsed["summary"],
            "recommendations": parsed["recommendations"],
            "reason": None,
            "generated_at": get_utc_now_iso(),
            "scope_employee_count": len(employees),
            "at_risk_tasks": at_risk_tasks,
            "rebalance_suggestions": rebalance_suggestions,
        }
        message = "AI insight generated successfully"
    else:
        reason = (
            result["reason"] if not result.get("success")
            else "Gemini returned a response that couldn't be parsed as the expected insight format."
        )
        data = _unavailable_insight(reason, len(employees), at_risk_tasks, rebalance_suggestions)
        message = "AI insight generation failed"

    redis_set_value(cache_key, json.dumps(data), expiration=INSIGHTS_CACHE_TTL_SECONDS)
    return response(status.HTTP_200_OK, message=message, data=data)


@app.delete('/tasks/{task_id}/sessions', status_code=200)
def delete_task_session(
    task_id: str,
    start_time: str = Body(..., embed=True),
    db=Depends(get_db),
    current_user=Depends(verify_token),
):
    """Manual time correction: remove one work session (matched by its start_time) and
    re-accrue time_spent. For fixing a stray blip / wrong start."""
    db_task = db.query(TaskModel).filter(TaskModel.id == task_id).with_for_update().first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    if not perms.can_modify_task(db, current_user, db_task):
        raise HTTPException(status_code=403, detail="Not authorized to edit this task's sessions")

    sessions = copy.deepcopy(db_task.task_sessions if db_task.task_sessions else [])
    remaining = [s for s in sessions if s.get("start_time") != start_time]
    if len(remaining) == len(sessions):
        raise HTTPException(status_code=404, detail="Session not found")

    db_task.task_sessions = remaining
    flag_modified(db_task, "task_sessions")
    recalculate_total_time(db_task)
    db_task.task_updated_at = utc_now()
    realign_user_tasks(db, db_task.task_assigned_to)

    db.commit()
    db.refresh(db_task)
    notify_change()
    data = TaskRead.from_orm(db_task).dict()
    return response(status.HTTP_200_OK, message="Session removed", data=data)


@app.patch('/tasks/{task_id}/sessions', status_code=200)
def edit_task_session(
    task_id: str,
    start_time: str = Body(..., embed=True),               # identifies the session to edit
    new_start_time: str | None = Body(None, embed=True),
    new_end_time: str | None = Body(None, embed=True),   # omit/null → leave the session open
    db=Depends(get_db),
    current_user=Depends(verify_token),
):
    """Manual time correction: adjust one work session's start/end (matched by its current
    start_time) and re-accrue time_spent. Pass new_end_time=null to keep it open."""
    db_task = db.query(TaskModel).filter(TaskModel.id == task_id).with_for_update().first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not perms.can_modify_task(db, current_user, db_task):
        raise HTTPException(status_code=403, detail="Not authorized to edit this task's sessions")

    sessions = copy.deepcopy(db_task.task_sessions if db_task.task_sessions else [])
    target = next((s for s in sessions if s.get("start_time") == start_time), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Resolve the new boundaries (fall back to the current values when a field is omitted).
    ns = new_start_time if new_start_time is not None else target.get("start_time")
    s_dt = parse_dt(ns)
    if s_dt is None:
        raise HTTPException(status_code=400, detail="Invalid start_time")

    if new_end_time is not None:
        # Caller set an explicit end.
        e_dt = parse_dt(new_end_time)
        if e_dt is None:
            raise HTTPException(status_code=400, detail="Invalid end_time")
        if e_dt <= s_dt:
            raise HTTPException(status_code=400, detail="Session end must be after its start")
        target["end_time"] = e_dt.isoformat()
    elif target.get("end_time"):
        # End omitted but the session was closed — keep its end, re-validate ordering vs new start.
        e_dt = parse_dt(target.get("end_time"))
        if e_dt is not None and e_dt <= s_dt:
            raise HTTPException(status_code=400, detail="Session end must be after its start")
    else:
        # Session was open and stays open.
        target["end_time"] = None

    target["start_time"] = s_dt.isoformat()

    db_task.task_sessions = sessions
    flag_modified(db_task, "task_sessions")
    recalculate_total_time(db_task)
    db_task.task_updated_at = utc_now()
    realign_user_tasks(db, db_task.task_assigned_to)

    db.commit()
    db.refresh(db_task)
    notify_change()
    data = TaskRead.from_orm(db_task).dict()
    return response(status.HTTP_200_OK, message="Session updated", data=data)


@app.post('/tasks/{task_id}/sessions/split', status_code=200)
def split_task_session(
    task_id: str,
    start_time: str = Body(..., embed=True),   # identifies the session to split
    split_at: str = Body(..., embed=True),     # instant to split at (must be strictly inside)
    db=Depends(get_db),
    current_user=Depends(verify_token),
):
    """Manual time correction: split one closed work session into two at `split_at`.
    Both halves keep the original status; time_spent is unchanged in total."""
    db_task = db.query(TaskModel).filter(TaskModel.id == task_id).with_for_update().first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not perms.can_modify_task(db, current_user, db_task):
        raise HTTPException(status_code=403, detail="Not authorized to edit this task's sessions")

    sessions = copy.deepcopy(db_task.task_sessions if db_task.task_sessions else [])
    idx = next((i for i, s in enumerate(sessions) if s.get("start_time") == start_time), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Session not found")

    target = sessions[idx]
    s_dt = parse_dt(target.get("start_time"))
    e_dt = parse_dt(target.get("end_time")) if target.get("end_time") else None
    sp_dt = parse_dt(split_at)
    if s_dt is None or sp_dt is None:
        raise HTTPException(status_code=400, detail="Invalid time value")
    if e_dt is None:
        raise HTTPException(status_code=400, detail="Cannot split an open session")
    if not (s_dt < sp_dt < e_dt):
        raise HTTPException(status_code=400, detail="Split point must be inside the session")

    label = target.get("status")
    first = {"start_time": s_dt.isoformat(), "end_time": sp_dt.isoformat(), "status": label}
    second = {"start_time": sp_dt.isoformat(), "end_time": e_dt.isoformat(), "status": label}
    sessions[idx:idx + 1] = [first, second]

    db_task.task_sessions = sessions
    flag_modified(db_task, "task_sessions")
    recalculate_total_time(db_task)
    db_task.task_updated_at = utc_now()
    realign_user_tasks(db, db_task.task_assigned_to)

    db.commit()
    db.refresh(db_task)
    notify_change()
    data = TaskRead.from_orm(db_task).dict()
    return response(status.HTTP_200_OK, message="Session split", data=data)


@app.get('/tasks/{task_id}/comments', status_code=200)
def list_task_comments(task_id: str, db=Depends(get_db), current_user=Depends(verify_token)):
    """Comment + activity thread for a task, oldest first."""
    task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
    if task and not perms.can_view_task(db, current_user, task):
        raise HTTPException(status_code=403, detail="Not authorized to view this task")
    rows = (
        db.query(TaskCommentModel)
        .filter(TaskCommentModel.task_id == task_id)
        .order_by(TaskCommentModel.created_at.asc(), TaskCommentModel.id.asc())
        .all()
    )
    data = [CommentRead.from_orm(r).dict() for r in rows]
    return response(status.HTTP_200_OK, message="ok", data=data)


@app.post('/tasks/{task_id}/comments', status_code=201, summary="Add a comment to a task")
def add_task_comment(task_id: str, payload: CommentCreate, db=Depends(get_db), current_user=Depends(verify_token)):
    """Anyone who can view the task may comment on it."""
    body = (payload.body or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Comment body cannot be empty")

    task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Only someone who can view the task may comment on it.
    if not perms.can_view_task(db, current_user, task):
        raise HTTPException(status_code=403, detail="Not authorized to comment on this task")

    row = TaskCommentModel(
        task_id=task_id,
        author_id=current_user.emp_id,
        author_name=current_user.emp_name,
        body=body,
        is_system=False,
        created_at=utc_now(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return response(status.HTTP_201_CREATED, message="Comment added", data=CommentRead.from_orm(row).dict())


@app.delete('/comments/{comment_id}', status_code=200, summary="Delete a comment")
def delete_comment(comment_id: int, db=Depends(get_db), current_user=Depends(verify_token)):
    """Author or an admin may delete; system-generated activity-log entries can't be deleted."""
    row = db.query(TaskCommentModel).filter(TaskCommentModel.id == comment_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Comment not found")
    if row.is_system:
        raise HTTPException(status_code=400, detail="Activity-log entries cannot be deleted")
    # Author or an admin may delete.
    if not perms.can_delete_comment(current_user, row):
        raise HTTPException(status_code=403, detail="Not authorized to delete this comment")
    db.delete(row)
    db.commit()
    return response(status.HTTP_200_OK, message="Comment deleted")


@app.get('/notifications', status_code=200)
def list_notifications(db=Depends(get_db), current_user=Depends(verify_token)):
    """Current user's notifications, newest first (unread count included)."""
    rows = (
        db.query(NotificationModel)
        .filter(NotificationModel.user_id == current_user.emp_id)
        .order_by(NotificationModel.created_at.desc(), NotificationModel.id.desc())
        .limit(50)
        .all()
    )
    data = [NotificationRead.from_orm(r).dict() for r in rows]
    unread = sum(1 for r in rows if not r.is_read)
    return response(status.HTTP_200_OK, message="ok", data={"items": data, "unread": unread})


@app.post('/notifications/{notif_id}/read', status_code=200, summary="Mark one notification read")
def mark_notification_read(notif_id: int, db=Depends(get_db), current_user=Depends(verify_token)):
    """Only the owning user's own notification can be marked read."""
    row = (
        db.query(NotificationModel)
        .filter(NotificationModel.id == notif_id, NotificationModel.user_id == current_user.emp_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    row.is_read = True
    db.commit()
    return response(status.HTTP_200_OK, message="ok")


@app.post('/notifications/read-all', status_code=200, summary="Mark all of the current user's notifications read")
def mark_all_notifications_read(db=Depends(get_db), current_user=Depends(verify_token)):
    """Bulk mark-as-read for the current user's own notifications only."""
    db.query(NotificationModel).filter(
        NotificationModel.user_id == current_user.emp_id,
        NotificationModel.is_read == False,  # SQLAlchemy needs == for column filter, not `is`
    ).update({NotificationModel.is_read: True})
    db.commit()
    return response(status.HTTP_200_OK, message="ok")


@app.get('/push/vapid-public-key', status_code=200)
def get_vapid_public_key(current_user=Depends(verify_token)):
    """Public VAPID key the frontend needs to call pushManager.subscribe()."""
    return response(status.HTTP_200_OK, message="ok", data={"public_key": VAPID_PUBLIC_KEY})


@app.post('/push/subscribe', status_code=201)
def subscribe_push(
    payload: PushSubscriptionCreate, db=Depends(get_db), current_user=Depends(verify_token)
):
    """Register (or re-register) a browser's push subscription for the current user.
    Upserts on endpoint so re-subscribing the same browser doesn't create duplicates."""
    existing = db.query(PushSubscriptionModel).filter(
        PushSubscriptionModel.endpoint == payload.endpoint
    ).first()
    if existing:
        existing.user_id = current_user.emp_id
        existing.p256dh = payload.keys.p256dh
        existing.auth = payload.keys.auth
    else:
        db.add(PushSubscriptionModel(
            user_id=current_user.emp_id,
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
            created_at=utc_now(),
        ))
    db.commit()
    return response(status.HTTP_201_CREATED, message="Subscribed")


@app.post('/push/unsubscribe', status_code=200, summary="Remove a browser's push subscription")
def unsubscribe_push(
    payload: PushUnsubscribe, db=Depends(get_db), current_user=Depends(verify_token)
):
    """Deletes the subscription for the current user matching the given endpoint."""
    db.query(PushSubscriptionModel).filter(
        PushSubscriptionModel.endpoint == payload.endpoint,
        PushSubscriptionModel.user_id == current_user.emp_id,
    ).delete()
    db.commit()
    return response(status.HTTP_200_OK, message="Unsubscribed")


@app.get('/tasks/{task_id}/links', status_code=200)
def list_task_links(task_id: str, db=Depends(get_db), current_user=Depends(verify_token)):
    """All structural links touching this task (subtasks, parent, dependencies, dependents)."""
    task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
    if task and not perms.can_view_task(db, current_user, task):
        raise HTTPException(status_code=403, detail="Not authorized to view this task")
    edges = db.query(TaskLinkModel).filter(
        (TaskLinkModel.from_task_id == task_id) | (TaskLinkModel.to_task_id == task_id)
    ).all()
    other_ids = {e.from_task_id for e in edges} | {e.to_task_id for e in edges}
    other_ids.discard(task_id)
    tmap = {}
    if other_ids:
        for t in db.query(TaskModel).filter(TaskModel.id.in_(list(other_ids))).all():
            tmap[t.id] = t

    out = []
    for e in edges:
        outgoing = e.from_task_id == task_id
        other_id = e.to_task_id if outgoing else e.from_task_id
        t = tmap.get(other_id)
        out.append(LinkedTask(
            link_id=e.id,
            link_type=e.link_type,
            task_id=other_id,
            task_ticket_id=t.ticket_id if t else None,
            task_name=t.task_name if t else None,
            task_status=t.task_status if t else None,
            task_priority=t.task_priority if t else None,
            task_assigned_to=t.task_assigned_to if t else None,
            subtask_total=(t.subtask_total or 0) if t else 0,
            subtask_done=(t.subtask_done or 0) if t else 0,
            direction="outgoing" if outgoing else "incoming",
        ).dict())
    return response(status.HTTP_200_OK, message="ok", data=out)


@app.post('/tasks/{task_id}/links', status_code=201, summary="Link two tasks (subtask or dependency)")
def add_task_link(task_id: str, payload: LinkCreate, db=Depends(get_db), current_user=Depends(verify_token)):
    """link_type is 'subtask' or 'depends_on'. Rejects self-links, duplicates, and direct
    reciprocal dependency cycles."""
    link_type = (payload.link_type or "").strip()
    if link_type not in ("subtask", "depends_on"):
        raise HTTPException(status_code=400, detail="link_type must be 'subtask' or 'depends_on'")
    if payload.to_task_id == task_id:
        raise HTTPException(status_code=400, detail="A task cannot link to itself")

    a = db.query(TaskModel).filter(TaskModel.id == task_id).first()
    b = db.query(TaskModel).filter(TaskModel.id == payload.to_task_id).first()
    if not a or not b:
        raise HTTPException(status_code=404, detail="Task not found")

    # Modifying a task's structural links requires modify rights on that task.
    if not perms.can_modify_task(db, current_user, a):
        raise HTTPException(status_code=403, detail="Not authorized to modify this task's links")

    # Duplicate guard
    exists = db.query(TaskLinkModel).filter(
        TaskLinkModel.from_task_id == task_id,
        TaskLinkModel.to_task_id == payload.to_task_id,
        TaskLinkModel.link_type == link_type,
    ).first()
    if exists:
        raise HTTPException(status_code=409, detail="Link already exists")

    # Cycle guard for dependencies (direct reciprocal only — cheap, catches the common case).
    if link_type == "depends_on":
        reciprocal = db.query(TaskLinkModel).filter(
            TaskLinkModel.from_task_id == payload.to_task_id,
            TaskLinkModel.to_task_id == task_id,
            TaskLinkModel.link_type == "depends_on",
        ).first()
        if reciprocal:
            raise HTTPException(status_code=409, detail="That would create a circular dependency")

    # Depth guard for subtasks: capped at 2 levels (story -> subtask), so progress rollup
    # never needs a recursive query.
    if link_type == "subtask":
        depth_error = check_subtask_depth(db, child_id=task_id, parent_id=payload.to_task_id)
        if depth_error:
            raise HTTPException(status_code=409, detail=depth_error)

    row = TaskLinkModel(
        from_task_id=task_id,
        to_task_id=payload.to_task_id,
        link_type=link_type,
        created_at=utc_now(),
    )
    db.add(row)
    try:
        if link_type == "subtask":
            recompute_subtask_counters(db, payload.to_task_id)
        db.commit()
    except IntegrityError:
        # The DB-level unique constraint is the final backstop on the duplicate-guard above
        # (which is SELECT-then-INSERT and has a race window under concurrent requests).
        db.rollback()
        raise HTTPException(status_code=409, detail="Link already exists")
    db.refresh(row)
    notify_change()
    return response(status.HTTP_201_CREATED, message="Link added", data={"id": row.id})


# Bound on a single dependency-graph traversal (scale-gaps-plan.md §A.6) — a pathological
# link web shouldn't be able to blow up a response; "truncated" tells the caller it hit this.
MAX_GRAPH_NODES = 200


@app.get(
    '/tasks/{task_id}/graph', status_code=200,
    summary="Full dependency/subtask graph reachable from a task (not just one hop)",
)
def get_task_graph(task_id: str, db=Depends(get_db), current_user=Depends(verify_token)):
    """`TaskLinks.tsx` / list_task_links only show one hop (this task's direct links). A
    program with dozens of interlinked stories has no way to spot a cycle or a bottleneck
    without clicking through each task one at a time — this BFS-walks every subtask/depends_on
    edge reachable from `task_id` (either direction) so the frontend can render one graph."""
    root = db.query(TaskModel).filter(TaskModel.id == task_id).first()
    if not root:
        raise HTTPException(status_code=404, detail="Task not found")
    if not perms.can_view_task(db, current_user, root):
        raise HTTPException(status_code=403, detail="Not authorized to view this task")

    visited_ids = {task_id}
    frontier = [task_id]
    edges_seen: dict = {}

    while frontier and len(visited_ids) < MAX_GRAPH_NODES:
        batch = db.query(TaskLinkModel).filter(
            TaskLinkModel.from_task_id.in_(frontier) | TaskLinkModel.to_task_id.in_(frontier)
        ).all()
        next_frontier = []
        for e in batch:
            edges_seen[e.id] = e
            for other in (e.from_task_id, e.to_task_id):
                if other not in visited_ids and len(visited_ids) < MAX_GRAPH_NODES:
                    visited_ids.add(other)
                    next_frontier.append(other)
        frontier = next_frontier

    nodes = db.query(TaskModel).filter(TaskModel.id.in_(visited_ids)).all()
    data = {
        "nodes": [
            {
                "id": t.id,
                "ticket_id": t.ticket_id,
                "task_name": t.task_name,
                "task_status": t.task_status,
                "task_priority": t.task_priority,
                "task_assigned_to": t.task_assigned_to,
            }
            for t in nodes
        ],
        "edges": [
            {
                "id": e.id,
                "from_task_id": e.from_task_id,
                "to_task_id": e.to_task_id,
                "link_type": e.link_type,
            }
            for e in edges_seen.values()
        ],
        "truncated": len(visited_ids) >= MAX_GRAPH_NODES,
    }
    return response(status.HTTP_200_OK, message="ok", data=data)


@app.delete('/links/{link_id}', status_code=200, summary="Remove a link between two tasks")
def delete_task_link(link_id: int, db=Depends(get_db), current_user=Depends(verify_token)):
    """Requires modify rights on the link's origin (from_task_id) task."""
    row = db.query(TaskLinkModel).filter(TaskLinkModel.id == link_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Link not found")

    # Removing a link requires modify rights on the task it originates from.
    from_task = db.query(TaskModel).filter(TaskModel.id == row.from_task_id).first()
    if from_task and not perms.can_modify_task(db, current_user, from_task):
        raise HTTPException(status_code=403, detail="Not authorized to modify this task's links")

    is_subtask_link = row.link_type == "subtask"
    parent_id = row.to_task_id
    db.delete(row)
    if is_subtask_link:
        recompute_subtask_counters(db, parent_id)
    db.commit()
    notify_change()
    return response(status.HTTP_200_OK, message="Link removed")


def _epic_rollup(db, epic_id: str) -> tuple:
    """(story_total, story_done, progress_pct) for one epic, computed live from tasks.epic_id.

    A story counts as fully done at 1.0; an in-flight story with its own subtasks counts
    proportionally (subtask_done/subtask_total) rather than 0, so an epic with a few
    half-finished stories doesn't read as 0% until the last one flips to done.
    """
    rows = db.query(
        TaskModel.task_status, TaskModel.subtask_total, TaskModel.subtask_done
    ).filter(TaskModel.epic_id == epic_id).all()
    total = len(rows)
    if not total:
        return 0, 0, 0.0
    done = 0
    progress_sum = 0.0
    for task_status, sub_total, sub_done in rows:
        if (task_status or "").lower() in ["done", "completed"]:
            done += 1
            progress_sum += 1.0
        elif sub_total:
            progress_sum += sub_done / sub_total
    return total, done, round((progress_sum / total) * 100, 1)


def _epic_to_dict(db, epic: EpicModel) -> dict:
    total, done, pct = _epic_rollup(db, epic.id)
    data = EpicRead.from_orm(epic).dict()
    data.update(story_total=total, story_done=done, progress_pct=pct)
    return data


@app.post('/epics', status_code=201, summary="Create an Epic (cross-team initiative above a story)")
def create_epic(payload: EpicCreate, db=Depends(get_db), current_user=Depends(verify_token)):
    """Open to any authenticated user — like open task assignment, an initiative shouldn't
    need admin rank to stand up. Owner defaults to the creator; an admin may hand it to
    someone else at creation time."""
    owner_id = payload.owner_id or current_user.emp_id
    if payload.owner_id:
        owner = db.query(UserModel).filter(UserModel.emp_id == payload.owner_id).first()
        if not owner:
            raise HTTPException(status_code=400, detail="Owner not found")

    epic_id = secrets.token_hex(8)
    ticket_id = f"E-{secrets.randbelow(100000):05d}"
    while db.query(EpicModel).filter(EpicModel.ticket_id == ticket_id).first():
        ticket_id = f"E-{secrets.randbelow(100000):05d}"

    epic = EpicModel(
        id=epic_id,
        ticket_id=ticket_id,
        name=payload.name,
        description=payload.description,
        status=payload.status or "active",
        owner_id=owner_id,
        department=payload.department,
        start_date=payload.start_date,
        target_date=payload.target_date,
        created_by=current_user.emp_id,
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db.add(epic)
    db.commit()
    db.refresh(epic)
    return response(status.HTTP_201_CREATED, message="Epic created", data=_epic_to_dict(db, epic))


@app.get('/epics', status_code=200, summary="List all Epics (company-wide, like the org chart)")
def list_epics(db=Depends(get_db), current_user=Depends(verify_token)):
    """Not org-tree scoped — an epic spans teams by definition, same reasoning as the
    Organization view (plan.md §10): it's shared planning info, not access-gated data."""
    epics = db.query(EpicModel).order_by(EpicModel.created_at.desc()).all()
    return response(status.HTTP_200_OK, message="Epics fetched", data=[_epic_to_dict(db, e) for e in epics])


@app.get('/epics/{epic_id}', status_code=200, summary="Epic detail + its linked stories")
def get_epic(epic_id: str, db=Depends(get_db), current_user=Depends(verify_token)):
    epic = db.query(EpicModel).filter(EpicModel.id == epic_id).first()
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    data = _epic_to_dict(db, epic)
    stories = db.query(TaskModel).filter(TaskModel.epic_id == epic_id).all()
    data["stories"] = [TaskRead.from_orm(t).dict() for t in stories]
    return response(status.HTTP_200_OK, message="Epic fetched", data=data)


@app.put('/epics/{epic_id}', status_code=200, summary="Update an Epic (owner/creator/admin only)")
def update_epic(epic_id: str, payload: EpicUpdate, db=Depends(get_db), current_user=Depends(verify_token)):
    epic = db.query(EpicModel).filter(EpicModel.id == epic_id).with_for_update().first()
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not can_modify_epic(current_user, epic):
        raise HTTPException(status_code=403, detail="Not authorized to modify this epic")

    if payload.owner_id is not None:
        owner = db.query(UserModel).filter(UserModel.emp_id == payload.owner_id).first()
        if not owner:
            raise HTTPException(status_code=400, detail="Owner not found")
        epic.owner_id = payload.owner_id
    if payload.name is not None:
        epic.name = payload.name
    if payload.description is not None:
        epic.description = payload.description
    if payload.status is not None:
        epic.status = payload.status
    if payload.department is not None:
        epic.department = payload.department
    if payload.start_date is not None:
        epic.start_date = payload.start_date
    if payload.target_date is not None:
        epic.target_date = payload.target_date
    epic.updated_at = utc_now()

    db.commit()
    db.refresh(epic)
    return response(status.HTTP_200_OK, message="Epic updated", data=_epic_to_dict(db, epic))


@app.delete('/epics/{epic_id}', status_code=200, summary="Delete an Epic (owner/creator/admin only)")
def delete_epic(epic_id: str, db=Depends(get_db), current_user=Depends(verify_token)):
    """Detaches (does not delete) its linked stories — tasks.epic_id is ON DELETE SET NULL,
    matching how deleting a user detaches their tasks rather than deleting them."""
    epic = db.query(EpicModel).filter(EpicModel.id == epic_id).with_for_update().first()
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")
    if not can_modify_epic(current_user, epic):
        raise HTTPException(status_code=403, detail="Not authorized to delete this epic")
    db.delete(epic)
    db.commit()
    return response(status.HTTP_200_OK, message="Epic deleted")


def _sprint_status(sprint: SprintModel) -> str:
    """'upcoming' | 'active' | 'completed', derived from start_date/end_date vs now — never
    stored, so it can't drift stale (same reasoning as Epic's live-computed rollup)."""
    now = utc_now()
    if now < sprint.start_date:
        return "upcoming"
    if now > sprint.end_date:
        return "completed"
    return "active"


def _sprint_rollup(db, sprint_id: str) -> dict:
    """(task_total, task_done, total_hours, completed_hours) for one sprint, computed live
    from tasks.sprint_id. `total_hours`/`completed_hours` use task_duration (hours) as the
    "scope" unit — the same unit /capacity and the timeline already use — since this app has
    no separate story-points field."""
    rows = db.query(TaskModel.task_status, TaskModel.task_duration).filter(
        TaskModel.sprint_id == sprint_id
    ).all()
    total = len(rows)
    done = 0
    total_hours = 0.0
    completed_hours = 0.0
    for task_status, duration in rows:
        hrs = parse_duration(duration) if duration else 0.0
        total_hours += hrs
        if (task_status or "").lower() in ["done", "completed"]:
            done += 1
            completed_hours += hrs
    return {
        "task_total": total,
        "task_done": done,
        "total_hours": round(total_hours, 2),
        "completed_hours": round(completed_hours, 2),
    }


def _sprint_to_dict(db, sprint: SprintModel) -> dict:
    data = SprintRead.from_orm(sprint).dict()
    data["status_label"] = _sprint_status(sprint)
    data.update(_sprint_rollup(db, sprint.id))
    return data


@app.post('/sprints', status_code=201, summary="Create a Sprint/Cycle")
def create_sprint(payload: SprintCreate, db=Depends(get_db), current_user=Depends(verify_token)):
    """Open to any authenticated user, same as Epics — a team lead shouldn't need admin rank
    to start planning in cycles."""
    if payload.end_date <= payload.start_date:
        raise HTTPException(status_code=400, detail="end_date must be after start_date")

    sprint = SprintModel(
        id=secrets.token_hex(8),
        name=payload.name,
        start_date=payload.start_date,
        end_date=payload.end_date,
        created_by=current_user.emp_id,
        created_at=utc_now(),
    )
    db.add(sprint)
    db.commit()
    db.refresh(sprint)
    return response(status.HTTP_201_CREATED, message="Sprint created", data=_sprint_to_dict(db, sprint))


@app.get('/sprints', status_code=200, summary="List all Sprints/Cycles (company-wide)")
def list_sprints(db=Depends(get_db), current_user=Depends(verify_token)):
    """Not org-tree scoped — a sprint/cycle is a shared planning cadence, same reasoning as
    Epics and the Organization view."""
    sprints = db.query(SprintModel).order_by(SprintModel.start_date.desc()).all()
    return response(status.HTTP_200_OK, message="Sprints fetched", data=[_sprint_to_dict(db, s) for s in sprints])


@app.get('/sprints/{sprint_id}', status_code=200, summary="Sprint detail + linked tasks")
def get_sprint(sprint_id: str, db=Depends(get_db), current_user=Depends(verify_token)):
    sprint = db.query(SprintModel).filter(SprintModel.id == sprint_id).first()
    if not sprint:
        raise HTTPException(status_code=404, detail="Sprint not found")
    data = _sprint_to_dict(db, sprint)
    tasks = db.query(TaskModel).filter(TaskModel.sprint_id == sprint_id).all()
    data["tasks"] = [TaskRead.from_orm(t).dict() for t in tasks]
    return response(status.HTTP_200_OK, message="Sprint fetched", data=data)


@app.put('/sprints/{sprint_id}', status_code=200, summary="Update a Sprint/Cycle (creator/admin only)")
def update_sprint(sprint_id: str, payload: SprintUpdate, db=Depends(get_db), current_user=Depends(verify_token)):
    sprint = db.query(SprintModel).filter(SprintModel.id == sprint_id).with_for_update().first()
    if not sprint:
        raise HTTPException(status_code=404, detail="Sprint not found")
    if not can_modify_sprint(current_user, sprint):
        raise HTTPException(status_code=403, detail="Not authorized to modify this sprint")

    new_start = payload.start_date or sprint.start_date
    new_end = payload.end_date or sprint.end_date
    if new_end <= new_start:
        raise HTTPException(status_code=400, detail="end_date must be after start_date")

    if payload.name is not None:
        sprint.name = payload.name
    sprint.start_date = new_start
    sprint.end_date = new_end

    db.commit()
    db.refresh(sprint)
    return response(status.HTTP_200_OK, message="Sprint updated", data=_sprint_to_dict(db, sprint))


@app.delete('/sprints/{sprint_id}', status_code=200, summary="Delete a Sprint/Cycle (creator/admin only)")
def delete_sprint(sprint_id: str, db=Depends(get_db), current_user=Depends(verify_token)):
    """Detaches (does not delete) its linked tasks — tasks.sprint_id is ON DELETE SET NULL."""
    sprint = db.query(SprintModel).filter(SprintModel.id == sprint_id).with_for_update().first()
    if not sprint:
        raise HTTPException(status_code=404, detail="Sprint not found")
    if not can_modify_sprint(current_user, sprint):
        raise HTTPException(status_code=403, detail="Not authorized to delete this sprint")
    db.delete(sprint)
    db.commit()
    return response(status.HTTP_200_OK, message="Sprint deleted")


@app.get(
    '/sprints/{sprint_id}/burndown', status_code=200,
    summary="Ideal vs actual burndown for a Sprint/Cycle",
)
def get_sprint_burndown(sprint_id: str, db=Depends(get_db), current_user=Depends(verify_token)):
    """Derived, not stored: there's no per-day snapshot table (and none is needed) — the
    actual curve is reconstructed from each linked task's own `completed_at` timestamp
    against the sprint's total scope (task_duration hours). A future day's
    `actual_remaining_hours` is null (not 0) — it isn't knowable yet, and the frontend chart
    should show "no data" there, not a fabricated flat line."""
    sprint = db.query(SprintModel).filter(SprintModel.id == sprint_id).first()
    if not sprint:
        raise HTTPException(status_code=404, detail="Sprint not found")

    tasks = db.query(TaskModel).filter(TaskModel.sprint_id == sprint_id).all()
    total_hours = sum(parse_duration(t.task_duration) or 0.0 for t in tasks)

    start = sprint.start_date.astimezone(ZoneInfo(BUSINESS_TZ)).date()
    end = sprint.end_date.astimezone(ZoneInfo(BUSINESS_TZ)).date()
    today = business_now().date()
    num_days = max(1, (end - start).days + 1)

    points = []
    for i in range(num_days):
        d = start + timedelta(days=i)
        ideal = total_hours * (1 - i / (num_days - 1)) if num_days > 1 else 0.0
        if d > today:
            actual = None
        else:
            completed_by_day = sum(
                parse_duration(t.task_duration) or 0.0
                for t in tasks
                if t.completed_at and t.completed_at.astimezone(ZoneInfo(BUSINESS_TZ)).date() <= d
            )
            actual = round(max(0.0, total_hours - completed_by_day), 2)
        points.append(BurndownPoint(
            date=d.isoformat(), ideal_remaining_hours=round(ideal, 2), actual_remaining_hours=actual,
        ))

    data = BurndownResponse(sprint_id=sprint_id, total_hours=round(total_hours, 2), points=points).dict()
    return response(status.HTTP_200_OK, message="ok", data=data)


# Attachments are stored inline as base64 (no object storage needed). Images only, capped
# to keep rows small — enough for screenshots/photos, not a general file-upload feature.
ALLOWED_ATTACHMENT_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"}
MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024  # 5 MB raw (base64 payload runs ~33% larger)


def build_task_attachment(task_id: str, uploaded_by: str, payload, strict: bool = True):
    """Validate + build a (not yet added/committed) TaskAttachmentModel from an
    AttachmentCreate-shaped payload. Shared by the standalone upload endpoint (strict=True,
    raises HTTPException on a bad file) and inline task-creation attachments (strict=False,
    silently skips a bad file rather than failing the whole task create — the frontend already
    validates client-side, so this should be rare)."""
    raw = payload.data or ""
    content_type = payload.content_type
    b64_part = raw

    # Accept a data URI ("data:image/png;base64,....") and pull the declared type from it —
    # more reliable than trusting a client-supplied content_type field.
    if raw.startswith("data:"):
        header, _, tail = raw.partition(",")
        b64_part = tail
        mime = header[5:].split(";")[0] if header.startswith("data:") else None
        if mime:
            content_type = mime

    if content_type not in ALLOWED_ATTACHMENT_TYPES:
        if strict:
            raise HTTPException(
                status_code=400,
                detail=f"Only image attachments are allowed ({', '.join(sorted(ALLOWED_ATTACHMENT_TYPES))})",
            )
        return None

    # Validate size from the decoded bytes, not the base64 string length.
    try:
        decoded_len = len(base64.b64decode(b64_part, validate=True))
    except ValueError:  # binascii.Error (bad padding/charset) is a ValueError subclass
        if strict:
            raise HTTPException(status_code=400, detail="Invalid base64 image data")
        return None
    if decoded_len > MAX_ATTACHMENT_BYTES:
        if strict:
            raise HTTPException(
                status_code=400,
                detail=f"Attachment too large (max {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB)",
            )
        return None

    return TaskAttachmentModel(
        task_id=task_id,
        filename=payload.filename,
        content_type=content_type,
        data=raw,
        uploaded_by=uploaded_by,
        created_at=utc_now(),
    )


@app.get('/tasks/{task_id}/attachments', status_code=200)
def list_task_attachments(task_id: str, db=Depends(get_db), current_user=Depends(verify_token)):
    """Image attachments for a task, oldest first."""
    task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
    if task and not perms.can_view_task(db, current_user, task):
        raise HTTPException(status_code=403, detail="Not authorized to view this task")
    rows = (
        db.query(TaskAttachmentModel)
        .filter(TaskAttachmentModel.task_id == task_id)
        .order_by(TaskAttachmentModel.created_at.asc(), TaskAttachmentModel.id.asc())
        .all()
    )
    data = [AttachmentRead.from_orm(r).dict() for r in rows]
    return response(status.HTTP_200_OK, message="ok", data=data)


@app.post('/tasks/{task_id}/attachments', status_code=201)
def add_task_attachment(
    task_id: str, payload: AttachmentCreate, db=Depends(get_db), current_user=Depends(verify_token)
):
    """Upload an image attachment (base64 data URI, e.g. from a <input type=file> FileReader)."""
    task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not perms.can_view_task(db, current_user, task):
        raise HTTPException(status_code=403, detail="Not authorized to attach files to this task")

    row = build_task_attachment(task_id, current_user.emp_id, payload, strict=True)
    db.add(row)
    db.commit()
    db.refresh(row)
    notify_change()
    return response(status.HTTP_201_CREATED, message="Attachment added", data=AttachmentRead.from_orm(row).dict())


@app.delete('/attachments/{attachment_id}', status_code=200, summary="Delete a task attachment")
def delete_task_attachment(attachment_id: int, db=Depends(get_db), current_user=Depends(verify_token)):
    """Uploader, or anyone who can modify the parent task, may delete it."""
    row = db.query(TaskAttachmentModel).filter(TaskAttachmentModel.id == attachment_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Attachment not found")

    task = db.query(TaskModel).filter(TaskModel.id == row.task_id).first()
    # Uploader, or anyone who can modify the task, may delete it.
    allowed = row.uploaded_by == current_user.emp_id or (
        task and perms.can_modify_task(db, current_user, task)
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Not authorized to delete this attachment")

    db.delete(row)
    db.commit()
    notify_change()
    return response(status.HTTP_200_OK, message="Attachment removed")


@app.post('/users/upload', status_code=200, summary="Bulk-create users from a CSV (admin only)")
async def upload_users(file: UploadFile = File(...), db=Depends(get_db), current_user=Depends(require_user_admin)):
    """Skips (rather than fails) rows that are malformed, reference an unknown designation,
    or already exist; manager_id links are resolved in a second pass after all rows are
    inserted. Returns a per-row skip reason list so the admin can fix the CSV.

    A `dept_admin` (scale-gaps-plan.md Phase 3, item 3) gets every created row force-assigned
    to their OWN department regardless of what the CSV's `emp_department` column says (a
    silent override, not a per-row skip — the CSV's department column just isn't meaningful
    input from a dept_admin), and any row targeting the rank>=EM management tier is skipped
    with a reason (a department-scoped grant must not be able to mint a new org-wide admin)."""
    caller_is_dept_admin = perms.is_dept_admin(current_user) and not perms.is_admin(current_user)
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="File must be a CSV")
    
    content = await file.read()
    # Decode logic
    try:
        decoded = content.decode('utf-8')
    except UnicodeDecodeError:
        # Fallback or error
        decoded = content.decode('latin-1')
        
    csv_reader = csv.DictReader(io.StringIO(decoded))

    def clean(v):
        v = (v or "").strip()
        return v or None

    def parse_education(v):
        v = clean(v)
        if not v:
            return None
        parts = [p.strip() for p in v.replace("|", ";").split(";") if p.strip()]
        return parts or None

    added_count = 0
    skipped = []            # {emp_id, reason} — surfaced so the admin can fix the CSV
    pending_managers = {}   # emp_id -> manager emp_id (applied after all users exist, FK-safe)

    for row in csv_reader:
        emp_id = clean(row.get("emp_id"))
        emp_name = clean(row.get("emp_name"))
        emp_email = clean(row.get("emp_email"))
        if not emp_id or not emp_name or not emp_email:
            skipped.append({"emp_id": emp_id or "?", "reason": "missing emp_id / emp_name / emp_email"})
            continue

        designation = clean(row.get("emp_designation"))
        # Roles are strict now — reject unknown designations rather than silently mis-ranking.
        if designation and perms.get_rank(designation) == 0:
            skipped.append({"emp_id": emp_id, "reason": f"unknown designation '{designation}'"})
            continue
        if caller_is_dept_admin and perms.get_rank(designation) >= perms.RANK_EM:
            skipped.append({
                "emp_id": emp_id,
                "reason": f"department admins cannot create management-tier users (designation '{designation}')",
            })
            continue

        row_department = clean(row.get("emp_department"))
        if caller_is_dept_admin:
            row_department = current_user.emp_department

        existing = db.query(UserModel).filter(
            (UserModel.emp_id == emp_id) | (UserModel.emp_email == emp_email)
        ).first()
        if existing:
            skipped.append({"emp_id": emp_id, "reason": "already exists"})
            continue

        db.add(UserModel(
            emp_name=emp_name,
            emp_id=emp_id,
            emp_email=emp_email,
            emp_phone=clean(row.get("emp_phone")),
            emp_designation=designation,
            emp_department=row_department,
            manager_id=None,  # set in the 2nd pass (safe under the manager_id FK)
            company=clean(row.get("company")),
            legal_entity=clean(row.get("legal_entity")),
            gender=clean(row.get("gender")),
            work_location=clean(row.get("work_location")),
            date_of_joining=clean(row.get("date_of_joining")),
            date_of_birth=clean(row.get("date_of_birth")),
            blood_group=clean(row.get("blood_group")),
            payscale=clean(row.get("payscale")),
            education=parse_education(row.get("education")),
            linkedin=clean(row.get("linkedin")),
            profile_pic=clean(row.get("profile_pic")),
        ))
        # Flush before adding the matching Foundation row: without it, the two inserts in
        # this same commit can reach Postgres in either order despite being add()ed
        # User-then-Foundation — SQLAlchemy's flush ordering across unrelated mapper classes
        # isn't guaranteed by add() order alone, and Foundation.emp_id's FK requires the User
        # row to already exist. (seed_demo.py avoids this by committing all Users
        # before any Foundation row — a real bug this endpoint had until now, only ever
        # exercised against Postgres, which is why SQLite-backed tests never caught it: SQLite
        # doesn't enforce FK constraints unless PRAGMA foreign_keys=ON, which this app doesn't set.)
        db.flush()
        db.add(Foundation(
            emp_id=emp_id,
            password=hash_password(clean(row.get("password")) or "123456"),
            token=None,
        ))
        mgr = clean(row.get("manager_id"))
        if mgr:
            pending_managers[emp_id] = mgr
        added_count += 1

    record_audit(
        db, current_user, "user.csv_import", target_type="user",
        details={"added": added_count, "skipped": len(skipped)},
    )

    db.commit()

    # 2nd pass: assign managers now that every user exists (order-independent + FK-safe).
    # A manager referenced but not present (in this file or the DB) is left unset.
    for emp_id, mgr in pending_managers.items():
        if db.query(UserModel).filter(UserModel.emp_id == mgr).first():
            db.query(UserModel).filter(UserModel.emp_id == emp_id).update({UserModel.manager_id: mgr})
    db.commit()

    return response(
        status.HTTP_200_OK,
        message="Bulk upload complete",
        data={"added": added_count, "skipped": len(skipped), "skipped_detail": skipped[:50]},
    )


@app.post('/tasks/upload', status_code=200, summary="Bulk-create tasks from a CSV")
async def upload_tasks(file: UploadFile = File(...), db=Depends(get_db), current_user=Depends(verify_token)):
    """All-or-nothing: every row is validated first, and the whole batch is rejected on the
    first error (unlike /users/upload, which skips bad rows).

    Optional columns support bulk subtask creation (scale-gaps-plan.md §A.4 — previously a
    CSV import couldn't stage subtasks at all, only POST /tasks's `subtasks` field or
    POST /tasks/{id}/subtasks could add one):
      - `row_ref` — an arbitrary string, unique within THIS file, so another row can point at
        it before it has a real id.
      - `subtask_of` — either another row's `row_ref` (same file) or an EXISTING task's real
        `id` — marks this row as a subtask of that target instead of a standalone story.
      - `epic_id` — an existing Epic's id, to roll this story up into it directly from CSV.
    """
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    content = await file.read()
    try:
        decoded = content.decode('utf-8')
    except UnicodeDecodeError:
         decoded = content.decode('latin-1')

    csv_reader = csv.DictReader(io.StringIO(decoded))
    rows = list(csv_reader)

    # Pre-validation: "if any issue in format or type then only retun error"
    # We will iterate first to validate, then insert if all good.
    # Or insert incrementally and rollback?
    # Validating first is safer for "retun error that this field is required".

    validated_tasks = []
    row_ref_to_id = {}
    seen_refs = set()

    for line_num, row in enumerate(rows, start=1):
        # Validate required fields
        if not row.get("task_name"):
            raise HTTPException(status_code=400, detail=f"Row {line_num}: task_name is required")
        if not row.get("task_assigned_to"):
            raise HTTPException(status_code=400, detail=f"Row {line_num}: task_assigned_to is required")

        # Validate Duration != 0
        duration = row.get("task_duration", "0") # Default to 0 if missing -> error
        if duration == "0":
             raise HTTPException(status_code=400, detail=f"Row {line_num}: task_duration cannot be 0")

        # Validate Assigned User Existence
        assigned_id = row.get("task_assigned_to")
        user = db.query(UserModel).filter(UserModel.emp_id == assigned_id).first()
        if not user:
            raise HTTPException(status_code=400, detail=f"Row {line_num}: Assigned user '{assigned_id}' not found")

        # Validate Rank Logic
        validate_assignee_eligibility(user)

        epic_id = (row.get("epic_id") or "").strip() or None
        if epic_id and not db.query(EpicModel).filter(EpicModel.id == epic_id).first():
            raise HTTPException(status_code=400, detail=f"Row {line_num}: epic_id '{epic_id}' not found")

        # ID Handling: If missing, generate.
        task_id = row.get("id")
        if not task_id:
            task_id = secrets.token_hex(8) # Generate random ID

        row_ref = (row.get("row_ref") or "").strip() or None
        if row_ref:
            if row_ref in seen_refs:
                raise HTTPException(status_code=400, detail=f"Row {line_num}: duplicate row_ref '{row_ref}'")
            seen_refs.add(row_ref)
            row_ref_to_id[row_ref] = task_id

        validated_tasks.append(
            dict(row, id=task_id, task_duration=duration, epic_id=epic_id, row_ref=row_ref, line_num=line_num)
        )

    # Resolve subtask_of -> a real parent id. Second pass since a row_ref can be defined
    # AFTER the row that references it (CSV rows have no inherent order requirement).
    subtasks_per_parent: dict = {}
    for item in validated_tasks:
        raw_parent = (item.get("subtask_of") or "").strip()
        if not raw_parent:
            item["_parent_id"] = None
            continue
        if raw_parent == item["id"] or raw_parent == item.get("row_ref"):
            raise HTTPException(
                status_code=400, detail=f"Row {item['line_num']}: a task cannot be a subtask of itself"
            )

        if raw_parent in row_ref_to_id:
            parent_id = row_ref_to_id[raw_parent]
            parent_row = next((r for r in validated_tasks if r["id"] == parent_id), None)
            if parent_row and (parent_row.get("subtask_of") or "").strip():
                raise HTTPException(
                    status_code=400,
                    detail=f"Row {item['line_num']}: its parent (row_ref '{raw_parent}') is "
                    "itself marked as a subtask in this file — subtasks can't be nested",
                )
        else:
            parent_task = db.query(TaskModel).filter(TaskModel.id == raw_parent).first()
            if not parent_task:
                raise HTTPException(
                    status_code=400,
                    detail=f"Row {item['line_num']}: subtask_of '{raw_parent}' matches no row_ref "
                    "in this file and no existing task id",
                )
            depth_error = check_subtask_depth(db, child_id=item["id"], parent_id=raw_parent)
            if depth_error:
                raise HTTPException(status_code=400, detail=f"Row {item['line_num']}: {depth_error}")
            parent_id = raw_parent

        item["_parent_id"] = parent_id
        subtasks_per_parent.setdefault(parent_id, []).append(item["line_num"])

    for parent_id, line_nums in subtasks_per_parent.items():
        if len(line_nums) > MAX_SUBTASKS_PER_REQUEST:
            raise HTTPException(
                status_code=400,
                detail=f"Rows {line_nums}: more than {MAX_SUBTASKS_PER_REQUEST} subtasks target "
                "the same parent in one upload — split the rest into a follow-up batch",
            )

    # All validated, insert them
    count = 0
    try:
        for item in validated_tasks:
            # Check ID duplication logic if ID was provided
            # If generated, likelihood of collision is low, but checked below.
            if db.query(TaskModel).filter(TaskModel.id == item["id"]).first():
                 # Should we fail or skip? "make new api to accept files... if any issue ... return error"
                 # Duplicate ID is an issue.
                 raise HTTPException(status_code=400, detail=f"Task ID {item['id']} already exists")

            db_task = TaskModel(
                id=item["id"],
                task_name=item.get("task_name"),
                task_description=item.get("task_description"),
                task_status=item.get("task_status", "todo"),
                task_assigned_to=item.get("task_assigned_to"),
                task_assigned_by=item.get("task_assigned_by"),
                task_assigned_date=parse_dt(item.get("task_assigned_date")),
                task_due_date=parse_dt(item.get("task_due_date")),
                task_priority=item.get("task_priority"),
                task_tags=item.get("task_tags"),
                task_notes=item.get("task_notes"),
                task_created_at=parse_dt(item.get("task_created_at")),
                task_updated_at=parse_dt(item.get("task_updated_at")),
                task_duration=item.get("task_duration"),
                epic_id=item.get("epic_id"),
            )
            db.add(db_task)
            count += 1

        # task_links rows need every parent id to already exist in the session (flushed
        # below) — including brand-new in-batch parents, since from_task_id/to_task_id are
        # real FKs onto tasks.id.
        for item in validated_tasks:
            if item.get("_parent_id"):
                db.add(TaskLinkModel(
                    from_task_id=item["id"],
                    to_task_id=item["_parent_id"],
                    link_type="subtask",
                    created_at=utc_now(),
                ))

        db.flush()
        for parent_id in subtasks_per_parent:
            recompute_subtask_counters(db, parent_id)

        record_audit(
            db, current_user, "task.csv_import", target_type="task",
            details={"added": count},
        )

        db.commit()
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — bulk CSV insert: any row/DB failure rolls the whole
        db.rollback()  # batch back and reports a clean 400 to the uploading admin, not a 500
        raise HTTPException(status_code=400, detail=f"Database error: {e!s}")

    return response(
        status.HTTP_200_OK, message="Bulk upload successful",
        data={"added": count, "subtasks_linked": sum(1 for i in validated_tasks if i.get("_parent_id"))},
    )