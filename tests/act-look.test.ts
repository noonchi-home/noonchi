// 보기 담당(src/act/look.ts): 관찰 모드를 한 번에 하나만 부르고(A 멈춘 단계가 먼저, B 판단 전 보기), 고른 도구를 실행하고, look 기록을 하나씩 남긴다.
// 관찰 모드는 진짜 Observer를 가짜 OpenAI 서버에 붙인다(tests/helpers/observer.ts). 가까이 보기 자리는 testCloser(tests/helpers/look.ts)다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOOK_DEFAULTS, Looker, type LookerOptions } from "../src/act/look.js";
import type { Stall, Stray } from "../src/act/track.js";
import { Observer } from "../src/agent/observer.js";
import type { BrainLog, CloserResult } from "../src/contract/events.js";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import type { LookSpot } from "../src/observe/crop.js";
import type { LatestFrame } from "../src/observe/pipeline.js";
import { LOOK_TEXT } from "../src/plan/labels.js";
import { LOOK_VIEW } from "./helpers/camera.js";
import { CLOSER_FOUND, testCloser, type TestCloser } from "./helpers/look.js";
import { startFakeObserver, type FakeObserver, type ObserveScript } from "./helpers/observer.js";

const ASK = "싱크대 안이 보이게 폰을 가까이 대 주세요";
// 실행 추적이 주는 싱크대 자리는 윗면 가운데다(src/server/home.ts placeLocator)
const SINK_TOP: [number, number, number] = [0.6, 0.9, 0];
const SINK: LookSpot = { id: "sink_1", label: "싱크대", position: SINK_TOP };
const CUP: LookSpot = { id: "cup_1", label: "컵", position: [1.5, 0, 0] };

const cupAt = (over: Partial<WorldObject> = {}): WorldObject => ({
  id: "cup_1", cls: "cup", position: [1.5, 0, 0], surface: null, surface_label: null, room: "kitchen", error_m: 0.1, status: "present",
  first_seen_ms: 0, last_seen_ms: 0, last_in_view_ms: 0, facts: {}, answered_ms: null, devices: [], closer_hold: false, followed_by: null, ...over,
});
const worldOf = (objects: WorldObject[]): WorldView => ({
  at_ms: 0, objects, fixtures: [], devices: [], eye: null, frame_ms: null, vlm_missing: 0, yolo_missing: 0,
  person: { visible: false, since_ms: 0, last_seen_ms: null, count: 0, room: null, room_label: null, position: null, near: [], holding: [], position_ms: null, answered_ms: null, facts: {} },
});
const fact = (value: string) => ({ value, at_ms: 0, since_ms: 0, certainty: "confirmed" as const });

/** A: 멈춘 놓기 단계 plan:pam-1:4. settled는 settle로 받은 값(받은 순서), ac를 끊으면 단계가 끝난 것이다. */
function stall(over: Partial<Stall> = {}) {
  const ac = new AbortController();
  const settled: boolean[] = [];
  const s: Stall = {
    planId: "plan:pam-1", stepId: "plan:pam-1:4", kind: "place", label: "컵 내려놓기", command: "컵을 싱크대에 넣어 주세요",
    until: { object: "cup_1", follow: true, facts: { place: "in_sink" } }, stuckMs: 8000, looks: 0, spots: [CUP, SINK], gen: 4, signal: ac.signal,
    settle: (c) => settled.push(c), ...over,
  };
  return { s, ac, settled };
}

const isA = (input: string) => input.includes("단계가 시작된 지");
let llm: FakeObserver | undefined;
afterEach(async () => { await llm?.close(); llm = undefined; });

/** 보기 담당 하나. 시계는 100초에서 시작하고, 가장 새 프레임은 지금 찍은 LOOK_VIEW 사진. */
async function setup(o: { script: ObserveScript; gate?: (input: string) => Promise<void> | undefined; objects?: WorldObject[]; frame?: (now: number) => LatestFrame | null; closer?: TestCloser; options?: Partial<LookerOptions> }) {
  await llm?.close();
  llm = await startFakeObserver(o.script, { gate: async (body) => { await o.gate?.(body.input[0].content as string); } });
  const clock = { t: 100_000, now() { return this.t; } };
  const logs: BrainLog[] = [];
  const asked: [string, string, string][] = [];
  const looked: LookSpot[] = [];
  const closer = o.closer ?? testCloser();
  let objects = o.objects ?? [cupAt()];
  const looker = new Looker({
    observer: new Observer({ provider: llm.provider() }), closer: (spot, signal) => closer.closer(spot, signal),
    frame: () => (o.frame ? o.frame(clock.now()) : { view: LOOK_VIEW, capturedAtMs: clock.now(), width: 480, height: 360 }),
    world: () => worldOf(objects), askPerson: (planId, stepId, text) => { asked.push([planId, stepId, text]); return true; },
    emit: (l) => logs.push(l), targets: () => [{ cls: "cup", facets: ["contents"] }], clock,
    onLook: (spot) => looked.push(spot), ...o.options,
  });
  const looks = () => logs.filter((l): l is Extract<BrainLog, { type: "look" }> => l.type === "look");
  return { looker, clock, logs, looks, asked, looked, closer, llm, setObjects: (x: WorldObject[]) => { objects = x; } };
}

describe("보기 담당: 판단 전 보기(B)", () => {
  it("행동 대상 종류 물건이 사진 안인데 볼 면을 모르면 관찰 모드를 한 번 부르고 look 기록을 남긴다. 같은 물건은 30초, 다른 물건이어도 10초 안에는 다시 부르지 않는다", async () => {
    const t = await setup({ script: () => [["wait", { reason: "다음 사진을 보려고" }]] });
    t.looker.tick();
    await t.looker.idle();
    const [body] = t.llm.bodies();
    expect(t.llm.bodies()).toHaveLength(1);
    expect(body.tools.map((x: any) => x.name)).toEqual(["look_closer", "wait"]);
    expect(body.input[0].content).toContain("- cup_1 컵 · 지금 사진 안");
    expect(body.input[0].content).toContain("판단 전에 이 사실을 더 잘 보면 좋다");
    expect(t.looks()).toEqual([{ type: "look", at_ms: 100_000, trigger: "unknown_fact", target: "cup_1", tool: "wait", reason: "다음 사진을 보려고", text: "컵 쪽은 기다림", result: null }]);

    t.clock.t += 29_000;
    t.looker.tick();
    await t.looker.idle();
    expect(t.llm.bodies()).toHaveLength(1);
    t.clock.t += 1_000;
    t.looker.tick();
    await t.looker.idle();
    expect(t.llm.bodies()).toHaveLength(2);

    t.setObjects([cupAt(), cupAt({ id: "cup_2", position: [1.6, 0, 0.1] })]);
    t.clock.t += 9_999;
    t.looker.tick();
    await t.looker.idle();
    expect(t.llm.bodies()).toHaveLength(2);
    t.clock.t += 1;
    t.looker.tick();
    await t.looker.idle();
    expect(t.llm.bodies()).toHaveLength(3);
    expect(t.llm.bodies()[2].input[0].content).toContain("- cup_2 컵 · 지금 사진 안");
    expect(t.looker.status()).toEqual({ calls: 3, costUsd: expect.any(Number), looks: 0, asks: 0, waits: 3, tells: 0 });
  });

  it("볼 면이 안이 안 보임이면 부르고, 비어 있음·시야 밖·싱크대 안·실행 추적이 치운 것·대상 종류 아님·10초 넘게 낡은 프레임·카메라 없음이면 부르지 않는다", async () => {
    const cases: { objects?: WorldObject[]; frame?: (now: number) => LatestFrame | null; options?: Partial<LookerOptions>; calls: number }[] = [
      { objects: [cupAt({ facts: { contents: fact("contents_unknown") } })], calls: 1 },
      { objects: [cupAt({ facts: { contents: fact("empty") } })], calls: 0 },
      { objects: [cupAt({ status: "out_of_view" })], calls: 0 },
      { objects: [cupAt({ facts: { place: fact("in_sink") } })], calls: 0 },
      // 실행 추적이 놓기 단계를 끝낸 컵(이미 치운 것)
      { objects: [cupAt({ facts: { contents: fact("contents_unknown") } })], options: { placed: () => new Map([["cup_1", { target: "sink_1", atMs: 0 }]]) }, calls: 0 },
      { objects: [cupAt({ id: "book_1", cls: "book" })], calls: 0 },
      { frame: (now) => ({ view: LOOK_VIEW, capturedAtMs: now - LOOK_DEFAULTS.frameFreshMs - 1, width: 480, height: 360 }), calls: 0 },
      { frame: (now) => ({ view: null, capturedAtMs: now, width: 480, height: 360 }), calls: 0 },
      { frame: () => null, calls: 0 },
    ];
    for (const c of cases) {
      const t = await setup({ script: () => [["wait", { reason: "다음 사진을 보려고" }]], objects: c.objects, frame: c.frame, options: c.options });
      t.looker.tick();
      await t.looker.idle();
      expect(t.llm.bodies()).toHaveLength(c.calls);
      expect(t.looks()).toHaveLength(c.calls);
    }
  });
});

describe("보기 담당: 멈춘 단계(A)가 먼저", () => {
  it("B가 관찰 모드를 부르는 중이면 끊고(B 기록 없음) A를 받는다. A가 고른 사람 부탁을 실행 추적에 넘기고 기록·settle(true)을 남긴다", async () => {
    let releaseB!: () => void;
    const heldB = new Promise<void>((ok) => { releaseB = ok; });
    const t = await setup({
      script: (input) => (isA(input) ? [["ask_person", { text: ASK, reason: "싱크대 안이 사진에서 작아서" }]] : [["wait", { reason: "다음 사진을 보려고" }]]),
      gate: (input) => (isA(input) ? undefined : heldB),
    });
    try {
      t.looker.tick();
      await vi.waitFor(() => expect(t.llm.bodies()).toHaveLength(1));
      const { s, settled } = stall();
      expect(t.looker.stalled(s)).toBe(true);
      await t.looker.idle();
      expect(t.asked).toEqual([["plan:pam-1", "plan:pam-1:4", ASK]]);
      expect(t.looks()).toEqual([{
        type: "look", at_ms: 100_000, trigger: "stalled", target: "cup_1", tool: "ask_person", reason: "싱크대 안이 사진에서 작아서",
        text: `가까이 비춰 달라고 부탁함 · ${ASK}`, result: { sent: true }, plan_id: "plan:pam-1", step_id: "plan:pam-1:4",
      }]);
      expect(settled).toEqual([true]);
      expect(t.llm.bodies()).toHaveLength(2);
    } finally {
      releaseB();
    }
  });

  it("A가 도는 동안 다른 A는 받지 않고 tick도 아무것도 하지 않는다. B가 잘라 보는 중이면 A를 받지 않는다", async () => {
    let releaseA!: () => void;
    const heldA = new Promise<void>((ok) => { releaseA = ok; });
    const closer = testCloser();
    const t = await setup({
      script: (input) => (isA(input) ? [["wait", { reason: "사람이 아직 옮기는 중이라" }]] : [["look_closer", { target: "cup_1", reason: "컵 안을 보려고" }]]),
      gate: (input) => (isA(input) ? heldA : undefined), closer,
    });
    const first = stall();
    expect(t.looker.stalled(first.s)).toBe(true);
    await vi.waitFor(() => expect(t.llm.bodies()).toHaveLength(1));
    expect(t.looker.stalled(stall().s)).toBe(false);
    t.looker.tick();
    releaseA();
    await t.looker.idle();
    expect(t.llm.bodies()).toHaveLength(1);
    expect(t.looks().map((l) => [l.trigger, l.tool, l.text])).toEqual([["stalled", "wait", "컵 쪽은 기다림"]]);
    expect(first.settled).toEqual([true]);

    closer.hold();
    t.clock.t += LOOK_DEFAULTS.objectGapMs;
    t.looker.tick();
    await vi.waitFor(() => expect(closer.calls).toHaveLength(1));
    const late = stall();
    expect(t.looker.stalled(late.s)).toBe(false);
    expect(late.settled).toEqual([]);
    closer.release();
    await t.looker.idle();
    expect(t.looks().at(-1)).toMatchObject({ trigger: "unknown_fact", tool: "look_closer", target: "cup_1", text: "컵 쪽을 가까이 봄 · 컵 보임", result: CLOSER_FOUND });
  });
});

describe("보기 담당: 가까이 보기 실행", () => {
  it("look_closer sink_1이면 받은 자리(싱크대 윗면)로 단계 신호와 함께 가까이 보고 기록·settle(true)을 남긴다. 같은 단계의 다음 요청 [앞서 한 일]에 그 결과가 있다", async () => {
    const t = await setup({
      script: (_input, round) => (round === 0 ? [["look_closer", { target: "sink_1", reason: "싱크대 안 컵을 더 잘 보려고" }]] : undefined),
    });
    const a = stall();
    expect(t.looker.stalled(a.s)).toBe(true);
    await t.looker.idle();
    expect(t.closer.calls).toHaveLength(1);
    expect(t.closer.calls[0]!.spot).toEqual({ id: "sink_1", label: "싱크대", position: SINK_TOP });
    expect(t.closer.calls[0]!.signal?.aborted).toBe(false);
    expect(t.looked).toEqual([{ id: "sink_1", label: "싱크대", position: SINK_TOP }]);
    expect(t.looks()).toEqual([{
      type: "look", at_ms: 100_000, trigger: "stalled", target: "sink_1", tool: "look_closer", reason: "싱크대 안 컵을 더 잘 보려고",
      text: "싱크대 쪽을 가까이 봄 · 컵 보임", result: CLOSER_FOUND, plan_id: "plan:pam-1", step_id: "plan:pam-1:4",
    }]);
    expect(a.settled).toEqual([true]);
    expect(t.looker.status()).toMatchObject({ calls: 1, looks: 1, asks: 0, waits: 0 });

    t.clock.t += 8_000;
    t.looker.stalled(stall().s);
    await t.looker.idle();
    const input = t.llm.bodies().at(-1).input[0].content as string;
    expect(input).toContain("[앞서 한 일]\n- 8초 전 look_closer sink_1 · 싱크대 쪽을 가까이 봄 · 컵 보임 · cup_1 0.72 in_sink");
  });

  it("가까이 보기가 새 사진 모자람·VLM 자리 없음이면 settle(false), 감지 오류면 settle(true)이고 까닭 글을 남긴다", async () => {
    const t = await setup({ script: () => [["look_closer", { target: "sink_1", reason: "싱크대 안을 보려고" }]] });
    const cases = [["no_fresh_frames", false], ["vlm_busy", false], ["error", true], ["out_of_view", true]] as const;
    for (const [why, counted] of cases) {
      t.closer.result = { ok: false, why };
      const a = stall();
      t.looker.stalled(a.s);
      await t.looker.idle();
      expect(a.settled).toEqual([counted]);
      expect(t.looks().at(-1)!.text).toBe(LOOK_TEXT.closer("싱크대", LOOK_TEXT.miss[why]));
    }
    expect(LOOK_TEXT.closer("싱크대", LOOK_TEXT.miss.no_fresh_frames)).toBe("싱크대 쪽을 가까이 봄 · 새 사진이 모자라 못 봄");
  });

  it("단계가 끝나 신호가 끊기면 관찰 모드·가까이 보기를 그만두고 기록·settle을 남기지 않는다. 가까이 본 결과가 단계를 끝낸 것은 기록한다", async () => {
    const closer = testCloser();
    closer.hold();
    const t = await setup({ script: () => [["look_closer", { target: "sink_1", reason: "싱크대 안을 보려고" }]], closer });
    const a = stall();
    t.looker.stalled(a.s);
    await vi.waitFor(() => expect(closer.calls).toHaveLength(1));
    a.ac.abort();
    expect(closer.calls[0]!.signal?.aborted).toBe(true);
    closer.release({ ok: false, why: "aborted" });
    await t.looker.idle();
    expect(t.looks()).toEqual([]);
    expect(a.settled).toEqual([]);

    // 가까이 본 결과가 World State에 들어가 그 단계를 끝냈으면(그래서 신호가 끊김) 기록한다
    closer.hold();
    const done = stall();
    t.looker.stalled(done.s);
    await vi.waitFor(() => expect(closer.calls).toHaveLength(2));
    done.ac.abort();
    closer.release(CLOSER_FOUND);
    await t.looker.idle();
    expect(t.looks()).toEqual([expect.objectContaining({ trigger: "stalled", tool: "look_closer", text: "싱크대 쪽을 가까이 봄 · 컵 보임", result: CLOSER_FOUND })]);

    let releaseA!: () => void;
    const heldA = new Promise<void>((ok) => { releaseA = ok; });
    const t2 = await setup({ script: () => [["wait", { reason: "기다리려고" }]], gate: () => heldA });
    const b = stall();
    t2.looker.stalled(b.s);
    await vi.waitFor(() => expect(t2.llm.bodies()).toHaveLength(1));
    b.ac.abort();
    await t2.looker.idle();
    releaseA();
    expect(t2.looks()).toEqual([]);
    expect(b.settled).toEqual([]);
    expect(t2.looker.stalled(stall({ signal: AbortSignal.abort() }).s)).toBe(false);
  });

  it("감지를 합친 뒤 단계가 끝나 VLM 답을 넣지 않은 가까이 보기(vlm aborted)도 실행한 관찰로 기록하고 settle(true)", async () => {
    const closer = testCloser();
    closer.hold();
    const t = await setup({ script: () => [["look_closer", { target: "sink_1", reason: "싱크대 안을 보려고" }]], closer });
    const a = stall();
    t.looker.stalled(a.s);
    await vi.waitFor(() => expect(closer.calls).toHaveLength(1));
    a.ac.abort();
    const cut: CloserResult = {
      ok: true, frame_id: "e3.c1", captured_at_ms: 6000, crop: [120, 90, 240, 180], frames: 3, found: [{ id: "cup_1", cls: "cup", score: 0.72, facts: [] }], summary: null, vlm: "aborted",
    };
    closer.release(cut);
    await t.looker.idle();
    const text = LOOK_TEXT.closer("싱크대", `컵 보임 · ${LOOK_TEXT.vlmAborted}`);
    expect(text).toBe("싱크대 쪽을 가까이 봄 · 컵 보임 · 단계가 끝나 VLM 답은 넣지 않음");
    expect(t.looks()).toEqual([expect.objectContaining({ trigger: "stalled", tool: "look_closer", target: "sink_1", text, result: cut })]);
    expect(a.settled).toEqual([true]);
    expect(t.looker.status()).toMatchObject({ looks: 1 });
  });

  it("감지는 합쳤지만 VLM 답이 왔을 때 사진이 끊겨 넣지 않은 가까이 보기(vlm no_fresh_frames)는 기록하고 자원 사정이라 settle(false)", async () => {
    const t = await setup({ script: () => [["look_closer", { target: "sink_1", reason: "싱크대 안을 보려고" }]] });
    const cut: CloserResult = {
      ok: true, frame_id: "e3.c1", captured_at_ms: 6000, crop: [120, 90, 240, 180], frames: 3, found: [{ id: null, cls: "cup", score: 0.72, facts: [] }], summary: null, vlm: "no_fresh_frames",
    };
    t.closer.result = cut;
    const a = stall();
    t.looker.stalled(a.s);
    await t.looker.idle();
    const text = LOOK_TEXT.closer("싱크대", `컵 보임 · ${LOOK_TEXT.vlmStale}`);
    expect(text).toBe("싱크대 쪽을 가까이 봄 · 컵 보임 · 새 사진이 끊겨 VLM 답은 넣지 않음");
    expect(t.looks()).toEqual([expect.objectContaining({ trigger: "stalled", tool: "look_closer", target: "sink_1", text, result: cut })]);
    expect(a.settled).toEqual([false]);
    expect(t.looker.status()).toMatchObject({ looks: 1 });
  });

  it("관찰 모드 호출이 실패하면(가짜 서버 닫음) 기다리기 기록에 까닭을 남기고 settle(true)", async () => {
    const t = await setup({ script: () => [["look_closer", { target: "sink_1", reason: "싱크대 안을 보려고" }]] });
    await t.llm.close();
    const a = stall({ spots: [SINK] });
    t.looker.stalled(a.s);
    await t.looker.idle();
    expect(t.looks()).toEqual([expect.objectContaining({ trigger: "stalled", tool: "wait", target: "sink_1", text: "싱크대 쪽은 기다림", reason: expect.stringMatching(/^관찰 모드 호출 실패: /), result: null })]);
    expect(a.settled).toEqual([true]);
  }, 15_000);
});

describe("보기 담당: 코치 계획의 다른 행동(off_track)과 들은 말(heard)", () => {
  const TELL = "먼저 냄비에 물을 받아 주세요";
  const stray = (over: Partial<Stray> = {}) => {
    const ac = new AbortController();
    const s: Stray = {
      planId: "plan:pam-1", stepId: "plan:pam-1:4", label: "물 받기", command: "냄비에 물을 받아 주세요", at: 4,
      steps: [{ label: "싱크대로 가기", status: "done" }, { label: "물 받기", status: "active" }], changes: ["사람 거실에 있음"], signal: ac.signal, ...over,
    };
    return { s, ac };
  };

  it("tell_person을 고르면 실행 추적의 tell을 부르고 look 기록(계기 off_track, 글 「다시 알림 · …」)을 남긴다. 관찰 모드 입력에 계획과 방금 본 변화가 있다", async () => {
    const told: [string, string, string][] = [];
    const t = await setup({ script: () => [["tell_person", { text: TELL, reason: "다른 곳으로 가서" }]], options: { tell: (p, st, text) => { told.push([p, st, text]); return true; } } });
    expect(t.looker.strayed(stray().s)).toBe(true);
    await t.looker.idle();
    expect(told).toEqual([["plan:pam-1", "plan:pam-1:4", TELL]]);
    expect(t.looks()).toEqual([{
      type: "look", at_ms: 100_000, trigger: "off_track", target: null, tool: "tell_person", reason: "다른 곳으로 가서", text: `다시 알림 · ${TELL}`, result: { sent: true },
      plan_id: "plan:pam-1", step_id: "plan:pam-1:4",
    }]);
    const input = t.llm.bodies()[0].input[0].content as string;
    expect(input).toContain("[계획] 지금 4번째 단계");
    expect(input).toContain("[방금 본 변화]\n- 사람 거실에 있음");
    expect(t.llm.bodies()[0].tools.map((x: any) => x.name)).toEqual(["tell_person", "wait"]);
    expect(t.looker.status()).toMatchObject({ calls: 1, tells: 1 });
  });

  it("다른 일(A·B·다른 off_track)이 도는 중이면 strayed를 받지 않는다. 단계가 끝나 신호가 끊기면 기록도 tell도 없다", async () => {
    let release!: () => void;
    const held = new Promise<void>((ok) => { release = ok; });
    const told: string[] = [];
    const t = await setup({ script: () => [["tell_person", { text: TELL, reason: "다른 곳으로 가서" }]], gate: () => held, options: { tell: (_p, _s, text) => { told.push(text); return true; } } });
    try {
      const a = stray();
      expect(t.looker.strayed(a.s)).toBe(true);
      expect(t.looker.strayed(stray().s)).toBe(false);
      await vi.waitFor(() => expect(t.llm.bodies()).toHaveLength(1));
      a.ac.abort();
      release();
      await t.looker.idle();
      expect(told).toEqual([]);
      expect(t.looks()).toEqual([]);
      expect(t.looker.strayed(stray({ signal: a.ac.signal }).s)).toBe(false);
    } finally { release(); }
  });

  it("heard: tell_person이면 told, pass_on이면 passed, wait면 waited. 들은 말은 관찰 모드 입력에만 가고 look 기록(글·까닭)에는 남지 않는다", async () => {
    const SAID = "어 뭐 해야 되지";
    const told: string[] = [];
    const { s } = stray();
    const base = { planId: s.planId, stepId: s.stepId, label: s.label, command: s.command, at: s.at, steps: s.steps, signal: s.signal };
    const t = await setup({
      script: (input) => (input.includes("[들은 말] 거실 불 켜 줘") ? [["pass_on", { reason: "「거실 불 켜 줘」는 이 일과 상관없어서" }]]
        : input.includes("[들은 말] 음 그렇구나") ? [["wait", { reason: "답이 필요 없는 말이라" }]] : [["tell_person", { text: "냄비에 물을 받아 주세요", reason: `「${SAID}」라고 해서` }]]),
      options: { tell: (_p, _s, text) => { told.push(text); return true; } },
    });
    expect(await t.looker.heard(s.planId, s.stepId, SAID, base)).toBe("told");
    expect(told).toEqual(["냄비에 물을 받아 주세요"]);
    expect(t.llm.bodies()[0].input[0].content).toContain(`[들은 말] ${SAID}`);
    expect(t.llm.bodies()[0].tools.map((x: any) => x.name)).toEqual(["tell_person", "pass_on", "wait"]);
    expect(await t.looker.heard(s.planId, s.stepId, "거실 불 켜 줘", base)).toBe("passed");
    expect(await t.looker.heard(s.planId, s.stepId, "음 그렇구나", base)).toBe("waited");
    expect(t.looks().map((l) => [l.trigger, l.tool, l.text, l.reason])).toEqual([
      ["heard", "tell_person", "다시 알림 · 냄비에 물을 받아 주세요", "「들은 말」라고 해서"],
      ["heard", "pass_on", "말 요청으로 넘김", "「들은 말」는 이 일과 상관없어서"],
      ["heard", "wait", "기다림", "답이 필요 없는 말이라"],
    ]);
    expect(JSON.stringify(t.logs)).not.toMatch(/뭐 해야|거실 불|그렇구나/);
  });

  it("heard: tell_person 글이 들은 말을 그대로 옮겨도 실제 폰에 읽는 글(tell)은 그대로이고, 기록·방송하는 look 글에서는 그 말을 뺀다", async () => {
    const SAID = "냄비 어디 있지";
    const TOLD = `${SAID} 하셨는데 수납장에서 꺼내 주세요`;
    const told: string[] = [];
    const { s } = stray();
    const base = { planId: s.planId, stepId: s.stepId, label: s.label, command: s.command, at: s.at, steps: s.steps, signal: s.signal };
    const t = await setup({ script: () => [["tell_person", { text: TOLD, reason: "냄비를 찾아서" }]], options: { tell: (_p, _s, text) => { told.push(text); return true; } } });
    expect(await t.looker.heard(s.planId, s.stepId, SAID, base)).toBe("told");
    expect(told).toEqual([TOLD]);
    expect(t.looks().map((l) => l.text)).toEqual(["다시 알림 · 들은 말 하셨는데 수납장에서 꺼내 주세요"]);
    expect(JSON.stringify(t.logs)).not.toContain(SAID);
  });

  it("heard: 보기 담당이 바쁘거나, 한 시간 상한을 넘었거나, 관찰 모드가 실패하면 passed(말 요청 에이전트로 넘긴다)", async () => {
    const { s } = stray();
    const base = { planId: s.planId, stepId: s.stepId, label: s.label, command: s.command, at: s.at, steps: s.steps, signal: s.signal };
    let release!: () => void;
    const held = new Promise<void>((ok) => { release = ok; });
    const busy = await setup({ script: () => [["wait", { reason: "기다리려고" }]], gate: () => held, options: { tell: () => true } });
    try {
      expect(busy.looker.strayed(stray().s)).toBe(true);
      expect(await busy.looker.heard(s.planId, s.stepId, "뭐 해야 되지", base)).toBe("passed");
    } finally { release(); }
    await busy.looker.idle();

    const capped = await setup({ script: () => [["tell_person", { text: TELL, reason: "몰라서" }]], options: { hourMax: 1, tell: () => true } });
    expect(await capped.looker.heard(s.planId, s.stepId, "뭐 해야 되지", base)).toBe("told");
    expect(await capped.looker.heard(s.planId, s.stepId, "뭐 해야 되지", base)).toBe("passed");
    expect(capped.llm.bodies()).toHaveLength(1);

    const failed = await setup({ script: () => [["wait", { reason: "x" }]], options: { tell: () => true, observer: { decide: async () => { throw new Error("닿지 않음"); }, status: () => ({ calls: 0, requests: 0, costUsd: 0 }) } } });
    expect(await failed.looker.heard(s.planId, s.stepId, "뭐 해야 되지", base)).toBe("passed");
  });
});

describe("보기 담당: 한 시간 상한", () => {
  it("관찰 모드는 한 시간(주입 시계)에 A·B 합쳐 60번까지만 부른다. 넘으면 부르지 않고 기다리기 기록을 남기고(A면 settle(true)) 한 시간이 지나면 다시 부른다", async () => {
    expect(LOOK_DEFAULTS.hourMax).toBe(60);
    const t = await setup({ script: () => [["wait", { reason: "다음 사진을 보려고" }]], options: { hourMax: 2 } });
    t.looker.tick();
    await t.looker.idle();
    t.clock.t += 1_000;
    t.looker.stalled(stall().s);
    await t.looker.idle();
    expect(t.llm.bodies()).toHaveLength(2);

    t.clock.t += 1_000;
    const a = stall();
    expect(t.looker.stalled(a.s)).toBe(true);
    await t.looker.idle();
    expect(t.llm.bodies()).toHaveLength(2);
    expect(a.settled).toEqual([true]);
    expect(t.looks().at(-1)).toEqual({
      type: "look", at_ms: 102_000, trigger: "stalled", target: "cup_1", tool: "wait", reason: LOOK_TEXT.capped, text: "컵 쪽은 기다림", result: null,
      plan_id: "plan:pam-1", step_id: "plan:pam-1:4",
    });

    t.clock.t = 100_000 + 3_600_000;
    t.looker.stalled(stall().s);
    await t.looker.idle();
    expect(t.llm.bodies()).toHaveLength(3);
    expect(t.looker.status()).toMatchObject({ calls: 3, waits: 4 });
  });

  it("가격표에 없는 모델이면 비용은 모름(null)이다", async () => {
    const t = await setup({ script: () => [["wait", { reason: "다음 사진을 보려고" }]], options: { observer: { decide: async () => ({ tool: "wait", reason: "기다리려고" }), status: () => ({ calls: 1, requests: 1, costUsd: null }) } } });
    t.looker.tick();
    await t.looker.idle();
    expect(t.looker.status()).toEqual({ calls: 1, costUsd: null, looks: 0, asks: 0, waits: 1, tells: 0 });
  });
});
