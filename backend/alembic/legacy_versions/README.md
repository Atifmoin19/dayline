# Legacy migrations (not loaded)

The original migration chain, `8d840365c088` (an empty baseline that assumed the tables
already existed) through `0015_add_is_onboarded`. It cannot build a schema from an empty
database, so it was squashed into `alembic/versions/0001_initial_schema.py`.

Alembic does not load this folder. It is kept only so a database stuck at an older revision
can be brought to `0015_add_is_onboarded` (temporarily set `version_locations` to this
folder), then stamped with `alembic stamp --purge 0001_initial_schema`.
