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
