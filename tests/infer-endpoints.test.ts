// 추론 모드(src/infer/endpoints.ts): mock·live는 VLM 주소·모델 이름만 고른다. 코드 경로는 같다.
import { describe, expect, it } from "vitest";
import { loadEndpoints, VLM_PRESETS, vlmTimeoutMs } from "../src/infer/endpoints.js";
import { ReachCache, reachable } from "../src/infer/reach.js";

describe("추론 모드", () => {
  it("mock이 기본이고 OpenAI 주소·모델을 고른다", () => {
    const e = loadEndpoints({ OPENAI_API_KEY: "k" });
    expect(e.mode).toBe("mock");
    expect(e.vlm).toMatchObject({ baseUrl: VLM_PRESETS.mock.baseUrl, model: VLM_PRESETS.mock.model, apiKey: "k" });
  });
  it("live는 같은 서버 vLLM 주소와 vLLM이 내건 이름 vlm을 고른다", () => {
    expect(loadEndpoints({ INFERENCE_MODE: "live" }).vlm).toMatchObject({ baseUrl: "http://vllm-vlm:8000/v1", model: "vlm" });
  });
  it("두 모드는 같은 모양이고 주소·모델 이름·키 자리·요청 칸만 다르다", () => {
    expect(Object.keys(VLM_PRESETS.mock).sort()).toEqual(Object.keys(VLM_PRESETS.live).sort());
    const [m, l] = [loadEndpoints({}), loadEndpoints({ INFERENCE_MODE: "live" })];
    expect(Object.keys(m).sort()).toEqual(Object.keys(l).sort());
    expect(Object.keys(m.vlm).sort()).toEqual(Object.keys(l.vlm).sort());
  });
  it("따로 준 주소·모델·PAM_URL이 앞선다", () => {
    const e = loadEndpoints({ INFERENCE_MODE: "live", VLM_BASE_URL: "http://127.0.0.1:8500/v1/", VLM_MODEL: "m", PAM_URL: "http://pam:8300/" });
    expect(e.vlm.baseUrl).toBe("http://127.0.0.1:8500/v1");
    expect(e.vlm.model).toBe("m");
    expect(e.pamUrl).toBe("http://pam:8300");
  });
  it("PAM_URL이 없으면 이 PC의 PAM 서비스 주소", () => {
    expect(loadEndpoints({}).pamUrl).toBe("http://127.0.0.1:8300");
  });
  it("VLM_EXTRA_BODY는 JSON으로 읽고, 깨진 JSON은 시작을 막는다", () => {
    expect(loadEndpoints({ VLM_EXTRA_BODY: '{"temperature":0}' }).vlm.extraBody).toEqual({ temperature: 0 });
    expect(() => loadEndpoints({ VLM_EXTRA_BODY: "{" })).toThrow(/VLM_EXTRA_BODY/);
  });
  it("모르는 모드는 시작을 막는다", () => {
    expect(() => loadEndpoints({ INFERENCE_MODE: "replay" })).toThrow(/mock 또는 live/);
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
