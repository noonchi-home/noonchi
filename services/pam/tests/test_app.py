"""PAM 서비스 HTTP: /predict·/reflect·/health. LLM은 가짜 OpenAI 호환 서버나 httpx 시험 전송으로 받는다."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from noonchi_pam.app import create_app
from noonchi_pam.llm import LlmClient
from noonchi_pam.settings import Settings
from test_v2 import MEMORY, PREDICT, REFLECT

DOWN = {"INFERENCE_MODE": "live", "PAM_LLM_BASE_URL": "http://127.0.0.1:9/v1"}


def client_for(base_url):
    return TestClient(create_app(Settings.from_env({"INFERENCE_MODE": "live", "PAM_LLM_BASE_URL": base_url, "PAM_LLM_MODEL": "q"})))


def recording_client(reply: dict, status: int = 200):
    sent = []

    def handler(req):
        sent.append((req.method, req.url.path, json.loads(req.content) if req.content else None))
        return httpx.Response(status, json=reply)
    s = Settings.from_env({"INFERENCE_MODE": "live"})
    return TestClient(create_app(s, LlmClient(s, transport=httpx.MockTransport(handler)))), sent


def test_predict_returns_parse_prediction_shape(fake_openai):
    r = client_for(fake_openai).post("/predict", json=PREDICT)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "valid" and body["prediction"]["task_index"] == -1 and body["selected_action"] is None


def test_predict_rejects_image_fields(fake_openai):
    c = client_for(fake_openai)
    assert c.post("/predict", json={**PREDICT, "frames": [{"image": {"base64": "AAAA"}}]}).status_code == 400
    assert c.post("/predict", json={**PREDICT, "image_url": "data:image/jpeg;base64,AAAA"}).status_code == 400


def test_predict_rejects_bad_memory_before_calling():
    c, sent = recording_client({})
    r = c.post("/predict", json={**PREDICT, "memory": {"initial_state": "x", "states": []}})
    assert r.status_code == 400 and sent == []


def test_invalid_model_answer_is_kept_distinct_from_wait():
    c, _ = recording_client({"choices": [{"message": {"content": "```json\n{}\n```"}, "finish_reason": "stop"}]})
    body = c.post("/predict", json=PREDICT).json()
    assert body["status"] == "invalid" and body["prediction"] is None and body["errors"]


def test_truncated_or_failed_llm_is_502():
    c, _ = recording_client({"choices": [{"message": {"content": "{"}, "finish_reason": "length"}]})
    assert c.post("/predict", json=PREDICT).status_code == 502
    c, _ = recording_client({"error": "x"}, status=500)
    assert c.post("/predict", json=PREDICT).status_code == 502
    c, _ = recording_client({"unexpected": True})
    assert c.post("/predict", json=PREDICT).status_code == 502
    assert TestClient(create_app(Settings.from_env(DOWN))).post("/predict", json=PREDICT).status_code == 502


def test_reflect_returns_updated_memory(fake_openai):
    r = client_for(fake_openai).post("/reflect", json={**REFLECT, "feedback": None})
    assert r.status_code == 200 and r.json()["memory"] == MEMORY and r.json()["status"] == "valid"


def test_health_reports_llm_and_limits(fake_openai):
    body = client_for(fake_openai).get("/health").json()
    assert body["ok"] is True
    assert body["llm"] == {"base_url": fake_openai, "model": "q", "reachable": True}
    assert body["limits"]["max_model_len"] == 32768
    assert body["limits"]["reflect_input_bytes"] > 0 and body["limits"]["predict_input_bytes"] > 0


def test_health_answers_when_llm_is_down():
    body = TestClient(create_app(Settings.from_env(DOWN))).get("/health").json()
    assert body["ok"] is True and body["llm"]["reachable"] is False


def test_reflect_over_context_is_413_and_not_sent():
    c, sent = recording_client({})
    r = c.post("/reflect", json={**REFLECT, "observation_text": "가" * 90_000, "feedback": None})
    assert r.status_code == 413 and "문맥 길이" in r.json()["error"]
    assert sent == []


def test_presets_pick_addresses_only():
    mock = Settings.from_env({"OPENROUTER_API_KEY": "k"})
    assert (mock.mode, mock.base_url, mock.model, mock.thinking, mock.api_key) == ("mock", "https://openrouter.ai/api/v1", "qwen/qwen3.5-27b", "openrouter", "k")
    assert mock.extra == {"provider": {"order": ["alibaba"], "allow_fallbacks": False, "require_parameters": True},
                          "plugins": [{"id": "context-compression", "enabled": False}]}
    assert (mock.max_tokens, mock.timeout_s, mock.max_model_len) == ({"predictor": 2048, "reflector": 16384}, 120.0, 32768)
    live = Settings.from_env({"INFERENCE_MODE": "live"})
    assert (live.base_url, live.model, live.thinking, live.extra) == ("http://vllm-pam:8000/v1", "pam", "chat_template", {})
    assert (live.max_tokens, live.max_model_len) == (mock.max_tokens, mock.max_model_len)
    assert Settings.from_env({"INFERENCE_MODE": "live", "PAM_MAX_MODEL_LEN": "24576"}).max_model_len == 24576
    with pytest.raises(ValueError, match="PAM_MAX_MODEL_LEN"):
        Settings.from_env({"INFERENCE_MODE": "live", "PAM_MAX_MODEL_LEN": "16384"})


def test_openai_provider_sends_openai_fields():
    s = Settings.from_env({"PAM_LLM_PROVIDER": "openai", "OPENAI_API_KEY": "k"})
    assert (s.mode, s.base_url, s.model, s.thinking, s.extra, s.api_key) == ("mock", "https://api.openai.com/v1", "gpt-5.4-mini", "openai", {}, "k")
    sent = []

    def handler(req):
        sent.append(json.loads(req.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]})
    client = LlmClient(s, transport=httpx.MockTransport(handler))
    client.complete([{"role": "user", "content": "x"}], {"temperature": 0.3, "enable_thinking": False})
    client.complete([{"role": "user", "content": "x"}], {"temperature": 0.3, "enable_thinking": True})
    predictor, reflector = sent
    # OpenAI는 max_tokens 대신 max_completion_tokens, 생각은 reasoning_effort다. 생각을 켜면 temperature는 기본값만 받는다.
    assert predictor == {"model": "gpt-5.4-mini", "messages": [{"role": "user", "content": "x"}], "max_completion_tokens": 2048,
                         "stream": False, "reasoning_effort": "none", "temperature": 0.3}
    assert reflector == {"model": "gpt-5.4-mini", "messages": [{"role": "user", "content": "x"}], "max_completion_tokens": 16384,
                         "stream": False, "reasoning_effort": "medium"}


def test_unknown_provider_is_rejected():
    with pytest.raises(ValueError, match="PAM_LLM_PROVIDER"):
        Settings.from_env({"PAM_LLM_PROVIDER": "gemini"})
    with pytest.raises(ValueError, match="PAM_LLM_PROVIDER"):
        Settings.from_env({"INFERENCE_MODE": "live", "PAM_LLM_PROVIDER": "openai"})


def test_unknown_mode_is_rejected():
    with pytest.raises(ValueError, match="mock 또는 live"):
        Settings.from_env({"INFERENCE_MODE": "replay"})


def test_request_body_same_fields_in_both_modes():
    sent = []

    def handler(req):
        sent.append((str(req.url), req.headers.get("authorization"), json.loads(req.content)))
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]})
    for env in ({"OPENROUTER_API_KEY": "k"}, {"INFERENCE_MODE": "live"}):
        LlmClient(Settings.from_env(env), transport=httpx.MockTransport(handler)).complete(
            [{"role": "user", "content": "x"}], {"temperature": 0.3, "enable_thinking": False})
    (mock_url, mock_auth, mock), (live_url, live_auth, live) = sent
    assert (mock_url, mock_auth) == ("https://openrouter.ai/api/v1/chat/completions", "Bearer k")
    assert (live_url, live_auth) == ("http://vllm-pam:8000/v1/chat/completions", None)
    assert mock["stream"] is False and live["stream"] is False
    assert mock["max_tokens"] == live["max_tokens"] == 2048
    assert mock["plugins"] == [{"id": "context-compression", "enabled": False}] and mock["reasoning"] == {"enabled": False}
    assert live["chat_template_kwargs"] == {"enable_thinking": False} and "plugins" not in live
    shared = {"model", "messages", "temperature", "max_tokens", "stream"}
    assert shared <= set(mock) and shared <= set(live)
    assert set(mock) - shared == {"reasoning", "provider", "plugins"} and set(live) - shared == {"chat_template_kwargs"}


def test_reflector_role_uses_reflector_max_tokens():
    sent = []

    def handler(req):
        sent.append(json.loads(req.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]})
    LlmClient(Settings.from_env({"INFERENCE_MODE": "live"}), transport=httpx.MockTransport(handler)).complete(
        [{"role": "user", "content": "x"}], {"temperature": 0.3, "enable_thinking": True}, role="reflector")
    assert sent[0]["max_tokens"] == 16384 and sent[0]["chat_template_kwargs"] == {"enable_thinking": True}
