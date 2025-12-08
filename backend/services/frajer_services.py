import re
import uuid
from typing import Any, Dict, List, Optional

from services.frajer_kb_engine import FrajerKB

MAX_NAME_LENGTH = 80


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def _trim_name(name: str) -> str:
    return name[:MAX_NAME_LENGTH]


def _normalize_lane_name(name: Optional[str]) -> str:
    normalized = re.sub(r"\s+", " ", (name or "").strip())
    return _trim_name(normalized) or "Main"


def _split_sentences(text: str) -> List[str]:
    if not text:
        return []
    cleaned = re.sub(r"\s+", " ", text.strip())
    if not cleaned:
        return []
    raw_parts = re.split(r"(?<=[.!?])\s+|\n+", cleaned)
    merged: List[str] = []

    for part in raw_parts:
        segment = part.strip()
        if not segment:
            continue
        lower = segment.lower()
        if merged and re.match(r"^(inak|else|otherwise)\b", lower):
            merged[-1] = merged[-1].rstrip(".") + ". " + segment
        else:
            merged.append(segment)

    return [segment.strip().rstrip(".") for segment in merged if segment.strip()]


def draft_engine_json_from_text(
    text: str, locale: str = "sk", kb_variant: str = "main"
) -> Dict[str, List[Dict[str, Any]]]:
    engine = FrajerKB(locale=locale, kb_variant=kb_variant)
    sentences = _split_sentences(text)

    lanes: Dict[str, Dict[str, str]] = {}
    nodes: List[Dict[str, Any]] = []
    flows: List[Dict[str, Any]] = []

    def ensure_lane(raw_lane: Optional[str]) -> str:
        lane_name = _normalize_lane_name(raw_lane) or _normalize_lane_name(
            engine.default_lane
        )
        if lane_name not in lanes:
            lanes[lane_name] = {"id": lane_name, "name": lane_name}
        return lane_name

    default_lane = ensure_lane(engine.default_lane)

    start_id = _new_id("start")
    nodes.append(
        {"id": start_id, "type": "start_event", "name": "Start", "laneId": default_lane}
    )
    previous = start_id

    i = 0
    while i < len(sentences):
        sentence = sentences[i]
        if not sentence:
            i += 1
            continue

        prev_lane = None
        if previous:
            for existing in nodes:
                if existing["id"] == previous:
                    prev_lane = existing.get("laneId")
                    break

        if i + 2 < len(sentences):
            second = sentences[i + 1]
            third = sentences[i + 2]
            if second and third:
                third_lower = third.strip().lower()
                if third_lower.startswith(("potom ", "potom,", "potom.")):
                    lane_a = engine._lane_hint(sentence)
                    lane_b = engine._lane_hint(second)
                    if lane_a and lane_b and lane_a != lane_b:
                        new_nodes, new_flows, previous = engine.compile_parallel_then(
                            sentence, second, previous
                        )
                        for n in new_nodes:
                            lane_hint = n.get("laneId") or prev_lane or default_lane
                            lane = ensure_lane(lane_hint)
                            n["laneId"] = lane
                        nodes.extend(new_nodes)
                        flows.extend(new_flows)
                        i += 2
                        continue

        new_nodes, new_flows, previous = engine.compile_sentence(sentence, previous)
        for n in new_nodes:
            lane_hint = n.get("laneId") or prev_lane or default_lane
            n_type = (n.get("type") or "").lower()
            if n_type == "task" and n.get("label"):
                detected_lane = engine._lane_hint(n["label"])
                if detected_lane != engine.default_lane:
                    first_token = (
                        re.split(r"\s+", n["label"].strip(), maxsplit=1)[0]
                        .strip(":,;")
                        .lower()
                    )
                    aliases = [detected_lane.lower()] + [
                        alias.lower()
                        for alias in engine.role_aliases.get(detected_lane, [])
                    ]
                    if first_token in aliases:
                        lane_hint = detected_lane
                    elif lane_hint == engine.default_lane and prev_lane:
                        lane_hint = prev_lane
                elif lane_hint == engine.default_lane and prev_lane:
                    lane_hint = prev_lane
            elif n_type.endswith("gateway") and prev_lane:
                lane_hint = prev_lane
            lane = ensure_lane(lane_hint)
            n["laneId"] = lane
        nodes.extend(new_nodes)
        flows.extend(new_flows)
        i += 1

    end_id = _new_id("end")
    nodes.append(
        {"id": end_id, "type": "end_event", "name": "End", "laneId": default_lane}
    )
    flows.append(
        {
            "id": _new_id("f"),
            "source": previous,
            "target": end_id,
            "laneId": default_lane,
        }
    )

    business_nodes = [
        n for n in nodes if n.get("type") not in {"start_event", "end_event"}
    ]
    if business_nodes:
        nodes[0]["laneId"] = business_nodes[0]["laneId"]
        end_node = nodes[-1]
        if end_node.get("type") == "end_event":
            end_node["laneId"] = business_nodes[-1]["laneId"]

    node_lane_lookup = {n["id"]: n.get("laneId", default_lane) for n in nodes}
    for flow in flows:
        flow["laneId"] = node_lane_lookup.get(flow.get("source"), default_lane)

    used_lane_ids = {n["laneId"] for n in nodes}
    lanes_list = [lane for lane in lanes.values() if lane["id"] in used_lane_ids]

    return {
        "lanes": lanes_list,
        "nodes": nodes,
        "flows": flows,
    }
