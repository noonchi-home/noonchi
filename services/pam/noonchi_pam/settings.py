"""PAM LLM 주소: INFERENCE_MODE(mock|live)가 미리 정한 주소·모델 이름만 고른다. PAM_LLM_BASE_URL·PAM_LLM_MODEL·PAM_LLM_API_KEY가 있으면 그 값을 쓴다.
mock은 PAM_LLM_PROVIDER=openai면 OpenRouter 대신 OpenAI(gpt-5.4-mini, OPENAI_API_KEY)를 부른다.
전송 값(max_tokens·시간 제한·OpenRouter provider)은 config/openrouter.json에서 읽는다.
문맥 길이 PAM_MAX_MODEL_LEN(기본 32768)은 compose vllm-pam의 --max-model-len과 같은 값이다. live 모델 이름 pam은 vllm-pam의 --served-model-name이다."""
from __future__ import annotations

import json
from dataclasses import dataclass, field

from pam.messages import PROJECT_ROOT

TRANSPORT = json.loads((PROJECT_ROOT / "config" / "openrouter.json").read_text(encoding="utf-8"))
NO_COMPRESSION = [{"id": "context-compression", "enabled": False}]

PRESETS = {
    "mock": {"base_url": TRANSPORT["endpoint"].removesuffix("/chat/completions"), "model": TRANSPORT["model"], "key_env": TRANSPORT["api_key_env"],
             "thinking": "openrouter", "extra": {"provider": TRANSPORT["provider"], "plugins": NO_COMPRESSION}},
    "live": {"base_url": "http://vllm-pam:8000/v1", "model": "pam", "key_env": "VLLM_API_KEY", "thinking": "chat_template", "extra": {}},
}
# mock에서 OpenRouter 대신 쓰는 제공자(PAM_LLM_PROVIDER). VLM과 같은 OpenAI 모델·키를 쓴다.
PROVIDERS = {
    "openai": {"base_url": "https://api.openai.com/v1", "model": "gpt-5.4-mini", "key_env": "OPENAI_API_KEY", "thinking": "openai", "extra": {}},
}


@dataclass(frozen=True)
class Settings:
    mode: str
    base_url: str
    model: str
    api_key: str
    thinking: str
    extra: dict = field(default_factory=dict)
    timeout_s: float = 120.0
    max_tokens: dict = field(default_factory=dict)
    max_model_len: int = 32768

    @staticmethod
    def from_env(env) -> "Settings":
        mode = (env.get("INFERENCE_MODE") or "mock").strip()
        if mode not in PRESETS:
            raise ValueError(f"INFERENCE_MODE={mode}: mock 또는 live여야 합니다")
        p = PRESETS[mode]

        def get(k: str) -> str | None:
            return (env.get(k) or "").strip() or None

        provider = get("PAM_LLM_PROVIDER")
        if provider:
            if mode != "mock" or provider not in PROVIDERS:
                raise ValueError(f"PAM_LLM_PROVIDER={provider}: mock에서 {', '.join(PROVIDERS)}만 됩니다")
            p = PROVIDERS[provider]

        max_model_len = int(get("PAM_MAX_MODEL_LEN") or 32768)
        max_tokens = dict(TRANSPORT["max_tokens"])
        if max_model_len <= max(max_tokens.values()):
            raise ValueError(f"PAM_MAX_MODEL_LEN={max_model_len}: 반성 출력 {max_tokens['reflector']}보다 커야 합니다")
        return Settings(
            mode=mode,
            base_url=(get("PAM_LLM_BASE_URL") or p["base_url"]).rstrip("/"),
            model=get("PAM_LLM_MODEL") or p["model"],
            api_key=get("PAM_LLM_API_KEY") or get(p["key_env"]) or "",
            thinking=p["thinking"], extra=json.loads(json.dumps(p["extra"])),
            timeout_s=float(get("PAM_LLM_TIMEOUT_S") or TRANSPORT["timeout_seconds"]),
            max_tokens=max_tokens,
            max_model_len=max_model_len,
        )
