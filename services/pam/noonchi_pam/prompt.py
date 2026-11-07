"""논문 프롬프트로 판단·반성 메시지를 만든다. 판단 규칙은 그대로 두고 사진이 들어가던 자리에 관찰 텍스트를 넣는다."""
from __future__ import annotations

import json
import re

from pam.contracts import ContractError, validate_memory, validate_tasks
from pam.messages import PROJECT_ROOT, _render, load_paper_config, load_prompt
from pam.scenarios import adapt_prompt, load_scenario, load_scenario_tasks

from .contracts import PredictRequest, ReflectRequest

SCENARIO = load_scenario(PROJECT_ROOT / "scenarios" / "noonchi" / "scenario.json")
load_scenario_tasks(SCENARIO)
PLACEHOLDER = re.compile(r"\{(window|tasks_block|n_tasks_minus_one|rules_block|fsm_block)\}")


def _adapted(prompt_id: str) -> tuple[str, dict]:
    template, _source = load_prompt(prompt_id)
    return adapt_prompt(template, SCENARIO)


def build_predict_messages(req: PredictRequest) -> dict:
    tasks = validate_tasks(list(req.tasks))
    memory = validate_memory(dict(req.memory), req.memory_kind)
    template, adaptation = _adapted(f"predictor_{req.memory_kind}")
    values = {
        "n_tasks_minus_one": str(len(tasks) - 1),
        "tasks_block": "\n".join(f"{i}: {t}" for i, t in enumerate(tasks)),
        ("rules_block" if req.memory_kind == "list" else "fsm_block"): json.dumps(memory, ensure_ascii=False, indent=2),
    }
    needed = set(PLACEHOLDER.findall(template))
    system = _render(template, {k: v for k, v in values.items() if k in needed})
    config = load_paper_config()
    return {
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": [
                {"type": "text", "text": f"Wall-clock time of the final observation: {req.final_time.isoformat()}"},
                {"type": "text", "text": "Observation log (oldest to newest):\n" + req.observation_text},
            ]},
        ],
        "generation": {k: config["predictor"][k] for k in ("temperature", "enable_thinking")},
        "adaptation": adaptation,
    }


def build_reflect_messages(req: ReflectRequest) -> dict:
    memory = validate_memory(dict(req.memory), req.memory_kind)
    template, adaptation = _adapted(f"reflector_{req.memory_kind}_update")
    text = "Current memory:\n" + json.dumps(memory, ensure_ascii=False, indent=2) + "\n\nSummary:\n" + req.action_summary
    if req.feedback:
        text += "\n\nHuman feedback:\n" + req.feedback
    config = load_paper_config()
    return {
        "messages": [
            {"role": "system", "content": template},
            {"role": "user", "content": [
                {"type": "text", "text": "Today's observations, provided as a chronological time-stamped log:\n" + req.observation_text},
                {"type": "text", "text": text},
            ]},
        ],
        "generation": {k: config["reflector"][k] for k in ("temperature", "enable_thinking")},
        "adaptation": adaptation,
    }


def parse_memory(raw: str, kind: str) -> dict:
    """완전한 JSON 객체만 받는다(마크다운·중복 키·NaN 같은 상수·고침 없음). 틀리면 ValueError."""
    def unique(pairs):
        out = {}
        for k, v in pairs:
            if k in out:
                raise ValueError(f"duplicate key: {k}")
            out[k] = v
        return out

    def constant(value):
        raise ValueError(f"nonstandard constant: {value}")

    try:
        value = json.loads(raw, object_pairs_hook=unique, parse_constant=constant)
        return validate_memory(value, kind)
    except (json.JSONDecodeError, ContractError) as e:
        raise ValueError(str(e)) from e
