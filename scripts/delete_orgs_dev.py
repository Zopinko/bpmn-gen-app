from __future__ import annotations

import os
import shutil
import sqlite3
import sys
from pathlib import Path


def _db_path() -> Path:
    return Path(os.getenv("AUTH_DB_PATH", "data/auth.db"))


def _models_base_dir() -> Path:
    return Path(os.getenv("BPMN_MODELS_DIR", "data/models")) / "orgs"


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def list_orgs(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT o.id, o.name, o.created_at,
               COUNT(m.id) AS member_count
        FROM organizations o
        LEFT JOIN organization_members m ON m.organization_id = o.id
        GROUP BY o.id
        ORDER BY o.created_at DESC
        """
    ).fetchall()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "created_at": row["created_at"],
            "member_count": row["member_count"],
        }
        for row in rows
    ]


def delete_org(conn: sqlite3.Connection, org_id: str) -> None:
    conn.execute("DELETE FROM organizations WHERE id = ?", (org_id,))
    conn.commit()


def prompt_yes_no(message: str) -> bool:
    while True:
        value = input(f"{message} [y/N]: ").strip().lower()
        if value in {"y", "yes"}:
            return True
        if value in {"", "n", "no"}:
            return False


def main() -> int:
    db_path = _db_path()
    if not db_path.exists():
        print(f"Auth DB not found: {db_path}")
        return 1

    with _connect(db_path) as conn:
        orgs = list_orgs(conn)
        if not orgs:
            print("No organizations found.")
            return 0

        print("Organizations:")
        for idx, org in enumerate(orgs, start=1):
            name = org["name"] or "-"
            print(
                f"{idx:>2}. {name} | id={org['id']} | members={org['member_count']} | created={org['created_at']}"
            )

        raw = input("Enter org ID to delete (or empty to exit): ").strip()
        if not raw:
            print("Canceled.")
            return 0

        target = next((o for o in orgs if o["id"] == raw), None)
        if not target:
            print("Org ID not found.")
            return 1

        name = target["name"] or "-"
        if not prompt_yes_no(f"Delete organization '{name}' ({target['id']})?"):
            print("Canceled.")
            return 0

        delete_org(conn, target["id"])
        print("Deleted from database.")

    models_dir = _models_base_dir() / target["id"]
    if models_dir.exists():
        if prompt_yes_no(f"Delete org models directory '{models_dir}'?"):
            shutil.rmtree(models_dir)
            print("Deleted models directory.")
        else:
            print("Skipped deleting models directory.")
    else:
        print("No models directory found.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
