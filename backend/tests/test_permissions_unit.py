"""
Direct unit tests of permissions.py predicates — no HTTP involved. These are the
highest-risk piece of the app (single source of truth for every authorization decision),
and pending.md flagged them as having zero test coverage.
"""
import pytest

import permissions as perms
from models import Task as TaskModel


# ---------------------------------------------------------------------------------------
# get_rank / is_admin / can_manage_users
# ---------------------------------------------------------------------------------------
@pytest.mark.parametrize("designation,expected_rank", [
    ("CHIEF TECHNOLOGY OFFICER", 5),
    ("ENGINEERING MANAGER", 4),
    ("TEAM LEAD", 3),
    ("SENIOR SOFTWARE ENGINEER", 2),
    ("SOFTWARE ENGINEER", 1),
    ("ASSOCIATE SOFTWARE ENGINEER", 1),   # reconciled gap: ASE is a real rank-1 IC
    ("chief technology officer", 5),       # case-insensitive
    ("SOMETHING MADE UP", 0),
    (None, 0),
    ("", 0),
])
def test_get_rank(designation, expected_rank):
    assert perms.get_rank(designation) == expected_rank


def test_product_designation_not_in_hierarchy_ranks_but_docstring_discusses_it():
    """permissions.py's module docstring calls out that PRODUCT was reconciled to rank 5,
    but no "PRODUCT" key actually exists in HIERARCHY_RANKS/ADMIN_DESIGNATIONS — only
    "DIRECTOR OF PRODUCT" and "SENIOR PRODUCT MANAGER" do. This
    pins current behavior (bare "PRODUCT" is unranked) rather than asserting the
    docstring's claim, which the actual dict does not implement under that literal key."""
    assert perms.get_rank("PRODUCT") == 0
    assert perms.is_admin(_make_bare_user("U1", "PRODUCT")) is False


def _make_bare_user(emp_id, designation):
    from models import User as UserModel
    u = UserModel(emp_name="X", emp_id=emp_id, emp_email=f"{emp_id}@x.com", emp_designation=designation)
    return u


@pytest.mark.parametrize("designation,expected", [
    ("ENGINEERING MANAGER", True),
    ("CHIEF TECHNOLOGY OFFICER", True),
    ("CHIEF INFORMATION SECURITY OFFICER", True),
    ("VICE PRESIDENT, ENGINEERING", True),
    ("DIRECTOR OF PRODUCT", True),
    ("TEAM LEAD", False),          # rank 3 — lead, but not admin
    ("SENIOR SOFTWARE ENGINEER", False),
    ("SOFTWARE ENGINEER", False),
    (None, False),
])
def test_is_admin(designation, expected):
    assert perms.is_admin(_make_bare_user("U1", designation)) is expected


def test_can_manage_users_is_is_admin():
    """Named separately for call-site clarity, but must be the exact same capability."""
    assert perms.can_manage_users is perms.is_admin


# ---------------------------------------------------------------------------------------
# can_assign_task_to / validate_assignee_eligibility — verify the 2026-07-26 "open
# assignment" change really is a permissive pass-through, in every direction.
# ---------------------------------------------------------------------------------------
def test_can_assign_task_to_allows_junior_to_assign_to_senior(db_session, org):
    """A rank-1 IC assigning a task TO their rank-4 manager's manager — would have been
    denied under the old hierarchy-gated rule. Must be allowed now."""
    assert perms.can_assign_task_to(db_session, org["se"], org["em"].emp_id) is True


def test_can_assign_task_to_allows_senior_to_assign_to_junior(db_session, org):
    assert perms.can_assign_task_to(db_session, org["em"], org["se"].emp_id) is True


def test_can_assign_task_to_allows_peer_to_peer(db_session, org):
    assert perms.can_assign_task_to(db_session, org["se"], org["se2"].emp_id) is True


def test_can_assign_task_to_allows_self_assignment(db_session, org):
    assert perms.can_assign_task_to(db_session, org["se"], org["se"].emp_id) is True


def test_can_assign_task_to_allows_unrelated_or_nonexistent_target(db_session, org):
    """The predicate takes a bare emp_id string and never even looks it up — it is a pure
    `return True`. Confirms it doesn't accidentally validate existence/eligibility either."""
    assert perms.can_assign_task_to(db_session, org["se"], "SOME-EMP-ID-THAT-DOES-NOT-EXIST") is True


@pytest.mark.parametrize("designation", ["SOFTWARE ENGINEER", "CHIEF TECHNOLOGY OFFICER", None])
def test_validate_assignee_eligibility_always_true(designation):
    user = _make_bare_user("U1", designation) if designation is not None else None
    assert perms.validate_assignee_eligibility(user) is True


# ---------------------------------------------------------------------------------------
# get_all_subordinates / get_user_view_scope — pure org-tree walk.
# ---------------------------------------------------------------------------------------
def test_get_all_subordinates_full_subtree(db_session, org):
    subs = perms.get_all_subordinates(db_session, "EM001")
    assert subs == {"TL001", "SE001", "SSE001", "SE002"}


def test_get_all_subordinates_leaf_has_none(db_session, org):
    assert perms.get_all_subordinates(db_session, "SE001") == set()


def test_get_user_view_scope_ic_sees_only_self(db_session, org):
    assert perms.get_user_view_scope(db_session, "SE001") == {"SE001"}


def test_get_user_view_scope_lead_sees_subtree_not_peers(db_session, org):
    scope = perms.get_user_view_scope(db_session, "TL001")
    assert scope == {"TL001", "SE001", "SSE001"}
    assert "SE002" not in scope   # sibling branch under EM001 must not leak
    assert "EM001" not in scope  # own manager must not leak


def test_get_user_view_scope_manager_sees_everyone_below(db_session, org):
    scope = perms.get_user_view_scope(db_session, "EM001")
    assert scope == {"EM001", "TL001", "SE001", "SSE001", "SE002"}


def test_can_view_user(db_session, org):
    assert perms.can_view_user(db_session, org["tl"], "SE001") is True
    assert perms.can_view_user(db_session, org["tl"], "SE002") is False
    assert perms.can_view_user(db_session, org["se"], "SSE001") is False  # peers can't see each other


# ---------------------------------------------------------------------------------------
# can_view_task / can_modify_task — must still be gated by org-tree/ownership (unlike
# assignment, which is now open).
# ---------------------------------------------------------------------------------------
def _task(assigned_to, assigned_by=None, task_id="T1"):
    return TaskModel(id=task_id, task_name="t", task_assigned_to=assigned_to, task_assigned_by=assigned_by)


def test_can_view_task_assignee_in_scope(db_session, org):
    task = _task(assigned_to="SE001")
    assert perms.can_view_task(db_session, org["tl"], task) is True   # manager of assignee
    assert perms.can_view_task(db_session, org["se"], task) is True   # self
    assert perms.can_view_task(db_session, org["em"], task) is True   # grand-manager
    assert perms.can_view_task(db_session, org["sse"], task) is False  # peer
    assert perms.can_view_task(db_session, org["se2"], task) is False  # sibling branch


def test_can_modify_task_admin_always_true(db_session, org):
    task = _task(assigned_to="SE001", assigned_by="SSE001")
    assert perms.can_modify_task(db_session, org["em"], task) is True  # is_admin


def test_can_modify_task_assignee_true(db_session, org):
    task = _task(assigned_to="SE001", assigned_by="TL001")
    assert perms.can_modify_task(db_session, org["se"], task) is True


def test_can_modify_task_assigner_true(db_session, org):
    task = _task(assigned_to="SE001", assigned_by="SSE001")
    assert perms.can_modify_task(db_session, org["sse"], task) is True


def test_can_modify_task_manager_of_assignee_true(db_session, org):
    task = _task(assigned_to="SE001", assigned_by="SE001")
    assert perms.can_modify_task(db_session, org["tl"], task) is True


def test_can_modify_task_unrelated_peer_false(db_session, org):
    """SSE001 is neither assignee, assigner, admin, nor a manager of the assignee (SE001) —
    they're peers under the same lead. Must be denied."""
    task = _task(assigned_to="SE001", assigned_by="TL001")
    assert perms.can_modify_task(db_session, org["sse"], task) is False


def test_can_modify_task_sibling_branch_false(db_session, org):
    task = _task(assigned_to="SE001", assigned_by="TL001")
    assert perms.can_modify_task(db_session, org["se2"], task) is False


# ---------------------------------------------------------------------------------------
# can_delete_comment
# ---------------------------------------------------------------------------------------
class _FakeComment:
    def __init__(self, author_id):
        self.author_id = author_id


def test_can_delete_comment_author_true(org):
    assert perms.can_delete_comment(org["se"], _FakeComment("SE001")) is True


def test_can_delete_comment_admin_true(org):
    assert perms.can_delete_comment(org["em"], _FakeComment("SE001")) is True


def test_can_delete_comment_other_non_admin_false(org):
    assert perms.can_delete_comment(org["sse"], _FakeComment("SE001")) is False


# ---------------------------------------------------------------------------------------
# validate_manager_hierarchy — form-validation helper (raises HTTPException).
# ---------------------------------------------------------------------------------------
def test_validate_manager_hierarchy_unknown_manager_raises(db_session, org):
    with pytest.raises(Exception) as exc_info:
        perms.validate_manager_hierarchy(db_session, "GHOST-MGR", "SOFTWARE ENGINEER", "SE001")
    assert getattr(exc_info.value, "status_code", None) == 400


def test_validate_manager_hierarchy_manager_must_outrank_employee(db_session, org):
    """TL001 (rank 3) cannot be SSE001's (rank 2) manager is fine (3>2) but cannot be
    EM001's (rank 4) manager (3 <= 4) -> should raise."""
    with pytest.raises(Exception) as exc_info:
        perms.validate_manager_hierarchy(db_session, "TL001", "ENGINEERING MANAGER", "EM001")
    assert getattr(exc_info.value, "status_code", None) == 400


def test_validate_manager_hierarchy_valid_passes(db_session, org):
    assert perms.validate_manager_hierarchy(db_session, "TL001", "SOFTWARE ENGINEER", "NEWHIRE") is True


def test_validate_manager_hierarchy_self_management_requires_cto_rank(db_session, org):
    # EM001 is rank 4 (< RANK_CTO=5) -> cannot be own manager.
    with pytest.raises(Exception) as exc_info:
        perms.validate_manager_hierarchy(db_session, "EM001", "ENGINEERING MANAGER", "EM001")
    assert getattr(exc_info.value, "status_code", None) == 400


def test_validate_manager_hierarchy_self_management_allowed_for_cto_rank(db_session, org):
    from conftest import make_user
    make_user(db_session, "CTO001", "Cathy CTO", "CHIEF TECHNOLOGY OFFICER", manager_id=None)
    assert perms.validate_manager_hierarchy(
        db_session, "CTO001", "CHIEF TECHNOLOGY OFFICER", "CTO001"
    ) is True
