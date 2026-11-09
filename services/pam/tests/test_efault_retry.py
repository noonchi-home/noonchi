"""시험용 EFAULT 다시 시도(conftest): WinError 10014일 때만 다시 하고 다른 오류는 바로 던진다."""
import pytest

from conftest import EFAULT, _retry_efault


def _flaky(errors: list[OSError]):
    calls = []

    def fn():
        calls.append(1)
        if errors:
            raise errors.pop(0)
        return "ok"
    return fn, calls


def efault() -> OSError:
    e = OSError("bad address")
    e.winerror = EFAULT
    return e


def test_retries_only_efault():
    fn, calls = _flaky([efault(), efault()])
    assert _retry_efault(fn)() == "ok" and len(calls) == 3
    fn, calls = _flaky([ConnectionRefusedError("refused")])
    with pytest.raises(ConnectionRefusedError):
        _retry_efault(fn)()
    assert len(calls) == 1


def test_gives_up_after_attempts():
    fn, calls = _flaky([efault() for _ in range(5)])
    with pytest.raises(OSError):
        _retry_efault(fn, attempts=3)()
    assert len(calls) == 3
