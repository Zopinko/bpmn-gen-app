# services/node_classifier.py
from __future__ import annotations
import re
from typing import Dict, Any, Optional
from .lexicon_loader import get_lexicon

# --------- Regexy na trvanie (timer) ----------
DURATION_RE = re.compile(
    r"(?P<val>\d+)\s*(?P<unit>(?:min|mins|minút|minúty|minuty|minutes|m)|"
    r"(?:h|hod|hodín|hours)|(?:d|deň|dni|days)|(?:s|sec|sek|sekúnd))",
    re.IGNORECASE,
)

TOKEN_TIMER_RE = re.compile(r"\[TIMER:\s*([^\]]+)\]", re.IGNORECASE)


# --------- Helpery ----------
def _normalize(s: str) -> str:
    return " " + re.sub(r"\s+", " ", s.strip().lower()) + " "


def _contains_any(text: str, phrases: list[str]) -> bool:
    if not phrases:
        return False
    t = _normalize(text)
    for p in phrases:
        pnorm = " " + p.lower().strip() + " "
        if pnorm in t:
            return True
    return False


def _parse_timer_value(raw: str) -> Dict[str, Any]:
    """
    Prevedie '48h', '2 d', '30 min' na normalizovanú štruktúru + ISO8601 (ak vieme).
    """
    m = DURATION_RE.search(raw)
    if not m:
        return {"raw": raw.strip()}
    val = int(m.group("val"))
    unit = m.group("unit").lower()

    if unit.startswith(("min", "m")):
        iso = f"PT{val}M"
    elif unit.startswith(("h", "hod", "hour")):
        iso = f"PT{val}H"
    elif unit.startswith(("d", "deň", "dni", "day")):
        iso = f"P{val}D"
    elif unit in ("s", "sec", "sek", "sekúnd"):
        iso = f"PT{val}S"
    else:
        iso = None
    return {"value": val, "unit": unit, "iso8601": iso, "raw": raw.strip()}


# --------- Priority 1: kontrolné tokeny ----------
def _check_control_tokens(text: str, lex: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    t = text
    tokens = lex.get("control_tokens", {}) or {}

    # [TIMER: ...]
    m = TOKEN_TIMER_RE.search(t)
    if m:
        timer_info = _parse_timer_value(m.group(1))
        return {
            "type": "intermediateCatchEvent",
            "eventDefinition": "timer",
            "meta": {"timer": timer_info, "source": "token"},
        }

    def has(key: str) -> bool:
        return _contains_any(t, tokens.get(key, []))

    if has("XOR"):
        return {"type": "exclusiveGateway", "meta": {"source": "token"}}
    if has("AND"):
        return {"type": "parallelGateway", "meta": {"source": "token"}}
    if has("EVENT"):
        return {"type": "eventBasedGateway", "meta": {"source": "token"}}
    if has("ERROR"):
        return {
            "type": "intermediateThrowEvent",
            "eventDefinition": "error",
            "meta": {"source": "token"},
        }
    if has("SUB"):
        return {"type": "subProcess", "meta": {"source": "token"}}
    # [TIMER] bez hodnoty
    if any(tok in t for tok in tokens.get("TIMER", [])):
        return {
            "type": "intermediateCatchEvent",
            "eventDefinition": "timer",
            "meta": {"timer": {"raw": ""}, "source": "token"},
        }
    return None


# --------- Priority 2: slovník fráz ----------
def _match_lexicon(text: str, lex: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if _contains_any(text, lex.get("exclusive_gateway", [])):
        # vzor "ak ... inak ..." – bonus
        if " ak " in _normalize(text) and " inak " in _normalize(text):
            return {
                "type": "exclusiveGateway",
                "meta": {"source": "lexicon+pattern", "pattern": "ak/inak"},
            }
        return {"type": "exclusiveGateway", "meta": {"source": "lexicon"}}

    if _contains_any(text, lex.get("parallel_gateway", [])):
        return {"type": "parallelGateway", "meta": {"source": "lexicon"}}

    if _contains_any(text, lex.get("event_based_gateway", [])):
        return {"type": "eventBasedGateway", "meta": {"source": "lexicon"}}

    if _contains_any(text, lex.get("inclusive_gateway", [])):
        return {"type": "inclusiveGateway", "meta": {"source": "lexicon"}}

    if _contains_any(text, lex.get("manual_task", [])):
        return {"type": "manual_task", "meta": {"source": "lexicon"}}

    # subprocess – toleruj dvojbodku
    if _contains_any(text.replace(":", " "), lex.get("subprocess", [])):
        return {"type": "subProcess", "meta": {"source": "lexicon"}}

    # Events (message send/receive)
    if _contains_any(text, lex.get("message_event_send", [])):
        return {
            "type": "intermediateThrowEvent",
            "eventDefinition": "message",
            "meta": {"direction": "send", "source": "lexicon"},
        }
    if _contains_any(text, lex.get("message_event_receive", [])):
        return {
            "type": "intermediateCatchEvent",
            "eventDefinition": "message",
            "meta": {"direction": "receive", "source": "lexicon"},
        }

    if _contains_any(text, lex.get("timer_event", [])):
        m = DURATION_RE.search(text)
        meta: Dict[str, Any] = {"source": "lexicon"}
        if m:
            meta["timer"] = _parse_timer_value(m.group(0))
        return {
            "type": "intermediateCatchEvent",
            "eventDefinition": "timer",
            "meta": meta,
        }

    if _contains_any(text, lex.get("error_event", [])):
        return {
            "type": "intermediateThrowEvent",
            "eventDefinition": "error",
            "meta": {"source": "lexicon"},
        }

    if _contains_any(text, lex.get("subprocess", [])):
        return {"type": "subProcess", "meta": {"source": "lexicon"}}

    return None


# --------- Priority 3: heuristiky ----------
def _heuristics(text: str) -> Optional[Dict[str, Any]]:
    t = _normalize(text)

    # XOR: "ak ... inak ..." / "if ... else ..."
    if (" ak " in t and " inak " in t) or (" if " in t and " else " in t):
        return {
            "type": "exclusiveGateway",
            "meta": {"source": "heuristic", "pattern": "if/else"},
        }

    # AND: "súbežne|naraz|zároveň" alebo "both ... and ..."
    if any(
        kw in t
        for kw in [
            " súbežne ",
            " naraz ",
            " zároveň ",
            " in parallel ",
            " concurrently ",
        ]
    ) or re.search(r"\bboth\b.+\band\b", t):
        return {"type": "parallelGateway", "meta": {"source": "heuristic"}}

    # ⬇⬇⬇ DOPLŇ TOTO: otázka = rozhodovanie (bezpečný default je XOR)
    if "?" in text:
        return {
            "type": "exclusiveGateway",
            "meta": {"source": "heuristic", "pattern": "question-mark"},
        }

    # Timer: číslo + jednotka + trigger slovo
    m = DURATION_RE.search(text)
    if m and any(
        w in t
        for w in [" po ", " počkaj ", " after ", " wait ", " timeout ", " deadline "]
    ):
        dur = _parse_timer_value(m.group(0))
        return {
            "type": "intermediateCatchEvent",
            "eventDefinition": "timer",
            "meta": {"timer": dur, "source": "heuristic"},
        }

    if any(keyword in t for keyword in (" ručný ", " rucny ", " manual ", " hand ")):
        return {"type": "manual_task", "meta": {"source": "heuristic"}}

    # Message receive: "počkaj na odpoveď" / "wait for response"
    if re.search(r"(počkaj na|wait for).*(odpoveď|response|reply)", t):
        return {
            "type": "intermediateCatchEvent",
            "eventDefinition": "message",
            "meta": {"direction": "receive", "source": "heuristic"},
        }

    return None


# --------- Verejná API funkcia ----------
def determine_node_type(text: str, lang: str = "sk") -> Dict[str, Any]:
    """
    Vráti dict s typom uzla. Nikdy nevracia None – fallback je 'task'.
    Príklady návratu:
      {"type":"exclusiveGateway", "meta":{...}}
      {"type":"intermediateCatchEvent","eventDefinition":"timer","meta":{"timer":{"iso8601":"PT48H"}}}
      {"type":"task","meta":{"source":"fallback"}}
    """
    lex = get_lexicon(lang)

    # 1) kontrolné tokeny (najvyššia priorita)
    r = _check_control_tokens(text, lex)
    if r:
        return r

    # 2) slovník fráz
    r = _match_lexicon(text, lex)
    if r:
        return r

    # 3) heuristiky
    r = _heuristics(text)
    if r:
        return r

    # 4) fallback
    return {"type": "task", "meta": {"source": "fallback"}}
