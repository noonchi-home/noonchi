import { describe, expect, it } from "vitest";
import { CupBrain, type BrainOutput } from "../src/brain/brain.js";
import { DEFAULT_BRAIN_CONFIG } from "../src/brain/config.js";
import type { DecisionInput, DecisionModel, Prediction } from "../src/brain/decision.js";
import type { RawPerception } from "../src/brain/perception.js";
import { ScriptedDecision } from "./helpers/decision.js";
import { ScriptedPerceiver } from "./helpers/perceivers.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const base: RawPerception = {
  person_present: "no", person_holding_cup: "no", drinking: "no", cup_visible: "yes", cup_support: "table",
  cup_contents: { visible: false, value: "unknown", certain: false }, note: "",
};

/** 0~3초 마심, 3~5초 사람 있음, 그 뒤 자리 비움. 요청이 뜬 뒤에는 컵 안(빈 컵)이 보인다. */
function scene(state: { requested: boolean; back: number | null }) {
  return (frames: readonly { capturedAtMs: number }[]): RawPerception => {
    const t = frames.at(-1)!.capturedAtMs;
    if (state.back !== null && t >= state.back) return { ...base, person_present: "yes" };
    if (t < 3000) return { ...base, person_present: "yes", person_holding_cup: "yes", drinking: "yes", cup_support: "hand" };
    if (t < 5000) return { ...base, person_present: "yes" };
    if (state.requested) return { ...base, cup_contents: { visible: true, value: "empty", certain: true } };
    return base;
  };
}

async function run(opts: { decision?: DecisionModel; untilMs?: number; back?: number | null; awayMs?: number; requestTimeoutMs?: number; scene?: typeof scene } = {}) {
  let now = 0;
  const state = { requested: false, back: opts.back ?? null };
  const out: BrainOutput[] = [];
  const brain = new CupBrain({
    perceiver: new ScriptedPerceiver((opts.scene ?? scene)(state)),
    decision: opts.decision ?? new ScriptedDecision(),
    config: { ...DEFAULT_BRAIN_CONFIG, awayMs: opts.awayMs ?? DEFAULT_BRAIN_CONFIG.awayMs, requestTimeoutMs: opts.requestTimeoutMs ?? DEFAULT_BRAIN_CONFIG.requestTimeoutMs },
    clock: { now: () => now },
    emit: (e) => {
      out.push(e);
      if (e.type === "request") state.requested = e.active;
    },
    time: { offsetMinutes: 540, epochMs: Date.parse("2026-11-04T03:00:00Z") },
  });
  for (let i = 0; (i * 1000) / 12 <= (opts.untilMs ?? 25_000); i++) {
    now = Math.round((i * 1000) / 12);
    brain.onFrame({ id: `f${i}`, capturedAtMs: now, jpeg: JPEG });
    brain.tick();
    await brain.idle();
  }
  return { out, brain };
}

const texts = (out: BrainOutput[]) => out.filter((e) => e.type === "brain").map((e) => (e as { text: string }).text);

describe("상위 판단 실행기(컵 시나리오, 모의 판정·모의 판단)", () => {
  it("마심 → 자리 비움 → 컵 안 요청 → 답 → 판단 → 재확인 → 실행 제안까지 간다", async () => {
    const { out, brain } = await run();
    const t = texts(out);
    const order = ["컵으로 마시는 중", "자리 비움 확인", "사진 요청", "컵 안 확인: 빈 컵", "판단 모델: 컵 치우기", "실행 제안: 컵 치우기"];
    let at = -1;
    for (const want of order) {
      const i = t.findIndex((x, k) => k > at && x.includes(want));
      expect(i, `${want} 순서`).toBeGreaterThan(at);
      at = i;
    }
    expect(out.filter((e) => e.type === "request").map((e) => (e as { active: boolean }).active)).toEqual([true, false]);
    expect(brain.stats()).toMatchObject({ state: "done" });
    expect(brain.stats().calls).toBeLessThanOrEqual(26);
  });

  it("판단 모델에는 사진 없이 관찰 텍스트·최종 시각·기억·작업 목록이 간다", async () => {
    const seen: DecisionInput[] = [];
    const spy: DecisionModel = {
      name: "spy",
      whatIf: (f, tasks) => new ScriptedDecision().whatIf(f, tasks),
      decide: async (input): Promise<Prediction> => { seen.push(input); return new ScriptedDecision().decide(input); },
    };
    await run({ decision: spy });
    expect(seen).toHaveLength(1);
    const lines = seen[0]!.text.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    const times = lines.filter((l) => !l.startsWith("[")).map((l) => l.slice(0, 8));
    expect(times).toEqual([...times].sort());
    expect(lines.every((l) => /^(\d\d:\d\d:\d\d(~\d\d:\d\d:\d\d)? |\[지속\] )/.test(l))).toBe(true);
    expect(seen[0]!.finalTime).toMatch(/[+-]\d\d:\d\d$/);
    expect(Object.keys(seen[0]!).sort()).toEqual(["facts", "finalTime", "memory", "memoryKind", "tasks", "text"]);
    expect(seen[0]!.facts.contents).toBe("empty");
    expect(seen[0]!.tasks).toContain("컵 치우기");
  });

  it("요청 중 사람이 돌아오면 요청을 거두고 행동하지 않는다", async () => {
    const { out } = await run({ back: 12_000 });
    expect(texts(out).some((x) => x.includes("사람이 돌아옴"))).toBe(true);
    expect(texts(out).some((x) => x.includes("실행 제안"))).toBe(false);
    expect(out.filter((e) => e.type === "request").map((e) => (e as { active: boolean }).active)).toEqual([true, false]);
  });

  it("판정마다 기록을 남긴다(근거 나이·비용)", async () => {
    const { out } = await run({ untilMs: 3000 });
    const logs = out.filter((e) => e.type === "perception");
    expect(logs.length).toBeGreaterThan(1);
    expect(logs[0]).toMatchObject({ evidence_age_ms: 0, cost_usd: 0 });
  });

  it("시작 직후라 관찰이 짧아도 바로 판단한다", async () => {
    const early = (st: { requested: boolean; back: number | null }) => (frames: readonly { capturedAtMs: number }[]): RawPerception => {
      const t = frames.at(-1)!.capturedAtMs;
      if (t < 1000) return { ...base, person_present: "yes", person_holding_cup: "yes", drinking: "yes", cup_support: "hand" };
      if (st.requested) return { ...base, cup_contents: { visible: true, value: "empty", certain: true } };
      return base;
    };
    const { out, brain } = await run({ awayMs: 1000, untilMs: 14_000, scene: early });
    const t = texts(out);
    expect(t.some((x) => x.includes("판단 모델 실패"))).toBe(false);
    expect(t.some((x) => x.includes("실행 제안: 컵 치우기"))).toBe(true);
    expect(brain.stats().state).toBe("done");
  });

  it("판단 모델이 실패하면 대기로 끝낸다", async () => {
    const broken: DecisionModel = { name: "broken", decide: async () => { throw new Error("연결 전"); } };
    const { out, brain } = await run({ decision: broken });
    expect(texts(out).some((x) => x.includes("판단 모델 실패(연결 전)"))).toBe(true);
    expect(brain.stats().state).toBe("done");
  });
});
