import os
import sys

from dotenv import load_dotenv

# Load env vars BEFORE importing models so DATABASE_URL is set
load_dotenv()

sys.path.append(os.getcwd())

try:
    from models import SessionLocal, User
    print(f"Checking DB: {os.getenv('DATABASE_URL')}")
except ImportError as e:
    print(f"Import failed: {e}")
    sys.exit(1)

try:
    db = SessionLocal()
    print("Session created")
    users = db.query(User).all()
    print(f"Total users found: {len(users)}")
    for u in users:
        print(f" - {u.emp_id}: {u.emp_name}")
    db.close()
except Exception as e:  # noqa: BLE001 — one-off CLI script: print-and-continue, not a service
    print(f"DB Error: {e}")
