"""저장소의 가짜 OpenAI 호환 서버(scripts/fake-openai.ts)를 띄운다. 실제 API를 부르지 않는다."""
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="session")
def fake_openai():
    node = shutil.which("node") or "node"
    proc = subprocess.Popen([node, "--import", "tsx", str(REPO / "scripts" / "fake-openai.ts"), "--port", "0"],
                            cwd=REPO, stdout=subprocess.PIPE, text=True)
    try:
        line = proc.stdout.readline().strip()
        assert line.startswith("listening "), line
        yield f"http://127.0.0.1:{line.split()[1]}/v1"
    finally:
        proc.terminate()
        proc.wait(10)
