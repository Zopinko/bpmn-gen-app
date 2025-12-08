from services.controller.validate import validate


def test_validate_detects_missing_end_and_task_flows():
    engine = {
        "lanes": [{"id": "L1", "name": "Lane 1"}],
        "nodes": [
            {"id": "start", "type": "start_event", "name": "Start", "laneId": "L1"},
            {"id": "task1", "type": "task", "name": "Task 1", "laneId": "L1"},
        ],
        "flows": [
            {"id": "f1", "source": "start", "target": "task1"},
        ],
    }

    issues = validate(engine)
    codes = {issue.code for issue in issues}
    assert "missing_end_event" in codes
    assert "task_without_incoming_or_outgoing" in codes


def test_validate_emits_soft_warnings():
    engine = {
        "lanes": [
            {"id": "L1", "name": "Team"},
            {"id": "L2", "name": "Unused"},
        ],
        "nodes": [
            {"id": "start", "type": "start_event", "name": "Start", "laneId": "L1"},
            {"id": "g1", "type": "exclusive_gateway", "name": "Check", "laneId": "L1"},
            {"id": "t1", "type": "task", "name": "A" * 61, "laneId": "L1"},
            {"id": "t2", "type": "task", "name": "Duplicate", "laneId": "L1"},
            {"id": "t3", "type": "task", "name": "Duplicate", "laneId": "L1"},
            {"id": "end", "type": "end_event", "name": "End", "laneId": "L1"},
        ],
        "flows": [
            {"id": "f1", "source": "start", "target": "g1"},
            {"id": "f2", "source": "g1", "target": "t1"},
            {"id": "f3", "source": "t1", "target": "t2"},
            {"id": "f4", "source": "t2", "target": "t3"},
            {"id": "f5", "source": "t3", "target": "end"},
        ],
    }

    issues = validate(engine)
    codes = {issue.code for issue in issues if issue.severity == "warning"}
    assert "empty_lane" in codes
    assert "too_long_name" in codes
    assert "duplicate_task_names" in codes
