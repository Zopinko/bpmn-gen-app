from xml.etree import ElementTree as ET

from services.bpmn_svc import _build_layout, generate_bpmn_from_json


def _engine(flows, lanes=None):
    lanes = lanes or [{"id": "L1", "name": "Role"}]
    lane_of = {
        "start": lanes[0]["id"],
        "a": lanes[0]["id"],
        "b": lanes[-1]["id"],
        "g": lanes[-1]["id"],
        "c": lanes[-1]["id"],
        "r": lanes[-1]["id"],
        "e": lanes[-1]["id"],
    }
    types = {"start": "startEvent", "g": "exclusiveGateway", "e": "endEvent"}
    return {
        "processId": "p1",
        "name": "Test",
        "lanes": lanes,
        "nodes": [
            {"id": nid, "type": types.get(nid, "task"), "laneId": lane, "name": nid.upper()}
            for nid, lane in lane_of.items()
        ],
        "flows": [{"id": f"f{i}", "source": s, "target": t} for i, (s, t) in enumerate(flows, 1)],
    }


# start -> a -> b -> g -> c -> e, and g -> r -> a sends the request back (a loop)
LOOP = [("start", "a"), ("a", "b"), ("b", "g"), ("g", "c"), ("g", "r"), ("r", "a"), ("c", "e")]


def test_loop_back_edge_does_not_push_steps_past_the_end():
    levels = _build_layout(_engine(LOOP))["levels"]
    assert levels["start"] < levels["a"] < levels["b"] < levels["g"] < levels["c"] < levels["e"]
    assert levels["g"] < levels["r"]


def test_loop_target_stays_left_of_the_loop_across_roles():
    lanes = [{"id": "L1", "name": "Applicant"}, {"id": "L2", "name": "Handler"}]
    pos = _build_layout(_engine(LOOP, lanes))["node_pos"]
    x = {nid: pos[nid][0] for nid in pos}
    assert x["start"] < x["a"] == x["b"] < x["g"] < x["r"]  # b takes over from a: right under it
    assert x["a"] < x["c"] < x["e"]


def test_loop_back_arrow_is_drawn_with_right_angles():
    lanes = [{"id": "L1", "name": "Applicant"}, {"id": "L2", "name": "Handler"}]
    root = ET.fromstring(generate_bpmn_from_json(_engine(LOOP, lanes)))
    flow_id = next(
        el.attrib["id"]
        for el in root.iter()
        if el.tag.endswith("sequenceFlow") and el.attrib.get("sourceRef") == "r" and el.attrib.get("targetRef") == "a"
    )
    edge = next(el for el in root.iter() if el.tag.endswith("BPMNEdge") and el.attrib.get("bpmnElement") == flow_id)
    points = [
        (float(wp.attrib["x"]), float(wp.attrib["y"]))
        for wp in edge
        if wp.tag.endswith("waypoint")
    ]
    assert len(points) >= 3
    for (x1, y1), (x2, y2) in zip(points, points[1:]):
        assert x1 == x2 or y1 == y2, f"diagonal segment {(x1, y1)} -> {(x2, y2)}"


def test_process_without_loops_keeps_its_columns():
    straight = [("start", "a"), ("a", "b"), ("b", "g"), ("g", "c"), ("g", "r"), ("c", "e"), ("r", "e")]
    levels = _build_layout(_engine(straight))["levels"]
    assert levels["start"] < levels["a"] < levels["b"] < levels["g"] < levels["c"] < levels["e"]
    assert levels["c"] == levels["r"]


def _edge_points(root, source, target):
    flow_id = next(
        el.attrib["id"]
        for el in root.iter()
        if el.tag.endswith("sequenceFlow") and el.attrib.get("sourceRef") == source and el.attrib.get("targetRef") == target
    )
    edge = next(el for el in root.iter() if el.tag.endswith("BPMNEdge") and el.attrib.get("bpmnElement") == flow_id)
    return [(float(wp.attrib["x"]), float(wp.attrib["y"])) for wp in edge if wp.tag.endswith("waypoint")]


def test_side_branch_leaves_the_gateway_straight_down():
    engine = _engine([("start", "a"), ("a", "b"), ("b", "g"), ("g", "c"), ("g", "r"), ("c", "e"), ("r", "e")])
    for flow in engine["flows"]:
        if (flow["source"], flow["target"]) == ("g", "c"):
            flow["name"] = "Áno"
        if (flow["source"], flow["target"]) == ("g", "r"):
            flow["name"] = "Nie"
    pos = _build_layout(engine)["node_pos"]
    gx, gy, gw, gh = pos["g"]
    root = ET.fromstring(generate_bpmn_from_json(engine))

    yes = _edge_points(root, "g", "c")
    assert yes[0] == (gx + gw, gy + gh / 2)  # main branch: right corner, straight on
    assert all(y == yes[0][1] for _, y in yes)

    no = _edge_points(root, "g", "r")
    assert no[0] == (gx + gw / 2, gy + gh)  # side branch: bottom corner
    assert no[1][0] == no[0][0] and no[1][1] > no[0][1]  # straight down first
    assert no[-1] == (pos["r"][0], pos["r"][1] + pos["r"][3] / 2)  # into the step from the left
    assert len(no) == 3


def test_loop_back_arrow_stays_inside_the_pool():
    lanes = [{"id": "L1", "name": "Applicant"}, {"id": "L2", "name": "Handler"}]
    engine = _engine(LOOP, lanes)
    _, pool_y, _, pool_h = _build_layout(engine)["pool_bounds"]
    root = ET.fromstring(generate_bpmn_from_json(engine))
    for _, y in _edge_points(root, "r", "a"):
        assert pool_y < y < pool_y + pool_h


def _parallel_engine():
    lanes = [{"id": "L1", "name": "Sales"}, {"id": "L2", "name": "Warehouse"}]
    nodes = [
        {"id": "start", "type": "startEvent", "laneId": "L1", "name": ""},
        {"id": "a", "type": "task", "laneId": "L1", "name": "A"},
        {"id": "p", "type": "task", "laneId": "L2", "name": "P"},
        {"id": "split", "type": "parallelGateway", "laneId": "L2", "name": ""},
        {"id": "t1", "type": "task", "laneId": "L2", "name": "T1"},
        {"id": "t2", "type": "task", "laneId": "L2", "name": "T2"},
        {"id": "t3", "type": "task", "laneId": "L2", "name": "T3"},
        {"id": "join", "type": "parallelGateway", "laneId": "L2", "name": ""},
        {"id": "s", "type": "task", "laneId": "L2", "name": "S"},
        {"id": "e", "type": "endEvent", "laneId": "L2", "name": ""},
    ]
    pairs = [("start", "a"), ("a", "p"), ("p", "split"), ("split", "t1"), ("split", "t2"), ("split", "t3"),
             ("t1", "join"), ("t2", "join"), ("t3", "join"), ("join", "s"), ("s", "e")]
    flows = [{"id": f"f{i}", "source": s, "target": t} for i, (s, t) in enumerate(pairs, 1)]
    return {"processId": "p1", "name": "Test", "lanes": lanes, "nodes": nodes, "flows": flows}


def _overlaps(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


def test_three_parallel_branches_get_their_own_rows():
    layout = _build_layout(_parallel_engine())
    pos = layout["node_pos"]
    ids = list(pos)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            assert not _overlaps(pos[a], pos[b]), f"{a} overlaps {b}"
    center = lambda nid: pos[nid][1] + pos[nid][3] / 2
    # first branch continues straight on, the others are stacked below
    assert center("t1") == center("split") == center("join") == center("s")
    assert center("t1") < center("t2") < center("t3")
    lane_top = layout["lane_y"]["L2"]
    lane_bottom = lane_top + layout["lane_h_map"]["L2"]
    for nid in ("split", "t1", "t2", "t3", "join", "s", "e"):
        assert lane_top < pos[nid][1] and pos[nid][1] + pos[nid][3] < lane_bottom


def test_steps_after_a_side_branch_stay_on_its_row():
    engine = _engine([("start", "a"), ("a", "b"), ("b", "g"), ("g", "c"), ("g", "r"), ("r", "e")])
    for flow in engine["flows"]:
        if (flow["source"], flow["target"]) == ("g", "c"):
            flow["name"] = "Áno"
    pos = _build_layout(engine)["node_pos"]
    center = lambda nid: pos[nid][1] + pos[nid][3] / 2
    assert center("c") == center("g")
    assert center("e") == center("r") > center("g")


def test_decision_name_stays_inside_its_role():
    engine = _engine([("start", "a"), ("a", "b"), ("b", "g"), ("g", "c"), ("g", "r"), ("c", "e"), ("r", "e")])
    layout = _build_layout(engine)
    lane_top = layout["lane_y"]["L1"]
    gx, gy, gw, gh = layout["node_pos"]["g"]
    assert gy - lane_top >= 50  # two lines of the gateway name fit above the diamond


def test_unnamed_parallel_gateways_survive_an_import_round_trip():
    from services.bpmn_import import bpmn_xml_to_engine

    imported = bpmn_xml_to_engine(generate_bpmn_from_json(_parallel_engine()))
    engine = imported.get("engine_json", imported)
    names = {n["id"]: n.get("name") for n in engine["nodes"]}
    assert names["split"] == "" and names["join"] == ""
    assert names["t1"] == "T1"
