from services.engine_normalizer import find_gateway_warnings


def test_find_gateway_warnings_missing_gateway_id_is_tolerated_and_warns():
    warnings = find_gateway_warnings(
        nodes=[{"type": "exclusiveGateway", "name": "badGateway"}],
        flows=[],
    )
    assert len(warnings) == 1
    assert "missing id" in warnings[0]
    assert "badGateway" in warnings[0]


def test_find_gateway_warnings_missing_id_does_not_crash_with_valid_flow():
    warnings = find_gateway_warnings(
        nodes=[{"type": "parallelGateway", "name": "noIdGateway"}],
        flows=[{"source": "Ghost", "target": "Ghost"}],
    )
    assert warnings
    assert isinstance(warnings[0], str)
    assert "missing id" in warnings[0]


def test_find_gateway_warnings_non_gateway_node_without_id_is_ignored():
    warnings = find_gateway_warnings(
        nodes=[{"type": "service", "name": "noIdService"}],
        flows=[],
    )
    assert warnings == []
