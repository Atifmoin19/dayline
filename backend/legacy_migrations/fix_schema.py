"""DESTRUCTIVE: drops ALL tables and recreates them (wipes every row).

Guarded so it cannot run by accident. To proceed you must either pass --yes or type
the confirmation phrase when prompted. Never run this against a database with data
you care about — use ALTER-based migrations instead.
"""
import sys

from dotenv import load_dotenv

load_dotenv()

from models import DATABASE_URL, Base, engine

CONFIRM_PHRASE = "DROP ALL TABLES"


def main():
    print(f"Target database: {DATABASE_URL}")
    print("This will DROP and RECREATE every table, deleting all data.")

    if "--yes" in sys.argv:
        confirmed = True
    else:
        try:
            answer = input(f'Type "{CONFIRM_PHRASE}" to continue: ')
        except EOFError:
            answer = ""
        confirmed = answer.strip() == CONFIRM_PHRASE

    if not confirmed:
        print("Aborted. No changes made.")
        sys.exit(1)

    print("Dropping all tables...")
    Base.metadata.drop_all(bind=engine)
    print("Creating all tables...")
    Base.metadata.create_all(bind=engine)
    print("Schema reset complete.")


if __name__ == "__main__":
    main()
