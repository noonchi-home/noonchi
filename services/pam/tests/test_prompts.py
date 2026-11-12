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
