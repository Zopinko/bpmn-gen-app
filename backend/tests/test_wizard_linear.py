from services.bpmn_svc import append_tasks_to_lane_from_description, build_linear_engine_from_wizard
from schemas.wizard import LaneAppendRequest, LinearWizardRequest


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
    tasks = _by_type(engine_json, "task")

    assert len(starts) == 1
    assert len(tasks) == len(payload.steps)

    flows = engine_json.get("flows", [])
    assert len(flows) == len(tasks)

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

    assert chain == expected_task_ids
    assert current == expected_task_ids[-1]


def test_lane_append_conditional_splits_multiple_tasks_per_branch():
    payload = LaneAppendRequest(
        lane_id="lane_1",
        description="Ak je žiadosť úplná, tak skontrolujem ju, odošlem potvrdenie, inak vrátim ju, pošlem upozornenie",
        engine_json={
            "processId": "proc_demo",
            "name": "Demo",
            "lanes": [{"id": "lane_1", "name": "Podpora"}],
            "nodes": [],
            "flows": [],
        },
    )

    built = append_tasks_to_lane_from_description(payload)
    engine_json = built["engine_json"]
    nodes = engine_json.get("nodes", [])
    flows = engine_json.get("flows", [])

    gateways = [node for node in nodes if node.get("type") == "exclusiveGateway"]
    tasks = [node for node in nodes if node.get("type") == "task"]

    assert len(gateways) == 1
    assert [task.get("name") for task in tasks] == [
        "skontrolujem ju",
        "odošlem potvrdenie",
        "vrátim ju",
        "pošlem upozornenie",
    ]

    gateway_id = gateways[0]["id"]
    yes_first = tasks[0]["id"]
    yes_second = tasks[1]["id"]
    no_first = tasks[2]["id"]
    no_second = tasks[3]["id"]
    flow_pairs = {(flow["source"], flow["target"], flow.get("name", "")) for flow in flows}

    assert (gateway_id, yes_first, "Áno") in flow_pairs
    assert (gateway_id, no_first, "Nie") in flow_pairs
    assert (yes_first, yes_second, "") in flow_pairs
    assert (no_first, no_second, "") in flow_pairs


def test_lane_append_parallel_does_not_split_on_word_a():
    payload = LaneAppendRequest(
        lane_id="lane_1",
        description="Paralelne pripravím zmluvu a dodatok, odošlem potvrdenie",
        engine_json={
            "processId": "proc_demo",
            "name": "Demo",
            "lanes": [{"id": "lane_1", "name": "Podpora"}],
            "nodes": [],
            "flows": [],
        },
    )

    built = append_tasks_to_lane_from_description(payload)
    engine_json = built["engine_json"]
    nodes = engine_json.get("nodes", [])

    gateways = [node for node in nodes if node.get("type") == "parallelGateway"]
    tasks = [node for node in nodes if node.get("type") == "task"]

    assert len(gateways) == 2
    assert [task.get("name") for task in tasks] == [
        "pripravím zmluvu a dodatok",
        "odošlem potvrdenie",
    ]


def test_lane_append_linear_steps_split_on_commas():
    payload = LaneAppendRequest(
        lane_id="lane_1",
        description="Prídem domov, odložím bundu",
        engine_json={
            "processId": "proc_demo",
            "name": "Demo",
            "lanes": [{"id": "lane_1", "name": "Podpora"}],
            "nodes": [],
            "flows": [],
        },
    )

    built = append_tasks_to_lane_from_description(payload)
    engine_json = built["engine_json"]
    tasks = [node for node in engine_json.get("nodes", []) if node.get("type") == "task"]
    flows = engine_json.get("flows", [])

    assert [task.get("name") for task in tasks] == [
        "Prídem domov",
        "odložím bundu",
    ]
    assert len(flows) == 1
    assert flows[0]["source"] == tasks[0]["id"]
    assert flows[0]["target"] == tasks[1]["id"]


def test_lane_append_inline_decision_after_linear_steps():
    payload = LaneAppendRequest(
        lane_id="lane_1",
        description="Prídem domov, odložím bundu, Ak je zima, tak zakúrim, inak idem spať",
        engine_json={
            "processId": "proc_demo",
            "name": "Demo",
            "lanes": [{"id": "lane_1", "name": "Podpora"}],
            "nodes": [],
            "flows": [],
        },
    )

    built = append_tasks_to_lane_from_description(payload)
    engine_json = built["engine_json"]
    nodes = engine_json.get("nodes", [])
    flows = engine_json.get("flows", [])

    gateways = [node for node in nodes if node.get("type") == "exclusiveGateway"]
    tasks = [node for node in nodes if node.get("type") == "task"]

    assert len(gateways) == 1
    assert [task.get("name") for task in tasks] == [
        "Prídem domov",
        "odložím bundu",
        "zakúrim",
        "idem spať",
    ]

    flow_pairs = {(flow["source"], flow["target"], flow.get("name", "")) for flow in flows}
    gateway_id = gateways[0]["id"]
    assert (tasks[0]["id"], tasks[1]["id"], "") in flow_pairs
    assert (tasks[1]["id"], gateway_id, "") in flow_pairs


def test_lane_append_inline_decision_after_linear_steps_without_comma_before_ak():
    payload = LaneAppendRequest(
        lane_id="lane_1",
        description="Prídem domov, odložím bundu Ak je zima, tak zakúrim, prinesiem drevo inak idem spať",
        engine_json={
            "processId": "proc_demo",
            "name": "Demo",
            "lanes": [{"id": "lane_1", "name": "Podpora"}],
            "nodes": [],
            "flows": [],
        },
    )

    built = append_tasks_to_lane_from_description(payload)
    engine_json = built["engine_json"]
    nodes = engine_json.get("nodes", [])

    gateways = [node for node in nodes if node.get("type") == "exclusiveGateway"]
    tasks = [node for node in nodes if node.get("type") == "task"]

    assert len(gateways) == 1
    assert [task.get("name") for task in tasks] == [
        "Prídem domov",
        "odložím bundu",
        "zakúrim",
        "prinesiem drevo",
        "idem spať",
    ]


def test_lane_append_conditional_splits_last_and_in_branch_into_extra_step():
    payload = LaneAppendRequest(
        lane_id="lane_1",
        description="Ak je zima, tak zakúrim, nachystám si drevo na noc a hodím drevo do piecky, inak idem spať",
        engine_json={
            "processId": "proc_demo",
            "name": "Demo",
            "lanes": [{"id": "lane_1", "name": "Podpora"}],
            "nodes": [],
            "flows": [],
        },
    )

    built = append_tasks_to_lane_from_description(payload)
    tasks = [node for node in built["engine_json"].get("nodes", []) if node.get("type") == "task"]

    assert [task.get("name") for task in tasks] == [
        "zakúrim",
        "nachystám si drevo na noc",
        "hodím drevo do piecky",
        "idem spať",
    ]


def test_lane_append_conditional_keeps_single_task_when_and_is_not_new_step():
    payload = LaneAppendRequest(
        lane_id="lane_1",
        description="Ak je žiadosť úplná, tak skontrolujem meno a adresu, inak ju vrátim",
        engine_json={
            "processId": "proc_demo",
            "name": "Demo",
            "lanes": [{"id": "lane_1", "name": "Podpora"}],
            "nodes": [],
            "flows": [],
        },
    )

    built = append_tasks_to_lane_from_description(payload)
    tasks = [node for node in built["engine_json"].get("nodes", []) if node.get("type") == "task"]

    assert [task.get("name") for task in tasks] == [
        "skontrolujem meno a adresu",
        "ju vrátim",
    ]
