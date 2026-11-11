// 에이전트 관찰 모드(src/agent/observer.ts): 상황 글 → 도구 하나(look_closer·ask_person·wait), 검사, 비용.
// 모델은 같은 주소 자리의 가짜 OpenAI 서버가 도구 호출로 낸다(tests/helpers/observer.ts, OPENAI_MODEL=gpt-5.4-mini). 실제 OpenAI는 부르지 않는다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { OBSERVER_DEFAULTS, OBSERVER_PROMPT, Observer, observerInput, type ObserveSituation } from "../src/agent/observer.js";
import { createProvider } from "../src/agent/providers/index.js";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import { toolOutputs } from "./helpers/llm.js";
import { startFakeObserver, type FakeObserver, type ObserveScript } from "./helpers/observer.js";

const cup: WorldObject = {
  id: "cup_1", cls: "cup", position: [0.6, 0.9, 0], surface: "sink_1", surface_label: "싱크대", room: "kitchen", error_m: 0.1, status: "present",
  first_seen_ms: 0, last_seen_ms: 9_000, last_in_view_ms: 9_000, facts: {}, answered_ms: null, devices: [], closer_hold: false,
};
const WORLD: WorldView = {
  at_ms: 13_000, objects: [cup], fixtures: [], devices: [], eye: null, frame_ms: 12_000, vlm_missing: 0, yolo_missing: 0,
  person: { visible: true, since_ms: 0, last_seen_ms: 12_000, count: 1, room: "kitchen", room_label: "주방", position: null, near: [], holding: ["cup"], position_ms: null, answered_ms: null, facts: {} },
};

/** 멈춘 놓기 단계(A): 싱크대는 사진 안, 식탁은 사진 밖. */
const stalled = (over: Partial<ObserveSituation> = {}): ObserveSituation => ({
  trigger: "stalled", goal: "컵 내려놓기 단계 · 지금 명령 「컵을 싱크대에 넣어 주세요」", stuckMs: 12_000,
  spots: [{ id: "sink_1", label: "싱크대", inView: true }, { id: "table_1", label: "식탁", inView: false }],
  world: WORLD, earlier: [{ atMs: 3_000, tool: "wait", target: "sink_1", text: "싱크대 쪽은 기다림" }],
  tools: ["look_closer", "ask_person", "wait"], nowMs: 13_000, ...over,
});

const ASK = "싱크대 안이 보이게 폰을 가까이 대 주세요";
let llm: FakeObserver | undefined;
afterEach(async () => { await llm?.close(); llm = undefined; });
const start = async (script: ObserveScript, o: Parameters<typeof startFakeObserver>[1] = {}) => (llm = await startFakeObserver(script, o));

describe("관찰 모드: 요청과 고른 도구", () => {
  it("요청은 관찰 프롬프트·도구 하나 꼭 부르기·그 상황의 도구이고, 입력 글에 확인할 것·가까이 볼 곳·World State·앞서 한 일이 있다. look_closer sink_1을 고른다", async () => {
    await start((_input, round) => (round === 0 ? [["look_closer", { target: "sink_1", reason: "싱크대 안 컵을 더 잘 보려고" }]] : undefined));
    const choice = await new Observer({ provider: llm!.provider() }).decide(stalled());
    expect(choice).toEqual({ tool: "look_closer", target: "sink_1", reason: "싱크대 안 컵을 더 잘 보려고" });
    const [body] = llm!.bodies();
    expect(llm!.bodies()).toHaveLength(1);
    expect(body).toMatchObject({
      model: "gpt-5.4-mini", instructions: OBSERVER_PROMPT, tool_choice: "required", parallel_tool_calls: false, max_output_tokens: OBSERVER_DEFAULTS.maxOutputTokens,
    });
    expect(body.tools.map((t: any) => t.name)).toEqual(["look_closer", "ask_person", "wait"]);
    const input = body.input[0].content as string;
    expect(input).toBe(observerInput(stalled()));
    for (const line of ["[확인할 것] 컵 내려놓기 단계", "단계가 시작된 지 12초", "- sink_1 싱크대 · 지금 사진 안", "- table_1 식탁 · 지금 사진 밖", "[World State]", "- 물건 cup_1 컵 ·", "[앞서 한 일]", "- 10초 전 wait sink_1 · 싱크대 쪽은 기다림", "[쓸 수 있는 도구] look_closer, ask_person, wait"]) {
      expect(input).toContain(line);
    }
  });

  it("판단 전 보기(B)는 단계 시간 대신 「판단 전」 줄이고, 도구는 그 상황의 것만 보낸다", async () => {
    await start(() => [["wait", { reason: "다음 사진을 보려고" }]]);
    const s = stalled({ trigger: "unknown_fact", goal: "컵 cup_1의 contents를 모름", stuckMs: null, earlier: [], tools: ["look_closer", "wait"] });
    expect(await new Observer({ provider: llm!.provider() }).decide(s)).toEqual({ tool: "wait", reason: "다음 사진을 보려고" });
    const [body] = llm!.bodies();
    expect(body.tools.map((t: any) => t.name)).toEqual(["look_closer", "wait"]);
    expect(body.input[0].content).toContain("판단 전에 이 사실을 더 잘 보면 좋다");
    expect(body.input[0].content).toContain("[앞서 한 일]\n- 없음");
  });

  it("없는 id나 사진 밖 id면 까닭을 도구 결과로 돌려주고 둘째 차례의 답을 쓴다", async () => {
    await start((_input, round) => [round === 0 ? ["look_closer", { target: "table_1", reason: "식탁을 보려고" }] : ["wait", { reason: "사람이 아직 옮기는 중이라" }]]);
    expect(await new Observer({ provider: llm!.provider() }).decide(stalled())).toEqual({ tool: "wait", reason: "사람이 아직 옮기는 중이라" });
    expect(llm!.bodies()).toHaveLength(2);
    expect(toolOutputs(llm!.bodies()[1])).toEqual([{ ok: false, error: expect.stringContaining("table_1는 지금 사진 밖") }]);

    llm!.script = (_input, round) => [round === 0 ? ["look_closer", { target: "sink_9", reason: "싱크대를 보려고" }] : ["look_closer", { target: "sink_1", reason: "싱크대를 보려고" }]];
    expect(await new Observer({ provider: llm!.provider() }).decide(stalled())).toMatchObject({ tool: "look_closer", target: "sink_1" });
    expect(toolOutputs(llm!.bodies()[3])).toEqual([{ ok: false, error: expect.stringContaining("없는 id입니다: sink_9") }]);
  });

  it("ask_person 글은 「주세요」로 끝나고 화면 글 규칙에 맞아야 한다. 틀리면 까닭을 주고 다시 받는다", async () => {
    await start((_input, round) => [round === 0 ? ["ask_person", { text: "폰을 싱크대 가까이 대 줘", reason: "사진 밖이라" }] : ["ask_person", { text: ASK, reason: "사진 밖이라" }]]);
    expect(await new Observer({ provider: llm!.provider() }).decide(stalled())).toEqual({ tool: "ask_person", text: ASK, reason: "사진 밖이라" });
    expect(toolOutputs(llm!.bodies()[1])[0].error).toContain("「주세요」로 끝나야");

    llm!.script = (_input, round) => [round === 0 ? ["ask_person", { text: "싱크대 안이 보이게(가까이) 폰을 대 주세요", reason: "사진 밖이라" }] : ["ask_person", { text: "폰을 → 싱크대로 대 주세요", reason: "사진 밖이라" }]];
    const bad = await new Observer({ provider: llm!.provider() }).decide(stalled());
    expect(toolOutputs(llm!.bodies()[3])[0].error).toContain("괄호 설명");
    expect(bad).toEqual({ tool: "wait", reason: expect.stringContaining("흐름 나열"), invalid: expect.stringContaining("흐름 나열") });
  });

  it("판단 전 보기(B, ask_person 없음)에서 ask_person을 부르면 거절하고 다시 받는다", async () => {
    await start((_input, round) => [round === 0 ? ["ask_person", { text: ASK, reason: "더 잘 보려고" }] : ["look_closer", { target: "sink_1", reason: "더 잘 보려고" }]]);
    const s = stalled({ trigger: "unknown_fact", stuckMs: null, tools: ["look_closer", "wait"] });
    expect(await new Observer({ provider: llm!.provider() }).decide(s)).toEqual({ tool: "look_closer", target: "sink_1", reason: "더 잘 보려고" });
    expect(toolOutputs(llm!.bodies()[1])).toEqual([{ ok: false, error: "이번에는 look_closer·wait만 부릅니다" }]);
  });

  it("인자가 틀리면(reason 없음) 까닭을 주고, 두 차례 다 틀리면 기다리기(invalid)로 끝난다", async () => {
    await start(() => [["look_closer", { target: "sink_1" }]]);
    const choice = await new Observer({ provider: llm!.provider() }).decide(stalled());
    expect(choice).toEqual({ tool: "wait", reason: expect.stringContaining("look_closer 인자가 맞지 않습니다"), invalid: expect.stringContaining("reason") });
    expect(llm!.bodies()).toHaveLength(OBSERVER_DEFAULTS.maxRounds);
  });

  it("도구 없이 글만 두 번 내면 다시 부탁한 뒤 기다리기(invalid)로 끝난다", async () => {
    await start(() => "싱크대를 보면 좋겠어요.");
    const choice = await new Observer({ provider: llm!.provider() }).decide(stalled());
    expect(choice).toEqual({ tool: "wait", reason: "도구를 부르지 않음", invalid: "도구를 부르지 않음" });
    const bodies = llm!.bodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1].input.at(-1)).toEqual({ role: "user", content: "답 글 대신 도구 하나를 부르세요." });
  });
});

describe("관찰 모드: 비용", () => {
  it("응답 사용량(input 10·output 5)을 가격표(gpt-5.4-mini)로 센다", async () => {
    await start(() => [["wait", { reason: "다음 사진을 보려고" }]]);
    const observer = new Observer({ provider: llm!.provider() });
    expect(observer.status()).toEqual({ calls: 0, requests: 0, costUsd: 0 });
    await observer.decide(stalled());
    const s = observer.status();
    expect(s).toMatchObject({ calls: 1, requests: 1 });
    expect(s.costUsd).toBeCloseTo((10 * 0.75 + 5 * 4.5) / 1e6, 12);
  });

  it("가격표에 없는 모델의 비용은 0이 아니라 모름(null)이다", async () => {
    await start(() => [["wait", { reason: "다음 사진을 보려고" }]]);
    const observer = new Observer({ provider: createProvider({ ...llm!.env, OPENAI_MODEL: "local-llm" }).provider });
    await observer.decide(stalled());
    expect(llm!.bodies()[0].model).toBe("local-llm");
    expect(observer.status()).toEqual({ calls: 1, requests: 1, costUsd: null });
  });
});

describe("관찰 모드: 끊기", () => {
  it("넘긴 신호를 끊으면 공급자 요청을 끊고 던진다. 이미 끊긴 신호면 요청을 보내지 않는다", async () => {
    let release!: () => void;
    const held = new Promise<void>((ok) => { release = ok; });
    await start(() => [["wait", { reason: "다음 사진을 보려고" }]], { gate: () => held });
    const observer = new Observer({ provider: llm!.provider() });
    const ac = new AbortController();
    const pending = observer.decide(stalled(), ac.signal);
    await vi.waitFor(() => expect(llm!.bodies()).toHaveLength(1));
    ac.abort();
    await expect(pending).rejects.toThrow();
    release();
    await expect(observer.decide(stalled(), AbortSignal.abort())).rejects.toThrow();
    expect(llm!.bodies()).toHaveLength(1);
    expect(observer.status()).toMatchObject({ calls: 2, requests: 0 });
  });

  it("시간 한도(timeoutMs)를 넘기면 요청을 끊고 시간 한도 오류를 던진다", async () => {
    await start(() => [["wait", { reason: "다음 사진을 보려고" }]], { gate: () => new Promise(() => {}) });
    const observer = new Observer({ provider: llm!.provider(), timeoutMs: 100 });
    await expect(observer.decide(stalled())).rejects.toThrow("관찰 모드가 0.1초 안에 답하지 않음");
  });
});
