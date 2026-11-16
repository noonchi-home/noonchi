"""저장소의 가짜 OpenAI 호환 서버(scripts/fake-openai.ts)를 띄운다. 실제 API를 부르지 않는다.

이 PC(Windows)는 127.0.0.1 소켓을 열거나 붙을 때 가끔 WinError 10014(EFAULT)로 실패한다(src/shared/net.ts와 같은 문제).
시험에서만 socketpair(asyncio 이벤트 루프·TestClient)와 create_connection(httpx)을 그 오류일 때만 다시 시도한다."""
import functools
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
EFAULT = 10014


def _retry_efault(fn, attempts: int = 6):
    @functools.wraps(fn)
    def wrapped(*args, **kwargs):
        for attempt in range(1, attempts + 1):
            try:
                return fn(*args, **kwargs)
            except OSError as e:
                if getattr(e, "winerror", None) != EFAULT or attempt == attempts:
                    raise
                time.sleep(0.05 * attempt)
    return wrapped


if sys.platform == "win32":
    socket.socketpair = _retry_efault(socket.socketpair)
    socket.create_connection = _retry_efault(socket.create_connection)


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
