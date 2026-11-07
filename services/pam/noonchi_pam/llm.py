"""OpenAI 호환 chat completions 한 번. 고치거나 다시 묻지 않는다. 잘린 답(finish_reason != stop)은 오류다.
요청 칸은 두 모드가 같다(model, messages, temperature, max_tokens, stream=false, 생각 켜기·끄기). 제공자 칸(extra)만 모드마다 다르다."""
from __future__ import annotations

import httpx

from .budget import check_budget
from .settings import Settings


class LlmError(RuntimeError):
    pass


class LlmClient:
    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None):
        self.s = settings
        self.http = httpx.Client(timeout=settings.timeout_s, transport=transport, follow_redirects=False)

    def _headers(self) -> dict:
        return {"authorization": f"Bearer {self.s.api_key}"} if self.s.api_key else {}

    def _thinking(self, on: bool) -> dict:
        return {"reasoning": {"enabled": on}} if self.s.thinking == "openrouter" else {"chat_template_kwargs": {"enable_thinking": on}}

    def body(self, messages: list[dict], generation: dict, role: str | None = None) -> dict:
        role = role or ("reflector" if generation["enable_thinking"] else "predictor")
        return {"model": self.s.model, "messages": messages, "temperature": generation["temperature"], "max_tokens": self.s.max_tokens[role],
                "stream": False, **self._thinking(generation["enable_thinking"]), **self.s.extra}

    def complete(self, messages: list[dict], generation: dict, role: str | None = None) -> str:
        body = self.body(messages, generation, role)
        check_budget(messages, body["max_tokens"], self.s.max_model_len)
        try:
            r = self.http.post(f"{self.s.base_url}/chat/completions", json=body, headers=self._headers())
        except httpx.HTTPError as e:
            raise LlmError(f"PAM LLM 연결 실패: {type(e).__name__}") from e
        if r.status_code != 200:
            raise LlmError(f"PAM LLM HTTP {r.status_code}")
        try:
            choice = r.json()["choices"][0]
            content = choice["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as e:
            raise LlmError("PAM LLM 답 모양이 chat completions가 아님") from e
        if choice.get("finish_reason") not in (None, "stop"):
            raise LlmError(f"PAM LLM 답이 끝나지 않음: {choice.get('finish_reason')}")
        if not isinstance(content, str):
            raise LlmError("PAM LLM 답에 글이 없음")
        return content

    def reachable(self) -> bool:
        try:
            return self.http.get(f"{self.s.base_url}/models", headers=self._headers(), timeout=2).status_code == 200
        except httpx.HTTPError:
            return False
