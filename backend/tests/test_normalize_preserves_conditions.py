from services.architect.normalize import postprocess_engine_json


def _engine(gateway_name, lanes=None, extra_nodes=None, extra_flows=None):
    lanes = lanes or [{"id": "L1", "name": "Sales"}]
    nodes = [
        {"id": "s", "type": "start_event", "laneId": lanes[0]["id"], "name": "Start"},
        {"id": "g", "type": "exclusive_gateway", "laneId": lanes[0]["id"], "name": gateway_name},
        {"id": "a", "type": "task", "laneId": lanes[0]["id"], "name": "Schváliť"},
        {"id": "b", "type": "task", "laneId": lanes[0]["id"], "name": "Zamietnuť"},
        {"id": "e1", "type": "end_event", "laneId": lanes[0]["id"], "name": "Schválené"},
        {"id": "e2", "type": "end_event", "laneId": lanes[0]["id"], "name": "Zamietnuté"},
    ] + (extra_nodes or [])
    flows = [
        {"id": "f1", "source": "s", "target": "g"},
        {"id": "f2", "source": "g", "target": "a"},
        {"id": "f3", "source": "g", "target": "b"},
        {"id": "f4", "source": "a", "target": "e1"},
        {"id": "f5", "source": "b", "target": "e2"},
    ] + (extra_flows or [])
    return {"processId": "p", "name": "P", "lanes": lanes, "nodes": nodes, "flows": flows}


def _gateway_name(engine):
    return next(n["name"] for n in engine["nodes"] if n["id"] == "g")


def test_amount_condition_is_kept():
    out = postprocess_engine_json(_engine("Suma > 5000?"))
    assert _gateway_name(out) == "Suma > 5000?"


def test_non_amount_comparison_is_kept():
    out = postprocess_engine_json(_engine("Vek > 18?"))
    assert _gateway_name(out) == "Vek > 18?"


def test_merge_word_does_not_rename_gateway():
    out = postprocess_engine_json(_engine("Merge request schválený?"))
    assert _gateway_name(out) == "Merge request schválený?"


def test_multiple_starts_and_ends_are_preserved():
    lanes = [{"id": "L1", "name": "Sales"}, {"id": "L2", "name": "Backoffice"}]
    engine = _engine(
        "Schválené?",
        lanes=lanes,
        extra_nodes=[
            {"id": "s2", "type": "start_event", "laneId": "L2", "name": "Reklamácia"},
            {"id": "c", "type": "task", "laneId": "L2", "name": "Spracovať reklamáciu"},
        ],
        extra_flows=[
            {"id": "f6", "source": "s2", "target": "c"},
            {"id": "f7", "source": "c", "target": "e2"},
        ],
    )
    out = postprocess_engine_json(engine)
    ids = {n["id"] for n in out["nodes"]}
    assert {"s", "s2", "e1", "e2", "c"} <= ids
    flow_ids = {f["id"] for f in out["flows"]}
    assert {"f1", "f2", "f3", "f4", "f5", "f6", "f7"} <= flow_ids
