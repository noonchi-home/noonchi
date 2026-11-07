"""Validate the paper's data contracts without making assistance decisions.

The list and FSM memory schemas follow Appendix F. Prediction responses follow
Appendix E. Observation records are the local input manifest, not a paper output.
"""

from __future__ import annotations

from datetime import datetime
import json
from typing import Any


class ContractError(ValueError):
    """An input or model response does not satisfy the declared contract."""


def _object(value: Any, fields: set[str], path: str) -> dict:
    if not isinstance(value, dict):
        raise ContractError(f"{path}: expected an object")
    actual = set(value)
    if actual != fields:
        missing = sorted(fields - actual)
        extra = sorted(repr(key) for key in actual - fields)
        raise ContractError(f"{path}: incorrect fields (missing={missing}, extra={extra})")
    return value


def _text(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{path}: expected a nonempty string")
    return value


def _array(value: Any, path: str) -> list:
    if not isinstance(value, list):
        raise ContractError(f"{path}: expected an array")
    return value


def validate_tasks(value: Any) -> list[str]:
    """Validate a nonempty, ordered list of available actions."""
    tasks = _array(value, "tasks")
    if not tasks:
        raise ContractError("tasks: at least one available action is required")
    for index, task in enumerate(tasks):
        _text(task, f"tasks[{index}]")
    return tasks


def _rules(value: Any, path: str) -> None:
    for index, rule in enumerate(_array(value, path)):
        rule_path = f"{path}[{index}]"
        _object(rule, {"trigger", "action"}, rule_path)
        _text(rule["trigger"], f"{rule_path}.trigger")
        _text(rule["action"], f"{rule_path}.action")


def validate_memory(value: Any, kind: str) -> dict:
    """Validate list or FSM memory; never execute rules or advance a state."""
    if kind == "list":
        memory = _object(value, {"rules"}, "memory")
        _rules(memory["rules"], "memory.rules")
        return memory
    if kind != "fsm":
        raise ContractError("memory kind: expected 'list' or 'fsm'")

    memory = _object(value, {"initial_state", "states"}, "memory")
    initial_state = _text(memory["initial_state"], "memory.initial_state")
    states = _array(memory["states"], "memory.states")
    if not states:
        raise ContractError("memory.states: at least one state is required")

    identifiers: set[str] = set()
    destinations: list[tuple[str, str]] = []
    for index, state in enumerate(states):
        path = f"memory.states[{index}]"
        _object(state, {"id", "description", "rules", "next"}, path)
        identifier = _text(state["id"], f"{path}.id")
        if identifier in identifiers:
            raise ContractError(f"{path}.id: duplicate state identifier {identifier!r}")
        identifiers.add(identifier)
        _text(state["description"], f"{path}.description")
        _rules(state["rules"], f"{path}.rules")
        for next_index, transition in enumerate(_array(state["next"], f"{path}.next")):
            next_path = f"{path}.next[{next_index}]"
            _object(transition, {"to", "on"}, next_path)
            destination = _text(transition["to"], f"{next_path}.to")
            _text(transition["on"], f"{next_path}.on")
            destinations.append((f"{next_path}.to", destination))

    if initial_state not in identifiers:
        raise ContractError("memory.initial_state: must name an existing state")
    for path, destination in destinations:
        if destination not in identifiers:
            raise ContractError(f"{path}: unknown state identifier {destination!r}")
    return memory


def validate_prediction(value: Any, tasks: list[str]) -> dict:
    """Validate structure and action bounds, not semantic correctness."""
    validate_tasks(tasks)
    prediction = _object(value, {"observation", "reasoning", "task_index"}, "prediction")
    _text(prediction["observation"], "prediction.observation")
    _text(prediction["reasoning"], "prediction.reasoning")
    index = prediction["task_index"]
    # bool is a subclass of int in Python, but is not a paper action index.
    if type(index) is not int or not -1 <= index < len(tasks):
        raise ContractError(f"prediction.task_index: expected an integer from -1 to {len(tasks) - 1}")
    return prediction


def _unique_object(pairs: list[tuple[str, Any]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ContractError(f"response JSON: duplicate key {key!r}")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ContractError(f"response JSON: nonstandard numeric constant {value!r}")


def parse_prediction(raw: str, tasks: list[str]) -> dict:
    """Preserve the original response and keep invalid output distinct from wait.

    Only a complete JSON object is accepted. Markdown fences, surrounding prose,
    duplicate keys, and nonstandard numeric constants are not silently repaired.
    """
    result = {
        "status": "invalid",
        "raw_response": raw,
        "prediction": None,
        "selected_action": None,
        "errors": [],
    }
    try:
        if not isinstance(raw, str):
            raise ContractError("response: expected a JSON string")
        value = json.loads(raw, object_pairs_hook=_unique_object, parse_constant=_reject_constant)
        prediction = validate_prediction(value, tasks)
    except (ContractError, json.JSONDecodeError) as error:
        result["errors"].append(str(error))
        return result

    result["status"] = "valid"
    result["prediction"] = prediction
    index = prediction["task_index"]
    result["selected_action"] = None if index == -1 else tasks[index]
    return result


def validate_observation_records(value: Any) -> list[dict]:
    """Validate ordered paired-camera records, without reading image files.

    Accept either an array or the manifest object {"observations": [...]}. Extra
    fields are rejected so evaluation labels cannot enter the model input here.
    Timestamps must be timezone-aware ISO strings and strictly increasing in
    absolute time. The supplied ordering and strings are preserved.
    """
    if isinstance(value, dict):
        value = _object(value, {"observations"}, "manifest")["observations"]
    records = _array(value, "observations")
    if not records:
        raise ContractError("observations: at least one paired-camera record is required")
    previous: datetime | None = None
    for index, record in enumerate(records):
        path = f"observations[{index}]"
        _object(record, {"timestamp", "left_image", "right_image"}, path)
        timestamp = _text(record["timestamp"], f"{path}.timestamp")
        _text(record["left_image"], f"{path}.left_image")
        _text(record["right_image"], f"{path}.right_image")
        try:
            current = datetime.fromisoformat(timestamp)
        except ValueError as error:
            raise ContractError(f"{path}.timestamp: expected an ISO datetime") from error
        if current.tzinfo is None or current.utcoffset() is None:
            raise ContractError(f"{path}.timestamp: timezone information is required")
        if previous is not None and current <= previous:
            raise ContractError(f"{path}.timestamp: timestamps must be unique and increasing")
        previous = current
    return records
