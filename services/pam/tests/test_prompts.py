"""옮긴 논문 프롬프트가 해시 검사를 통과하고 논문 설정이 그대로인지 본다."""
from pathlib import Path

from pam.messages import PROJECT_ROOT, PROMPT_IDS, load_paper_config, load_prompt


def test_paper_prompts_load_with_hash_check():
    for prompt_id in PROMPT_IDS:
        text, source = load_prompt(prompt_id)
        assert text.strip()
        assert source["id"] == prompt_id


def test_paper_prompt_files_are_lf_only():
    files = sorted(Path(PROJECT_ROOT, "prompts", "paper").glob("*.txt"))
    assert files
    for path in files:
        assert b"\r" not in path.read_bytes(), f"{path.name}: CRLF가 들어 있다. .gitattributes의 services/pam 줄을 확인한다."


def test_root_gitattributes_pins_pam_line_endings():
    lines = Path(PROJECT_ROOT, "..", "..", ".gitattributes").read_text(encoding="utf-8").splitlines()
    assert "services/pam/** -text" in lines
    assert "services/pam/prompts/paper/*.txt text eol=lf" in lines


def test_paper_config_is_unchanged():
    config = load_paper_config()
    assert config["model"] == "Qwen3.5-27B"
    assert config["predictor"]["temperature"] == 0.3
    assert config["predictor"]["enable_thinking"] is False
    assert config["reflector"]["enable_thinking"] is True


def test_noonchi_predict_prompt_says_where_drinks_are_kept():
    """집 설명의 보관 자리 줄: 쓴 컵은 싱크대, 물·콜라는 냉장고(채워 주기 판단의 근거)."""
    from noonchi_pam.contracts import PredictRequest
    from noonchi_pam.prompt import build_predict_messages

    memory = {"initial_state": "s", "states": [{"id": "s", "description": "d", "rules": [], "next": []}]}
    built = build_predict_messages(PredictRequest(
        contract="pam-predict/2", final_time="2026-11-13T12:00:00+09:00", observation_text="12:00:00 사람 보임",
        memory_kind="fsm", memory=memory, tasks=["컵 치우기", "컵에 물 채워 주기"],
    ))
    system = built["messages"][0]["content"]
    line = ("- The designated storage area: the kitchen sink, where used cups, bottles and bowls are put. "
            "Drinks such as water and cola are kept in the fridge.")
    assert line in system
    assert "corner of the desk" not in system


def _reflect_system():
    from noonchi_pam.contracts import ReflectRequest
    from noonchi_pam.prompt import build_reflect_messages

    memory = {"initial_state": "s", "states": [{"id": "s", "description": "d", "rules": [], "next": []}]}
    built = build_reflect_messages(ReflectRequest(
        contract="pam-reflect/2", day="2026-11-13", memory_kind="fsm", memory=memory,
        observation_text="12:00:00 사람 보임", action_summary="행동 없음",
    ))
    return built["messages"][0]["content"], built["adaptation"]


def test_noonchi_reflect_prompt_learns_appliance_habits_and_writes_task_names():
    """반성 지시문: 집기·놓기 형식 대신 우리 행동 이름을 쓰고, 손으로 다룬 가전도 다시 적어 규칙을 만든다."""
    system, _ = _reflect_system()
    assert "Pick up <object>" not in system
    assert "RE-STATE the pick-and-place actions" not in system
    assert "appliance operations" in system
    assert "- action: exactly one of these task names, copied character for character: " in system
    assert "Never add, move, rewrite or remove rules for them." in system


def test_noonchi_predict_prompt_has_appliance_goal():
    """판단 지시문의 목표 줄에 손으로 다루던 가전을 켜 주는 일이 있다."""
    from noonchi_pam.contracts import PredictRequest
    from noonchi_pam.prompt import build_predict_messages

    memory = {"initial_state": "s", "states": [{"id": "s", "description": "d", "rules": [], "next": []}]}
    built = build_predict_messages(PredictRequest(
        contract="pam-predict/2", final_time="2026-11-13T12:00:00+09:00", observation_text="12:00:00 사람 보임",
        memory_kind="fsm", memory=memory, tasks=["컵 치우기", "에어컨 켜기"],
    ))
    system = built["messages"][0]["content"]
    assert ("- operating home appliances the person habitually operates by hand, such as turning on the living-room "
            "air conditioner when they sit down to watch TV.") in system
    assert "- etc. –- any helpful action that is grounded in observed behavior." in system


def test_noonchi_reflect_new_replacements_match_once_and_old_ones_still_match():
    """새 다섯은 목록 맨 앞이고 반성 지시문에서 한 번씩 맞는다. 옛 바꾸기는 지금처럼 맞는다."""
    from pam.messages import load_prompt
    from pam.scenarios import adapt_prompt
    from noonchi_pam.prompt import SCENARIO

    _, adaptation = _reflect_system()
    new = SCENARIO["prompt_replacements"][:5]
    applied = {c["old"]: c["occurrences"] for c in adaptation["applied_changes"]}
    for change in new:
        assert applied.get(change["old"]) == 1, change["reason"]
    template, _ = load_prompt("reflector_fsm_update")
    _, before = adapt_prompt(template, {**SCENARIO, "prompt_replacements": SCENARIO["prompt_replacements"][5:]})
    for change in before["applied_changes"]:
        assert change["old"] in applied, change["reason"]


REFERENCE = "Treat the memory as a REFERENCE, not as a strict matcher."
STRICT = "Fire a memory rule only when EVERY condition in its trigger holds in the latest observations"


def _noonchi_predict_system(kind):
    from noonchi_pam.contracts import PredictRequest
    from noonchi_pam.prompt import build_predict_messages

    memory = ({"initial_state": "s", "states": [{"id": "s", "description": "d", "rules": [], "next": []}]} if kind == "fsm"
              else {"rules": [{"trigger": "t", "action": "컵 치우기"}]})
    built = build_predict_messages(PredictRequest(
        contract="pam-predict/2", final_time="2026-11-16T05:56:43+09:00", observation_text="05:56:41 사람 앉아 있음",
        memory_kind=kind, memory=memory, tasks=["컵 치우기", "컵 그대로 두기"],
    ))
    return built["messages"][0]["content"]


def test_noonchi_predict_prompt_fires_a_rule_only_when_every_trigger_condition_holds():
    """노닌치 판단 지시문: 「기억은 참고일 뿐, 맞지 않아도 써도 된다」를 빼고 규칙 조건이 모두 맞을 때만 쓴다(2026-11-16 밤 판정 F·G·E:
    사람이 앉아 있는데 「자리를 비웠고」 규칙으로 치우기·묻기, TV가 없는데 「TV를 보는 중」 규칙으로 콜라)."""
    for kind in ("fsm", "list"):
        system = _noonchi_predict_system(kind)
        assert REFERENCE not in system, kind
        assert "you may fire it even when the trigger phrasing" not in system, kind
        assert STRICT in system, kind
        assert "a rule whose trigger says the user left does not fire while the person is visible" in system, kind
        assert "(짐작)" in system, kind


def test_paper_predictor_prompts_keep_the_reference_clause(tmp_path):
    """논문 재현 경로(시나리오 없이 논문 프롬프트로 만드는 판단 메시지)는 원본 그대로다: 노닌치 시나리오만 그 문장을 바꾼다."""
    from pam.messages import build_predictor_messages

    frames = []
    for i in range(5):
        p = tmp_path / f"f{i}.png"
        p.write_bytes(b"png")
        frames.append({"timestamp": f"2026-11-16T05:56:{30 + 2 * i:02d}+09:00", "image_path": str(p)})
    fsm = {"initial_state": "s", "states": [{"id": "s", "description": "d", "rules": [], "next": []}]}
    for kind, memory in (("fsm", fsm), ("list", {"rules": [{"trigger": "t", "action": "a"}]})):
        system = build_predictor_messages(frames, ["a", "b"], memory_kind=kind, memory=memory)["messages"][0]["content"]
        assert REFERENCE in system, kind
        assert STRICT not in system, kind
