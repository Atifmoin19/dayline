"""POST /demo personas and ticket-id uniqueness.

Each persona logs in as a specific Quillbrook Labs person and sees that person's org-tree
scope: the CTO sees everyone, the tech lead sees their two reports, ICs see only themselves.
"""
import random

import pytest

import seed_loader
from models import Task

from tests.test_demo import bearer, start_demo, task_items


@pytest.fixture
def demo_on(monkeypatch):
    monkeypatch.setenv("DEMO_MODE_ENABLED", "true")
    monkeypatch.setenv("DEMO_MAX_PER_IP_PER_HOUR", "1000")
    monkeypatch.setenv("DEMO_MAX_LIVE_WORKSPACES", "1000")
    monkeypatch.delenv("DEMO_TTL_HOURS", raising=False)


@pytest.mark.parametrize("persona,name,scope_names", [
    ("manager", "Odile Marchetti", None),  # None = the whole org (12 people)
    ("team_lead", "Wren Takahashi", {"Wren Takahashi", "Mira Okafor", "Tomas Lindqvist"}),
    ("employee_1", "Mira Okafor", {"Mira Okafor"}),
    ("employee_2", "Saoirse Brannigan", {"Saoirse Brannigan"}),
    ("developer", "Mira Okafor", {"Mira Okafor"}),  # backwards-compatible alias of employee_1
])
def test_persona_logs_in_as_the_right_person_with_the_right_scope(client, demo_on, persona, name, scope_names):
    r = start_demo(client, persona=persona)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["userData"]["emp_name"] == name
    assert data["demo"]["persona"] == persona
    h = bearer(r)

    directory = {u["emp_id"]: u["emp_name"] for u in client.get("/user", headers=h).json()["data"]}
    expected = set(directory.values()) if scope_names is None else scope_names
    assert len(directory) == 12

    insight = client.get("/insights", headers=h).json()["data"]
    assert insight["scope_employee_count"] == len(expected)

    assignees = {directory[t["task_assigned_to"]] for t in task_items(client.get("/tasks", headers=h))}
    assert assignees <= expected
    assert name in assignees  # every persona has work of their own
    if scope_names is None:
        assert len(assignees) >= 10


def test_employee_personas_are_on_different_teams(client, demo_on):
    one = start_demo(client, persona="employee_1").json()["data"]["userData"]
    two = start_demo(client, persona="employee_2").json()["data"]["userData"]
    assert one["emp_department"] != two["emp_department"]


def test_many_demo_workspaces_never_collide_on_ticket_ids(client, demo_on, db_session):
    for _ in range(20):
        r = start_demo(client)
        assert r.status_code == 200, r.text
    tickets = [t for (t,) in db_session.query(Task.ticket_id)]
    assert len(tickets) == len(set(tickets)) == 20 * len(seed_loader.load_seed()["tasks"])


def test_ticket_ids_stay_unique_when_the_random_space_is_tiny(client, demo_on, db_session, monkeypatch):
    """Force collisions: draws come from only 300 values, so within one workspace and across
    workspaces the same number is drawn again and again. Every ticket must still be unique."""
    rng = random.Random(7)
    monkeypatch.setattr(seed_loader.secrets, "randbelow", lambda n: rng.randrange(min(n, 300)))
    for _ in range(5):
        r = start_demo(client)
        assert r.status_code == 200, r.text
    tickets = [t for (t,) in db_session.query(Task.ticket_id)]
    assert len(tickets) == len(set(tickets))
