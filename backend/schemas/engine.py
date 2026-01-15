# engine.py  (upravená schéma – kompatibilná s "gateway" + gatewayType a flows.condition)
import re
import xml.etree.ElementTree as ET
from fastapi import HTTPException
from jsonschema import validate, ValidationError

SCHEMA = {
    "type": "object",
    "required": ["processId", "name", "lanes", "nodes", "flows"],
    "properties": {
        "processId": {"type": "string", "minLength": 1},
        "name": {"type": "string", "minLength": 1},
        "lanes": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string", "minLength": 1},
                    "name": {"type": "string", "minLength": 1},
                },
            },
        },
        "nodes": {
            "type": "array",
            "items": {
                "anyOf": [
                    {
                        "type": "object",
                        "required": ["id", "type", "laneId", "name"],
                        "properties": {
                            "id": {"type": "string", "minLength": 1},
                            "type": {
                                "type": "string",
                                "enum": [
                                    "startEvent",
                                    "endEvent",
                                    "task",
                                    "userTask",
                                    "serviceTask",
                                    "gateway",
                                    "exclusiveGateway",
                                    "parallelGateway",
                                    "inclusiveGateway",
                                ],
                            },
                            "gatewayType": {
                                "type": "string",
                                "enum": ["exclusive", "parallel", "inclusive"],
                            },
                            "laneId": {"type": "string", "minLength": 1},
                            "name": {"type": "string", "minLength": 1},
                        },
                        "additionalProperties": True,
                    },
                    {
                        "type": "object",
                        "required": ["id", "type", "laneId", "name"],
                        "properties": {
                            "id": {"type": "string", "minLength": 1},
                            "type": {"type": "string", "enum": ["textAnnotation"]},
                            "laneId": {"type": "string", "minLength": 1},
                            "name": {"type": "string"},
                        },
                        "additionalProperties": True,
                    },
                ],
            },
        },
        "flows": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "source", "target"],
                "properties": {
                    "id": {"type": "string", "minLength": 1},
                    "source": {"type": "string", "minLength": 1},
                    "target": {"type": "string", "minLength": 1},
                    "name": {"type": "string"},
                    # umožníme podmienky na vetvách z gateway
                    "condition": {"type": "string"},
                    # voliteľne default vetva (ak by si doplnil v budúcnosti)
                    "default": {"type": "boolean"},
                },
                "additionalProperties": True,
            },
        },
    },
    "additionalProperties": False,
}


def validate_payload(payload: dict):
    try:
        validate(instance=payload, schema=SCHEMA)
    except ValidationError as e:
        where = "/".join([str(p) for p in e.path]) or "<root>"
        raise HTTPException(
            status_code=400, detail=f"JSON validation error at {where}: {e.message}"
        )


def validate_xml(xml_text: str):
    ET.fromstring(xml_text)  # syntaktická validácia
    head = "\n".join(xml_text.splitlines()[:6])
    pairs = re.findall(r'(xmlns(?::\w+)?)="[^"]+"', head)
    if len(pairs) != len(set(pairs)):
        raise ValueError("Duplicate xmlns detected")
