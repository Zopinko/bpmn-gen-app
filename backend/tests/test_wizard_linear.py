from services.bpmn_svc import build_linear_engine_from_wizard
from schemas.wizard import LinearWizardRequest


def _by_type(engine_json, node_type: str):
    return [
        node for node in engine_json.get("nodes", []) if node.get("type") == node_type
    ]


def test_build_linear_engine_from_wizard_creates_chain():
    payload = LinearWizardRequest(
        process_name="Wizard Checkout",
        roles=["Sales", "Support"],
        start_trigger="Customer requests quote",
        output="Quote delivered",
        steps=["Gather requirements", "Prepare offer", "Send quote"],
    )

    engine_json = build_linear_engine_from_wizard(payload)

    starts = _by_type(engine_json, "startEvent")
    ends = _by_type(engine_json, "endEvent")
    tasks = _by_type(engine_json, "task")

    assert len(starts) == 1
    assert len(ends) == 1
    assert len(tasks) == len(payload.steps)

    flows = engine_json.get("flows", [])
    assert len(flows) == len(tasks) + 1

    flow_map = {flow["source"]: flow["target"] for flow in flows}
    assert len(flow_map) == len(
        flows
    ), "Flow IDs should be unique per source in a linear chain"

    expected_task_ids = [f"task_{i}" for i in range(1, len(payload.steps) + 1)]
    chain = []
    current = starts[0]["id"]

    while current in flow_map:
        nxt = flow_map[current]
        chain.append(nxt)
        current = nxt

    assert chain[:-1] == expected_task_ids
    assert chain[-1] == ends[0]["id"]
