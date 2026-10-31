"""The demo seed is lively right after "Try the demo": today's work sessions (completed and
running) inside working hours, on-hold work, one overdue task, tasks due today/tomorrow,
comments and a subtask — laid out relative to the creation time in the business timezone.
"""
from collections import Counter
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from models import Task, TaskComment, TaskLink, User
from task_helpers import BUSINESS_END_HOUR, BUSINESS_START_HOUR, BUSINESS_TZ, parse_dt

from tests.test_demo import start_demo

TZ = ZoneInfo(BUSINESS_TZ)
FINISHED = ("done", "completed")


@pytest.fixture
def demo_on(monkeypatch):
    monkeypatch.setenv("DEMO_MODE_ENABLED", "true")
    monkeypatch.delenv("DEMO_MAX_PER_IP_PER_HOUR", raising=False)
    monkeypatch.delenv("DEMO_MAX_LIVE_WORKSPACES", raising=False)


def local(y, m, d, hh, mm=0):
    """A business-timezone wall-clock time as an aware UTC datetime."""
    return datetime(y, m, d, hh, mm, tzinfo=TZ).astimezone(timezone.utc)


def make_demo(client, freeze_now, db_session, now):
    freeze_now(now)
    r = start_demo(client)
    assert r.status_code == 200, r.text
    db_session.expire_all()
    return db_session.query(Task).all()


def sessions_of(tasks):
    for t in tasks:
        for s in t.task_sessions or []:
            yield t, parse_dt(s["start_time"]), parse_dt(s.get("end_time"))


def assert_inside_working_hours(tasks, now):
    for t, start, end in sessions_of(tasks):
        a = start.astimezone(TZ)
        b = (end or now).astimezone(TZ)
        assert a.date() == b.date(), t.task_name
        assert a.time() >= time(BUSINESS_START_HOUR), (t.task_name, a)
        assert b.time() <= time(BUSINESS_END_HOUR), (t.task_name, b)
        assert start < (end or now) <= now, t.task_name
    by_person = {}
    for t, start, end in sessions_of(tasks):
        by_person.setdefault(t.task_assigned_to, []).append((start, end or now))
    for spans in by_person.values():  # nobody works two things at once
        spans.sort()
        assert all(a[1] <= b[0] for a, b in zip(spans, spans[1:]))


def test_midday_demo_has_today_sessions_for_most_people(client, demo_on, db_session, freeze_now):
    now = local(2026, 3, 11, 15, 30)  # a Wednesday afternoon
    tasks = make_demo(client, freeze_now, db_session, now)
    today = now.astimezone(TZ).date()
    assert_inside_working_hours(tasks, now)

    worked_today = {t.task_assigned_to for t, s, _ in sessions_of(tasks) if s.astimezone(TZ).date() == today}
    assert len(worked_today) >= 9  # of 12

    running = [(t, s) for t, s, e in sessions_of(tasks) if e is None]
    assert len(running) >= 4
    assert all(t.task_status == "in-progress" for t, _ in running)
    per_person = Counter(t.task_assigned_to for t, _ in running)
    assert max(per_person.values()) == 1  # one live timer per person

    # Earlier days have history too (Week / Reports views).
    assert any(s.astimezone(TZ).date() < today for _, s, _ in sessions_of(tasks))

    # time_spent is the sum of closed sessions, in hours.
    for t in tasks:
        closed = sum(((e - s).total_seconds() for s, e in
                      ((parse_dt(x["start_time"]), parse_dt(x.get("end_time"))) for x in t.task_sessions or [])
                      if e), 0.0)
        assert t.time_spent == pytest.approx(closed / 3600.0), t.task_name

    statuses = Counter(t.task_status for t in tasks)
    assert statuses["on-hold"] >= 2

    open_tasks = [t for t in tasks if t.task_status not in FINISHED]
    overdue = [t for t in open_tasks if parse_dt(t.task_due_date) < now]
    assert len(overdue) == 1
    due_dates = [parse_dt(t.task_due_date).astimezone(TZ).date() for t in open_tasks]
    assert today in due_dates
    assert today + timedelta(days=1) in due_dates

    # Something was finished today, after its last session.
    done_today = [t for t in tasks if t.task_status in FINISHED and t.completed_at
                  and parse_dt(t.completed_at).astimezone(TZ).date() == today]
    assert done_today
    for t in done_today:
        assert parse_dt(t.completed_at) <= now

    comments = db_session.query(TaskComment).all()
    assert len(comments) >= 3
    names = {u.emp_id: u.emp_name for u in db_session.query(User)}
    for c in comments:
        assert c.author_name == names[c.author_id]
        assert parse_dt(c.created_at) <= now
    assert db_session.query(TaskLink).filter(TaskLink.link_type == "subtask").count() >= 3


def test_early_morning_demo_has_nothing_in_the_future(client, demo_on, db_session, freeze_now):
    now = local(2026, 3, 11, 8, 0)  # before the working day starts
    tasks = make_demo(client, freeze_now, db_session, now)
    assert_inside_working_hours(tasks, now)
    assert not [1 for _, _, e in sessions_of(tasks) if e is None]
    assert sum(1 for _ in sessions_of(tasks)) >= 10  # yesterday's work is shown instead


def test_evening_demo_closes_sessions_at_end_of_day(client, demo_on, db_session, freeze_now):
    now = local(2026, 3, 11, 21, 15)
    tasks = make_demo(client, freeze_now, db_session, now)
    assert_inside_working_hours(tasks, now)
    assert not [1 for _, _, e in sessions_of(tasks) if e is None]
    open_tasks = [t for t in tasks if t.task_status not in FINISHED]
    assert len([t for t in open_tasks if parse_dt(t.task_due_date) < now]) == 1


def test_sessions_today_start_at_the_beginning_of_the_working_day(client, demo_on, db_session, freeze_now):
    now = local(2026, 3, 11, 10, 45)  # only 45 minutes into the day
    tasks = make_demo(client, freeze_now, db_session, now)
    assert_inside_working_hours(tasks, now)
    today = now.astimezone(TZ).date()
    assert any(s.astimezone(TZ).date() == today for _, s, _ in sessions_of(tasks))
