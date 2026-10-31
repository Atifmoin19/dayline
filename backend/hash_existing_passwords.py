"""One-time migration: bcrypt-hash any foundation.password rows still in plaintext.

Idempotent — rows already hashed (prefix "$2") are skipped, so it is safe to re-run.
Usage:  ./.venv/bin/python hash_existing_passwords.py
"""
from dotenv import load_dotenv

load_dotenv()

from models import Foundation, SessionLocal
from security import hash_password, is_hashed


def main():
    db = SessionLocal()
    try:
        rows = db.query(Foundation).all()
        migrated = 0
        skipped = 0
        for f in rows:
            if not f.password or is_hashed(f.password):
                skipped += 1
                continue
            f.password = hash_password(f.password)
            migrated += 1
        db.commit()
        print(f"Password migration complete: {migrated} hashed, {skipped} already-hashed/empty.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
