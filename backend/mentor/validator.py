from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from .models import ValidationRequest, ValidationResponse

KB_DIR = Path(__file__).resolve().parent.parent / "kb"
LABEL_RULES_FILE = KB_DIR / "label_rules.sk.yaml"
ALIASES_FILE = KB_DIR / "aliases.sk.yaml"


def _normalize_alias_token(value: str) -> str:
    normalized = (value or "").strip()
    return normalized.lower()


def lint_kb(label_rules_data: Dict[str, Any], aliases_data: Dict[str, Any]) -> List[str]:
    issues: List[str] = []

    label_rules = label_rules_data.get("label_rules")
    if label_rules is None:
        issues.append("label_rules root missing")
        label_rules = []
    if not isinstance(label_rules, list):
        issues.append("label_rules must be a list")
        label_rules = []

    seen_ids = set()
    for idx, entry in enumerate(label_rules):
        if not isinstance(entry, dict):
            issues.append(f"label_rules[{idx}] must be an object")
            continue
        entry_id = entry.get("id")
        if not entry_id:
            issues.append(f"label_rules[{idx}] missing id")
        elif entry_id in seen_ids:
            issues.append(f"label_rules duplicate id {entry_id}")
        else:
            seen_ids.add(entry_id)
        if not entry.get("locale"):
            issues.append(f"label_rules[{idx}] missing locale")
        patterns = entry.get("patterns")
        if not isinstance(patterns, list) or not patterns:
            issues.append(f"label_rules[{idx}] missing patterns")
        else:
            for p_idx, pattern in enumerate(patterns):
                if not isinstance(pattern, dict):
                    issues.append(f"label_rules[{idx}].patterns[{p_idx}] must be an object")
                    continue
                if not pattern.get("value"):
                    issues.append(f"label_rules[{idx}].patterns[{p_idx}] missing value")
                mode = pattern.get("mode")
                if mode not in {"plain", "regex"}:
                    issues.append(f"label_rules[{idx}].patterns[{p_idx}] has invalid mode {mode}")
        labels = entry.get("labels")
        if not isinstance(labels, dict):
            issues.append(f"label_rules[{idx}] missing labels")
        else:
            if not labels.get("positive"):
                issues.append(f"label_rules[{idx}] labels.positive missing")
            if not labels.get("negative"):
                issues.append(f"label_rules[{idx}] labels.negative missing")
        if not entry.get("gateway"):
            issues.append(f"label_rules[{idx}] missing gateway")

    aliases = aliases_data.get("aliases")
    if aliases is None:
        issues.append("aliases root missing")
        aliases = {}
    if not isinstance(aliases, dict):
        issues.append("aliases must be a mapping")
        aliases = {}

    for role, alias_list in aliases.items():
        if not isinstance(role, str) or not role.strip():
            issues.append("alias role names must be non-empty strings")
            continue
        if not isinstance(alias_list, list) or not alias_list:
            issues.append(f"aliases[{role}] must be a non-empty list")
            continue
        seen_role_aliases = set()
        for alias in alias_list:
            token = _normalize_alias_token(str(alias))
            if not token:
                issues.append(f"aliases[{role}] contains empty alias")
                continue
            if token in seen_role_aliases:
                issues.append(f"aliases[{role}] contains duplicate alias '{alias}'")
                continue
            seen_role_aliases.add(token)

    return issues


def detect_conflicts(aliases_data: Dict[str, Any]) -> List[str]:
    conflicts: List[str] = []
    alias_map = aliases_data.get("aliases") if isinstance(aliases_data, dict) else {}
    if not isinstance(alias_map, dict):
        return conflicts

    ownership: Dict[str, str] = {}
    for role, alias_list in alias_map.items():
        if not isinstance(alias_list, list):
            continue
        for alias in alias_list:
            token = _normalize_alias_token(str(alias))
            if not token:
                continue
            owner = ownership.get(token)
            if owner and owner != role:
                conflicts.append(
                    f"Alias '{alias}' already assigned to role '{owner}' and cannot also belong to '{role}'"
                )
            else:
                ownership[token] = role
    return conflicts


def kpi_delta(base_version: Optional[str], candidate_version: Optional[str]) -> Dict[str, Any]:
    return {"base_version": base_version, "candidate_version": candidate_version, "delta": 0}


def _load_yaml(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)  # type: ignore[no-untyped-call]
    return data if data is not None else default


def validate_kb_version(_: Optional[str]) -> ValidationResponse:
    label_rules = _load_yaml(LABEL_RULES_FILE, {"label_rules": []})
    aliases = _load_yaml(ALIASES_FILE, {"locale": "sk", "source": "mentor", "aliases": {}})
    lint_issues = lint_kb(
        label_rules if isinstance(label_rules, dict) else {"label_rules": []},
        aliases if isinstance(aliases, dict) else {"aliases": {}},
    )
    conflicts = detect_conflicts(aliases if isinstance(aliases, dict) else {"aliases": {}})
    passed = not lint_issues and not conflicts
    resp = ValidationResponse(
        pass_state=passed,
        kpi_delta=kpi_delta(None, None),
        conflicts=lint_issues + conflicts,
    )
    return resp
