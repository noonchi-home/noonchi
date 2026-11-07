// 감지 모드 실행기: VLM 거르기, 요청 답 사진 우선 호출, 판단 근거를 관찰 텍스트로 전달(사진 없음), 처음부터 끝(모의 행동·결과).

import { describe, expect, it } from "vitest";
import { CupBrain, type BrainOutput } from "../src/brain/brain.js";
import { DEFAULT_BRAIN_CONFIG } from "../src/brain/config.js";
import type { DecisionInput, DecisionModel } from "../src/brain/decision.js";
import type { RawPerception } from "../src/brain/perception.js";
import type { Presence } from "../src/brain/presence.js";
import type { Frame } from "../src/brain/window.js";
import { ScriptedDecision } from "./helpers/decision.js";
import { ScriptedPerceiver } from "./helpers/perceivers.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const PHOTO = Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]);
const base: RawPerception = {
  person_present: "no", person_holding_cup: "no", drinking: "no", cup_visible: "yes", cup_support: "table",
  cup_contents: { visible: false, value: "unknown", certain: false }, note: "",
};

class Spy implements DecisionModel {
  readonly name = "spy";
  inputs: DecisionInput[] = [];
  private readonly mock = new ScriptedDecision();
  whatIf = this.mock.whatIf.bind(this.mock);
  async decide(input: DecisionInput) {
    this.inputs.push(input);
    return this.mock.decide(input);
  }
}

interface Scene {
  /** 시각 → YOLO가 본 사람·컵(식탁은 모름). */
  yolo(t: number): Pick<Presence, "person" | "cup">;
  /** 시각 → VLM이 볼 장면(답 사진은 따로). null이면 판정 실패. */
  vlm(t: number): RawPerception | null;
}

function setup(scene: Scene, opts: { decision?: DecisionModel } = {}) {
  let now = 0;
  const out: BrainOutput[] = [];
  const seen: number[] = [];
  const perceiver = new ScriptedPerceiver((frames) => {
    seen.push(frames.at(-1)!.capturedAtMs);
    if (frames.length === 1 && frames[0]!.jpeg === PHOTO) return { ...base, cup_contents: { visible: true, value: "empty", certain: true }, note: "답 사진" };
    return scene.vlm(frames.at(-1)!.capturedAtMs);
  });
  const brain = new CupBrain({
    perceiver, decision: opts.decision ?? new ScriptedDecision(), config: DEFAULT_BRAIN_CONFIG, clock: { now: () => now },
    emit: (e) => out.push(e), presence: true, acting: true, time: { offsetMinutes: 540, epochMs: Date.parse("2026-11-04T03:00:00Z") },
  });
  let lastSeen = { person: null as number | null, cup: null as number | null };
  const step = async (t: number) => {
    now = t;
    brain.onFrame({ id: `f${t}`, capturedAtMs: t, jpeg: JPEG });
    const y = scene.yolo(t);
    lastSeen = { person: y.person === "yes" ? t : lastSeen.person, cup: y.cup === "yes" ? t : lastSeen.cup };
    brain.onPresence({ atMs: t, latestMs: t, ...y, table: "unknown", frames: 7, scores: { person: y.person === "yes" ? 0.8 : 0, cup: y.cup === "yes" ? 0.8 : 0 }, seen: { ...lastSeen } });
    brain.tick();
    await brain.idle();
  };
  const runTo = async (from: number, to: number) => {
    for (let t = from; t <= to; t += 84) await step(t);
  };
  return { brain, out, seen, step, runTo, setNow: (t: number) => { now = t; } };
}

const texts = (out: BrainOutput[]) => out.filter((e) => e.type === "brain").map((e) => (e as { text: string }).text);
const leave: Scene = {
  yolo: (t) => (t < 5000 ? { person: "yes", cup: "yes" } : { person: "no", cup: "yes" }),
  vlm: (t) => (t < 3000 ? { ...base, person_present: "yes", person_holding_cup: "yes", drinking: "yes", cup_support: "hand" }
    : t < 5000 ? { ...base, person_present: "yes" } : base),
};

describe("VLM 거르기(감지 모드)", () => {
  it("사람도 컵도 안 보이면 VLM을 부르지 않는다", async () => {
    const s = setup({ yolo: () => ({ person: "no", cup: "no" }), vlm: () => base });
    await s.runTo(0, 10_000);
    expect(s.brain.stats().calls).toBe(0);
  });

  it("사용 중이 된 뒤 장면 짝(사람·컵)이 그대로면 더 부르지 않는다", async () => {
    const s = setup({ yolo: () => ({ person: "yes", cup: "yes" }), vlm: leave.vlm });
    await s.runTo(0, 3000);
    expect(s.brain.machine.state).toBe("in_use");
    const calls = s.brain.stats().calls;
    await s.runTo(3084, 12_000);
    expect(s.brain.stats().calls).toBe(calls);
  });

  it("사람이 떠나면 VLM 확인(사람 없음)까지 받아 자리 비움 → 요청", async () => {
    const s = setup(leave);
    await s.runTo(0, 11_000);
    expect(s.brain.machine.state).toBe("requesting");
    expect(s.seen.some((t) => t >= 5000)).toBe(true);
  });
});

describe("요청 답 사진", () => {
  it("요청이 없으면 받지 않고, 요청 뒤 찍힌 사진은 다음 호출을 그 사진 한 장으로 하고 판단 근거로 넘긴다", async () => {
    const spy = new Spy();
    const s = setup(leave, { decision: spy });
    expect(s.brain.answerPhoto({ id: "early", capturedAtMs: 100, jpeg: PHOTO })).toBe(false);
    await s.runTo(0, 11_000);
    const req = s.out.find((e) => e.type === "request" && e.active) as { at_ms: number };
    expect(req).toBeTruthy();
    expect(s.brain.answerPhoto({ id: "before", capturedAtMs: req.at_ms - 10, jpeg: PHOTO })).toBe(false);
    const photo: Frame = { id: "photo-1", capturedAtMs: 11_050, jpeg: PHOTO };
    expect(s.brain.answerPhoto(photo)).toBe(true);
    await s.brain.idle();
    expect(s.out.some((e) => e.type === "perception" && e.answer)).toBe(true);
    expect(texts(s.out).some((t) => t.startsWith("컵 안 확인: 빈 컵(확신"))).toBe(true);
    await s.runTo(11_088, 14_000);
    expect(spy.inputs).toHaveLength(1);
    const sent = spy.inputs[0]!;
    expect(sent.text).toContain("[지속] 컵 안: 빈 컵 확신, 12:00:11 요청 답 사진");
    expect(sent.text).toMatch(/^12:00:\d\d YOLO 사람/m);
    expect(sent.text).toMatch(/^12:00:11 요청 답 사진 VLM /m);
    expect(sent.finalTime).toMatch(/^2026-11-04T12:00:1\d\.\d{3}\+09:00$/);
    expect(JSON.stringify(sent)).not.toMatch(/jpeg|base64|image/);
  });
});

describe("답 사진 두 장", () => {
  it("첫 사진 판정 중에 둘째 사진이 와도 첫 사진을 찾아 판단 근거로 넘긴다", async () => {
    const spy = new Spy();
    const s = setup(leave, { decision: spy });
    await s.runTo(0, 11_000);
    expect(s.brain.answerPhoto({ id: "photo-1", capturedAtMs: 11_050, jpeg: PHOTO })).toBe(true);
    expect(s.brain.answerPhoto({ id: "photo-2", capturedAtMs: 11_060, jpeg: PHOTO })).toBe(true);
    await s.brain.idle();
    expect(s.out.filter((e) => e.type === "perception" && e.answer)).toHaveLength(2);
    await s.runTo(11_088, 14_000);
    expect(spy.inputs[0]!.text).toContain("[지속] 컵 안: 빈 컵 확신, 12:00:11 요청 답 사진");
  });
});

describe("판단 근거 사진 보존", () => {
  it("자리 비움 중 확신한 컵 안의 사진은 판단이 10초 넘게 늦어져도 근거로 넘긴다", async () => {
    const spy = new Spy();
    // 5~6초 사진에서만 빈 컵이 보이고, 6~20초는 VLM이 계속 실패한다(판정 없음). 회복한 뒤 자리 비움이 확인된다
    const s = setup({
      yolo: leave.yolo,
      vlm: (t) => (t < 5000 ? leave.vlm(t) : t < 6000 ? { ...base, cup_contents: { visible: true, value: "empty", certain: true } } : t < 20_000 ? null : base),
    }, { decision: spy });
    await s.runTo(0, 30_000);
    expect(spy.inputs.length).toBeGreaterThan(0);
    expect(spy.inputs[0]!.text).toMatch(/\[지속\] 컵 안: 빈 컵 확신, 12:00:0[56] 장면 사진/);
  });
});

describe("멈춤(stop)", () => {
  it("멈춘 뒤에는 진행 중이던 판정이 끝나도 새 VLM·판단 모델 호출을 하지 않는다", async () => {
    const spy = new Spy();
    const s = setup(leave, { decision: spy });
    await s.runTo(0, 11_000);
    s.brain.answerPhoto({ id: "photo-1", capturedAtMs: 11_050, jpeg: PHOTO }); // 판정이 시작됨(빈 컵 → 판단 차례)
    s.brain.stop();
    await s.brain.idle();
    const calls = s.brain.stats().calls;
    await s.runTo(11_088, 14_000);
    expect(s.brain.stats().calls).toBe(calls);
    expect(spy.inputs).toHaveLength(0);
    expect(s.brain.answerPhoto({ id: "photo-2", capturedAtMs: 14_100, jpeg: PHOTO })).toBe(false);
  });
});

describe("처음부터 끝(감지 모드, 모의 행동)", () => {
  it("마심 → 자리 비움 → 요청 → 답 사진 → 판단 → 재확인 → 행동(부탁) → 치웠어요 → 컵 없음 → 치워짐", async () => {
    let gone = Infinity;
    const scene: Scene = {
      yolo: (t) => (t < 5000 ? { person: "yes", cup: "yes" } : { person: "no", cup: t >= gone ? "no" : "yes" }),
      vlm: (t) => (t >= gone ? { ...base, cup_visible: "no", cup_support: "unknown" } : leave.vlm(t)),
    };
    const s = setup(scene);
    await s.runTo(0, 11_000);
    s.brain.answerPhoto({ id: "photo-1", capturedAtMs: 11_050, jpeg: PHOTO });
    await s.brain.idle();
    await s.runTo(11_088, 16_000);
    expect(s.brain.machine.state).toBe("acting");
    const action = s.out.find((e) => e.type === "action") as Extract<BrainOutput, { type: "action" }>;
    expect(action.plan).toMatchObject({ task: "컵 치우기", dry_run: true });
    s.setNow(16_050);
    s.brain.reply(action.id, "done");
    gone = 16_100;
    await s.runTo(16_100, 19_000);
    expect(s.brain.machine.state).toBe("done");
    expect(s.out.find((e) => e.type === "result")).toMatchObject({ outcome: "cleared" });
    const order = ["컵으로 마시는 중", "자리 비움 확인", "사진 요청", "컵 안 확인", "판단 모델: 컵 치우기", "실행 제안: 컵 치우기", "실행(모의)", "치웠어요", "치워짐"];
    const t = texts(s.out);
    let at = -1;
    for (const o of order) {
      const i = t.findIndex((x, k) => k > at && x.includes(o));
      expect(i, o).toBeGreaterThan(at);
      at = i;
    }
  });
});
