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
  first_seen_ms: 0, last_seen_ms: 9_000, last_in_view_ms: 9_000, facts: {}, answered_ms: null, devices: [], closer_hold: false, followed_by: null,
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

  it("ask_person은 글 대신 [가까이 볼 곳] id(사진 밖이어도 된다)를 고른다. 없는 id나 글만 내면 까닭을 주고 다시 받는다. 모델이 함께 낸 글은 쓰지 않는다", async () => {
    await start((_input, round) => [round === 0 ? ["ask_person", { text: ASK, reason: "사진 밖이라" }] : ["ask_person", { target: "table_1", text: "폰을 싱크대 가까이 대 줘", reason: "사진 밖이라" }]]);
    expect(await new Observer({ provider: llm!.provider() }).decide(stalled())).toEqual({ tool: "ask_person", target: "table_1", reason: "사진 밖이라" });
    expect(toolOutputs(llm!.bodies()[1])[0].error).toContain("ask_person 인자가 맞지 않습니다: target");

    llm!.script = () => [["ask_person", { target: "sink_9", reason: "사진 밖이라" }]];
    const bad = await new Observer({ provider: llm!.provider() }).decide(stalled());
    expect(toolOutputs(llm!.bodies()[3])[0].error).toContain("없는 id입니다: sink_9");
    expect(bad).toEqual({ tool: "wait", reason: expect.stringContaining("없는 id입니다: sink_9"), invalid: expect.stringContaining("없는 id입니다: sink_9") });
  });

  it("판단 전 보기(B, ask_person 없음)에서 ask_person을 부르면 거절하고 다시 받는다", async () => {
    await start((_input, round) => [round === 0 ? ["ask_person", { target: "sink_1", reason: "더 잘 보려고" }] : ["look_closer", { target: "sink_1", reason: "더 잘 보려고" }]]);
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

describe("관찰 모드: 코치 계획의 다른 행동·들은 말", () => {
  const PLAN = { at: 4, steps: [
    { label: "수납장으로 가기", status: "done" as const }, { label: "냄비 꺼내기", status: "done" as const }, { label: "싱크대로 가기", status: "done" as const },
    { label: "물 받기", status: "active" as const }, { label: "인덕션으로 가기", status: "pending" as const },
  ] };
  const TELL = "먼저 냄비에 물을 받아 주세요";
  const off = (over: Partial<ObserveSituation> = {}): ObserveSituation => ({
    trigger: "off_track", goal: "물 받기 단계 · 지금 명령 「냄비에 물을 받아 주세요」", stuckMs: 9_000, spots: [], world: WORLD, earlier: [],
    tools: ["tell_person", "wait"], nowMs: 13_000, plan: PLAN, changes: ["사람 거실에 있음", "폰이 냉장고 가까이로 감"], ...over,
  });
  const heard = (over: Partial<ObserveSituation> = {}): ObserveSituation => off({ trigger: "heard", tools: ["tell_person", "pass_on", "wait"], changes: undefined, said: "어 뭐 해야 되지", ...over });

  it("off_track 요청의 입력 글에 [계획] 단계 목록·지금 단계·[방금 본 변화]가 있고 도구는 tell_person·wait뿐이다. tell_person을 고르면 그 방식을 돌려준다", async () => {
    await start(() => [["tell_person", { mode: "earlier", reason: "물을 받기 전에 다른 곳으로 가서" }]]);
    expect(await new Observer({ provider: llm!.provider() }).decide(off())).toEqual({ tool: "tell_person", mode: "earlier", reason: "물을 받기 전에 다른 곳으로 가서" });
    const [body] = llm!.bodies();
    expect(body.tools.map((t: any) => t.name)).toEqual(["tell_person", "wait"]);
    const input = body.input[0].content as string;
    expect(input).toBe(observerInput(off()));
    expect(input.split("\n").slice(0, 2)).toEqual(["[확인할 것] 물 받기 단계 · 지금 명령 「냄비에 물을 받아 주세요」", "- 사람이 지금 단계와 다른 일을 하는 것 같다"]);
    expect(input).toContain("[계획] 지금 4번째 단계\n- 1 수납장으로 가기 · 끝남\n- 2 냄비 꺼내기 · 끝남\n- 3 싱크대로 가기 · 끝남\n- 4 물 받기 · 지금\n- 5 인덕션으로 가기 · 아직");
    expect(input).toContain("[방금 본 변화]\n- 사람 거실에 있음\n- 폰이 냉장고 가까이로 감");
    expect(input).not.toContain("[들은 말]");
    expect(input).toContain("[쓸 수 있는 도구] tell_person, wait");
  });

  it("heard 요청에는 [들은 말]이 있고 도구는 tell_person·pass_on·wait다. pass_on을 고르면 그대로 돌려준다", async () => {
    await start(() => [["pass_on", { reason: "이 일과 상관없는 말이라" }]]);
    expect(await new Observer({ provider: llm!.provider() }).decide(heard({ said: "거실 불 켜 줘" }))).toEqual({ tool: "pass_on", reason: "이 일과 상관없는 말이라" });
    const [body] = llm!.bodies();
    expect(body.tools.map((t: any) => t.name)).toEqual(["tell_person", "pass_on", "wait"]);
    const input = body.input[0].content as string;
    expect(input.split("\n")[1]).toBe("- 사람이 한 말을 들었다");
    expect(input).toContain("[들은 말] 거실 불 켜 줘");
    expect(input).toContain("[계획] 지금 4번째 단계");
    expect(input).not.toContain("[방금 본 변화]");
  });

  it("tell_person은 글 대신 방식(repeat·earlier)을 고른다. 글만 내거나 없는 방식이면 까닭을 주고 다시 받는다", async () => {
    await start((_input, round) => [round === 0 ? ["tell_person", { text: "지금 그거 하면 안 돼요", reason: "순서가 달라서" }] : ["tell_person", { mode: "earlier", text: TELL, reason: "순서가 달라서" }]]);
    expect(await new Observer({ provider: llm!.provider() }).decide(off())).toEqual({ tool: "tell_person", mode: "earlier", reason: "순서가 달라서" });
    expect(toolOutputs(llm!.bodies()[1])[0].error).toContain("tell_person 인자가 맞지 않습니다: mode");
    llm!.script = () => [["tell_person", { mode: "louder", reason: "순서가 달라서" }]];
    expect(await new Observer({ provider: llm!.provider() }).decide(off())).toMatchObject({ tool: "wait", invalid: expect.stringContaining("mode") });
  });

  it("위험 가전을 켜라는 글은 tell_person·ask_person 어디로도 나가지 않는다(켜기 전 묻기를 건너뛰지 않게): 모델 글은 받지 않고 방식·곳만 돌려준다. 글만 두 차례 내면 기다리기", async () => {
    await start((_input, round) => [round === 0 ? ["tell_person", { text: "먼저 인덕션을 켜 주세요", reason: "순서가 달라서" }] : ["tell_person", { mode: "earlier", text: "먼저 인덕션을 켜 주세요", reason: "순서가 달라서" }]]);
    const c = await new Observer({ provider: llm!.provider() }).decide(off());
    expect(c).toEqual({ tool: "tell_person", mode: "earlier", reason: "순서가 달라서" });
    expect(JSON.stringify(c)).not.toContain("인덕션");
    llm!.script = () => [["tell_person", { text: "인덕션을 켜 주세요", reason: "다음 단계라서" }]];
    expect(await new Observer({ provider: llm!.provider() }).decide(heard())).toMatchObject({ tool: "wait", invalid: expect.stringContaining("mode") });
    llm!.script = () => [["ask_person", { text: "전자레인지를 돌려 주세요", reason: "보려고" }]];
    expect(await new Observer({ provider: llm!.provider() }).decide(stalled())).toMatchObject({ tool: "wait", invalid: expect.stringContaining("target") });
  });

  it("off_track에서 pass_on·ask_person·look_closer를 부르면 거절한다", async () => {
    await start((_input, round) => [round === 0 ? ["pass_on", { reason: "상관없어서" }] : ["wait", { reason: "지금 단계를 하는 중이라" }]]);
    expect(await new Observer({ provider: llm!.provider() }).decide(off())).toEqual({ tool: "wait", reason: "지금 단계를 하는 중이라" });
    expect(toolOutputs(llm!.bodies()[1])).toEqual([{ ok: false, error: "이번에는 tell_person·wait만 부릅니다" }]);
  });

  it("관찰 프롬프트에 계획과 들은 말을 다루는 법, 새 도구 둘의 설명이 있다", () => {
    const lines = OBSERVER_PROMPT.split("\n");
    expect(lines).toContain("- [계획]이 있으면 사람이 지금 단계와 다른 일을 하는지 본다. 다른 자리로 갔거나 순서를 건너뛰었거나 위험하면(물을 받기 전에 불을 켬) tell_person mode earlier로 지금 할 일부터 하라고 알린다. 지금 단계를 하는 중으로 보이면 wait.");
    expect(lines).toContain("- [들은 말]이 있으면: 무엇을 할지 모르겠다는 말이면 tell_person mode repeat으로 지금 할 일을 다시 알리고, 이 일과 상관없는 말이면 pass_on, 답이 필요 없는 말이면 wait.");
    expect(lines.some((l) => l.startsWith("- tell_person: 사람에게 지금 할 일을 한 줄로 다시 알린다."))).toBe(true);
    expect(lines.some((l) => l.startsWith("- pass_on: 들은 말이 지금 하는 일과 상관없다."))).toBe(true);
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
