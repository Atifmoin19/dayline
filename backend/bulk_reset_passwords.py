"""Admin utility: reset every non-admin account's password to the default, clear tokens,
and mark them as needing onboarding again.

Each password is stored bcrypt-hashed. After this runs, reset users log in with the
default and go through the onboarding wizard (/onboarding, which only allows setting a
real password while the stored one is still the default) or the old /register endpoint
directly. Admin-rank accounts (permissions.get_rank >= RANK_EM) are skipped by default —
they stay already-registered so the separate /admin-login door keeps working — pass
--include-admins to reset everyone unconditionally instead. Prints the list of emp_ids
that were reset (and which admin emp_ids were skipped).

Usage:  ./.venv/bin/python bulk_reset_passwords.py [--password NEWDEFAULT] [--include-admins]
"""
import sys

from dotenv import load_dotenv

load_dotenv()

from models import Foundation, SessionLocal, User as UserModel
from permissions import RANK_EM, get_rank
from security import hash_password

DEFAULT_PASSWORD = "123456"


def main():
    new_password = DEFAULT_PASSWORD
    if "--password" in sys.argv:
        i = sys.argv.index("--password")
        if i + 1 < len(sys.argv):
            new_password = sys.argv[i + 1]
    include_admins = "--include-admins" in sys.argv

    db = SessionLocal()
    try:
        designations = {
            u.emp_id: u.emp_designation for u in db.query(UserModel).all()
        }
        rows = db.query(Foundation).order_by(Foundation.emp_id).all()
        hashed = hash_password(new_password)
        reset_ids = []
        skipped_admin_ids = []
        for f in rows:
            is_admin = get_rank(designations.get(f.emp_id)) >= RANK_EM
            if is_admin and not include_admins:
                skipped_admin_ids.append(f.emp_id)
                continue
            f.password = hashed
            f.token = None          # force re-login
            f.last_active_at = None
            f.is_onboarded = False
            reset_ids.append(f.emp_id)
        db.commit()
        print(f"Reset {len(reset_ids)} accounts to password: {new_password!r}")
        for eid in reset_ids:
            print(f"  {eid}")
        if skipped_admin_ids:
            print(f"Skipped {len(skipped_admin_ids)} admin-rank accounts (already registered):")
            for eid in skipped_admin_ids:
                print(f"  {eid}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
