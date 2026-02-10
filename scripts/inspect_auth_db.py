import os
import sqlite3
from pathlib import Path

def get_db_path() -> Path:
    return Path(os.getenv("AUTH_DB_PATH", "auth.db")).expanduser().resolve()


def main() -> None:
    db_path = get_db_path()
    print(f"Auth DB: {db_path}")
    if not db_path.exists():
        print("Database file does not exist.")
        return

    conn = sqlite3.connect(db_path)
    try:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        tables = [row[0] for row in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
        ).fetchall()]

        print("\nTables:")
        if not tables:
            print("  (none)")
            return

        for table in tables:
            print(f"\n- {table}")
            print("  Columns:")
            for col in cur.execute(f"PRAGMA table_info('{table}')").fetchall():
                pk = " PK" if col[5] else ""
                notnull = " NOT NULL" if col[3] else ""
                dflt = f" DEFAULT {col[4]}" if col[4] is not None else ""
                print(f"    - {col[1]} ({col[2]}){notnull}{dflt}{pk}")

            print("  Indexes:")
            idxs = cur.execute(f"PRAGMA index_list('{table}')").fetchall()
            if not idxs:
                print("    (none)")
            else:
                for idx in idxs:
                    print(f"    - {idx[1]} (unique={bool(idx[2])})")

            print("  Foreign Keys:")
            fks = cur.execute(f"PRAGMA foreign_key_list('{table}')").fetchall()
            if not fks:
                print("    (none)")
            else:
                for fk in fks:
                    print(
                        f"    - {fk[2]}.{fk[4]} -> {fk[3]} "
                        f"(on_update={fk[5]}, on_delete={fk[6]})"
                    )
    finally:
        conn.close()


if __name__ == "__main__":
    main()
