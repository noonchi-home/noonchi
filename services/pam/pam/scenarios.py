"""Apply explicit scenario substitutions without changing the preserved paper prompts."""

from __future__ import annotations

import hashlib
from pathlib import Path

from .contracts import ContractError, validate_memory, validate_tasks
from .messages import read_json


def load_scenario(path: Path) -> dict:
    path = Path(path).resolve()
    value = read_json(path)
    if not isinstance(value, dict):
        raise ContractError("Scenario configuration must be an object.")
    for name in ("id", "tasks_file"):
        if not isinstance(value.get(name), str) or not value[name].strip():
            raise ContractError(f"Scenario requires {name}.")
    if not isinstance(value.get("memory_files"), dict):
        raise ContractError("Scenario requires memory_files.")
    changes = value.get("prompt_replacements")
    if not isinstance(changes, list) or not changes:
        raise ContractError("Scenario requires documented prompt substitutions.")
    for change in changes:
        if not isinstance(change, dict) or any(
            not isinstance(change.get(key), str) or not change[key].strip()
            for key in ("old", "new", "reason")
        ):
            raise ContractError("Each scenario change needs old, new, and reason strings.")
    return {**value, "_config_path": str(path),
            "_config_sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def scenario_file(scenario: dict, name: str, kind: str | None = None) -> Path:
    relative = scenario["memory_files"].get(kind) if name == "memory" else scenario.get(name)
    if not isinstance(relative, str) or not relative.strip():
        raise ContractError(f"Scenario does not define {name} ({kind}).")
    root = Path(scenario["_config_path"]).parent
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise ContractError("Scenario data files must remain within the scenario directory.")
    return path


def load_scenario_tasks(scenario: dict) -> list[str]:
    tasks = validate_tasks(read_json(scenario_file(scenario, "tasks_file")))
    labels = scenario.get("action_labels_ko")
    if labels is not None and (not isinstance(labels, list) or len(labels) != len(tasks)
                               or any(not isinstance(label, str) or not label.strip() for label in labels)):
        raise ContractError("Korean action labels must correspond one-to-one with the task list.")
    return tasks


def load_scenario_memory(scenario: dict, kind: str) -> dict:
    return validate_memory(read_json(scenario_file(scenario, "memory", kind)), kind)


def adapt_prompt(template: str, scenario: dict) -> tuple[str, dict]:
    """Record each literal substitution. Paper files remain unchanged."""
    adapted = template
    applied = []
    for change in scenario["prompt_replacements"]:
        count = adapted.count(change["old"])
        if count:
            adapted = adapted.replace(change["old"], change["new"])
            applied.append({"old": change["old"], "new": change["new"],
                            "reason": change["reason"], "occurrences": count})
    if not applied:
        raise ContractError("No scenario substitutions matched this paper prompt.")
    return adapted, {"id": scenario["id"], "config_path": scenario["_config_path"],
                     "config_sha256": scenario["_config_sha256"], "applied_changes": applied,
                     "adapted_template_sha256": hashlib.sha256(adapted.encode("utf-8")).hexdigest(),
                     "action_labels_ko": scenario.get("action_labels_ko")}
