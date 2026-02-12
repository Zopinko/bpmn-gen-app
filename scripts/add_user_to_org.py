import argparse
import os
import sqlite3
from pathlib import Path


def resolve_db_path(explicit_path: str | None) -> Path:
    if explicit_path:
        return Path(explicit_path).expanduser().resolve()
    return Path(os.getenv("AUTH_DB_PATH", "data/auth.db")).expanduser().resolve()


def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def find_user_id(conn: sqlite3.Connection, email: str) -> str | None:
    row = conn.execute(
        "SELECT id, email FROM users WHERE lower(email) = lower(?) LIMIT 1",
        (email.strip(),),
    ).fetchone()
    return row["id"] if row else None


def find_org_id(conn: sqlite3.Connection, org_id: str | None, org_name: str | None) -> str | None:
    if org_id:
        row = conn.execute(
            "SELECT id FROM organizations WHERE id = ? LIMIT 1",
            (org_id.strip(),),
        ).fetchone()
        return row["id"] if row else None
    if org_name:
        row = conn.execute(
            "SELECT id FROM organizations WHERE lower(name) = lower(?) ORDER BY created_at DESC LIMIT 1",
            (org_name.strip(),),
        ).fetchone()
        return row["id"] if row else None
    return None


def has_membership(conn: sqlite3.Connection, user_id: str, org_id: str) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM organization_members
        WHERE user_id = ? AND organization_id = ?
        LIMIT 1
        """,
        (user_id, org_id),
    ).fetchone()
    return row is not None


def add_membership(conn: sqlite3.Connection, user_id: str, org_id: str, role: str) -> None:
    conn.execute(
        """
        INSERT INTO organization_members(id, organization_id, user_id, role, created_at)
        VALUES (lower(hex(randomblob(16))), ?, ?, ?, datetime('now'))
        """,
        (org_id, user_id, role),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Add an existing user to an organization.")
    parser.add_argument("--email", required=True, help="User email to add.")
    parser.add_argument("--org-id", default=None, help="Organization ID.")
    parser.add_argument("--org-name", default=None, help="Organization name (case-insensitive).")
    parser.add_argument("--role", default="member", help="Role to assign (owner/member).")
    parser.add_argument("--db", default=None, help="Path to auth.db (defaults to AUTH_DB_PATH or data/auth.db).")
    args = parser.parse_args()

    db_path = resolve_db_path(args.db)
    if not db_path.exists():
        print(f"Auth DB not found: {db_path}")
        return 2

    role = args.role.strip().lower()
    if role not in {"owner", "member"}:
        print("Role must be 'owner' or 'member'.")
        return 2

    with connect(db_path) as conn:
        user_id = find_user_id(conn, args.email)
        if not user_id:
            print(f"User not found for email: {args.email}")
            return 2

        org_id = find_org_id(conn, args.org_id, args.org_name)
        if not org_id:
            print("Organization not found. Provide --org-id or --org-name.")
            return 2

        if has_membership(conn, user_id, org_id):
            print(f"User already member of org: {org_id}")
            return 0

        add_membership(conn, user_id, org_id, role)
        conn.commit()
        print(f"Added user {args.email} to org {org_id} as {role}.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
