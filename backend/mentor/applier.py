from __future__ import annotations

import copy
import subprocess
from datetime import datetime
from pathlib import Path
from subprocess import CalledProcessError
from typing import Any, Dict, Iterable, List

import yaml

from .models import MentorApplyAudit, MentorApplyRequest, MentorApplyResponse, Proposal
from .validator import detect_conflicts, lint_kb

REPO_ROOT = Path(__file__).resolve().parent.parent
KB_DIR = REPO_ROOT / "kb"
LABEL_RULES_FILE = KB_DIR / "label_rules.sk.yaml"
ALIASES_FILE = KB_DIR / "aliases.sk.yaml"
DEFAULT_SOURCE = "mentor_v1.0"


class UnsupportedProposalType(Exception):
    def __init__(self, proposal_type: str) -> None:
        super().__init__(proposal_type)
        self.proposal_type = proposal_type


class MentorApplyConflict(Exception):
    def __init__(self, conflicts: List[str]) -> None:
        super().__init__("; ".join(conflicts))
        self.conflicts = conflicts


def _ensure_kb_dir() -> None:
    KB_DIR.mkdir(parents=True, exist_ok=True)


def _read_yaml(path: Path, default: Any) -> Any:
    if not path.exists():
        return copy.deepcopy(default)
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)  # type: ignore[no-untyped-call]
    if data is None:
        return copy.deepcopy(default)
    return data


def _write_yaml(path: Path, data: Any) -> None:
    with path.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(  # type: ignore[no-untyped-call]
            data,
            handle,
            sort_keys=False,
            allow_unicode=True,
            indent=2,
        )


def _normalize_alias_token(value: str) -> str:
    normalized = (value or "").strip()
    return normalized.lower()


def _deduplicate_aliases(values: Iterable[str]) -> List[str]:
    seen = set()
    result: List[str] = []
    for raw in values:
        alias = raw.strip()
        if not alias:
            continue
        key = _normalize_alias_token(alias)
        if key in seen:
            continue
        seen.add(key)
        result.append(alias)
    return result


def _decode_pointer(path: str) -> List[str]:
    if path == "":
        return []
    if not path.startswith("/"):
        raise ValueError(f"Invalid JSON pointer '{path}'")
    tokens = path.lstrip("/").split("/") if path != "/" else [""]
    return [
        token.replace("~1", "/").replace("~0", "~") for token in tokens if token != ""
    ]


def _parse_index(token: str, length: int, allow_end: bool = False) -> int:
    if token == "-":
        if allow_end:
            return length
        raise ValueError("'-' is only permitted for appending to arrays")
    try:
        index = int(token)
    except ValueError as exc:  # pragma: no cover
        raise ValueError(f"Invalid array index '{token}'") from exc
    if index < 0 or index > length or (index == length and not allow_end):
        raise ValueError(f"Array index out of range: {token}")
    return index


def _traverse(doc: Any, tokens: List[str]) -> Any:
    current = doc
    for raw in tokens:
        token = raw.replace("~1", "/").replace("~0", "~")
        if isinstance(current, list):
            idx = _parse_index(token, len(current))
            current = current[idx]
        elif isinstance(current, dict):
            if token not in current:
                raise ValueError(f"Path segment '{token}' not found")
            current = current[token]
        else:
            raise ValueError(f"Cannot traverse into non-container at '{token}'")
    return current


def _get_parent(doc: Any, tokens: List[str]) -> tuple[Any, str]:
    if not tokens:
        raise ValueError("JSON pointer must not be empty for this operation")
    parent_tokens = tokens[:-1]
    parent = _traverse(doc, parent_tokens) if parent_tokens else doc
    last = tokens[-1].replace("~1", "/").replace("~0", "~")
    return parent, last


def _add_value(doc: Any, tokens: List[str], value: Any) -> Any:
    if not tokens:
        return copy.deepcopy(value)
    parent, key = _get_parent(doc, tokens)
    if isinstance(parent, list):
        idx = _parse_index(key, len(parent), allow_end=True)
        if idx == len(parent):
            parent.append(copy.deepcopy(value))
        else:
            parent.insert(idx, copy.deepcopy(value))
    elif isinstance(parent, dict):
        parent[key] = copy.deepcopy(value)
    else:
        raise ValueError("Cannot add to non-container parent")
    return doc


def _replace_value(doc: Any, tokens: List[str], value: Any) -> Any:
    if not tokens:
        return copy.deepcopy(value)
    parent, key = _get_parent(doc, tokens)
    if isinstance(parent, list):
        idx = _parse_index(key, len(parent))
        parent[idx] = copy.deepcopy(value)
    elif isinstance(parent, dict):
        if key not in parent:
            raise ValueError(f"Path '{'/'.join(tokens)}' not found for replace")
        parent[key] = copy.deepcopy(value)
    else:
        raise ValueError("Cannot replace in non-container parent")
    return doc


def _remove_value(doc: Any, tokens: List[str]) -> Any:
    if not tokens:
        raise ValueError("Cannot remove the document root")
    parent, key = _get_parent(doc, tokens)
    if isinstance(parent, list):
        idx = _parse_index(key, len(parent))
        parent.pop(idx)
    elif isinstance(parent, dict):
        if key not in parent:
            raise ValueError(f"Path '{'/'.join(tokens)}' not found for remove")
        parent.pop(key)
    else:
        raise ValueError("Cannot remove from non-container parent")
    return doc


def _apply_json_patch(document: Any, operations: List[Dict[str, Any]]) -> Any:
    doc = copy.deepcopy(document)
    for op in operations:
        operation = op.get("op")
        path = op.get("path")
        if operation is None or path is None:
            raise ValueError("Patch operation missing op or path")
        tokens = _decode_pointer(path)
        if operation == "add":
            doc = _add_value(doc, tokens, op.get("value"))
        elif operation == "replace":
            doc = _replace_value(doc, tokens, op.get("value"))
        elif operation == "remove":
            doc = _remove_value(doc, tokens)
        elif operation == "move":
            from_path = op.get("from")
            if not from_path:
                raise ValueError('move operation requires "from" field')
            from_tokens = _decode_pointer(from_path)
            value = copy.deepcopy(_traverse(doc, from_tokens))
            doc = _remove_value(doc, from_tokens)
            doc = _add_value(doc, tokens, value)
        elif operation == "copy":
            from_path = op.get("from")
            if not from_path:
                raise ValueError('copy operation requires "from" field')
            value = copy.deepcopy(_traverse(doc, _decode_pointer(from_path)))
            doc = _add_value(doc, tokens, value)
        elif operation == "test":
            value = op.get("value")
            current = _traverse(doc, tokens)
            if current != value:
                raise ValueError(f"test operation failed at path '{path}'")
        else:
            raise ValueError(f"Unsupported patch operation '{operation}'")
    return doc


def _ensure_proposal_identity(proposal: Proposal, idx: int) -> None:
    if not proposal.id:
        stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        proposal.id = f"prop_{stamp}_{idx:03d}"
    if not proposal.source:
        proposal.source = DEFAULT_SOURCE


def _normalize_patterns(proposal: Proposal) -> None:
    for pattern in proposal.match.patterns:
        mode = (pattern.mode or "plain").lower()
        if mode != "regex":
            mode = "plain"
        pattern.mode = mode


def _normalize_action(proposal: Proposal) -> None:
    if not proposal.action:
        return
    op_map = {
        "set_gateway_labels": "set_branch_labels",
        "add_role_alias": "add_alias",
    }
    proposal.action.op = op_map.get(proposal.action.op, proposal.action.op)
    if proposal.action.params is None:
        proposal.action.params = {}


def _normalize_targets(proposal: Proposal) -> List[Dict[str, str]]:
    normalized: List[Dict[str, str]] = []
    for target in proposal.targets:
        if isinstance(target, dict):
            normalized.append(target)
            continue
        target_value = (target or "").strip()
        if not target_value:
            continue
        if target_value == "exclusive_gateway":
            normalized.append({"gateway_type": "exclusive"})
        else:
            normalized.append({"lane": target_value})
    return normalized


def _apply_label_rule(
    label_rules: Dict[str, Any],
    proposal: Proposal,
    normalized_targets: List[Dict[str, str]],
) -> None:
    locale = proposal.match.locale or "sk"
    labels = (
        proposal.action.params.get("labels")
        if proposal.action and proposal.action.params
        else None
    )
    if not isinstance(labels, (list, tuple)) or len(labels) < 2:
        raise MentorApplyConflict([f"Proposal {proposal.id} missing branch labels."])
    positive, negative = labels[0], labels[1]

    gateway_type = "exclusive"
    for target in normalized_targets:
        if target.get("gateway_type"):
            gateway_type = target["gateway_type"]
            break

    entry = {
        "id": proposal.id,
        "locale": locale,
        "patterns": [
            {"value": pattern.value, "mode": pattern.mode}
            for pattern in proposal.match.patterns
        ],
        "gateway": gateway_type,
        "labels": {"positive": positive, "negative": negative},
        "source": proposal.source or DEFAULT_SOURCE,
    }

    existing = label_rules.setdefault("label_rules", [])
    if any(item.get("id") == entry["id"] for item in existing):
        raise MentorApplyConflict([f"Label rule id {entry['id']} already exists."])
    existing.append(entry)


def _apply_alias(
    aliases_data: Dict[str, Any],
    proposal: Proposal,
    normalized_targets: List[Dict[str, str]],
) -> None:
    meta_locale = aliases_data.setdefault("locale", "sk")
    if not meta_locale:
        aliases_data["locale"] = "sk"
    aliases_data.setdefault("source", "mentor")
    alias_map = aliases_data.setdefault("aliases", {})
    params = proposal.action.params if proposal.action else {}
    role = params.get("role") if isinstance(params, dict) else None
    if not role and normalized_targets:
        role = normalized_targets[0].get("lane")
    if not role:
        raise MentorApplyConflict([f"Proposal {proposal.id} missing role target."])
    role = str(role)

    raw_aliases = params.get("aliases") if isinstance(params, dict) else None
    alias_values: List[str]
    if isinstance(raw_aliases, (list, tuple)) and raw_aliases:
        alias_values = [str(item) for item in raw_aliases]
    else:
        alias_values = list(proposal.match.context)
    if not alias_values:
        raise MentorApplyConflict([f"Proposal {proposal.id} has no alias values."])

    existing_values = alias_map.get(role, []) or []
    merged = _deduplicate_aliases(list(existing_values) + alias_values)
    alias_map[role] = merged


def _load_state() -> Dict[str, Any]:
    _ensure_kb_dir()
    label_rules = _read_yaml(LABEL_RULES_FILE, {"label_rules": []})
    if not isinstance(label_rules, dict):
        label_rules = {"label_rules": []}
    aliases = _read_yaml(
        ALIASES_FILE, {"locale": "sk", "source": "mentor", "aliases": {}}
    )
    if not isinstance(aliases, dict):
        aliases = {"locale": "sk", "source": "mentor", "aliases": {}}
    aliases.setdefault("aliases", {})
    return {"label_rules": label_rules, "aliases": aliases}


def _save_state(state: Dict[str, Any], touched: Iterable[Path]) -> None:
    if LABEL_RULES_FILE in touched:
        _write_yaml(LABEL_RULES_FILE, state["label_rules"])
    if ALIASES_FILE in touched:
        _write_yaml(ALIASES_FILE, state["aliases"])


def _run_git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # type: ignore[no-any-unimported]
        ["git", *args],
        cwd=str(REPO_ROOT),
        check=True,
        capture_output=True,
        text=True,
    )


def apply_proposals(request: MentorApplyRequest) -> MentorApplyResponse:
    proposals = list(request.proposals or [])
    if not proposals:
        raise MentorApplyConflict(["No proposals to apply."])

    engine_document = (
        copy.deepcopy(request.engine_json) if request.engine_json is not None else None
    )
    accumulated_patch_ops: List[Dict[str, Any]] = []
    engine_only = all(proposal.type == "engine_patch" for proposal in proposals)

    if engine_only:
        if engine_document is None:
            raise MentorApplyConflict(
                ["Engine JSON is required for engine_patch proposals."]
            )
        for proposal in proposals:
            if not proposal.engine_patch:
                raise MentorApplyConflict(
                    [f"Proposal {proposal.id} has no engine_patch operations."]
                )
            for op in proposal.engine_patch:
                if hasattr(op, "model_dump"):
                    accumulated_patch_ops.append(op.model_dump(by_alias=True))
                elif isinstance(op, dict):
                    accumulated_patch_ops.append(dict(op))
        if not accumulated_patch_ops:
            raise MentorApplyConflict(["No engine changes to apply."])
        try:
            patched_engine_json = _apply_json_patch(
                engine_document, accumulated_patch_ops
            )
        except ValueError as exc:
            raise MentorApplyConflict([f"Failed to apply engine patch: {exc}"])
        return MentorApplyResponse(
            new_kb_version=request.base_kb_version or "engine_patch",
            audit=MentorApplyAudit(commit_id=None, pr_url=None),
            patched_engine_json=patched_engine_json,
        )

    normalized_targets_cache: Dict[str, List[Dict[str, str]]] = {}
    for idx, proposal in enumerate(proposals):
        if proposal.type not in {"alias", "label_rule"}:
            raise UnsupportedProposalType(proposal.type)
        _ensure_proposal_identity(proposal, idx)
        _normalize_patterns(proposal)
        _normalize_action(proposal)
        targets = _normalize_targets(proposal)
        normalized_targets_cache[proposal.id] = targets
        if proposal.engine_patch:
            for op in proposal.engine_patch:
                if hasattr(op, "model_dump"):
                    accumulated_patch_ops.append(op.model_dump(by_alias=True))
                elif isinstance(op, dict):
                    accumulated_patch_ops.append(dict(op))
        if not proposal.source:
            proposal.source = DEFAULT_SOURCE

    current_state = _load_state()
    lint_issues = lint_kb(current_state["label_rules"], current_state["aliases"])
    if lint_issues:
        raise MentorApplyConflict(lint_issues)

    preview_state = {
        "label_rules": copy.deepcopy(current_state["label_rules"]),
        "aliases": copy.deepcopy(current_state["aliases"]),
    }

    touched: List[Path] = []
    for proposal in proposals:
        targets = normalized_targets_cache.get(proposal.id, [])
        if proposal.type == "label_rule":
            _apply_label_rule(preview_state["label_rules"], proposal, targets)
            if LABEL_RULES_FILE not in touched:
                touched.append(LABEL_RULES_FILE)
        elif proposal.type == "alias":
            _apply_alias(preview_state["aliases"], proposal, targets)
            if ALIASES_FILE not in touched:
                touched.append(ALIASES_FILE)

    if not touched:
        raise MentorApplyConflict(["No changes to apply."])

    post_lint = lint_kb(preview_state["label_rules"], preview_state["aliases"])
    if post_lint:
        raise MentorApplyConflict(post_lint)

    conflict_messages = detect_conflicts(preview_state["aliases"])
    if conflict_messages:
        raise MentorApplyConflict(conflict_messages)

    if (
        preview_state["label_rules"] == current_state["label_rules"]
        and preview_state["aliases"] == current_state["aliases"]
    ):
        raise MentorApplyConflict(["No changes to apply."])

    _save_state(preview_state, touched)

    for path in touched:
        _run_git("add", str(path.relative_to(REPO_ROOT)))

    proposal_ids = ", ".join(proposal.id for proposal in proposals)
    try:
        _run_git("commit", "--no-verify", "-m", f"mentor: apply {proposal_ids}")
    except CalledProcessError as exc:
        raise RuntimeError(exc.stderr.strip() or exc.stdout.strip()) from exc

    commit = _run_git("rev-parse", "HEAD")
    commit_id = commit.stdout.strip()
    new_version = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    audit = MentorApplyAudit(commit_id=commit_id, pr_url=None)

    patched_engine_json = None
    if engine_document is not None and accumulated_patch_ops:
        try:
            patched_engine_json = _apply_json_patch(
                engine_document, accumulated_patch_ops
            )
        except ValueError as exc:
            raise MentorApplyConflict([f"Failed to apply engine patch: {exc}"])

    return MentorApplyResponse(
        new_kb_version=new_version, audit=audit, patched_engine_json=patched_engine_json
    )
