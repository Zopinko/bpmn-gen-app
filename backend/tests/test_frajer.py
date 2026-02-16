# -*- coding: utf-8 -*-
import re
from typing import Dict, Any

# 1) UNIT testy pre draft engine (bez KB)
from services.frajer_services import draft_engine_json_from_text
from services.bpmn_svc import postprocess_engine_json

# 2) UNIT test pre detekciu IF/ELSE cez KB (nevoláme HTTP)
from services.frajer_kb_engine import FrajerKB

# 3) INTEGRATION test: voláme priamo FastAPI app (bez spúšťania uvicorn)
from main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def _by_type(ej: Dict[str, Any], t: str):
    return [n for n in ej.get("nodes", []) if n.get("type") == t]


def test_simple_linear_draft():
    ej = draft_engine_json_from_text(
        "Používateľ vytvorí objednávku. Systém odošle potvrdenie."
    )
    assert ej["lanes"]
    assert _by_type(ej, "start_event")
    assert _by_type(ej, "end_event")
    assert _by_type(ej, "task")
    assert len(ej["flows"]) >= 2


def test_if_else_detect_slots_with_kb():
    text = "Ak je suma > 1000, potom schvál ponuku, inak eskaluj manažérovi."
    kb = FrajerKB(locale="sk")
    c = kb.detect_construct(text)
    assert c is not None, "IF/ELSE veta nebola rozpoznaná (chýba 'potom'?)"
    assert c["template"] == "exclusive_if_else"

    slots = kb.fill_slots(text, c["template"])
    # očakávané sloty
    assert "suma > 1000" in slots["cond_short"]
    assert "schvál" in slots["then_action"].lower()
    assert "eskaluj" in slots["else_action"].lower()


def test_lane_detection_order_independent_draft():
    text = (
        "Operátor: skontroluje žiadosť. Zapíše poznámku.\n"
        "Backoffice: vytvorí zmluvu; odošle email."
    )
    ej = draft_engine_json_from_text(text)

    lane_names = {lane["name"] for lane in ej["lanes"]}
    assert {"Operátor", "Backoffice"}.issubset(lane_names)

    lane_by_id = {lane["id"]: lane["name"] for lane in ej["lanes"]}
    tasks_by_lane = {}
    for node in ej["nodes"]:
        if node["type"] != "task":
            continue
        lane_name = lane_by_id[node["laneId"]]
        # podpor názvy v "name" (nové) aj "label" (staršie)
        nm = node.get("name") or node.get("label") or ""
        tasks_by_lane.setdefault(lane_name, []).append(nm)

    # len over, že sú tam tie dva tasky (poradie neriešime)
    assert any("skontroluje žiadosť" in t.lower() for t in tasks_by_lane["Operátor"])
    assert any("zapíše poznámku" in t.lower() for t in tasks_by_lane["Operátor"])
    assert any("vytvorí zmluvu" in t.lower() for t in tasks_by_lane["Backoffice"])
    assert any("odošle email" in t.lower() for t in tasks_by_lane["Backoffice"])


def test_preview_bpmn_contains_exclusive_gateway_with_kb():
    # Integračne otestujeme endpoint /frajer/preview-bpmn (bez uvicorn)
    txt = (
        "Sales: prijme dopyt. "
        "Ak je suma > 1000, potom schvál ponuku, inak eskaluj manažérovi. "
        "Backoffice: vystav faktúru."
    )
    r = client.post(
        "/frajer/preview-bpmn",
        json={"text": txt, "use_kb": True, "locale": "sk"},
    )
    assert r.status_code == 200
    xml = r.text

    # v XML musí byť exclusiveGateway a gateway s otáznikom v name
    assert "<exclusiveGateway" in xml
    assert re.search(
        r'<exclusiveGateway[^>]+name="[^"]+\?"', xml
    ), "Gateway nemĂˇ popis s otĂˇznikom"

    # lanes by mali obsahovať Sales a Backoffice
    assert 'lane id="Sales"' in xml
    assert 'lane id="Backoffice"' in xml


def test_gateway_flows_have_yes_no_labels():
    txt = (
        "Sales: prijme dopyt. "
        "Ak je suma > 1000, potom schval ponuku, inak eskaluj manazerovi. "
        "Backoffice: vystav fakturu."
    )
    ej = draft_engine_json_from_text(txt)
    ej = postprocess_engine_json(ej, locale="sk")

    flows_by_source = {}
    for flow in ej.get("flows", []):
        flows_by_source.setdefault(flow.get("source"), []).append(flow)

    decision_outs = None
    for node in ej.get("nodes", []):
        if node.get("type") != "exclusive_gateway":
            continue
        outs = flows_by_source.get(node.get("id"), [])
        if len(outs) == 2:
            decision_outs = outs
            break

    assert decision_outs, "Decision gateway with two outgoing flows not found"
    labels = {
        (flow.get("name") or flow.get("label") or "").lower() for flow in decision_outs
    }
    assert "áno" in labels
    assert "nie" in labels


def test_preview_json_returns_after_tidy_and_meta():
    txt = (
        "Sales: prijme dopyt. "
        "Ak je suma > 1000, potom schvál ponuku, inak eskaluj manažérovi. "
        "Backoffice: vystav faktúru."
    )
    resp = client.post(
        "/frajer/preview-json",
        json={"text": txt, "use_kb": True, "locale": "sk"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("after_tidy", {}).get("nodes"), "after_tidy missing nodes"
    assert data.get("meta", {}).get("locale") == "sk"
    kb_meta = data.get("meta", {}).get("kb") or {}
    assert kb_meta.get("variant_requested") == "main"
