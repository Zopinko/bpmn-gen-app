from __future__ import annotations

from typing import Any, Dict, List

from mentor.rule_engine import run_rules


def _engine(nodes: List[Dict[str, Any]], flows: List[Dict[str, Any]], lanes=None):
    if lanes is None:
        lanes = [{"id": "lane_1", "name": "Lane 1"}]
    return {
        "processId": "proc_1",
        "name": "Process",
        "lanes": lanes,
        "nodes": nodes,
        "flows": flows,
    }


def _by_rule(findings, rule_id: str):
    return [f for f in findings if f.id.startswith(rule_id)]


def test_seqflow_no_cross_pool_valid():
    lanes = [
        {"id": "lane_a", "name": "A", "poolId": "pool_1"},
        {"id": "lane_b", "name": "B", "poolId": "pool_1"},
    ]
    nodes = [
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_a"},
        {"id": "t2", "type": "task", "name": "Task 2", "laneId": "lane_b"},
    ]
    flows = [{"id": "f1", "source": "t1", "target": "t2"}]
    findings = run_rules(_engine(nodes, flows, lanes=lanes))
    assert not _by_rule(findings, "seqflow_no_cross_pool")


def test_seqflow_no_cross_pool_invalid():
    lanes = [
        {"id": "lane_a", "name": "A", "poolId": "pool_1"},
        {"id": "lane_b", "name": "B", "poolId": "pool_2"},
    ]
    nodes = [
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_a"},
        {"id": "t2", "type": "task", "name": "Task 2", "laneId": "lane_b"},
    ]
    flows = [{"id": "f1", "source": "t1", "target": "t2"}]
    findings = run_rules(_engine(nodes, flows, lanes=lanes))
    matches = _by_rule(findings, "seqflow_no_cross_pool")
    assert len(matches) == 1
    assert matches[0].target.id == "f1"


def test_seqflow_no_cross_subprocess_valid():
    nodes = [
        {"id": "sub_1", "type": "subProcess", "name": "Sub", "laneId": "lane_1"},
        {
            "id": "t1",
            "type": "task",
            "name": "Task 1",
            "laneId": "lane_1",
            "parentId": "sub_1",
        },
        {
            "id": "t2",
            "type": "task",
            "name": "Task 2",
            "laneId": "lane_1",
            "parentId": "sub_1",
        },
    ]
    flows = [{"id": "f1", "source": "t1", "target": "t2"}]
    findings = run_rules(_engine(nodes, flows))
    assert not _by_rule(findings, "seqflow_no_cross_subprocess")


def test_seqflow_no_cross_subprocess_invalid():
    nodes = [
        {"id": "sub_1", "type": "subProcess", "name": "Sub", "laneId": "lane_1"},
        {
            "id": "t1",
            "type": "task",
            "name": "Task 1",
            "laneId": "lane_1",
            "parentId": "sub_1",
        },
        {"id": "t2", "type": "task", "name": "Task 2", "laneId": "lane_1"},
    ]
    flows = [{"id": "f1", "source": "t1", "target": "t2"}]
    findings = run_rules(_engine(nodes, flows))
    matches = _by_rule(findings, "seqflow_no_cross_subprocess")
    assert len(matches) == 1
    assert matches[0].target.id == "f1"


def test_message_flow_between_pools_valid():
    lanes = [
        {"id": "lane_a", "name": "A", "poolId": "pool_1"},
        {"id": "lane_b", "name": "B", "poolId": "pool_2"},
    ]
    nodes = [
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_a"},
        {"id": "t2", "type": "task", "name": "Task 2", "laneId": "lane_b"},
    ]
    flows = [{"id": "m1", "type": "messageFlow", "source": "t1", "target": "t2"}]
    findings = run_rules(_engine(nodes, flows, lanes=lanes))
    assert not _by_rule(findings, "message_flow_between_pools")


def test_message_flow_between_pools_invalid():
    lanes = [
        {"id": "lane_a", "name": "A", "poolId": "pool_1"},
        {"id": "lane_b", "name": "B", "poolId": "pool_1"},
    ]
    nodes = [
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_a"},
        {"id": "t2", "type": "task", "name": "Task 2", "laneId": "lane_b"},
    ]
    flows = [{"id": "m1", "type": "messageFlow", "source": "t1", "target": "t2"}]
    findings = run_rules(_engine(nodes, flows, lanes=lanes))
    matches = _by_rule(findings, "message_flow_between_pools")
    assert len(matches) == 1
    assert matches[0].target.id == "m1"


def test_boundary_event_max_one_outgoing_valid():
    nodes = [
        {"id": "b1", "type": "boundaryEvent", "name": "Boundary", "laneId": "lane_1"},
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
    ]
    flows = [{"id": "f1", "source": "b1", "target": "t1"}]
    findings = run_rules(_engine(nodes, flows))
    assert not _by_rule(findings, "boundary_event_max_one_outgoing")


def test_boundary_event_max_one_outgoing_invalid():
    nodes = [
        {"id": "b1", "type": "boundaryEvent", "name": "Boundary", "laneId": "lane_1"},
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
        {"id": "t2", "type": "task", "name": "Task 2", "laneId": "lane_1"},
    ]
    flows = [
        {"id": "f1", "source": "b1", "target": "t1"},
        {"id": "f2", "source": "b1", "target": "t2"},
    ]
    findings = run_rules(_engine(nodes, flows))
    matches = _by_rule(findings, "boundary_event_max_one_outgoing")
    assert len(matches) == 1
    assert matches[0].target.id == "b1"


def test_boundary_event_no_incoming_valid():
    nodes = [
        {"id": "b1", "type": "boundaryEvent", "name": "Boundary", "laneId": "lane_1"},
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
    ]
    flows = [{"id": "f1", "source": "b1", "target": "t1"}]
    findings = run_rules(_engine(nodes, flows))
    assert not _by_rule(findings, "boundary_event_no_incoming")


def test_boundary_event_no_incoming_invalid():
    nodes = [
        {"id": "b1", "type": "boundaryEvent", "name": "Boundary", "laneId": "lane_1"},
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
    ]
    flows = [{"id": "f1", "source": "t1", "target": "b1"}]
    findings = run_rules(_engine(nodes, flows))
    matches = _by_rule(findings, "boundary_event_no_incoming")
    assert len(matches) == 1
    assert matches[0].target.id == "b1"


def test_subprocess_start_event_none_valid():
    nodes = [
        {"id": "sub_1", "type": "subProcess", "name": "Sub", "laneId": "lane_1"},
        {
            "id": "s1",
            "type": "startEvent",
            "name": "Start",
            "laneId": "lane_1",
            "parentId": "sub_1",
        },
    ]
    findings = run_rules(_engine(nodes, []))
    assert not _by_rule(findings, "subprocess_start_event_none")


def test_subprocess_start_event_none_invalid():
    nodes = [
        {"id": "sub_1", "type": "subProcess", "name": "Sub", "laneId": "lane_1"},
        {
            "id": "s1",
            "type": "startEvent",
            "name": "Start",
            "laneId": "lane_1",
            "parentId": "sub_1",
            "eventDefinition": "timer",
        },
    ]
    findings = run_rules(_engine(nodes, []))
    matches = _by_rule(findings, "subprocess_start_event_none")
    assert len(matches) == 1
    assert matches[0].target.id == "s1"


def test_gateway_no_mixed_mode_valid():
    nodes = [
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
        {"id": "t2", "type": "task", "name": "Task 2", "laneId": "lane_1"},
        {"id": "t3", "type": "task", "name": "Task 3", "laneId": "lane_1"},
        {"id": "g1", "type": "exclusiveGateway", "name": "G", "laneId": "lane_1"},
    ]
    flows = [
        {"id": "f1", "source": "t1", "target": "g1"},
        {"id": "f2", "source": "t2", "target": "g1"},
        {"id": "f3", "source": "g1", "target": "t3"},
    ]
    findings = run_rules(_engine(nodes, flows))
    assert not _by_rule(findings, "gateway_no_mixed_mode")


def test_gateway_no_mixed_mode_invalid():
    nodes = [
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
        {"id": "t2", "type": "task", "name": "Task 2", "laneId": "lane_1"},
        {"id": "t3", "type": "task", "name": "Task 3", "laneId": "lane_1"},
        {"id": "t4", "type": "task", "name": "Task 4", "laneId": "lane_1"},
        {"id": "g1", "type": "exclusiveGateway", "name": "G", "laneId": "lane_1"},
    ]
    flows = [
        {"id": "f1", "source": "t1", "target": "g1"},
        {"id": "f2", "source": "t2", "target": "g1"},
        {"id": "f3", "source": "g1", "target": "t3"},
        {"id": "f4", "source": "g1", "target": "t4"},
    ]
    findings = run_rules(_engine(nodes, flows))
    matches = _by_rule(findings, "gateway_no_mixed_mode")
    assert len(matches) == 1
    assert matches[0].target.id == "g1"


def test_gateway_diverging_min_two_outgoing_valid():
    nodes = [
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
        {"id": "t2", "type": "task", "name": "Task 2", "laneId": "lane_1"},
        {"id": "t3", "type": "task", "name": "Task 3", "laneId": "lane_1"},
        {"id": "g1", "type": "exclusiveGateway", "name": "G", "laneId": "lane_1"},
    ]
    flows = [
        {"id": "f1", "source": "t1", "target": "g1"},
        {"id": "f2", "source": "g1", "target": "t2"},
        {"id": "f3", "source": "g1", "target": "t3"},
    ]
    findings = run_rules(_engine(nodes, flows))
    assert not _by_rule(findings, "gateway_diverging_min_two_outgoing")


def test_gateway_diverging_min_two_outgoing_invalid():
    nodes = [
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
        {"id": "t2", "type": "task", "name": "Task 2", "laneId": "lane_1"},
        {"id": "g1", "type": "exclusiveGateway", "name": "G", "laneId": "lane_1"},
    ]
    flows = [
        {"id": "f1", "source": "t1", "target": "g1"},
        {"id": "f2", "source": "g1", "target": "t2"},
    ]
    findings = run_rules(_engine(nodes, flows))
    matches = _by_rule(findings, "gateway_diverging_min_two_outgoing")
    assert len(matches) == 1
    assert matches[0].target.id == "g1"


def test_lane_is_empty_valid():
    lanes = [{"id": "lane_1", "name": "Lane 1"}]
    nodes = [{"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"}]
    findings = run_rules(_engine(nodes, [], lanes=lanes))
    assert not _by_rule(findings, "lane_is_empty")


def test_lane_is_empty_invalid():
    lanes = [
        {"id": "lane_1", "name": "Lane 1"},
        {"id": "lane_2", "name": "Lane 2"},
    ]
    nodes = [{"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"}]
    findings = run_rules(_engine(nodes, [], lanes=lanes))
    matches = _by_rule(findings, "lane_is_empty")
    assert len(matches) == 1
    assert matches[0].target.id == "lane_2"


def test_activity_is_isolated_invalid():
    nodes = [{"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"}]
    findings = run_rules(_engine(nodes, []))
    matches = _by_rule(findings, "activity_is_isolated")
    assert len(matches) == 1
    assert matches[0].target.id == "t1"


def test_activity_is_isolated_valid():
    nodes = [
        {"id": "s1", "type": "startEvent", "name": "Start", "laneId": "lane_1"},
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
        {"id": "e1", "type": "endEvent", "name": "End", "laneId": "lane_1"},
    ]
    flows = [
        {"id": "f1", "source": "s1", "target": "t1"},
        {"id": "f2", "source": "t1", "target": "e1"},
    ]
    findings = run_rules(_engine(nodes, flows))
    assert not _by_rule(findings, "activity_is_isolated")


def test_gateway_is_redundant_invalid():
    nodes = [
        {"id": "s1", "type": "startEvent", "name": "Start", "laneId": "lane_1"},
        {"id": "g1", "type": "exclusiveGateway", "name": "G", "laneId": "lane_1"},
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
    ]
    flows = [
        {"id": "f1", "source": "s1", "target": "g1"},
        {"id": "f2", "source": "g1", "target": "t1"},
    ]
    findings = run_rules(_engine(nodes, flows))
    matches = _by_rule(findings, "gateway_is_redundant")
    assert len(matches) == 1
    assert matches[0].target.id == "g1"


def test_gateway_is_redundant_split_valid():
    nodes = [
        {"id": "s1", "type": "startEvent", "name": "Start", "laneId": "lane_1"},
        {"id": "g1", "type": "exclusiveGateway", "name": "G", "laneId": "lane_1"},
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
        {"id": "t2", "type": "task", "name": "Task 2", "laneId": "lane_1"},
    ]
    flows = [
        {"id": "f1", "source": "s1", "target": "g1"},
        {"id": "f2", "source": "g1", "target": "t1"},
        {"id": "f3", "source": "g1", "target": "t2"},
    ]
    findings = run_rules(_engine(nodes, flows))
    assert not _by_rule(findings, "gateway_is_redundant")


def test_gateway_is_redundant_merge_valid():
    nodes = [
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
        {"id": "t2", "type": "task", "name": "Task 2", "laneId": "lane_1"},
        {"id": "g1", "type": "exclusiveGateway", "name": "G", "laneId": "lane_1"},
        {"id": "t3", "type": "task", "name": "Task 3", "laneId": "lane_1"},
    ]
    flows = [
        {"id": "f1", "source": "t1", "target": "g1"},
        {"id": "f2", "source": "t2", "target": "g1"},
        {"id": "f3", "source": "g1", "target": "t3"},
    ]
    findings = run_rules(_engine(nodes, flows))
    assert not _by_rule(findings, "gateway_is_redundant")


def test_xor_outgoing_flows_require_names_invalid():
    nodes = [
        {"id": "s1", "type": "startEvent", "name": "Start", "laneId": "lane_1"},
        {"id": "g1", "type": "exclusiveGateway", "name": "G", "laneId": "lane_1"},
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
        {"id": "t2", "type": "task", "name": "Task 2", "laneId": "lane_1"},
    ]
    flows = [
        {"id": "f1", "source": "s1", "target": "g1"},
        {"id": "f2", "source": "g1", "target": "t1"},
        {"id": "f3", "source": "g1", "target": "t2"},
    ]
    findings = run_rules(_engine(nodes, flows))
    matches = _by_rule(findings, "xor_outgoing_flows_require_names")
    assert len(matches) == 2


def test_xor_outgoing_flows_require_names_valid():
    nodes = [
        {"id": "s1", "type": "startEvent", "name": "Start", "laneId": "lane_1"},
        {"id": "g1", "type": "exclusiveGateway", "name": "G", "laneId": "lane_1"},
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
        {"id": "t2", "type": "task", "name": "Task 2", "laneId": "lane_1"},
    ]
    flows = [
        {"id": "f1", "source": "s1", "target": "g1"},
        {"id": "f2", "source": "g1", "target": "t1", "name": "Ano"},
        {"id": "f3", "source": "g1", "target": "t2", "name": "Nie"},
    ]
    findings = run_rules(_engine(nodes, flows))
    assert not _by_rule(findings, "xor_outgoing_flows_require_names")


def test_xor_outgoing_flows_require_names_default_flow_ignored():
    nodes = [
        {"id": "s1", "type": "startEvent", "name": "Start", "laneId": "lane_1"},
        {"id": "g1", "type": "exclusiveGateway", "name": "G", "laneId": "lane_1"},
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
        {"id": "t2", "type": "task", "name": "Task 2", "laneId": "lane_1"},
    ]
    flows = [
        {"id": "f1", "source": "s1", "target": "g1"},
        {"id": "f2", "source": "g1", "target": "t1"},
        {"id": "f3", "source": "g1", "target": "t2", "name": "Ano", "default": True},
    ]
    findings = run_rules(_engine(nodes, flows))
    matches = _by_rule(findings, "xor_outgoing_flows_require_names")
    assert len(matches) == 1


def test_gateway_requires_incoming_invalid():
    nodes = [
        {"id": "g1", "type": "exclusiveGateway", "name": "G", "laneId": "lane_1"},
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
    ]
    flows = [{"id": "f1", "source": "g1", "target": "t1"}]
    findings = run_rules(_engine(nodes, flows))
    matches = _by_rule(findings, "gateway_requires_incoming")
    assert len(matches) == 1
    assert matches[0].target.id == "g1"


def test_gateway_requires_incoming_valid():
    nodes = [
        {"id": "s1", "type": "startEvent", "name": "Start", "laneId": "lane_1"},
        {"id": "g1", "type": "exclusiveGateway", "name": "G", "laneId": "lane_1"},
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
    ]
    flows = [
        {"id": "f1", "source": "s1", "target": "g1"},
        {"id": "f2", "source": "g1", "target": "t1"},
    ]
    findings = run_rules(_engine(nodes, flows))
    assert not _by_rule(findings, "gateway_requires_incoming")


def test_gateway_requires_incoming_merge_valid():
    nodes = [
        {"id": "t1", "type": "task", "name": "Task 1", "laneId": "lane_1"},
        {"id": "t2", "type": "task", "name": "Task 2", "laneId": "lane_1"},
        {"id": "g1", "type": "exclusiveGateway", "name": "G", "laneId": "lane_1"},
    ]
    flows = [
        {"id": "f1", "source": "t1", "target": "g1"},
        {"id": "f2", "source": "t2", "target": "g1"},
    ]
    findings = run_rules(_engine(nodes, flows))
    assert not _by_rule(findings, "gateway_requires_incoming")
