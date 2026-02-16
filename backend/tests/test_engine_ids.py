from services.bpmn_svc import generate_bpmn_from_json


def test_generate_bpmn_includes_engine_ids():
    engine = {
        "processId": "Process_1",
        "name": "Test",
        "lanes": [
            {"id": "Lane_A", "name": "Role A"},
            {"id": "Lane_B", "name": "Role B"},
        ],
        "nodes": [
            {"id": "Start_1", "type": "startEvent", "laneId": "Lane_A", "name": "Start"},
            {"id": "Task_1", "type": "task", "laneId": "Lane_A", "name": "Step A"},
            {"id": "End_1", "type": "endEvent", "laneId": "Lane_B", "name": "End"},
        ],
        "flows": [
            {"source": "Start_1", "target": "Task_1"},
            {"id": "Flow_1", "source": "Task_1", "target": "End_1"},
        ],
    }

    xml = generate_bpmn_from_json(engine)
    assert 'data-engine-id="Start_1"' in xml
    assert 'data-engine-id="Task_1"' in xml
    assert 'data-engine-id="End_1"' in xml
    assert 'data-engine-id="Flow_1"' in xml
    assert 'data-engine-id="F_Start_1_Task_1_0"' in xml
