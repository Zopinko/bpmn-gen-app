from __future__ import annotations

from pathlib import Path
import sqlite3

from core.auth_config import get_auth_config


def _db_path() -> Path:
    path = Path(get_auth_config().auth_db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def run_auth_migrations() -> None:
    migrations_dir = Path(__file__).resolve().parent / "migrations"
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL
            )
            """
        )
        applied = {
            row["version"]
            for row in conn.execute("SELECT version FROM schema_migrations").fetchall()
        }
        for file in sorted(migrations_dir.glob("*.sql")):
            version = file.name
            if version in applied:
                continue
            script = file.read_text(encoding="utf-8")
            conn.executescript(script)
            conn.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?, datetime('now'))",
                (version,),
            )
        conn.commit()
