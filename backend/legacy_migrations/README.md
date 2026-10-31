# Legacy migration scripts (DEPRECATED)

These are the old, ad-hoc, one-off schema scripts from before Alembic. They are kept
for historical reference only — **do not run them**. Several were duplicates or
conflicted with each other, and `fix_schema.py` is destructive (drops all tables).

**Schema changes now go through Alembic.** From the backend root:

```bash
# create a migration after editing models.py
./.venv/bin/alembic revision --autogenerate -m "describe change"
# review the generated file in alembic/versions/, then apply
./.venv/bin/alembic upgrade head
```

The current schema baseline is stamped at revision `8d840365c088`.

## What each did (superseded)
- `upgrade_db.py`, `upgrade_db_v2.py` — added early task columns (v2 fixed a missing commit).
- `upgrade_db_sessions.py`, `upgrade_postgres_db.py` — both added `task_sessions`.
- `fix_schema.py` — **drops and recreates ALL tables** (data loss). Use Alembic instead.
- `drop_user_token.py` — removed a legacy token column.
- `create_foundation_entry.py` — inserted a hardcoded test user (`test_manual_01`).
- `migrate_users_to_foundation.py` — backfilled `foundation` rows from `users`.

## Still-current data/ops scripts (kept in backend root, not here)
- `hash_existing_passwords.py`, `bulk_reset_passwords.py` — password ops.
- `migrate_dates_to_timestamptz.py` — the datetime column migration (idempotent).
- `import_users_from_csv.py`, `populate_db_from_csv.py`, `check_db.py` — data import/inspection.
