"""models.resolve_database_url: SQLite fallback must be loud in dev and refused in production."""
import logging

import pytest

from models import resolve_database_url


def test_explicit_url_is_used_as_is():
    url = "postgresql://u:p@db:5432/taskboard"
    assert resolve_database_url({"DATABASE_URL": url}) == url


def test_missing_url_falls_back_to_sqlite_with_warning(caplog):
    with caplog.at_level(logging.WARNING, logger="models"):
        url = resolve_database_url({})
    assert url.startswith("sqlite:///")
    assert any("DATABASE_URL is not set" in r.getMessage() for r in caplog.records)


@pytest.mark.parametrize("env", [{}, {"DATABASE_URL": "sqlite:///./x.db"}])
def test_sqlite_refused_in_production(env):
    with pytest.raises(RuntimeError, match="production"):
        resolve_database_url({**env, "ENVIRONMENT": "production"})


def test_postgres_allowed_in_production():
    url = "postgresql://u:p@db:5432/taskboard"
    assert resolve_database_url({"DATABASE_URL": url, "ENVIRONMENT": "Production"}) == url


def test_postgres_scheme_alias_is_normalised():
    """Some hosts (Neon, Heroku-style) hand out postgres://, which SQLAlchemy 2 rejects."""
    url = "postgres://u:p@ep-x.neon.tech/db?sslmode=require"
    assert resolve_database_url({"DATABASE_URL": url}) == "postgresql://u:p@ep-x.neon.tech/db?sslmode=require"
