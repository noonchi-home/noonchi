// PAM LLM 전송: 모드는 주소·모델·키·제공자 칸만 바꾼다. 다시 묻지 않고(재시도 0), 넘겨주기(3xx)를 따라가지 않고, 키가 없으면 authorization을 보내지 않는다.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { PamLinkError, PamLlm, pamSettings } from "../src/brain/pam/index.js";
import { PAM_PRESETS } from "../src/infer/endpoints.js";
import { listenRetry } from "../src/shared/net.js";

const X = [{ role: "user" as const, content: [{ type: "text" as const, text: "x" }] }];
const OFF = { temperature: 0.3, enable_thinking: false };
const ON = { temperature: 0.3, enable_thinking: true };
const OK = { choices: [{ message: { content: "{}" }, finish_reason: "stop" }] };
function capture(reply: () => Response = () => Response.json(OK)) {
  const sent: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    sent.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
    return reply();
  }) as typeof fetch;
  return { sent, fetchImpl };
}
let close: (() => void) | undefined;
afterEach(() => { close?.(); close = undefined; });

describe("PAM LLM 전송", () => {
  it("mock 모드 표는 config/openrouter.json과 같다", () => {
    const t = JSON.parse(readFileSync("src/brain/pam/config/openrouter.json", "utf8"));
    expect(PAM_PRESETS.mock).toEqual({ baseUrl: t.endpoint.replace(/\/chat\/completions$/, ""), model: t.model, keyEnv: t.api_key_env, thinking: "openrouter",
      extraBody: { provider: t.provider, plugins: [{ id: "context-compression", enabled: false }] } });
    expect(pamSettings({}).maxTokens).toEqual(t.max_tokens);
    expect(pamSettings({}).timeoutMs).toBe(t.timeout_seconds * 1000);
  });

  it("두 모드가 같은 칸(model·messages·temperature·max_tokens·stream)을 보내고, 다른 것은 제공자 칸뿐이다", async () => {
    const c = capture();
    await new PamLlm(pamSettings({ OPENROUTER_API_KEY: "k" }), c).complete(X, OFF, "predictor", 5000);
    await new PamLlm(pamSettings({ INFERENCE_MODE: "live" }), c).complete(X, OFF, "predictor", 5000);
    const [mock, live] = c.sent;
    expect([mock!.url, mock!.auth]).toEqual(["https://openrouter.ai/api/v1/chat/completions", "Bearer k"]);
    expect([live!.url, live!.auth]).toEqual(["http://vllm-pam:8000/v1/chat/completions", null]);
    const shared = ["model", "messages", "temperature", "max_tokens", "stream"];
    expect(Object.keys(mock!.body).filter((k) => !shared.includes(k)).sort()).toEqual(["plugins", "provider", "reasoning"]);
    expect(Object.keys(live!.body).filter((k) => !shared.includes(k))).toEqual(["chat_template_kwargs"]);
    expect([mock!.body.max_tokens, live!.body.max_tokens, mock!.body.stream, live!.body.stream]).toEqual([2048, 2048, false, false]);
  });

  it("반성은 반성 max_tokens와 생각 켜기", async () => {
    const c = capture();
    await new PamLlm(pamSettings({ INFERENCE_MODE: "live" }), c).complete(X, ON, "reflector", 5000);
    expect(c.sent[0]!.body).toMatchObject({ max_tokens: 16384, chat_template_kwargs: { enable_thinking: true } });
  });

  it("openai 공급자는 max_completion_tokens·reasoning_effort, 생각을 켜면 temperature를 보내지 않는다", async () => {
    const c = capture();
    const llm = new PamLlm(pamSettings({ PAM_LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" }), c);
    await llm.complete(X, OFF, "predictor", 5000);
    await llm.complete(X, ON, "reflector", 5000);
    expect(c.sent.map((s) => s.body)).toEqual([
      { model: "gpt-5.4-mini", messages: X, max_completion_tokens: 2048, stream: false, reasoning_effort: "none", temperature: 0.3 },
      { model: "gpt-5.4-mini", messages: X, max_completion_tokens: 16384, stream: false, reasoning_effort: "medium" },
    ]);
  });

  it("모르는 공급자·live의 공급자·모르는 모드·작은 문맥 길이는 시작할 때 실패", () => {
    expect(() => pamSettings({ PAM_LLM_PROVIDER: "gemini" })).toThrow("PAM_LLM_PROVIDER=gemini: mock에서 openai만 됩니다");
    expect(() => pamSettings({ INFERENCE_MODE: "live", PAM_LLM_PROVIDER: "openai" })).toThrow(/PAM_LLM_PROVIDER/);
    expect(() => pamSettings({ INFERENCE_MODE: "replay" })).toThrow("mock 또는 live");
    expect(() => pamSettings({ INFERENCE_MODE: "live", PAM_MAX_MODEL_LEN: "16384" })).toThrow(/PAM_MAX_MODEL_LEN/);
  });

  it("HTTP 오류는 다시 보내지 않고 PamLinkError(한 번만 보냄)", async () => {
    for (const status of [500, 429]) {
      const c = capture(() => Response.json({ error: "x" }, { status }));
      await expect(new PamLlm(pamSettings({ INFERENCE_MODE: "live" }), c).complete(X, OFF, "predictor", 5000)).rejects.toThrow(`PAM LLM HTTP ${status}`);
      expect(c.sent).toHaveLength(1);
    }
  });

  it("넘겨주기(3xx)는 따라가지 않는다", async () => {
    let hits = 0;
    const srv = createServer((req, res) => { hits++; res.writeHead(302, { location: "/elsewhere" }); res.end(); });
    const { port } = await listenRetry(srv, 0, "127.0.0.1");
    close = () => srv.close();
    const s = pamSettings({ INFERENCE_MODE: "live", PAM_LLM_BASE_URL: `http://127.0.0.1:${port}/v1` });
    await expect(new PamLlm(s).complete(X, OFF, "predictor", 5000)).rejects.toThrow("PAM LLM HTTP 302");
    expect(hits).toBe(1);
  });

  it("응답 머리 뒤 본문이 멈춰도 제한 시간에 끊는다(전체 제한)", async () => {
    const srv = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"choices":[');
    });
    const { port } = await listenRetry(srv, 0, "127.0.0.1");
    close = () => { srv.closeAllConnections(); srv.close(); };
    const s = pamSettings({ INFERENCE_MODE: "live", PAM_LLM_BASE_URL: `http://127.0.0.1:${port}/v1` });
    const t0 = Date.now();
    await expect(new PamLlm(s).complete(X, OFF, "predictor", 300)).rejects.toBeInstanceOf(PamLinkError);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("닿지 않음·시간 초과는 PamLinkError", async () => {
    const down = pamSettings({ INFERENCE_MODE: "live", PAM_LLM_BASE_URL: "http://127.0.0.1:9/v1" });
    await expect(new PamLlm(down).complete(X, OFF, "predictor", 5000)).rejects.toBeInstanceOf(PamLinkError);
    const hang = ((_u: string | URL, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason)))) as typeof fetch;
    await expect(new PamLlm(pamSettings({ INFERENCE_MODE: "live" }), { fetchImpl: hang }).complete(X, OFF, "predictor", 200)).rejects.toBeInstanceOf(PamLinkError);
  });
});
