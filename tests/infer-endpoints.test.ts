// 추론 모드(src/infer/endpoints.ts): openai·vllm은 VLM·PAM LLM 주소·모델 이름·키 자리·제공자 칸만 고른다. 코드 경로는 같다.
import { describe, expect, it } from "vitest";
import { loadEndpoints, VLM_PRESETS, vlmTimeoutMs } from "../src/infer/endpoints.js";
import { createInference } from "../src/infer/inference.js";
import { ReachCache, reachable } from "../src/infer/reach.js";

describe("추론 모드", () => {
  it("openai가 기본이고 OpenAI 주소·모델을 고른다", () => {
    const e = loadEndpoints({ OPENAI_API_KEY: "k" });
    expect(e.mode).toBe("openai");
    expect(e.vlm).toMatchObject({ baseUrl: VLM_PRESETS.openai.baseUrl, model: VLM_PRESETS.openai.model, apiKey: "k" });
  });
  it("vllm은 같은 서버 vLLM 주소와 vLLM이 내건 이름 vlm을 고른다", () => {
    expect(loadEndpoints({ INFERENCE_MODE: "vllm" }).vlm).toMatchObject({ baseUrl: "http://vllm-vlm:8000/v1", model: "vlm" });
  });
  it("두 모드는 같은 모양이고 주소·모델 이름·키 자리·요청 칸만 다르다", () => {
    expect(Object.keys(VLM_PRESETS.openai).sort()).toEqual(Object.keys(VLM_PRESETS.vllm).sort());
    const [m, l] = [loadEndpoints({}), loadEndpoints({ INFERENCE_MODE: "vllm" })];
    expect(Object.keys(m).sort()).toEqual(Object.keys(l).sort());
    expect(Object.keys(m.vlm).sort()).toEqual(Object.keys(l.vlm).sort());
  });
  it("PAM LLM: 따로 준 주소·모델·키가 앞서고 끝 /를 지운다. 키는 PAM_LLM_API_KEY → 모드 키 → 빈 글", () => {
    const e = loadEndpoints({ INFERENCE_MODE: "vllm", PAM_LLM_BASE_URL: "http://x:1/v1//", PAM_LLM_MODEL: "m", VLLM_API_KEY: "v" });
    expect(e.pam).toMatchObject({ baseUrl: "http://x:1/v1", model: "m", apiKey: "v", thinking: "chat_template" });
    expect(loadEndpoints({ INFERENCE_MODE: "vllm", PAM_LLM_API_KEY: "a", VLLM_API_KEY: "v" }).pam.apiKey).toBe("a");
    expect(loadEndpoints({}).pam).toMatchObject({ baseUrl: "https://api.openai.com/v1", model: "gpt-5.4-mini", apiKey: "", thinking: "openai" });
    expect(loadEndpoints({ OPENAI_API_KEY: "k" }).pam).toMatchObject({ baseUrl: "https://api.openai.com/v1", model: "gpt-5.4-mini", apiKey: "k", thinking: "openai" });
  });
  it("따로 준 VLM 주소·모델이 앞선다", () => {
    const e = loadEndpoints({ INFERENCE_MODE: "vllm", VLM_BASE_URL: "http://127.0.0.1:8500/v1/", VLM_MODEL: "m" });
    expect(e.vlm.baseUrl).toBe("http://127.0.0.1:8500/v1");
    expect(e.vlm.model).toBe("m");
  });
  it("VLM_CLOSER_MODEL은 가까이 보기 VLM 모델 이름만 바꾼다. 비우면 VLM 모델과 같고, 주소·키·요청 칸은 같다", () => {
    expect(loadEndpoints({}).vlm.closerModel).toBe(VLM_PRESETS.openai.model);
    expect(loadEndpoints({ INFERENCE_MODE: "vllm" }).vlm.closerModel).toBe("vlm");
    expect(loadEndpoints({ VLM_MODEL: "gpt-5.4-nano", VLM_CLOSER_MODEL: " " }).vlm.closerModel).toBe("gpt-5.4-nano");
    expect(loadEndpoints({ VLM_MODEL: "gpt-5.4-nano", VLM_CLOSER_MODEL: "gpt-5.4-mini" }).vlm).toMatchObject({ model: "gpt-5.4-nano", closerModel: "gpt-5.4-mini" });
    const { vlm, closerVlm } = createInference({ VLM_MODEL: "gpt-5.4-nano", VLM_CLOSER_MODEL: "gpt-5.4-mini" });
    expect([vlm.model, closerVlm.model]).toEqual(["gpt-5.4-nano", "gpt-5.4-mini"]);
    const same = createInference({ VLM_MODEL: "gpt-5.4-nano" });
    expect(same.closerVlm.model).toBe("gpt-5.4-nano");
  });
  it("생각 말풍선 모델은 없다: 메시지 상자 문장은 모델 없이 만든다(THOUGHT_MODEL을 줘도 쓰지 않는다)", () => {
    expect(loadEndpoints({ THOUGHT_MODEL: "small" }).vlm).not.toHaveProperty("thoughtModel");
    expect(createInference({ THOUGHT_MODEL: "small" })).not.toHaveProperty("thought");
  });
  it("VLM_EXTRA_BODY는 JSON으로 읽고, 깨진 JSON은 시작을 막는다", () => {
    expect(loadEndpoints({ VLM_EXTRA_BODY: '{"temperature":0}' }).vlm.extraBody).toEqual({ temperature: 0 });
    expect(() => loadEndpoints({ VLM_EXTRA_BODY: "{" })).toThrow(/VLM_EXTRA_BODY/);
  });
  it("모르는 모드는 시작을 막는다", () => {
    expect(() => loadEndpoints({ INFERENCE_MODE: "replay" })).toThrow(/openai 또는 vllm/);
    expect(() => loadEndpoints({ INFERENCE_MODE: "live" })).toThrow("(예전 이름 live → vllm)");
  });
  it("옛 이름 mock은 openai로 읽고 경고 한 줄을 남긴다(지금 .env들이 mock이다). 새 이름이면 경고가 없다", () => {
    const e = loadEndpoints({ INFERENCE_MODE: "mock" });
    expect(e.mode).toBe("openai");
    expect(e.vlm).toEqual(loadEndpoints({ INFERENCE_MODE: "openai" }).vlm);
    expect(e.warnings).toEqual(["[경고] INFERENCE_MODE=mock은 openai로 읽어요"]);
    expect(loadEndpoints({ INFERENCE_MODE: "openai" }).warnings).toEqual([]);
    expect(loadEndpoints({}).warnings).toEqual([]);
  });
});

describe("VLM 제한 시간", () => {
  it("기본 20초, 1초 이상 숫자만 받는다", () => {
    expect(vlmTimeoutMs({})).toBe(20_000);
    expect(vlmTimeoutMs({ VLM_TIMEOUT_MS: "5000" })).toBe(5000);
    expect(vlmTimeoutMs({ VLM_TIMEOUT_MS: "10" })).toBe(20_000);
    expect(vlmTimeoutMs({ VLM_TIMEOUT_MS: "x" })).toBe(20_000);
  });
});

describe("주소 응답 확인", () => {
  it("ReachCache는 ttl 동안 다시 묻지 않고, 지나면 다시 묻는다", async () => {
    let t = 0;
    let calls = 0;
    const cache = new ReachCache(1000, () => t);
    const probe = async () => { calls++; return true; };
    expect(await cache.check("a", probe)).toBe(true);
    t = 999;
    await cache.check("a", probe);
    expect(calls).toBe(1);
    t = 1000;
    await cache.check("a", probe);
    expect(calls).toBe(2);
  });
  it("reachable은 2xx면 true, 그 밖이나 연결 실패면 false다", async () => {
    const ok = (status: number) => (async () => new Response("", { status })) as unknown as typeof fetch;
    expect(await reachable("http://127.0.0.1:9/v1/models", { fetchImpl: ok(200) })).toBe(true);
    expect(await reachable("http://127.0.0.1:9/v1/models", { fetchImpl: ok(401) })).toBe(false);
    expect(await reachable("http://127.0.0.1:9/v1/models", { fetchImpl: (async () => { throw new Error("refused"); }) as unknown as typeof fetch })).toBe(false);
  });
});
