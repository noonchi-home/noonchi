"""Assemble paper system prompts and provider-independent multimodal inputs.

Image parts reference local files. This is NOT a vendor API request; a future
transport must encode those files without dropping frames or changing settings.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from .contracts import ContractError, validate_memory, validate_tasks

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROMPT_IDS = frozenset({
    "predictor_no_memory", "predictor_list", "predictor_fsm",
    "reflector_list_build", "reflector_list_update",
    "reflector_fsm_build", "reflector_fsm_update",
})
PLACEHOLDER = re.compile(r"\{(window|tasks_block|n_tasks_minus_one|rules_block|fsm_block)\}")


def read_json(path: Path) -> Any:
    """Reject duplicate keys and non-JSON constants instead of silently changing input."""
    def object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ContractError(f"Duplicate JSON key: {key}")
            result[key] = value
        return result

    def invalid_constant(value: str) -> None:
        raise ContractError(f"Invalid JSON constant: {value}")

    try:
        return json.loads(Path(path).read_text(encoding="utf-8-sig"),
                          object_pairs_hook=object_pairs, parse_constant=invalid_constant)
    except (OSError, ValueError) as exc:
        raise ContractError(f"Cannot read JSON {path}: {exc}") from exc


def load_paper_config(project_dir: Path = PROJECT_ROOT) -> dict[str, Any]:
    config = read_json(project_dir / "config" / "paper.json")
    expected = {
        "predictor": {"temperature": 0.3, "enable_thinking": False,
                      "frame_count": 5, "frame_stride_seconds": 2, "interval_seconds": 1},
        "reflector": {"temperature": 0.3, "enable_thinking": True, "frame_count": 200},
    }
    if not isinstance(config, dict) or config.get("model") != "Qwen3.5-27B":
        raise ContractError("The paper profile must use Qwen3.5-27B.")
    for role, settings in expected.items():
        if not isinstance(config.get(role), dict):
            raise ContractError(f"Paper settings for {role} must be an object.")
        for key, expected_value in settings.items():
            actual = config.get(role, {}).get(key)
            if type(actual) is not type(expected_value) or actual != expected_value:
                raise ContractError(f"Paper setting differs: {role}.{key}")
    return config


def load_prompt(prompt_id: str, project_dir: Path = PROJECT_ROOT) -> tuple[str, dict]:
    if prompt_id not in PROMPT_IDS:
        raise ContractError(f"Unknown paper prompt: {prompt_id}")
    source_map = read_json(project_dir / "prompts" / "source_map.json")
    source = source_map["prompts"][prompt_id]
    path = (project_dir / source["file"]).resolve()
    if not path.is_relative_to(project_dir.resolve() / "prompts" / "paper"):
        raise ContractError("A paper prompt must be under prompts/paper.")
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != source["sha256"]:
        raise ContractError(f"Paper prompt hash mismatch: {prompt_id}")
    return raw.decode("utf-8"), {"id": prompt_id, **source}


def _render(template: str, values: dict[str, str]) -> str:
    # A single regex pass deliberately leaves braces inside inserted JSON intact.
    needed = set(PLACEHOLDER.findall(template))
    if needed != set(values):
        raise ContractError(f"Prompt substitution mismatch: expected {sorted(needed)}")
    return PLACEHOLDER.sub(lambda match: values[match.group(1)], template)


def _frame_content(frames: list[dict], count: int, stride: int | None = None) -> list[dict]:
    if len(frames) != count:
        raise ContractError(f"Expected {count} composed frames, received {len(frames)}.")
    previous = None
    parts: list[dict] = []
    for frame in frames:
        try:
            instant = datetime.fromisoformat(frame["timestamp"].replace("Z", "+00:00"))
            image_path = Path(frame["image_path"]).resolve()
        except (KeyError, TypeError, ValueError) as exc:
            raise ContractError(f"Invalid composed-frame metadata: {exc}") from exc
        if instant.utcoffset() is None:
            raise ContractError("Frame timestamps must include a timezone.")
        if previous is not None:
            if instant <= previous:
                raise ContractError("Frames must be in strictly increasing time order.")
            if stride is not None and instant - previous != timedelta(seconds=stride):
                raise ContractError(f"Predictor frames must be {stride} seconds apart.")
        if not image_path.is_file():
            raise ContractError(f"Composed image does not exist: {image_path}")
        # Only the actual picture becomes image content. Ground-truth labels and
        # source filenames are not additional text supplied to the model.
        parts.append({"type": "image_file", "path": str(image_path), "mime_type": "image/png"})
        previous = instant
    return parts


def build_predictor_messages(
    frames: list[dict], tasks: list[str], *, memory_kind: str = "none",
    memory: dict | None = None, project_dir: Path = PROJECT_ROOT, scenario: dict | None = None,
) -> dict:
    """Prepare E.1/E.2/E.3 without inferring a state or selecting an action."""
    tasks = validate_tasks(tasks)
    if memory_kind not in {"none", "list", "fsm"}:
        raise ContractError("memory_kind must be none, list, or fsm.")
    if memory_kind == "none":
        if memory is not None:
            raise ContractError("The no-memory condition cannot receive memory.")
    elif memory is None:
        raise ContractError(f"The {memory_kind} condition requires memory.")
    else:
        validate_memory(memory, memory_kind)
    config = load_paper_config(project_dir)
    image_parts = _frame_content(frames, 5, stride=2)
    prompt_id = "predictor_no_memory" if memory_kind == "none" else f"predictor_{memory_kind}"
    template, source = load_prompt(prompt_id, project_dir)
    adaptation = None
    if scenario is not None:
        from .scenarios import adapt_prompt
        template, adaptation = adapt_prompt(template, scenario)
    values = {
        "window": "5", "n_tasks_minus_one": str(len(tasks) - 1),
        "tasks_block": "\n".join(f"{index}: {task}" for index, task in enumerate(tasks)),
    }
    if memory_kind != "none":
        values["rules_block" if memory_kind == "list" else "fsm_block"] = json.dumps(
            memory, ensure_ascii=False, indent=2)
    system = _render(template, values)
    return {
        "role": "predictor", "memory_kind": memory_kind, "tasks": tasks,
        "prompt_source": source, "model": config["model"], "scenario": adaptation,
        "generation": {key: config["predictor"][key] for key in ("temperature", "enable_thinking")},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": [
                {"type": "text", "text": f"Wall-clock time of the final frame: {frames[-1]['timestamp']}"},
                *image_parts,
            ]},
        ],
    }


def build_reflector_messages(
    frames: list[dict], *, memory_kind: str, operation: str,
    memory: dict | None = None, summary: str | None = None,
    feedback: str | None = None, project_dir: Path = PROJECT_ROOT, scenario: dict | None = None,
    frame_count: int = 200,
) -> dict:
    """Prepare F.1--F.4 with the paper count, or an explicit user-selected 50/100/150.

    The paper configuration and prompt text remain unchanged. The override is
    recorded separately so a reduced-frame experiment cannot be mistaken for the
    paper's 200-frame input condition.
    """
    if type(frame_count) is not int or frame_count not in (50, 100, 150, 200):
        raise ContractError("Reflector frame_count must be 200 (paper), or 50/100/150 (explicit user override).")
    if memory_kind not in {"list", "fsm"}:
        raise ContractError("Reflector memory_kind must be list or fsm.")
    if operation not in {"build", "update"}:
        raise ContractError("Reflector operation must be build or update.")
    if operation == "build":
        if any(value is not None for value in (memory, summary, feedback)):
            raise ContractError("Initial memory build receives no prior memory, summary, or feedback.")
        input_text = None
    else:
        if memory is None:
            raise ContractError("An end-of-day update requires current memory.")
        validate_memory(memory, memory_kind)
        if not isinstance(summary, str) or not summary.strip():
            raise ContractError("An end-of-day update requires a nonempty chronological action summary.")
        if feedback is not None and (not isinstance(feedback, str) or not feedback.strip()):
            raise ContractError("Feedback must be nonempty text when supplied.")
        input_text = ("Current memory:\n" + json.dumps(memory, ensure_ascii=False, indent=2)
                      + "\n\nSummary:\n" + summary)
        if feedback is not None:
            input_text += "\n\nHuman feedback:\n" + feedback
    config = load_paper_config(project_dir)
    image_parts = _frame_content(frames, frame_count)
    prompt_id = f"reflector_{memory_kind}_{operation}"
    template, source = load_prompt(prompt_id, project_dir)
    adaptation = None
    if scenario is not None:
        from .scenarios import adapt_prompt
        template, adaptation = adapt_prompt(template, scenario)
    return {
        "role": "reflector", "memory_kind": memory_kind, "operation": operation,
        "frame_count": frame_count,
        "frame_count_source": "paper" if frame_count == 200 else "explicit_user_override",
        "prompt_source": source, "model": config["model"], "scenario": adaptation,
        "generation": {key: config["reflector"][key] for key in ("temperature", "enable_thinking")},
        "messages": [
            {"role": "system", "content": template},
            {"role": "user", "content": [
                {"type": "text", "text": ("The training video" if operation == "build" else "Today's video")
                 + ", provided as chronological sampled frames:"},
                *image_parts,
                *([{"type": "text", "text": input_text}] if input_text is not None else []),
            ]},
        ],
    }
