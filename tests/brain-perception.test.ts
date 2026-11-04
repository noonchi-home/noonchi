import { describe, expect, it } from "vitest";
import { FrameBuffer, selectWindow, type Frame } from "../src/brain/window.js";
import { PerceptionLoop } from "../src/brain/loop.js";
import {
  OpenAIPerceiver, PERCEPTION_JSON_SCHEMA, normalizePerception, parsePerception, type RawPerception, type PerceiveReply,
} from "../src/brain/perception.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const frame = (ms: number, id = `f${ms}`): Frame => ({ id, capturedAtMs: ms, jpeg: JPEG });
const raw = (over: Partial<RawPerception> = {}): RawPerception => ({
  person_present: "no", person_holding_cup: "no", drinking: "no", cup_visible: "yes", cup_support: "table",
  cup_contents: { visible: false, value: "unknown", certain: false }, note: "", ...over,
});

describe("판정 정규화", () => {
  it("내용물은 안이 보이고 값이 있을 때만 안다", () => {
    expect(normalizePerception(raw()).contents).toBe("unknown");
    expect(normalizePerception(raw({ cup_contents: { visible: false, value: "empty", certain: true } })).contents).toBe("unknown");
    const seen = normalizePerception(raw({ cup_contents: { visible: true, value: "empty", certain: true } }));
    expect([seen.contents, seen.contents_status]).toEqual(["empty", "confirmed"]);
    const guess = normalizePerception(raw({ cup_contents: { visible: true, value: "not_empty", certain: false } }));
    expect([guess.contents, guess.contents_status]).toEqual(["not_empty", "inferred"]);
  });

  it("컵이 안 보이면 내용물도 모른다", () => {
    const p = normalizePerception(raw({ cup_visible: "no", cup_contents: { visible: true, value: "empty", certain: true } }));
    expect(p.contents).toBe("unknown");
  });

  it("스키마에 맞지 않으면 거절한다", () => {
    expect(() => parsePerception(JSON.stringify({ ...raw(), extra: 1 }))).toThrow();
    expect(() => parsePerception(JSON.stringify({ ...raw(), person_present: "maybe" }))).toThrow();
    expect(() => parsePerception("```json\n{}\n```")).toThrow();
    expect(parsePerception(JSON.stringify(raw({ drinking: "yes" }))).drinking).toBe("yes");
  });

  it("OpenAI 구조화 출력용 스키마는 모든 필드가 필수이고 추가 필드를 막는다", () => {
    const schema = PERCEPTION_JSON_SCHEMA as { required: string[]; additionalProperties: boolean };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required.sort()).toEqual(["cup_contents", "cup_support", "cup_visible", "drinking", "note", "person_holding_cup", "person_present"]);
  });
});

describe("판정 창", () => {
  const twelveFps = Array.from({ length: 37 }, (_, i) => frame(Math.round((i * 1000) / 12)));

  it("최신 1장과 0.5초 간격 이전 사진 최대 4장을 2초 안에서 고른다", () => {
    const picked = selectWindow(twelveFps, { spanMs: 2000, stepMs: 500, maxFrames: 5 });
    expect(picked.map((f) => f.capturedAtMs)).toEqual([1000, 1500, 2000, 2500, 3000]);
  });

  it("2초보다 오래된 사진은 넣지 않고 같은 사진을 두 번 넣지 않는다", () => {
    expect(selectWindow([frame(0), frame(3000)], { spanMs: 2000, stepMs: 500, maxFrames: 5 }).map((f) => f.capturedAtMs)).toEqual([3000]);
    expect(selectWindow([frame(1200), frame(2900), frame(3000)], { spanMs: 2000, stepMs: 500, maxFrames: 5 }).map((f) => f.capturedAtMs)).toEqual([1200, 3000]);
    expect(selectWindow([], { spanMs: 2000, stepMs: 500, maxFrames: 5 })).toEqual([]);
  });

  it("버퍼는 촬영 순서로 두고 오래된 사진을 버린다", () => {
    const buf = new FrameBuffer(1000);
    buf.push(frame(500));
    buf.push(frame(2000));
    buf.push(frame(1500));
    expect(buf.frames().map((f) => f.capturedAtMs)).toEqual([1500, 2000]);
    expect(buf.latest()?.capturedAtMs).toBe(2000);
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("판정 반복(단일 진행·최신 우선)", () => {
  const reply = (cost = 0.001): PerceiveReply => ({ perception: normalizePerception(raw()), costUsd: cost, model: "m" });

  it("진행 중에는 새로 부르지 않고, 끝나면 그때의 최신 창으로 부른다", async () => {
    let now = 0;
    const calls: number[][] = [];
    const pending: ReturnType<typeof deferred<PerceiveReply>>[] = [];
    const results: number[] = [];
    const loop = new PerceptionLoop({
      perceiver: { perceive: (frames) => { calls.push(frames.map((f) => f.capturedAtMs)); const d = deferred<PerceiveReply>(); pending.push(d); return d.promise; } },
      buffer: new FrameBuffer(3000),
      config: { intervalMs: 1000, callCap: 10, window: { spanMs: 2000, stepMs: 500, maxFrames: 5 } },
      clock: { now: () => now },
      onResult: (r) => { results.push(r.evidenceAtMs); },
    });
    loop.onFrame(frame(0));
    expect(calls).toEqual([[0]]);
    now = 400; loop.onFrame(frame(400));
    now = 1200; loop.onFrame(frame(1200));
    expect(calls).toHaveLength(1);
    pending[0]!.resolve(reply());
    await new Promise((r) => setTimeout(r, 0));
    expect(results).toEqual([0]);
    expect(calls[1]).toEqual([0, 400, 1200]); // 끝난 순간의 최신(1200ms)까지, 2초 안 사진
  });

  it("새 사진이 없으면 같은 사진을 다시 판정하지 않는다", async () => {
    let now = 0;
    let count = 0;
    const loop = new PerceptionLoop({
      perceiver: { perceive: async () => { count++; return reply(); } },
      buffer: new FrameBuffer(3000),
      config: { intervalMs: 1000, callCap: 10, window: { spanMs: 2000, stepMs: 500, maxFrames: 5 } },
      clock: { now: () => now },
      onResult: () => {},
    });
    loop.onFrame(frame(0));
    await loop.idle();
    now = 5000;
    loop.poll();
    await loop.idle();
    expect(count).toBe(1);
  });

  it("상한은 실제 요청 수(다시 묻기 포함)로 센다", async () => {
    let now = 0;
    const loop = new PerceptionLoop({
      perceiver: { perceive: async (_f, o) => ({ ...reply(0.001), attempts: Math.min(2, o?.maxAttempts ?? 2) }) },
      buffer: new FrameBuffer(3000),
      config: { intervalMs: 1000, callCap: 3, window: { spanMs: 2000, stepMs: 500, maxFrames: 5 } },
      clock: { now: () => now },
      onResult: () => {},
    });
    for (let t = 0; t <= 4000; t += 1000) { now = t; loop.onFrame(frame(t)); await loop.idle(); }
    expect(loop.stats().calls).toBe(3); // 2 + 남은 1(한 번만 시도)
  });

  it("호출 상한을 넘으면 더 부르지 않고 알린다", async () => {
    let now = 0;
    const loop = new PerceptionLoop({
      perceiver: { perceive: async () => reply(0.002) },
      buffer: new FrameBuffer(3000),
      config: { intervalMs: 1000, callCap: 2, window: { spanMs: 2000, stepMs: 500, maxFrames: 5 } },
      clock: { now: () => now },
      onResult: () => {},
    });
    for (let t = 0; t <= 4000; t += 1000) { now = t; loop.onFrame(frame(t)); await loop.idle(); }
    expect(loop.stats()).toMatchObject({ calls: 2, capped: true });
    expect(loop.stats().costUsd).toBeCloseTo(0.004);
  });

  it("판정 실패도 결과로 넘기되 판정은 비운다", async () => {
    const got: (string | undefined)[] = [];
    const loop = new PerceptionLoop({
      perceiver: { perceive: async () => { throw new Error("HTTP 500"); } },
      buffer: new FrameBuffer(3000),
      config: { intervalMs: 1000, callCap: 5, window: { spanMs: 2000, stepMs: 500, maxFrames: 5 } },
      clock: { now: () => 0 },
      onResult: (r) => { got.push(r.error); expect(r.perception).toBeNull(); },
    });
    loop.onFrame(frame(0));
    await loop.idle();
    expect(got).toEqual(["HTTP 500"]);
  });
});

describe("OpenAI 판정기", () => {
  it("사진마다 촬영 시각을 붙여 한 번에 보내고, 형식이 틀리면 한 번 다시 묻는다", async () => {
    const bodies: { input: { content: { type: string; text?: string }[] }[]; text: { format: { strict: boolean } } }[] = [];
    const answers = ["not json", JSON.stringify(raw({ drinking: "yes" }))];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const text = answers.shift()!;
      return new Response(JSON.stringify({
        model: "gpt-5.4-mini-2026-03-17", status: "completed",
        usage: { input_tokens: 1000, output_tokens: 100 },
        output: [{ type: "message", content: [{ type: "output_text", text }] }],
      }), { status: 200 });
    }) as typeof fetch;
    const p = new OpenAIPerceiver({ apiKey: "k", model: "gpt-5.4-mini", fetchImpl });
    const out = await p.perceive([frame(1000), frame(1500)]);
    expect(out.perception?.drinking).toBe("yes");
    expect(bodies).toHaveLength(2);
    const content = bodies[0]!.input[0]!.content;
    expect(content.filter((c) => c.type === "input_image")).toHaveLength(2);
    expect(content.some((c) => c.text?.includes("-500ms"))).toBe(true);
    expect(bodies[0]!.text.format.strict).toBe(true);
    expect(out.costUsd).toBeGreaterThan(0);
  });

  it("다시 묻기도 실제 호출로 세고, 남은 상한이 1이면 한 번만 부른다", async () => {
    let requests = 0;
    const fetchImpl = (async () => {
      requests++;
      return new Response(JSON.stringify({
        model: "gpt-5.4-mini-2026-03-17", status: "completed", usage: { input_tokens: 10, output_tokens: 1 },
        output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }],
      }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await new OpenAIPerceiver({ apiKey: "k", model: "gpt-5.4-mini", fetchImpl }).perceive([frame(0)], { maxAttempts: 1 });
    expect(requests).toBe(1);
    expect(out.attempts).toBe(1);
  });

  it("두 번째 시도가 네트워크 오류여도 첫 시도 비용은 남긴다", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      if (n++ === 1) return new Response("down", { status: 500 });
      return new Response(JSON.stringify({
        model: "gpt-5.4-mini-2026-03-17", status: "completed", usage: { input_tokens: 1000, output_tokens: 10 },
        output: [{ type: "message", content: [{ type: "output_text", text: "nope" }] }],
      }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await new OpenAIPerceiver({ apiKey: "k", model: "gpt-5.4-mini", fetchImpl }).perceive([frame(0)]);
    expect(out.perception).toBeNull();
    expect(out.attempts).toBe(2);
    expect(out.costUsd).toBeGreaterThan(0);
    expect(out.error).toMatch(/HTTP 500/);
  });

  it("두 번 다 형식이 틀리면 판정을 비우고 비용은 센다", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      model: "gpt-5.4-mini-2026-03-17", status: "completed", usage: { input_tokens: 10, output_tokens: 1 },
      output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }],
    }), { status: 200 })) as unknown as typeof fetch;
    const out = await new OpenAIPerceiver({ apiKey: "k", model: "gpt-5.4-mini", fetchImpl }).perceive([frame(0)]);
    expect(out.perception).toBeNull();
    expect(out.error).toMatch(/형식/);
    expect(out.costUsd).toBeGreaterThan(0);
  });
});
