"""Password hashing helpers (bcrypt).

Uses the `bcrypt` library directly (passlib 1.7.x is incompatible with bcrypt 4.x).
Supports a transparent migration from the legacy plaintext scheme: verify_password
accepts a stored value that is either a bcrypt hash ($2...) or a legacy plaintext
string. Callers should re-hash on successful login (see main.login) so plaintext
rows disappear over time. Run hash_existing_passwords.py to migrate them in bulk.
"""
import bcrypt

# bcrypt hashes always start with $2 (e.g. $2b$12$...).
_BCRYPT_PREFIX = "$2"

# bcrypt hard-limits the secret to 72 bytes and raises above that; truncate first.
_MAX_BYTES = 72


def is_hashed(stored: str | None) -> bool:
    return bool(stored) and stored.startswith(_BCRYPT_PREFIX)


def hash_password(plain: str) -> str:
    secret = plain.encode("utf-8")[:_MAX_BYTES]
    return bcrypt.hashpw(secret, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, stored: str | None) -> bool:
    if not stored:
        return False
    if not is_hashed(stored):
        # Legacy plaintext row — direct compare.
        return plain == stored
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:_MAX_BYTES], stored.encode("utf-8"))
    except Exception:  # noqa: BLE001 — bcrypt raises ValueError on a malformed/foreign hash
        return False  # (e.g. a row not yet migrated as expected); treat as "wrong password", not a crash.
