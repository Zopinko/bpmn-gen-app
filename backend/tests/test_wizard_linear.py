from services.bpmn_svc import append_tasks_to_lane_from_description, build_linear_engine_from_wizard
from schemas.wizard import LaneAppendRequest, LinearWizardRequest


def _by_type(engine_json, node_type: str):
    return [node for node in engine_json.get("nodes", []) if node.get("type") == node_type]


def _demo_engine():
    return {
        "processId": "proc_demo",
        "name": "Demo",
        "lanes": [{"id": "lane_1", "name": "Support"}],
        "nodes": [],
        "flows": [],
    }


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
    flows = engine_json.get("flows", [])

    assert len(starts) == 1
    assert len(tasks) == len(payload.steps)
    assert len(flows) == len(tasks)

    flow_map = {flow["source"]: flow["target"] for flow in flows}
    expected_task_ids = [f"task_{i}" for i in range(1, len(payload.steps) + 1)]
    chain = []
    current = starts[0]["id"]

    while current in flow_map:
        nxt = flow_map[current]
        chain.append(nxt)
        current = nxt

    assert chain == expected_task_ids
    assert current == expected_task_ids[-1]


def test_lane_append_linear_steps_split_on_commas():
    built = append_tasks_to_lane_from_description(
        LaneAppendRequest(
            lane_id="lane_1",
            description="Come home, hang jacket",
            engine_json=_demo_engine(),
        )
    )["engine_json"]

    tasks = _by_type(built, "task")
    flows = built.get("flows", [])

    assert [task.get("name") for task in tasks] == ["Come home", "hang jacket"]
    assert len(flows) == 1
    assert flows[0]["source"] == tasks[0]["id"]
    assert flows[0]["target"] == tasks[1]["id"]


def test_lane_append_conditional_splits_multiple_tasks_per_branch():
    built = append_tasks_to_lane_from_description(
        LaneAppendRequest(
            lane_id="lane_1",
            description=(
                "Ak je request valid, tak review request, send confirmation, "
                "inak return request, send warning"
            ),
            engine_json=_demo_engine(),
        )
    )["engine_json"]

    tasks = _by_type(built, "task")
    gateways = _by_type(built, "exclusiveGateway")
    flow_pairs = {(flow["source"], flow["target"], flow.get("name", "")) for flow in built.get("flows", [])}

    assert len(gateways) == 1
    assert [task.get("name") for task in tasks] == [
        "review request",
        "send confirmation",
        "return request",
        "send warning",
    ]
    gateway_id = gateways[0]["id"]
    assert (gateway_id, tasks[0]["id"], "Áno") in flow_pairs
    assert (gateway_id, tasks[2]["id"], "Nie") in flow_pairs
    assert (tasks[0]["id"], tasks[1]["id"], "") in flow_pairs
    assert (tasks[2]["id"], tasks[3]["id"], "") in flow_pairs


def test_lane_append_inline_decision_after_linear_steps():
    built = append_tasks_to_lane_from_description(
        LaneAppendRequest(
            lane_id="lane_1",
            description="Come home, hang jacket, Ak je cold, tak light fire, inak go sleep",
            engine_json=_demo_engine(),
        )
    )["engine_json"]

    tasks = _by_type(built, "task")
    gateways = _by_type(built, "exclusiveGateway")
    flow_pairs = {(flow["source"], flow["target"], flow.get("name", "")) for flow in built.get("flows", [])}

    assert len(gateways) == 1
    assert [task.get("name") for task in tasks] == [
        "Come home",
        "hang jacket",
        "light fire",
        "go sleep",
    ]
    gateway_id = gateways[0]["id"]
    assert (tasks[0]["id"], tasks[1]["id"], "") in flow_pairs
    assert (tasks[1]["id"], gateway_id, "") in flow_pairs


def test_lane_append_inline_decision_after_linear_steps_without_comma_before_ak():
    built = append_tasks_to_lane_from_description(
        LaneAppendRequest(
            lane_id="lane_1",
            description="Come home, hang jacket Ak je cold, tak light fire, bring wood inak go sleep",
            engine_json=_demo_engine(),
        )
    )["engine_json"]

    tasks = _by_type(built, "task")
    gateways = _by_type(built, "exclusiveGateway")

    assert len(gateways) == 1
    assert [task.get("name") for task in tasks] == [
        "Come home",
        "hang jacket",
        "light fire",
        "bring wood",
        "go sleep",
    ]


def test_lane_append_conditional_splits_last_and_in_branch_into_extra_step():
    built = append_tasks_to_lane_from_description(
        LaneAppendRequest(
            lane_id="lane_1",
            description="Ak je zima, tak zakurim, nachystam si drevo na noc a hodim drevo do piecky, inak idem spat",
            engine_json=_demo_engine(),
        )
    )["engine_json"]

    tasks = _by_type(built, "task")

    assert [task.get("name") for task in tasks] == [
        "zakurim",
        "nachystam si drevo na noc",
        "hodim drevo do piecky",
        "idem spat",
    ]


def test_lane_append_conditional_keeps_single_task_when_and_is_not_new_step():
    built = append_tasks_to_lane_from_description(
        LaneAppendRequest(
            lane_id="lane_1",
            description="Ak je request valid, tak check name and address, inak return request",
            engine_json=_demo_engine(),
        )
    )["engine_json"]

    tasks = _by_type(built, "task")

    assert [task.get("name") for task in tasks] == [
        "check name and address",
        "return request",
    ]


def test_lane_append_period_ends_decision_block_before_next_sentence():
    built = append_tasks_to_lane_from_description(
        LaneAppendRequest(
            lane_id="lane_1",
            description=(
                "Come home, unlock door, enter room. "
                "Ak je cold tak get wood, prepare fireplace, inak check temperature, eat snack, go sleep. "
                "Continue later"
            ),
            engine_json=_demo_engine(),
        )
    )["engine_json"]

    tasks = _by_type(built, "task")
    gateways = _by_type(built, "exclusiveGateway")
    flows = built.get("flows", [])

    assert len(gateways) == 1
    assert [task.get("name") for task in tasks] == [
        "Come home",
        "unlock door",
        "enter room",
        "get wood",
        "prepare fireplace",
        "check temperature",
        "eat snack",
        "go sleep",
        "Continue later",
    ]

    incoming_to_continue = [flow for flow in flows if flow.get("target") == tasks[-1]["id"]]
    assert len(incoming_to_continue) == 1
    source_id = incoming_to_continue[0]["source"]
    source_node = next(node for node in built.get("nodes", []) if node.get("id") == source_id)
    assert source_node.get("type") == "task"
    assert source_node.get("name") == "prepare fireplace"


def test_lane_append_parallel_does_not_split_on_word_a():
    built = append_tasks_to_lane_from_description(
        LaneAppendRequest(
            lane_id="lane_1",
            description="Paralelne prepare contract and addendum, send confirmation",
            engine_json=_demo_engine(),
        )
    )["engine_json"]

    tasks = _by_type(built, "task")
    gateways = _by_type(built, "parallelGateway")

    assert len(gateways) == 2
    assert [task.get("name") for task in tasks] == [
        "prepare contract and addendum",
        "send confirmation",
    ]


def test_lane_append_parallel_splits_last_and_into_extra_step():
    built = append_tasks_to_lane_from_description(
        LaneAppendRequest(
            lane_id="lane_1",
            description="Paralelne nachystam piecku, nastiepem triesky a otvorim klapku",
            engine_json=_demo_engine(),
        )
    )["engine_json"]

    tasks = _by_type(built, "task")
    gateways = _by_type(built, "parallelGateway")

    assert len(gateways) == 2
    assert [task.get("name") for task in tasks] == [
        "nachystam piecku",
        "nastiepem triesky",
        "otvorim klapku",
    ]


def test_lane_append_parallel_keeps_single_task_when_and_is_not_new_step():
    built = append_tasks_to_lane_from_description(
        LaneAppendRequest(
            lane_id="lane_1",
            description="Paralelne check name and address, send confirmation",
            engine_json=_demo_engine(),
        )
    )["engine_json"]

    tasks = _by_type(built, "task")

    assert [task.get("name") for task in tasks] == [
        "check name and address",
        "send confirmation",
    ]


def test_lane_append_continues_after_parallel_join_not_last_branch_task():
    first = append_tasks_to_lane_from_description(
        LaneAppendRequest(
            lane_id="lane_1",
            description="Paralelne prepare wood, prepare fire and open vent",
            engine_json=_demo_engine(),
        )
    )["engine_json"]

    second = append_tasks_to_lane_from_description(
        LaneAppendRequest(
            lane_id="lane_1",
            description="Continue later",
            engine_json=first,
        )
    )["engine_json"]

    nodes = {node["id"]: node for node in second.get("nodes", [])}
    next_tasks = [node for node in nodes.values() if node.get("type") == "task" and node.get("name") == "Continue later"]
    flows = second.get("flows", [])

    assert len(next_tasks) == 1
    incoming_to_next = [flow for flow in flows if flow.get("target") == next_tasks[0]["id"]]
    assert len(incoming_to_next) == 1
    assert nodes[incoming_to_next[0]["source"]].get("type") == "parallelGateway"


def test_lane_append_prefers_parallel_join_before_end_event():
    base = {
        "processId": "proc_demo",
        "name": "Demo",
        "lanes": [{"id": "lane_1", "name": "Support"}],
        "nodes": [
            {"id": "gw_split", "type": "parallelGateway", "laneId": "lane_1", "name": "Paralelne"},
            {"id": "gw_join", "type": "parallelGateway", "laneId": "lane_1", "name": "Zlucenie paralelnych vetiev"},
            {"id": "task_a", "type": "task", "name": "prepare fireplace", "laneId": "lane_1"},
            {"id": "task_b", "type": "task", "name": "split wood", "laneId": "lane_1"},
            {"id": "task_c", "type": "task", "name": "open vent", "laneId": "lane_1"},
            {"id": "end_1", "type": "endEvent", "name": "Koniec", "laneId": "lane_1"},
        ],
        "flows": [
            {"id": "f1", "source": "gw_split", "target": "task_a"},
            {"id": "f2", "source": "gw_split", "target": "task_b"},
            {"id": "f3", "source": "gw_split", "target": "task_c"},
            {"id": "f4", "source": "task_a", "target": "gw_join"},
            {"id": "f5", "source": "task_b", "target": "gw_join"},
            {"id": "f6", "source": "task_c", "target": "gw_join"},
            {"id": "f7", "source": "gw_join", "target": "end_1"},
        ],
    }

    built = append_tasks_to_lane_from_description(
        LaneAppendRequest(lane_id="lane_1", description="Continue later", engine_json=base)
    )["engine_json"]

    nodes = {node["id"]: node for node in built.get("nodes", [])}
    next_tasks = [node for node in nodes.values() if node.get("type") == "task" and node.get("name") == "Continue later"]
    flows = built.get("flows", [])

    assert len(next_tasks) == 1
    incoming_to_next = [flow for flow in flows if flow.get("target") == next_tasks[0]["id"]]
    assert len(incoming_to_next) == 1
    assert incoming_to_next[0]["source"] == "gw_join"
