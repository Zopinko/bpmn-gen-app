"""Check the geometry of exported XML independently of the router."""

import random
from xml.etree import ElementTree as ET

import pytest

from services.bpmn_svc import generate_bpmn_from_json
from services import bpmn_svc


def _hits_interior(a, b, bounds):
    # Intersect the segment's parameter interval with each open rectangle slab.
    low, high = 0.0, 1.0
    for axis, (origin, size) in enumerate(((bounds[0], bounds[2]), (bounds[1], bounds[3]))):
        left, right = origin + 1, origin + size - 1
        delta = b[axis] - a[axis]
        if delta == 0:
            if not left < a[axis] < right:
                return False
        else:
            entry, exit_ = sorted(((left - a[axis]) / delta, (right - a[axis]) / delta))
            low, high = max(low, entry), min(high, exit_)
    return low < high


def _assert_clear(xml):
    root = ET.fromstring(xml)
    flows = {el.get("id"): (el.get("sourceRef"), el.get("targetRef"))
             for el in root.findall(".//{*}sequenceFlow")}
    node_ids = {el.get("id") for el in root.iter()
                if el.tag.rsplit("}", 1)[-1] in {
                    "task", "startEvent", "endEvent", "exclusiveGateway",
                    "parallelGateway", "inclusiveGateway", "eventBasedGateway",
                }}
    bounds = {}
    for shape in root.findall(".//{*}BPMNShape"):
        if shape.get("bpmnElement") in node_ids:
            rect = shape.find("{*}Bounds")
            bounds[shape.get("bpmnElement")] = tuple(float(rect.get(k)) for k in ("x", "y", "width", "height"))
    assert bounds.keys() == node_ids
    edges = root.findall(".//{*}BPMNEdge")
    assert {edge.get("bpmnElement") for edge in edges} == flows.keys()
    for edge in edges:
        fid = edge.get("bpmnElement")
        points = [(float(wp.get("x")), float(wp.get("y"))) for wp in edge.findall("{*}waypoint")]
        assert len(points) >= 2
        for a, b in zip(points, points[1:]):
            for nid, rect in bounds.items():
                if nid not in flows[fid]:
                    assert not _hits_interior(a, b, rect), (fid, a, b, nid, rect)


def _engine(nodes, pairs, lane_count=3):
    return {
        "processId": "p", "name": "P",
        "lanes": [{"id": f"L{i}", "name": f"Role {i}"} for i in range(lane_count)],
        "nodes": [{"id": nid, "type": kind, "laneId": f"L{lane}", "name": nid}
                  for nid, kind, lane in nodes],
        "flows": [{"id": f"f{i}", "source": src, "target": tgt}
                  for i, (src, tgt) in enumerate(pairs, 11)],
    }


def test_h05_flow_skips_an_intervening_step():
    engine = _engine(
        [("n0", "task", 2), ("n1", "task", 0), ("n3", "task", 2), ("n8", "task", 2)],
        [("n1", "n3"), ("n3", "n8"), ("n0", "n8")],
    )
    _assert_clear(generate_bpmn_from_json(engine))


@pytest.mark.parametrize("pairs", [
    [("a", "a"), ("a", "b")],
    [("a", "b"), ("b", "c"), ("c", "a")],
])
def test_self_loops_and_backward_flows(pairs):
    engine = _engine([(nid, "task", 1) for nid in ("a", "b", "c")], pairs)
    _assert_clear(generate_bpmn_from_json(engine))


def test_diagonal_preference_is_checked_against_isolated_obstacle(monkeypatch):
    engine = _engine([(nid, "task", 1) for nid in ("a", "b", "c")], [("a", "b")])
    layout = bpmn_svc._build_layout(engine)
    # Centers differ by less than 1 px, which permits a slanted straight candidate.
    layout["node_pos"] = {"a": (100, 100, 100, 80), "b": (400, 100.8, 100, 80), "c": (250, 100, 100, 80)}
    monkeypatch.setattr(bpmn_svc, "_build_layout", lambda _: layout)
    _assert_clear(generate_bpmn_from_json(engine))


def test_impossible_route_warns_and_minimizes_distinct_collisions(monkeypatch, caplog):
    engine = _engine([(nid, "task", 1) for nid in ("a", "b", "c", "d")], [("a", "b")])
    layout = bpmn_svc._build_layout(engine)
    # Deliberately impossible external layout: a's right port is inside c.
    layout["node_pos"] = {
        "a": (100, 100, 100, 80), "b": (600, 100, 100, 80),
        "c": (190, 100, 100, 80), "d": (350, 100, 100, 80),
    }
    monkeypatch.setattr(bpmn_svc, "_build_layout", lambda _: layout)
    root = ET.fromstring(generate_bpmn_from_json(engine))
    edge = root.find(".//{*}BPMNEdge")
    points = [(float(wp.get("x")), float(wp.get("y"))) for wp in edge.findall("{*}waypoint")]
    hit = {nid for nid in ("c", "d") if any(
        _hits_interior(a, b, layout["node_pos"][nid]) for a, b in zip(points, points[1:])
    )}
    assert hit == {"c"}
    assert "No collision-free route for flow f11" in caplog.text
    assert "minimum-collision route (1 nodes)" in caplog.text


@pytest.mark.parametrize("seed", range(200))
def test_random_forward_graphs(seed):
    rng = random.Random(42 + seed)
    lane_count = rng.randint(3, 4)
    nodes = [(f"n{i}", "task", rng.randrange(lane_count)) for i in range(rng.randint(4, 12))]
    nodes = [("start", "startEvent", 0)] + nodes + [("end", "endEvent", lane_count - 1)]
    if seed % 3 == 0:
        nodes.insert(rng.randrange(2, len(nodes) - 2), ("g", "exclusiveGateway", rng.randrange(lane_count)))
    pairs = [(a[0], b[0]) for a, b in zip(nodes, nodes[1:])]
    for i, node in enumerate(nodes[:-2]):
        if node[1] == "exclusiveGateway" or rng.random() < 0.4:
            pairs.append((node[0], nodes[rng.randrange(i + 2, len(nodes))][0]))
    _assert_clear(generate_bpmn_from_json(_engine(nodes, pairs, lane_count)))


@pytest.mark.parametrize("a,b,expected", [
    ((0, 0), (100, 100), True),
    ((0, 100), (100, 0), True),
    ((0, 40), (100, 40), False),
    ((0, 0), (30, 30), False),
])
def test_xml_geometry_checker_handles_diagonals_and_boundaries(a, b, expected):
    assert _hits_interior(a, b, (40, 40, 20, 20)) is expected
