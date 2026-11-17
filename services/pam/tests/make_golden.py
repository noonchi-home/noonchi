"""옮기기 전 Python PAM의 정답 파일(tests/fixtures/pam-golden/out)을 만든다. 한 번만 돌린다. 실제 모델은 부르지 않는다(httpx MockTransport)."""
import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import conftest  # noqa: E402,F401  이 PC(Windows)의 127.0.0.1 소켓 EFAULT(WinError 10014) 다시 시도를 시험과 같게 건다

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from noonchi_pam.app import create_app  # noqa: E402
from noonchi_pam.budget import estimate_tokens, limits  # noqa: E402
from noonchi_pam.contracts import PredictRequest, ReflectRequest  # noqa: E402
from noonchi_pam.llm import LlmClient  # noqa: E402
from noonchi_pam.prompt import _adapted, build_predict_messages, build_reflect_messages, parse_memory  # noqa: E402
from noonchi_pam.settings import Settings  # noqa: E402
from pam.contracts import _reject_constant, _unique_object, parse_prediction  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
DIR = REPO / "tests" / "fixtures" / "pam-golden"
OUT = DIR / "out"
JSON_ERR = "<json>"
TRANSPORTS = {"mock": {"OPENROUTER_API_KEY": "k"}, "live": {"INFERENCE_MODE": "live"},
              "openai": {"PAM_LLM_PROVIDER": "openai", "OPENAI_API_KEY": "k"}}
OK_REPLY = {"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]}


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")


def dump(path: Path, value, ascii: bool = False) -> None:
    """메시지 파일은 글자 그대로(TS toMatchFileSnapshot과 바이트 비교). 검사 결과(parse·memory)는 단독 대리 문자(\\ud800)가 들어
    UTF-8로 쓸 수 없으므로 ascii=True로 이스케이프한다(TS는 JSON.parse한 값으로 비교한다)."""
    write(path, json.dumps(value, ensure_ascii=ascii, indent=2) + "\n")


def wire(env: dict, built: dict, role: str) -> str:
    sent = []

    def handler(req):
        sent.append(f"POST {req.url}\nauthorization: {req.headers.get('authorization', '-')}\n\n{req.content.decode('utf-8')}")
        return httpx.Response(200, json=OK_REPLY)
    LlmClient(Settings.from_env(env), transport=httpx.MockTransport(handler)).complete(built["messages"], built["generation"], role=role)
    return sent[0]


def messages(cases, build, model, role, tokens):
    for case in cases:
        built = build(model(**case["request"]))
        dump(OUT / f"{case['id']}.messages.json", {"messages": built["messages"], "generation": built["generation"]})
        write(OUT / f"{case['id']}.wire.txt", "".join(f"=== {t} ===\n{wire(env, built, role)}\n" for t, env in TRANSPORTS.items()))
        tokens[case["id"]] = estimate_tokens(built["messages"])


def is_json_error(raw: str) -> bool:
    try:
        json.loads(raw, object_pairs_hook=_unique_object, parse_constant=_reject_constant)
    except json.JSONDecodeError:
        return True
    except Exception:
        return False
    return False


def main() -> None:
    inputs = json.loads((DIR / "inputs.json").read_text(encoding="utf-8"))
    OUT.mkdir(exist_ok=True)
    tokens: dict = {}
    messages(inputs["predict"], build_predict_messages, PredictRequest, "predictor", tokens)
    messages(inputs["reflect"], build_reflect_messages, ReflectRequest, "reflector", tokens)
    dump(OUT / "tokens.json", tokens)

    adaptation = {}
    for pid in ("predictor_fsm", "predictor_list", "reflector_fsm_update", "reflector_list_update"):
        a = _adapted(pid)[1]
        adaptation[pid] = {"applied": [{k: c[k] for k in ("old", "new", "reason", "occurrences")} for c in a["applied_changes"]],
                           "adapted_template_sha256": a["adapted_template_sha256"]}
    dump(OUT / "adaptation.json", adaptation)

    parse = []
    for c in inputs["parse"]:
        r = parse_prediction(c["raw"], c["tasks"])
        if is_json_error(c["raw"]):
            r["errors"] = [JSON_ERR]
        parse.append({"id": c["id"], "result": r})
    dump(OUT / "parse.json", parse, ascii=True)

    memory = []
    for c in inputs["memory"]:
        try:
            memory.append({"id": c["id"], "ok": True, "memory": parse_memory(c["raw"], c["kind"])})
        except ValueError as e:
            decode = isinstance(e, json.JSONDecodeError) or isinstance(e.__cause__, json.JSONDecodeError)
            memory.append({"id": c["id"], "ok": False, "error": JSON_ERR if decode else str(e)})
    dump(OUT / "memory.json", memory, ascii=True)

    requests = []
    for c in inputs["requests"]:
        sent = []

        def handler(req, c=c):
            sent.append(1)
            return httpx.Response(c["llm"]["status"], json=c["llm"]["json"])
        s = Settings.from_env({"INFERENCE_MODE": "live"})
        r = TestClient(create_app(s, LlmClient(s, transport=httpx.MockTransport(handler)))).post(f"/{c['route']}", json=c["body"])
        requests.append({"id": c["id"], "status": r.status_code,
                         "answer": r.json()["status"] if r.status_code == 200 else None, "sent": len(sent)})
    dump(OUT / "requests.json", requests)

    dump(OUT / "limits.json", [{"env": env, "limits": limits(Settings.from_env(env))} for env in inputs["limits"]])

    settings = []
    for c in inputs["settings"]:
        try:
            settings.append({"id": c["id"], "settings": asdict(Settings.from_env(c["env"]))})
        except ValueError as e:
            settings.append({"id": c["id"], "error": str(e)})
    dump(OUT / "settings.json", settings)


if __name__ == "__main__":
    main()
