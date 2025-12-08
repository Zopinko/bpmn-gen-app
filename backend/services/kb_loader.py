from pathlib import Path
from typing import Any, Dict, Optional, Tuple
import json
import yaml

KB_DIR = Path(__file__).resolve().parent.parent / "kb"


def _load_yaml_candidates(
    candidates: Tuple[str, ...]
) -> Tuple[Optional[Any], Optional[str]]:
    for filename in candidates:
        path = KB_DIR / filename
        if path.exists():
            with path.open("r", encoding="utf-8") as handle:
                return yaml.safe_load(handle), filename
    return None, None


def _load_json_candidates(
    candidates: Tuple[str, ...]
) -> Tuple[Optional[Any], Optional[str]]:
    for filename in candidates:
        path = KB_DIR / filename
        if path.exists():
            with path.open("r", encoding="utf-8") as handle:
                return json.load(handle), filename
    return None, None


def _variant_filenames(
    prefix: str, locale: Optional[str], variant: str, extension: str
) -> Tuple[str, ...]:
    candidates = []
    if variant and variant != "main":
        if locale:
            candidates.append(f"{prefix}.{variant}.{locale}{extension}")
        else:
            candidates.append(f"{prefix}.{variant}{extension}")
    if locale:
        candidates.append(f"{prefix}.{locale}{extension}")
    else:
        candidates.append(f"{prefix}{extension}")
    return tuple(candidates)


def get_kb(locale: str = "sk", variant: str = "main") -> Dict[str, Any]:
    """Load KB assets with optional variant fallback.

    If a variant-specific file is missing we gracefully fall back to the main KB
    while recording metadata so the caller knows a fallback occurred.
    """

    meta: Dict[str, Any] = {
        "variant_requested": variant or "main",
        "variant_resolved": "main",
        "files": {},
    }

    # Synonyms
    syn_candidates = _variant_filenames("synonyms", locale, variant, ".yaml")
    syn, syn_file = _load_yaml_candidates(syn_candidates)
    if syn is None:
        raise FileNotFoundError(
            f"No synonyms file found for locale={locale} variant={variant}"
        )
    meta["files"]["synonyms"] = {
        "filename": syn_file,
        "is_variant": syn_file in syn_candidates
        and syn_file.startswith(f"synonyms.{variant}"),
    }

    # Patterns
    pat_candidates = _variant_filenames("patterns", locale, variant, ".yaml")
    pat, pat_file = _load_yaml_candidates(pat_candidates)
    if pat is None:
        raise FileNotFoundError(
            f"No patterns file found for locale={locale} variant={variant}"
        )
    meta["files"]["patterns"] = {
        "filename": pat_file,
        "is_variant": pat_file in pat_candidates
        and pat_file.startswith(f"patterns.{variant}"),
    }

    # Roles
    roles_candidates = _variant_filenames("roles", locale, variant, ".yaml")
    roles, roles_file = _load_yaml_candidates(roles_candidates)
    if roles is None:
        raise FileNotFoundError(
            f"No roles file found for locale={locale} variant={variant}"
        )
    meta["files"]["roles"] = {
        "filename": roles_file,
        "is_variant": roles_file in roles_candidates
        and roles_file.startswith(f"roles.{variant}"),
    }

    # Constraints (not locale specific)
    constraints_candidates = _variant_filenames("constraints", None, variant, ".yaml")
    constraints, constraints_file = _load_yaml_candidates(constraints_candidates)
    if constraints is None:
        raise FileNotFoundError("constraints.yaml missing from KB directory")
    meta["files"]["constraints"] = {
        "filename": constraints_file,
        "is_variant": constraints_file in constraints_candidates
        and constraints_file.startswith(f"constraints.{variant}"),
    }

    # Templates (JSON)
    templates_candidates = _variant_filenames("templates", None, variant, ".json")
    templates, templates_file = _load_json_candidates(templates_candidates)
    if templates is None:
        raise FileNotFoundError("templates.json missing from KB directory")
    meta["files"]["templates"] = {
        "filename": templates_file,
        "is_variant": templates_file in templates_candidates
        and templates_file.startswith(f"templates.{variant}"),
    }

    # Decide resolved variant: if at least one variant-specific file was loaded
    resolved_variant = meta["variant_requested"]
    if resolved_variant != "main" and not any(
        info["is_variant"] for info in meta["files"].values()
    ):
        resolved_variant = "main"
    meta["variant_resolved"] = resolved_variant

    return {
        "syn": syn,
        "pat": pat,
        "tpl": templates,
        "roles": roles,
        "constraints": constraints,
        "_meta": meta,
    }
