"""문맥 길이 검사: 입력 추정 토큰 + max_tokens ≤ max_model_len. 추정은 UTF-8 바이트 ÷ 3(한국어 한 글자를 1토큰으로 넉넉히 센다)."""
from __future__ import annotations

import math

from .contracts import PredictRequest, ReflectRequest
from .prompt import build_predict_messages, build_reflect_messages
from .settings import Settings

PER_MESSAGE = 8
RESERVE = 256


class BudgetError(ValueError):
    pass


def _texts(messages: list[dict]):
    for m in messages:
        c = m["content"]
        yield from ([c] if isinstance(c, str) else [p.get("text", "") for p in c])


def estimate_tokens(messages: list[dict]) -> int:
    return sum(math.ceil(len(t.encode("utf-8")) / 3) for t in _texts(messages)) + PER_MESSAGE * len(messages)


def check_budget(messages: list[dict], max_tokens: int, max_model_len: int) -> None:
    n = estimate_tokens(messages)
    if n + max_tokens > max_model_len:
        raise BudgetError(f"입력이 문맥 길이를 넘음: 추정 {n} + 출력 {max_tokens} > {max_model_len}")


def limits(s: Settings) -> dict:
    """판단·반성 요청에서 바뀌는 글(관찰 텍스트·행동 요약·피드백·기억 JSON·행동 목록)에 쓸 수 있는 UTF-8 바이트 수."""
    empty_memory = {"initial_state": "s", "states": [{"id": "s", "description": "d", "rules": [], "next": []}]}
    p = build_predict_messages(PredictRequest(contract="pam-predict/2", final_time="2026-01-01T00:00:00+09:00", observation_text="x",
                                              memory_kind="fsm", memory=empty_memory, tasks=["t"]))["messages"]
    r = build_reflect_messages(ReflectRequest(contract="pam-reflect/2", day="2026-01-01", memory_kind="fsm", memory=empty_memory,
                                              observation_text="x", action_summary="x", feedback=None))["messages"]

    def room(msgs: list[dict], role: str) -> int:
        return max(0, (s.max_model_len - s.max_tokens[role] - estimate_tokens(msgs) - RESERVE) * 3)

    return {"max_model_len": s.max_model_len, "predict_input_bytes": room(p, "predictor"), "reflect_input_bytes": room(r, "reflector")}
