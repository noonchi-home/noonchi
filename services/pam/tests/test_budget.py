"""문맥 길이 검사: /health가 알리는 반성 입력 한도 안의 요청은 통과하고, 넘으면 거절한다."""
import json

import pytest

from noonchi_pam.budget import BudgetError, check_budget, limits
from noonchi_pam.contracts import ReflectRequest
from noonchi_pam.prompt import build_reflect_messages
from noonchi_pam.settings import Settings
from test_v2 import MEMORY


def reflect_messages(obs: str, actions: str):
    return build_reflect_messages(ReflectRequest(contract="pam-reflect/2", day="2026-11-07", memory_kind="fsm", memory=MEMORY,
                                                 observation_text=obs, action_summary=actions, feedback=None))["messages"]


def test_text_inside_reported_limit_fits_with_max_tokens():
    s = Settings.from_env({"INFERENCE_MODE": "live"})
    room = limits(s)["reflect_input_bytes"] - len(json.dumps(MEMORY, ensure_ascii=False, indent=2).encode("utf-8"))
    obs = ("가" * 30 + "\n") * (int(room * 0.7) // 91)       # 한 줄 91바이트
    actions = ("나" * 30 + "\n") * (int(room * 0.3) // 91)
    check_budget(reflect_messages(obs, actions), s.max_tokens["reflector"], s.max_model_len)


def test_text_past_limit_is_rejected():
    s = Settings.from_env({"INFERENCE_MODE": "live"})
    with pytest.raises(BudgetError):
        check_budget(reflect_messages("가" * 40_000, "나"), s.max_tokens["reflector"], s.max_model_len)


def test_limits_follow_max_model_len():
    small = limits(Settings.from_env({"INFERENCE_MODE": "live", "PAM_MAX_MODEL_LEN": "20000"}))
    big = limits(Settings.from_env({"INFERENCE_MODE": "live"}))
    assert small["max_model_len"] == 20000 and 0 < small["reflect_input_bytes"] < big["reflect_input_bytes"]
