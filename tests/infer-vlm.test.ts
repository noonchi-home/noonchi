// VLM 어댑터: OpenAI 호환 chat completions 하나로 사진과 JSON Schema를 보내고 답을 검사한다. 모델 자리는 가짜 서버나 fetch 시험 대역이다.
import { afterEach, describe, expect, it } from "vitest";
import { startFakeOpenAI, type FakeServer } from "../scripts/fake-openai.js";
import { estimateCostUsd } from "../src/infer/cost.js";
import { OpenAICompatClient } from "../src/infer/openai-compat.js";
import { VlmClient } from "../src/infer/vlm.js";

let f: FakeServer | undefined;
afterEach(async () => { await f?.close(); f = undefined; });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const ep = (baseUrl: string, extraBody: Record<string, unknown> = {}) => ({ baseUrl, model: "m", apiKey: "", extraBody });

describe("OpenAI 호환 호출", () => {
  it("키가 있으면 Bearer로 보내고 답 글·사용량을 돌려준다", async () => {
    f = await startFakeOpenAI({ reply: () => "hi" });
    const r = await new OpenAICompatClient({ ...ep(`${f.url}/v1`), apiKey: "k1" }).chat({ messages: [{ role: "user", content: "x" }], maxTokens: 50 });
    expect(r).toMatchObject({ text: "hi", model: "m", usage: { prompt: 10, completion: 5, cached: 0 } });
    expect(f.requests.at(-1)!.body).toMatchObject({ model: "m", max_completion_tokens: 50 });
  });

  it("HTTP 오류는 던진다", async () => {
    const fetchImpl = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
    await expect(new OpenAICompatClient(ep("http://127.0.0.1:9/v1"), { fetchImpl }).chat({ messages: [] })).rejects.toThrow(/HTTP 503/);
  });
});

describe("VLM 어댑터", () => {
  it("chat completions에 사진과 JSON Schema를 보내고 답을 검사한다", async () => {
    f = await startFakeOpenAI({ reply: () => '{"a":1}' });
    const vlm = new VlmClient(ep(`${f.url}/v1`, { reasoning_effort: "none" }));
    const r = await vlm.json({ prompt: "p", texts: ["t"], images: [JPEG], schema: { name: "s", schema: { type: "object" } }, parse: (t) => JSON.parse(t) as { a: number } });
    expect(r).toMatchObject({ value: { a: 1 }, attempts: 1, model: "m", costUsd: 0 });
    const body = f.requests.at(-1)!.body;
    expect(body).toMatchObject({ model: "m", reasoning_effort: "none", response_format: { type: "json_schema", json_schema: { name: "s", strict: true, schema: { type: "object" } } } });
    const content = body.messages[0].content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(content.map((p) => p.type)).toEqual(["text", "text", "image_url"]);
    expect(content[2]!.image_url!.url).toBe(`data:image/jpeg;base64,${JPEG.toString("base64")}`);
  });

  it("사진마다 설명을 주면 그 사진 바로 앞에 둔다", async () => {
    f = await startFakeOpenAI({ reply: () => "{}" });
    await new VlmClient(ep(`${f.url}/v1`)).json({ prompt: "p", images: [JPEG, JPEG], captions: ["c1", "c2"], schema: { name: "s", schema: {} }, parse: JSON.parse });
    const content = f.requests.at(-1)!.body.messages[0].content as { type: string; text?: string }[];
    expect(content.map((p) => p.text ?? p.type)).toEqual(["p", "c1", "image_url", "c2", "image_url"]);
  });

  it("형식이 틀리면 한 번 다시 묻고 그래도 틀리면 value null", async () => {
    f = await startFakeOpenAI({ reply: () => "not json" });
    const r = await new VlmClient(ep(`${f.url}/v1`)).json({ prompt: "p", images: [JPEG], schema: { name: "s", schema: {} }, parse: (t) => JSON.parse(t) });
    expect(r).toMatchObject({ value: null, attempts: 2, error: "형식이 2번 틀림" });
    expect(f.requests.filter((q) => q.method === "POST")).toHaveLength(2);
  });

  it("maxAttempts 1이면 한 번만 묻는다", async () => {
    f = await startFakeOpenAI({ reply: () => "not json" });
    const r = await new VlmClient(ep(`${f.url}/v1`)).json({ prompt: "p", images: [JPEG], schema: { name: "s", schema: {} }, parse: JSON.parse, maxAttempts: 1 });
    expect(r).toMatchObject({ value: null, attempts: 1 });
  });

  it("두 번째 시도가 HTTP 오류여도 첫 시도 비용과 횟수를 남긴다", async () => {
    let n = 0;
    const fetchImpl = (async () => (n++ === 1 ? new Response("down", { status: 500 })
      : new Response(JSON.stringify({ model: "gpt-5.4-mini", choices: [{ message: { content: "nope" } }], usage: { prompt_tokens: 1000, completion_tokens: 10 } }), { status: 200 }))) as unknown as typeof fetch;
    const r = await new VlmClient(ep("http://127.0.0.1:9/v1"), { fetchImpl }).json({ prompt: "p", images: [JPEG], schema: { name: "s", schema: {} }, parse: JSON.parse });
    expect(r).toMatchObject({ value: null, attempts: 2, model: "gpt-5.4-mini" });
    expect(r.costUsd).toBeGreaterThan(0);
    expect(r.error).toMatch(/HTTP 500/);
  });

  it("signal이 끊기면 요청을 끊고 다시 묻지 않는다", async () => {
    let started = 0;
    const hang: typeof fetch = (_u, init) => { started++; return new Promise((_, no) => init!.signal!.addEventListener("abort", () => no(init!.signal!.reason))); };
    const vlm = new VlmClient(ep("http://127.0.0.1:9/v1"), { fetchImpl: hang });
    const ac = new AbortController();
    const p = vlm.json({ prompt: "p", images: [JPEG], schema: { name: "s", schema: {} }, parse: JSON.parse, signal: ac.signal });
    ac.abort(new Error("timeout"));
    expect(await p).toMatchObject({ value: null, aborted: true, attempts: 1 });
    expect(started).toBe(1);
  });

  it("이미 끊긴 signal이면 요청하지 않는다", async () => {
    let started = 0;
    const fetchImpl = (async () => { started++; return new Response("{}"); }) as unknown as typeof fetch;
    const r = await new VlmClient(ep("http://127.0.0.1:9/v1"), { fetchImpl }).json({ prompt: "p", images: [JPEG], schema: { name: "s", schema: {} }, parse: JSON.parse, signal: AbortSignal.abort() });
    expect(r).toMatchObject({ value: null, aborted: true, attempts: 0 });
    expect(started).toBe(0);
  });

  it("제한 시간(timeoutMs)이 지나면 끊는다", async () => {
    const hang: typeof fetch = (_u, init) => new Promise((_, no) => init!.signal!.addEventListener("abort", () => no(init!.signal!.reason)));
    const r = await new VlmClient(ep("http://127.0.0.1:9/v1"), { fetchImpl: hang, timeoutMs: 50 }).json({ prompt: "p", images: [JPEG], schema: { name: "s", schema: {} }, parse: JSON.parse });
    expect(r).toMatchObject({ value: null, attempts: 1 });
    expect(r.error).toBeTruthy();
  });
});

describe("호출 비용 어림", () => {
  it("gpt-5.4-mini 표로 세고 표에 없는 모델(같은 서버 vLLM)은 0", () => {
    expect(estimateCostUsd("gpt-5.4-mini", { prompt: 1_000_000, completion: 0, cached: 0 })).toBeCloseTo(0.75);
    expect(estimateCostUsd("gpt-5.4-mini-2026-03-17", { prompt: 1_000_000, completion: 1_000_000, cached: 1_000_000 })).toBeCloseTo(0.075 + 4.5);
    expect(estimateCostUsd("vlm", { prompt: 1_000_000, completion: 1_000_000, cached: 0 })).toBe(0);
  });
});
