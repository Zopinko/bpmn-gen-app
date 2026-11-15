"""Drawing rules agreed for the map (same rules as the incremental layout in the frontend)."""

from xml.etree import ElementTree as ET

from services.bpmn_svc import _build_layout, generate_bpmn_from_json

LANES = [{"id": "L1", "name": "Sales"}, {"id": "L2", "name": "Warehouse"}, {"id": "L3", "name": "Accounting"}]


def _engine(nodes, pairs):
    return {
        "processId": "p1",
        "name": "Rules",
        "lanes": LANES,
        "nodes": [
            {"id": nid, "type": ntype, "laneId": lane, "name": nid.upper() if ntype == "task" else ""}
            for nid, ntype, lane in nodes
        ],
        "flows": [{"id": f"f{i}", "source": s, "target": t} for i, (s, t) in enumerate(pairs, 1)],
    }


def _points(engine, source, target):
    root = ET.fromstring(generate_bpmn_from_json(engine))
    flow_id = next(
        el.attrib["id"]
        for el in root.iter()
        if el.tag.endswith("sequenceFlow") and el.attrib.get("sourceRef") == source and el.attrib.get("targetRef") == target
    )
    edge = next(el for el in root.iter() if el.tag.endswith("BPMNEdge") and el.attrib.get("bpmnElement") == flow_id)
    return [(float(wp.attrib["x"]), float(wp.attrib["y"])) for wp in edge if wp.tag.endswith("waypoint")]


def _cx(pos, nid):
    return pos[nid][0] + pos[nid][2] / 2


def _cy(pos, nid):
    return pos[nid][1] + pos[nid][3] / 2


def test_hand_off_goes_straight_down_under_the_last_step():
    engine = _engine(
        [("s", "startEvent", "L1"), ("a", "task", "L1"), ("b", "task", "L1"), ("c", "task", "L2"), ("e", "endEvent", "L2")],
        [("s", "a"), ("a", "b"), ("b", "c"), ("c", "e")],
    )
    pos = _build_layout(engine)["node_pos"]
    assert _cx(pos, "c") == _cx(pos, "b")
    path = _points(engine, "b", "c")
    assert path == [(_cx(pos, "b"), pos["b"][1] + pos["b"][3]), (_cx(pos, "c"), pos["c"][1])]


def test_hand_off_back_up_leaves_a_gap_in_the_role():
    # Sales: a -> Warehouse: b, b2, c -> back to Sales: d
    engine = _engine(
        [("s", "startEvent", "L1"), ("a", "task", "L1"), ("b", "task", "L2"), ("b2", "task", "L2"),
         ("c", "task", "L2"), ("d", "task", "L1"), ("e", "endEvent", "L1")],
        [("s", "a"), ("a", "b"), ("b", "b2"), ("b2", "c"), ("c", "d"), ("d", "e")],
    )
    layout = _build_layout(engine)
    pos, levels = layout["node_pos"], layout["levels"]
    assert _cx(pos, "b") == _cx(pos, "a")
    assert _cx(pos, "d") == _cx(pos, "c")  # straight up from the last warehouse step
    assert levels["d"] - levels["a"] == 2  # Sales stays empty under b2 while the warehouse works
    path = _points(engine, "c", "d")
    assert path == [(_cx(pos, "c"), pos["c"][1]), (_cx(pos, "d"), pos["d"][1] + pos["d"][3])]


def test_hand_off_across_two_roles_keeps_the_column():
    engine = _engine(
        [("s", "startEvent", "L1"), ("a", "task", "L1"), ("b", "task", "L3"), ("c", "task", "L2"), ("e", "endEvent", "L2")],
        [("s", "a"), ("a", "b"), ("b", "c"), ("c", "e")],
    )
    pos = _build_layout(engine)["node_pos"]
    assert _cx(pos, "a") == _cx(pos, "b") == _cx(pos, "c")


def test_hand_off_to_a_decision_goes_straight_down():
    engine = _engine(
        [("s", "startEvent", "L1"), ("a", "task", "L1"), ("b", "task", "L2"), ("g", "exclusiveGateway", "L3"),
         ("y", "task", "L3"), ("n", "task", "L3"), ("e", "endEvent", "L3")],
        [("s", "a"), ("a", "b"), ("b", "g"), ("g", "y"), ("g", "n"), ("y", "e"), ("n", "e")],
    )
    pos = _build_layout(engine)["node_pos"]
    assert _cx(pos, "g") == _cx(pos, "b")
    path = _points(engine, "b", "g")
    assert path == [(_cx(pos, "b"), pos["b"][1] + pos["b"][3]), (_cx(pos, "g"), pos["g"][1])]


def test_decision_label_moves_left_when_the_arrow_comes_from_above():
    engine = _engine(
        [("s", "startEvent", "L1"), ("a", "task", "L1"), ("b", "task", "L2"), ("g", "exclusiveGateway", "L3"),
         ("y", "task", "L3"), ("n", "task", "L3"), ("e", "endEvent", "L3")],
        [("s", "a"), ("a", "b"), ("b", "g"), ("g", "y"), ("g", "n"), ("y", "e"), ("n", "e")],
    )
    engine["nodes"][3]["name"] = "Laptop in stock?"
    pos = _build_layout(engine)["node_pos"]
    root = ET.fromstring(generate_bpmn_from_json(engine))
    shape = next(el for el in root.iter() if el.tag.endswith("BPMNShape") and el.attrib.get("bpmnElement") == "g")
    label = next(el for el in shape.iter() if el.tag.endswith("Bounds") and el is not shape.find("{*}Bounds"))
    label_right = float(label.attrib["x"]) + float(label.attrib["width"])
    assert label_right <= pos["g"][0]  # the label stays clear of the vertical arrow


def test_taken_spot_goes_down_then_right():
    # a hands work to two warehouse steps: only one fits under it
    engine = _engine(
        [("s", "startEvent", "L1"), ("a", "task", "L1"), ("b", "task", "L2"), ("c", "task", "L2"),
         ("e", "endEvent", "L2")],
        [("s", "a"), ("a", "b"), ("a", "c"), ("b", "e"), ("c", "e")],
    )
    pos = _build_layout(engine)["node_pos"]
    assert _cx(pos, "b") == _cx(pos, "a")
    assert pos["c"][0] > pos["b"][0]
    # the bottom of a already carries the arrow to b: the second arrow uses the free right side
    path = _points(engine, "a", "c")
    assert path == [
        (pos["a"][0] + pos["a"][2], _cy(pos, "a")),
        (_cx(pos, "c"), _cy(pos, "a")),
        (_cx(pos, "c"), pos["c"][1]),
    ]


def _parallel():
    return _engine(
        [("s", "startEvent", "L1"), ("split", "parallelGateway", "L1"), ("t1", "task", "L1"),
         ("t2", "task", "L1"), ("join", "parallelGateway", "L1"), ("e", "endEvent", "L1")],
        [("s", "split"), ("split", "t1"), ("split", "t2"), ("t1", "join"), ("t2", "join"), ("join", "e")],
    )


def test_parallel_branch_leaves_the_split_from_the_bottom_corner():
    engine = _parallel()
    pos = _build_layout(engine)["node_pos"]
    path = _points(engine, "split", "t2")
    assert path[0] == (_cx(pos, "split"), pos["split"][1] + pos["split"][3])
    assert path[1][0] == path[0][0]
    assert path[-1] == (pos["t2"][0], _cy(pos, "t2"))
    assert _points(engine, "split", "t1")[0] == (pos["split"][0] + pos["split"][2], _cy(pos, "split"))


def test_parallel_branch_enters_the_join_from_the_bottom_corner():
    engine = _parallel()
    pos = _build_layout(engine)["node_pos"]
    path = _points(engine, "t2", "join")
    assert path == [
        (pos["t2"][0] + pos["t2"][2], _cy(pos, "t2")),
        (_cx(pos, "join"), _cy(pos, "t2")),
        (_cx(pos, "join"), pos["join"][1] + pos["join"][3]),
    ]
    assert _points(engine, "t1", "join")[-1] == (pos["join"][0], _cy(pos, "join"))


def test_merging_branch_enters_from_the_free_bottom_side():
    # g decides: yes -> a, no -> b (a row lower); both continue to c
    engine = _engine(
        [("s", "startEvent", "L1"), ("g", "exclusiveGateway", "L1"), ("a", "task", "L1"), ("b", "task", "L1"),
         ("c", "task", "L1"), ("e", "endEvent", "L1")],
        [("s", "g"), ("g", "a"), ("g", "b"), ("a", "c"), ("b", "c"), ("c", "e")],
    )
    engine["flows"][1]["name"] = "Áno"
    engine["flows"][2]["name"] = "Nie"
    pos = _build_layout(engine)["node_pos"]
    assert _points(engine, "a", "c")[-1] == (pos["c"][0], _cy(pos, "c"))  # straight on, from the left
    path = _points(engine, "b", "c")
    assert path == [
        (pos["b"][0] + pos["b"][2], _cy(pos, "b")),
        (_cx(pos, "c"), _cy(pos, "b")),
        (_cx(pos, "c"), pos["c"][1] + pos["c"][3]),
    ]


def _all_paths(engine):
    root = ET.fromstring(generate_bpmn_from_json(engine))
    flows = {
        el.attrib["id"]: (el.attrib["sourceRef"], el.attrib["targetRef"])
        for el in root.iter()
        if el.tag.endswith("sequenceFlow")
    }
    paths = {}
    for edge in root.iter():
        if edge.tag.endswith("BPMNEdge") and edge.attrib.get("bpmnElement") in flows:
            points = [(float(wp.attrib["x"]), float(wp.attrib["y"])) for wp in edge if wp.tag.endswith("waypoint")]
            paths[flows[edge.attrib["bpmnElement"]]] = points
    return paths


def _segment_hits(a, b, box):
    x, y, w, h = box
    if a[0] == b[0]:
        lo, hi = sorted((a[1], b[1]))
        return x < a[0] < x + w and lo < y + h and hi > y
    lo, hi = sorted((a[0], b[0]))
    return y < a[1] < y + h and lo < x + w and hi > x


def test_rejected_request_loops_back_without_crossing_steps():
    # Employee submits; the manager approves (-> HR records it) or suggests other
    # dates, which goes back to the employee.
    engine = _engine(
        [("s", "startEvent", "L1"), ("sub", "task", "L1"), ("gw", "exclusiveGateway", "L2"), ("app", "task", "L2"),
         ("sug", "task", "L2"), ("rec", "task", "L3"), ("e", "endEvent", "L3")],
        [("s", "sub"), ("sub", "gw"), ("gw", "app"), ("gw", "sug"), ("sug", "sub"), ("app", "rec"), ("rec", "e")],
    )
    engine["flows"][2]["name"] = "Yes"
    engine["flows"][3]["name"] = "No"
    pos = _build_layout(engine)["node_pos"]
    for (src, tgt), points in _all_paths(engine).items():
        for a, b in zip(points, points[1:]):
            for nid, box in pos.items():
                if nid in (src, tgt):
                    continue
                assert not _segment_hits(a, b, box), f"{src}->{tgt} crosses {nid}"
    # the loop comes back into the employee's step from above
    loop = _points(engine, "sug", "sub")
    assert loop[-1] == (_cx(pos, "sub"), pos["sub"][1])
    # the hand-off to HR still comes into the step from above
    hand_off = _points(engine, "app", "rec")
    assert hand_off[-1] == (_cx(pos, "rec"), pos["rec"][1])
