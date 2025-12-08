import pytest

from services.node_classifier import determine_node_type


@pytest.mark.parametrize(
    ("text", "lang"),
    [
        ("Exkluzívna brána rozhodne medzi vetvami.", "sk"),
        ("Use an exclusive gateway decision in the process.", "en"),
    ],
)
def test_exclusive_gateway_detection(text: str, lang: str) -> None:
    result = determine_node_type(text, lang=lang)
    assert result["type"] == "exclusiveGateway"


@pytest.mark.parametrize(
    ("text", "lang"),
    [
        ("Paralelná brána spustí oba kroky naraz.", "sk"),
        ("Trigger the parallel gateway decision for both tasks.", "en"),
    ],
)
def test_parallel_gateway_detection(text: str, lang: str) -> None:
    result = determine_node_type(text, lang=lang)
    assert result["type"] == "parallelGateway"


@pytest.mark.parametrize(
    ("text", "lang"),
    [
        ("Inkluzívna brána povoľuje aspoň jeden priebeh.", "sk"),
        ("Route via the inclusive decision gateway when needed.", "en"),
    ],
)
def test_inclusive_gateway_detection(text: str, lang: str) -> None:
    result = determine_node_type(text, lang=lang)
    assert result["type"] == "inclusiveGateway"


@pytest.mark.parametrize(
    ("text", "lang"),
    [
        ("Ručná úloha zabezpečí manuálne spracovanie formulára.", "sk"),
        ("Perform a manual task by hand before approval.", "en"),
    ],
)
def test_manual_task_detection(text: str, lang: str) -> None:
    result = determine_node_type(text, lang=lang)
    assert result["type"] == "manual_task"
