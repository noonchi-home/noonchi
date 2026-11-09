"""pam-predict/2·pam-reflect/2: 사진 칸이 없고, 논문 판단 규칙 문장은 그대로 두고 사진 자리에 관찰 텍스트를 넣는다."""
import json

import pytest
from pydantic import ValidationError

from noonchi_pam.contracts import PredictRequest, ReflectRequest
from noonchi_pam.prompt import build_predict_messages, build_reflect_messages, parse_memory

MEMORY = {"initial_state": "drinking", "states": [
    {"id": "drinking", "description": "마시는 중", "rules": [], "next": [{"to": "left_cup", "on": "컵을 두고 떠남"}]},
    {"id": "left_cup", "description": "컵을 두고 자리를 비움", "rules": [{"trigger": "빈 컵이 식탁에 남음", "action": "컵 치우기"}], "next": []},
]}
LIST_MEMORY = {"rules": [{"trigger": "빈 컵이 식탁에 남음", "action": "컵 치우기"}]}
PREDICT = {"contract": "pam-predict/2", "final_time": "2026-11-07T21:00:08.000+09:00",
           "observation_text": "21:00:00 사람 보임\n21:00:04 사람 안 보임", "memory_kind": "fsm", "memory": MEMORY,
           "tasks": ["컵 치우기", "사용자에게 물어보기"]}
REFLECT = {"contract": "pam-reflect/2", "day": "2026-11-07", "memory_kind": "fsm", "memory": MEMORY,
           "observation_text": "07:58:02 사람 보임", "action_summary": "08:10:40 컵 치우기 부탁", "feedback": "다 마신 뒤에만 치워 줘"}


def test_predict_request_has_no_image_field():
    with pytest.raises(ValidationError):
        PredictRequest(**{**PREDICT, "frames": [{"image": {"base64": "AAAA"}}]})
    with pytest.raises(ValidationError):
        PredictRequest(**{**PREDICT, "image": "data:image/jpeg;base64,AAAA"})
    with pytest.raises(ValidationError):
        PredictRequest(**{**PREDICT, "final_time": "2026-11-07T21:00:08"})  # 시간대 없음
    with pytest.raises(ValidationError):
        PredictRequest(**{**PREDICT, "contract": "pam-predict/1"})


def test_predict_messages_keep_rules_and_put_text_where_photos_were():
    built = build_predict_messages(PredictRequest(**PREDICT))
    system = built["messages"][0]["content"]
    user = built["messages"][1]["content"]
    assert "If the person is holding or touching an object, the robot cannot perform any" in system
    assert "action on that object until the person sets it down on the desk." in system  # 판단 규칙 문장은 그대로
    assert "camera frames" not in system and "back-facing cameras" not in system
    assert "a home with a dining table" in system and "personal desk" not in system
    assert "0: 컵 치우기\n1: 사용자에게 물어보기" in system
    assert json.dumps(MEMORY, ensure_ascii=False, indent=2) in system
    assert "{" + "window}" not in system and "{" + "fsm_block}" not in system
    assert all(part["type"] == "text" for part in user)
    assert user[0]["text"] == "Wall-clock time of the final observation: 2026-11-07T21:00:08+09:00"
    assert "21:00:04 사람 안 보임" in user[1]["text"]
    assert built["generation"] == {"temperature": 0.3, "enable_thinking": False}
    assert built["adaptation"]["applied_changes"]


def test_list_memory_uses_the_list_prompts():
    built = build_predict_messages(PredictRequest(**{**PREDICT, "memory_kind": "list", "memory": LIST_MEMORY}))
    system = built["messages"][0]["content"]
    assert "flat list of production rules" in system and json.dumps(LIST_MEMORY, ensure_ascii=False, indent=2) in system
    reflect = build_reflect_messages(ReflectRequest(**{**REFLECT, "memory_kind": "list", "memory": LIST_MEMORY}))
    assert "Today's video" not in reflect["messages"][0]["content"]


def test_reflect_messages_use_day_text_summary_and_feedback():
    built = build_reflect_messages(ReflectRequest(**REFLECT))
    system = built["messages"][0]["content"]
    text = "\n".join(p["text"] for p in built["messages"][1]["content"])
    assert "Today's video" not in system
    assert "07:58:02 사람 보임" in text and "Summary:\n08:10:40 컵 치우기 부탁" in text and "Human feedback:\n다 마신 뒤에만 치워 줘" in text
    assert built["generation"] == {"temperature": 0.3, "enable_thinking": True}
    no_feedback = build_reflect_messages(ReflectRequest(**{**REFLECT, "feedback": None}))
    assert "Human feedback" not in "\n".join(p["text"] for p in no_feedback["messages"][1]["content"])


def test_reflect_fields_have_size_caps():
    for field, size in (("observation_text", 100_001), ("action_summary", 50_001), ("feedback", 8_001)):
        with pytest.raises(ValidationError):
            ReflectRequest(**{**REFLECT, field: "가" * size})
    with pytest.raises(ValidationError):
        ReflectRequest(**{**REFLECT, "photos": []})


def test_parse_memory_is_strict():
    assert parse_memory(json.dumps(MEMORY), "fsm") == MEMORY
    for raw in ("```json\n{}\n```", '{"rules": [], "rules": []}', '{"rules": [{"trigger": "a", "action": NaN}]}', "[]"):
        with pytest.raises(ValueError):
            parse_memory(raw, "list")
