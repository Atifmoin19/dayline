"""Migration: convert the ISO-string date columns to real `timestamptz`.

Idempotent — each column is only altered if it is still a character type, so re-runs
are safe. Existing values like "2025-12-11T14:31:36.718Z" are parsed by Postgres'
`::timestamptz` cast (Z = UTC); empty strings become NULL.

Postgres only. Usage:  ./.venv/bin/python migrate_dates_to_timestamptz.py
"""
from dotenv import load_dotenv

load_dotenv()

from sqlalchemy import inspect, text

from models import engine

TARGETS = {
    "foundation": ["last_active_at"],
    "tasks": ["task_assigned_date", "task_due_date", "task_created_at",
              "task_updated_at", "completed_at"],
}

CHAR_TYPES = {"character varying", "varchar", "text", "character"}


def main():
    if engine.dialect.name != "postgresql":
        print(f"Dialect is {engine.dialect.name!r}; this migration targets PostgreSQL. Aborting.")
        return

    insp = inspect(engine)
    converted, skipped = [], []

    with engine.begin() as conn:
        for table, cols in TARGETS.items():
            existing = {c["name"]: c for c in insp.get_columns(table)}
            for col in cols:
                if col not in existing:
                    skipped.append(f"{table}.{col} (absent)")
                    continue
                coltype = str(existing[col]["type"]).lower()
                is_char = any(t in coltype for t in CHAR_TYPES)
                if not is_char:
                    skipped.append(f"{table}.{col} (already {coltype})")
                    continue
                conn.execute(text(
                    f"ALTER TABLE {table} ALTER COLUMN {col} TYPE timestamptz "
                    f"USING NULLIF({col}, '')::timestamptz"
                ))
                converted.append(f"{table}.{col}")

    print("Converted to timestamptz:")
    for c in converted:
        print(f"  {c}")
    if not converted:
        print("  (none — already migrated)")
    if skipped:
        print("Skipped:")
        for s in skipped:
            print(f"  {s}")


if __name__ == "__main__":
    main()
