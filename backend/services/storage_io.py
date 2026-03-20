from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def atomic_write_text(path: str | Path, content: str, encoding: str = "utf-8") -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(
        dir=str(target.parent),
        prefix=f"{target.name}.",
        suffix=".tmp",
        text=True,
    )
    temp_file = Path(temp_path)
    try:
        with os.fdopen(fd, "w", encoding=encoding) as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_file, target)
    except Exception:
        try:
            temp_file.unlink(missing_ok=True)
        except Exception:
            pass
        raise


def atomic_write_json(path: str | Path, payload: Any, *, ensure_ascii: bool = False, indent: int | None = None) -> None:
    atomic_write_text(
        path,
        json.dumps(payload, ensure_ascii=ensure_ascii, indent=indent),
        encoding="utf-8",
    )
