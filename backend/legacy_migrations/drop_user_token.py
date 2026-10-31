from sqlalchemy import text

from models import engine


def drop_token_column():
    # Use engine.begin() to ensure the transaction is committed
    with engine.begin() as connection:
        try:
            # Drop token column from users table
            connection.execute(text("ALTER TABLE users DROP COLUMN IF EXISTS token"))
            print("Dropped token column from users table.")
        except Exception as e:  # noqa: BLE001 — one-off migration script: report and move on
            print(f"Could not drop token column: {e}")

if __name__ == "__main__":
    drop_token_column()
