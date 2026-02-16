# services/frajer_kb_engine.py
from __future__ import annotations

import re
import uuid
from typing import Dict, Any, List, Optional, Tuple

from .kb_loader import get_kb


def _uuid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:6]}"


class FrajerKB:
    """KB-driven parser + heuristics for Frajer."""

    def __init__(self, locale: str = "sk", kb_variant: str = "main") -> None:
        self.locale = locale
        self.kb_variant_requested = kb_variant or "main"
        self.kb = get_kb(locale, variant=self.kb_variant_requested)
        self.kb_meta = self.kb.get("_meta", {})
        self.kb_variant_resolved = self.kb_meta.get(
            "variant_resolved", self.kb_variant_requested
        )
        roles = self.kb.get("roles", {})

        self.role_aliases: Dict[str, List[str]] = roles.get("aliases", {})
        self.default_lane: str = roles.get("defaults", {}).get(
            "primary_process_lane", "Main"
        )
        self.system_lanes: set[str] = {
            name for name in self.role_aliases.keys() if name.lower().startswith("syst")
        }
        if not self.system_lanes and "System" not in self.role_aliases:
            self.system_lanes = {"System"}

    def _clean_action(self, txt: str) -> str:
        txt = (txt or "").strip().rstrip(".")
        txt = re.sub(
            r"^\s*([^\W\d_][\w\s\-\/&]+?)\s*:\s+",
            "",
            txt,
            flags=re.UNICODE,
        )
        for lane_name in self.role_aliases.keys():
            pref = lane_name.lower() + " "
            if txt.lower().startswith(pref):
                txt = txt[len(lane_name) :].strip()
        return txt[:1].upper() + txt[1:] if txt else txt

    # ------------------------------------------------------------------
    def detect_construct(self, sentence: str) -> Optional[Dict[str, Any]]:
        s = sentence.strip()
        lane_hint = self._lane_hint(s)

        for rule in self.kb.get("pat", {}).get("constructs", []):
            hints = rule.get("hints", [])
            if any(re.search(h, s) for h in hints):
                return {
                    "intent": rule.get("intent"),
                    "template": rule.get("template"),
                    "rule_id": rule.get("id"),
                }

        if re.search(r"(?i)\bak\b.+\b(inak|else)\b", s) or re.search(
            r"(?i)\bak\b.+\bpotom\b", s
        ):
            return {
                "intent": "exclusive_gateway",
                "template": "exclusive_if_else",
                "rule_id": "heur_if_else",
            }
        if re.search(r"(?i)\b(paralelne|zároveň|súbežne|popritom)\b", s):
            return {
                "intent": "parallel_gateway",
                "template": "parallel_split_join",
                "rule_id": "heur_parallel",
            }
        if re.search(r"(?i)\b(opakuj kým|kým|pokiaľ|až do)\b", s):
            return {"intent": "loop", "template": "while_loop", "rule_id": "heur_loop"}
        if re.search(r"(?i)\b(po(?:šle|došle)|notifikuj|informuj)\b", s):
            return {
                "intent": "message",
                "template": "message_task",
                "rule_id": "heur_message",
            }

        return None

    # ------------------------------------------------------------------
    def _lane_hint(self, sentence: str) -> str:
        s = sentence.strip()

        match = re.match(
            r"^\s*([^\W\d_][\w\s\-\/&]+?)\s*:\s+",
            s,
            flags=re.UNICODE,
        )
        if match:
            return match.group(1).strip()

        for lane, aliases in self.role_aliases.items():
            pattern = r"\b(" + "|".join(map(re.escape, aliases + [lane])) + r")\b"
            if re.search(pattern, s, flags=re.IGNORECASE):
                return lane

        return self.default_lane

    # ------------------------------------------------------------------
    def fill_slots(self, sentence: str, template: str) -> Dict[str, str]:
        s = sentence.strip()
        lane_hint = self._lane_hint(s)
        slots: Dict[str, str] = {
            "lane_true": lane_hint,
            "lane_false": lane_hint,
            "lane_join": lane_hint,
            "lane_a": lane_hint,
            "lane_b": lane_hint,
            "action_a": "Akcia A",
            "action_b": "Akcia B",
            "inc_a": "Optional A",
            "inc_b": "Optional B",
            "message_action": "Odošli informáciu",
            "lane_target": lane_hint,
            "loop_cond": "Podmienka platí",
            "loop_action": "Opakovaná akcia",
            "cond_short": "",
            "then_action": "",
            "else_action": "",
        }
        if template == "exclusive_if_else":
            m = re.search(
                r"(?i)\bak\s+([^,]+),\s*(.+?)(?:,|\.)\s*(inak|else)\s+(.+)$", s
            )
            if m:
                cond = re.sub(
                    r"(?i)^(je|je to|suma|hodnota)\s*", "", m.group(1)
                ).strip()
                then_raw = m.group(2)
                else_raw = m.group(4)
                slots["cond_short"] = cond
                slots["then_action"] = self._clean_action(then_raw)
                slots["else_action"] = self._clean_action(else_raw)
                slots["lane_true"] = self._lane_hint(then_raw)
                slots["lane_false"] = self._lane_hint(else_raw)
            else:
                m2 = re.search(r"(?i)\bak\s+([^,]+),\s*(.+)$", s)
                if m2:
                    cond = re.sub(
                        r"(?i)^(je|je to|suma|hodnota)\s*", "", m2.group(1)
                    ).strip()
                    then_raw = m2.group(2)
                    slots["cond_short"] = cond
                    slots["then_action"] = self._clean_action(then_raw)
                    slots["lane_true"] = self._lane_hint(then_raw)

        if template == "exclusive_if_else" and not slots.get("lane_false"):
            slots["lane_false"] = slots.get("lane_true") or self.default_lane
        elif template == "exclusive_if_then":
            m = re.match(r"(?i)^\s*ak\s+([^,]+),\s*(.+)$", s)
            if m:
                cond_raw = m.group(1).strip()
                action_raw = m.group(2).strip()

                cond_clean = re.sub(
                    r"(?i)^(je|je to|stav|situácia|materiál)\s*", "", cond_raw
                ).strip()
                cond_lower = cond_clean.lower()
                if cond_lower.startswith("nie je "):
                    cond_clean = "Je " + cond_clean[7:]
                elif " nie je " in cond_lower:
                    cond_clean = re.sub(r"(?i)\s*nie\s+je\s*", " je ", cond_clean)
                elif cond_lower.startswith("nie "):
                    cond_clean = cond_clean[4:]
                cond_clean = cond_clean.strip().rstrip(".")
                if cond_clean:
                    cond_clean = cond_clean[:1].upper() + cond_clean[1:]

                action_text = self._clean_action(action_raw)
                lane_true = self._lane_hint(action_raw)
                if (
                    lane_true
                    and lane_true != self.default_lane
                    and lane_true not in self.system_lanes
                ):
                    first_token = (
                        re.split(r"\s+", action_text.strip(), maxsplit=1)[0]
                        .strip(":,;")
                        .lower()
                    )
                    aliases = [lane_true.lower()] + [
                        alias.lower() for alias in self.role_aliases.get(lane_true, [])
                    ]
                    if first_token not in aliases:
                        lane_true = self.default_lane

                slots["cond_short"] = cond_clean or self._clean_action(cond_raw)
                slots["then_action"] = action_text or "Vykonaj ďalší krok"
                slots["lane_true"] = lane_true or lane_hint
                slots["lane_join"] = lane_true or lane_hint
                slots["lane_false"] = lane_true or lane_hint

        elif template in ("parallel_split_join", "inclusive_split_join"):
            parts = re.split(r"(?i)\b(?:a|tiež|zároveň|popritom)\b", s, maxsplit=1)
            if len(parts) == 2:
                left, right = parts[0].strip(), parts[1].strip()
                slots["action_a"] = self._clean_action(left)
                slots["action_b"] = self._clean_action(right)
                slots["lane_a"] = self._lane_hint(left)
                slots["lane_b"] = self._lane_hint(right)

        elif template == "message_task":
            slots["lane_target"] = self._lane_hint(s)
            slots["message_action"] = self._clean_action(
                re.sub(r"(?i)\b(po(?:šle|došle)|notifikuj|informuj)\b", "Odošli", s)
            )

        elif template == "while_loop":
            m = re.search(
                r"(?i)\b(opakuj kým|kým|pokiaľ|až do)\b\s*(.+?)(?::|\.)", s
            )
            if m:
                slots["loop_cond"] = m.group(2).strip()
            m2 = re.search(r":\s*(.+)$", s)
            if m2:
                slots["loop_action"] = self._clean_action(m2.group(1))

        return slots

    def compile_parallel_then(
        self, first_sentence: str, second_sentence: str, prev_id: Optional[str]
    ) -> Tuple[List[Dict], List[Dict], str]:
        lane_a = self._lane_hint(first_sentence) or self.default_lane
        lane_b = self._lane_hint(second_sentence) or self.default_lane
        slots = {
            "lane_a": lane_a,
            "lane_b": lane_b,
            "action_a": self._clean_action(first_sentence),
            "action_b": self._clean_action(second_sentence),
        }
        return self.apply_template("parallel_split_join", slots, prev_id)

    # ------------------------------------------------------------------
    def apply_template(
        self, tpl_name: str, slots: Dict[str, str], prev_id: Optional[str]
    ) -> Tuple[List[Dict], List[Dict], str]:
        tpl = self.kb["tpl"].get(tpl_name, {})
        nodes: List[Dict[str, Any]] = []
        flows: List[Dict[str, Any]] = []

        def _norm_type(t: str) -> str:
            t = t.strip()
            if "_" in t:
                return t.lower()
            out: List[str] = []
            for ch in t:
                out.append("_" + ch.lower() if ch.isupper() else ch)
            return "".join(out).lstrip("_")

        def _lane_value(raw_lane: Optional[str]) -> str:
            if not raw_lane:
                return slots.get("lane_true") or self.default_lane
            lane = raw_lane.strip()
            if lane.startswith("{") and lane.endswith("}"):
                key = lane[1:-1].strip()
                return slots.get(key) or self.default_lane
            return lane

        id_map: Dict[str, str] = {}
        id_map_index: Dict[int, str] = {}
        type_counts: Dict[str, int] = {}

        for idx, node_tpl in enumerate(tpl.get("nodes", [])):
            ntype = _norm_type(node_tpl["type"])
            node_id = _uuid(ntype)
            label_tpl = node_tpl.get("label", "")
            label = label_tpl.format(**slots) if label_tpl else ""
            lane = _lane_value(node_tpl.get("lane"))
            name = label or node_tpl.get("name") or ntype.replace("_", " ").title()
            nodes.append(
                {
                    "id": node_id,
                    "type": ntype,
                    "label": label,
                    "name": name,
                    "laneId": lane,
                }
            )

            type_index = type_counts.get(ntype, 0)
            type_counts[ntype] = type_index + 1
            id_map[f"{ntype}#{type_index}"] = node_id

            original_type = node_tpl.get("type") or ntype
            id_map[f"{original_type}#{type_index}"] = node_id

            if node_tpl.get("key"):
                id_map[node_tpl["key"].strip()] = node_id

            id_map_index[idx] = node_id

        def resolve(ref: str) -> str:
            if ref == "prev":
                if prev_id:
                    return prev_id
                return id_map_index.get(0)
            if ref in id_map:
                return id_map[ref]
            m = re.match(r"^([A-Za-z_][\w]*)#(\d+)$", ref)
            if m:
                key_norm = _norm_type(m.group(1))
                idx = int(m.group(2))
                if f"{key_norm}#{idx}" in id_map:
                    return id_map[f"{key_norm}#{idx}"]
                if f"{m.group(1)}#{idx}" in id_map:
                    return id_map[f"{m.group(1)}#{idx}"]
                if idx in id_map_index:
                    return id_map_index[idx]
            last_idx = max(id_map_index.keys()) if id_map_index else 0
            return id_map_index.get(last_idx)

        for flow_tpl in tpl.get("flows", []):
            src, dst = flow_tpl[0], flow_tpl[1]
            flows.append(
                {"id": _uuid("flow"), "source": resolve(src), "target": resolve(dst)}
            )

        last = (
            flows[-1]["target"]
            if flows
            else (nodes[-1]["id"] if nodes else (prev_id or ""))
        )
        return nodes, flows, last

    # ------------------------------------------------------------------
    def compile_sentence(
        self, sentence: str, prev_id: Optional[str]
    ) -> Tuple[List[Dict], List[Dict], str]:
        construct = self.detect_construct(sentence)
        if not construct:
            node_id = _uuid("task")
            lane = self._lane_hint(sentence)
            label = sentence.strip().rstrip(".")
            node = {
                "id": node_id,
                "type": "task",
                "label": label,
                "name": label or "Task",
                "laneId": lane,
            }
            flows: List[Dict[str, Any]] = []
            if prev_id:
                flows = [{"id": _uuid("flow"), "source": prev_id, "target": node_id}]
            return [node], flows, node_id

        slots = self.fill_slots(sentence, construct["template"])
        return self.apply_template(construct["template"], slots, prev_id)
