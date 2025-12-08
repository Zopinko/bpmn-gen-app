# routers/nl_router.py
import json
import uuid
import re
from typing import Dict, Any, Optional, List
from fastapi import APIRouter, HTTPException

from core.config import get_openai_client
from schemas.nl import NLProcess, SessionReply, UserMessage, NLResponse
from services.bpmn_svc import generate_bpmn_from_json
from schemas.engine import validate_payload
from services.architect.normalize import (
    normalize_engine_payload,
    postprocess_engine_json,
)
from services.node_classifier import determine_node_type

router = APIRouter()
client = get_openai_client()

# In-memory chat sessions
SESSIONS: Dict[str, Dict[str, Any]] = {}

SYSTEM_PROMPT = """You are a Process Design Copilot (Slovak).
Najprv si vyžiadaj chýbajúce informácie čo najkratšími otázkami (lanes/roly a kroky – 3–8 slov, slovesom na začiatku).
Keď máš dosť údajov, vráť finálny proces.
Výstup musí byť VŽDY validný JSON podľa schémy (nižšie) – nikdy text mimo JSON.
"""


def tool_schema_emit_json():
    return {
        "type": "function",
        "function": {
            "name": "emit_json",
            "description": "Finalize simple process JSON for transformation do engine JSON.",
            "parameters": {
                "type": "object",
                "properties": {
                    "process_json": {
                        "type": "object",
                        "required": ["process_name", "lanes"],
                        "properties": {
                            "process_name": {"type": "string"},
                            "lanes": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "required": ["name", "tasks"],
                                    "properties": {
                                        "name": {"type": "string"},
                                        "tasks": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "required": ["name"],
                                                "properties": {
                                                    "name": {"type": "string"}
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    }
                },
                "required": ["process_json"],
            },
        },
    }


@router.post("/nl/session", response_model=SessionReply)
def nl_session():
    sid = str(uuid.uuid4())
    SESSIONS[sid] = {"messages": [{"role": "system", "content": SYSTEM_PROMPT}]}
    first = "Ahoj! Ako sa volá proces a kto sú hlavní účastníci (lanes)?"
    SESSIONS[sid]["messages"].append({"role": "assistant", "content": first})
    return SessionReply(session_id=sid, assistant_message=first)


@router.post("/nl/message", response_model=NLResponse)
def nl_message(inp: UserMessage):
    if inp.session_id not in SESSIONS:
        raise HTTPException(404, "Session not found")

    hist = SESSIONS[inp.session_id]["messages"]
    hist.append({"role": "user", "content": inp.message})

    chat = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=hist,
        tools=[tool_schema_emit_json()],
        tool_choice="auto",
        temperature=0.3,
    )

    msg = chat.choices[0].message
    assistant_text = msg.content or ""
    if assistant_text:
        hist.append({"role": "assistant", "content": assistant_text})

    tool_payload = None
    tool_calls = msg.tool_calls or []
    for tc in tool_calls:
        if tc.type == "function" and tc.function.name == "emit_json":
            try:
                tool_payload = json.loads(tc.function.arguments or "{}")
            except Exception as e:
                raise HTTPException(400, f"emit_json arguments JSON parse error: {e}")
            break

    out = NLResponse(
        session_id=inp.session_id, assistant_message=assistant_text, pending=True
    )

    if isinstance(tool_payload, dict):
        simple = tool_payload.get("process_json", {})
        try:
            simple_obj = NLProcess.model_validate(simple)
        except Exception as e:
            raise HTTPException(400, f"emit_json.process_json je nevalidný: {e}")

        engine = simple_to_engine(simple_obj)
        engine = normalize_engine_payload(engine)
        engine = postprocess_engine_json(engine)
        validate_payload(engine)
        xml = generate_bpmn_from_json(engine)

        out.pending = False
        out.simple_json = simple_obj.model_dump()
        out.engine_json = engine
        out.bpmn_xml = xml

    return out


# ---------------- simple -> engine (s gateway) ----------------


def slugify(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return re.sub(r"-+", "-", s).strip("-") or "process"


def simple_to_engine(proc: NLProcess) -> dict:
    if not proc.lanes:
        raise HTTPException(400, "Process musí mať aspoň jeden lane.")

    pid = f"{slugify(proc.process_name)}-{str(uuid.uuid4())[:8]}"
    lanes: List[dict] = []
    nodes: List[dict] = []
    flows: List[dict] = []

    # 1) Lanes
    lane_ids: List[str] = []
    for i, ln in enumerate(proc.lanes, start=1):
        lid = f"lane_{i}"
        lane_ids.append(lid)
        lanes.append({"id": lid, "name": ln.name})

    # 2) Start/End
    start_id = "start_1"
    end_id = "end_1"
    # ... tesne pred nodes.append({...}) ...
    gw_id = f"gw_{uuid.uuid4().hex[:8]}"
    gw_name = "Rozhodnutie"  # alebo si sem neskôr doplň dynamický text

    nodes.append(
        {"id": start_id, "type": "startEvent", "laneId": lane_ids[0], "name": "Start"}
    )
    nodes.append(
        {"id": end_id, "type": "endEvent", "laneId": lane_ids[-1], "name": "End"}
    )
    nodes.append(
        {
            "id": gw_id,
            "type": "exclusiveGateway",  # nechaj typ, ak ho takto používa zvyšok pipeline
            "laneId": lid,
            "name": gw_name,
        }
    )

    # 3) mapovanie názvu lane -> laneId (pre vetvy do iného lane)
    lane_name_to_id = {ln.name.strip(): lid for lid, ln in zip(lane_ids, proc.lanes)}

    task_ids_by_lane: Dict[str, List[str]] = {}
    task_counter = 1

    # 4) Prejdi lane po lane
    for lid, ln in zip(lane_ids, proc.lanes):
        tids: List[str] = []  # sekvenčné uzly v lane
        prev_id: Optional[str] = None
        curr_gateway_id: Optional[str] = None  # aktívny gateway po "DECIDE:"

        for t in ln.tasks or []:
            name = (t.name or "").strip()
            lower = name.lower()

            # 4.1) DECIDE: vytvor exclusive gateway
            if lower.startswith("decide:"):
                gw_id = f"gw_{uuid.uuid4().hex[:8]}"
                gw_name = "Rozhodnutie"

                nodes.append(
                    {
                        "id": gw_id,
                        "type": "gateway",
                        "gatewayType": "exclusive",
                        "laneId": lid,
                        "name": gw_name,
                    }
                )

                if prev_id:
                    flows.append(
                        {
                            "id": f"f_{prev_id}_to_{gw_id}",
                            "source": prev_id,
                            "target": gw_id,
                        }
                    )

                tids.append(gw_id)  # gateway vstúpi do sekvenčného poradia
                prev_id = gw_id
                curr_gateway_id = gw_id
                continue

            # 4.2) Vetva: '-> LABEL: Akcia [→ lane: XYZ]'
            m = re.match(r"^->\s*([^:]+)\s*:\s*(.+)$", name)
            if m and curr_gateway_id:
                cond = m.group(1).strip()  # napr. ÁNO / NIE
                action = m.group(2).strip()

                # voliteľne presun do iného lane na konci riadku: "→ lane: Názov"
                lane_override = None
                mo = re.search(r"\s*→\s*lane:\s*(.+)$", action, flags=re.IGNORECASE)
                if mo:
                    lane_name = mo.group(1).strip()
                    lane_override = lane_name_to_id.get(lane_name)
                    action = re.sub(
                        r"\s*→\s*lane:\s*.+$", "", action, flags=re.IGNORECASE
                    ).strip()

                target_lane = lane_override or lid

                tid = f"task_{task_counter}"
                task_counter += 1
                nodes.append(
                    {"id": tid, "type": "task", "laneId": target_lane, "name": action}
                )

                flows.append(
                    {
                        "id": f"f_{curr_gateway_id}_to_{tid}",
                        "source": curr_gateway_id,
                        "target": tid,
                        "condition": cond,
                    }
                )
                # Vetvy NEpridávame do sekvenčného poradia (aby sa medzi sebou neprepájali automaticky)
                continue

            # 4.3) Bežný sekvenčný krok (auto-rozpoznávanie cez klasifikátor)
            tid = f"task_{task_counter}"
            task_counter += 1

            cls = determine_node_type(name, lang="sk")  # prípadne viaž na jazyk session
            node: Dict[str, Any] = {"id": tid, "laneId": lid, "name": name}
            ntype = cls["type"]

            if ntype in (
                "exclusiveGateway",
                "parallelGateway",
                "inclusiveGateway",
                "eventBasedGateway",
            ):
                node["type"] = ntype

            elif ntype in ("intermediateCatchEvent", "intermediateThrowEvent"):
                node["type"] = ntype
                node["eventDefinition"] = cls.get("eventDefinition")
                meta = cls.get("meta") or {}
                if node["eventDefinition"] == "timer":
                    node["timer"] = meta.get("timer")  # {"iso8601":"PT48H", ...}
                if node["eventDefinition"] == "message":
                    node["direction"] = meta.get("direction")  # "send" / "receive"
                if node["eventDefinition"] == "error":
                    node["errorRef"] = "GenericError"

            elif ntype == "subProcess":
                node["type"] = "subProcess"

            else:
                node["type"] = "task"  # fallback

            nodes.append(node)
            tids.append(tid)

            if prev_id:
                flows.append(
                    {"id": f"f_{prev_id}_to_{tid}", "source": prev_id, "target": tid}
                )

            prev_id = tid
            tids.append(tid)
            curr_gateway_id = None  # normálny krok ukončí „mód rozhodnutia“

        task_ids_by_lane[lid] = tids

    # 5) Start/End podľa poradia vytvárania uzlov (nie podľa "posledného lane"):
    ordered_ids = [n["id"] for n in nodes if n["id"] not in (start_id, end_id)]
    first_created: Optional[str] = ordered_ids[0] if ordered_ids else None
    last_created: Optional[str] = ordered_ids[-1] if ordered_ids else None

    if first_created and last_created:
        flows.append(
            {
                "id": f"f_{start_id}_to_{first_created}",
                "source": start_id,
                "target": first_created,
            }
        )
        flows.append(
            {
                "id": f"f_{last_created}_to_{end_id}",
                "source": last_created,
                "target": end_id,
            }
        )
    else:
        flows.append(
            {"id": f"f_{start_id}_to_{end_id}", "source": start_id, "target": end_id}
        )

    return {
        "processId": pid,
        "name": proc.process_name,
        "lanes": lanes,
        "nodes": nodes,
        "flows": flows,
    }
