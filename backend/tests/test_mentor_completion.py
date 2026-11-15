from mentor.models import MentorReviewRequest
from mentor.rule_service import MentorRuleService


def review(types, edges, locale="sk"):
    engine = {
        "processId": "demo",
        "lanes": [{"id": "role", "name": "Spracovateľ"}],
        "nodes": [
            {"id": key, "name": key.upper(), "type": value, "laneId": "role"}
            for key, value in types.items()
        ],
        "flows": [
            {"id": f"f{i}", "source": source, "target": target}
            for i, (source, target) in enumerate(edges)
        ],
    }
    return MentorRuleService().review(MentorReviewRequest(engine_json=engine, locale=locale))


def test_bare_skeleton_has_no_end_warning_but_is_not_ready():
    findings, meta = review({"start": "startEvent"}, [])
    assert not any("end" in f.id for f in findings)
    assert meta["completion_ready"] is False


def test_start_is_required_and_end_warning_is_localized():
    findings, meta = review({"work": "task"}, [], "en")
    assert any(f.id.startswith("process_missing_start:") for f in findings)
    assert any("ending" in f.message for f in findings)
    assert meta["completion_ready"] is False


def test_unreachable_steps_and_trapped_branch_block_completion():
    types = {"start": "bpmn:StartEvent", "work": "task", "end": "endEvent",
             "loop": "task", "stuck": "task", "isolated": "task", "orphan": "endEvent"}
    findings, meta = review(types, [
        ("start", "work"), ("work", "end"), ("work", "loop"),
        ("loop", "stuck"), ("stuck", "loop"), ("isolated", "end"),
    ])
    ids = {f.id for f in findings}
    assert {"node_unreachable_from_start:isolated", "node_unreachable_from_start:orphan",
            "node_no_path_to_end:loop", "node_no_path_to_end:stuck"} <= ids
    assert "Spracovateľ" in next(f.message for f in findings if f.target.id == "loop")
    assert meta["completion_ready"] is False


def test_parallel_paths_need_a_parallel_join_without_a_bypass():
    types = {"s": "startEvent", "split": "parallelGateway", "left": "task",
             "right": "task", "join": "parallelGateway", "e": "endEvent"}
    edges = [("s", "split"), ("split", "left"), ("split", "right"),
             ("left", "join"), ("right", "join"), ("join", "e")]
    assert review(types, edges)[1]["completion_ready"] is True
    for invalid in [edges + [("left", "e")], [edge for edge in edges if edge != ("right", "join")] + [("right", "e")]]:
        findings, meta = review(types, invalid)
        assert any(f.id == "parallel_branches_not_joined:split" for f in findings)
        assert meta["completion_ready"] is False


def test_loop_with_exit_can_finish():
    findings, meta = review({"s": "startEvent", "a": "task", "b": "task", "e": "endEvent"},
                            [("s", "a"), ("a", "b"), ("b", "a"), ("b", "e")])
    assert not any(f.id.startswith("node_no_path_to_end:") for f in findings)
    assert meta["completion_ready"] is True


def test_dangling_task_keeps_connection_actions_available_but_blocks_completion():
    findings, meta = review({"s": "startEvent", "a": "task", "b": "task", "e": "endEvent"},
                            [("s", "a"), ("a", "b"), ("a", "e")])
    dangling = next(f for f in findings if f.id == "node_no_path_to_end:b")
    assert dangling.severity == "SOFT"
    assert meta["completion_ready"] is False


def test_decision_without_input_is_unreachable_even_when_it_can_reach_an_end():
    findings, meta = review({"s": "startEvent", "a": "task", "g": "exclusiveGateway", "e": "endEvent"},
                            [("s", "a"), ("a", "e"), ("g", "a"), ("g", "e")])
    assert any(f.id == "node_unreachable_from_start:g" for f in findings)
    assert meta["completion_ready"] is False


def test_a_role_with_only_events_has_no_steps_yet():
    findings, meta = review({"s": "startEvent", "e": "endEvent"}, [("s", "e")], "en")
    empty = next(f for f in findings if f.id == "lane_is_empty:role")
    assert "Spracovateľ" in empty.message
    assert "has no steps" in empty.message
    assert meta["completion_ready"] is False
