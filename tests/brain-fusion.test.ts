// 감지 모드(YOLO 존재 판정 + VLM)와 모의 행동(acting) 상태 기계.

import { describe, expect, it } from "vitest";
import { planAction } from "../src/brain/actor.js";
import { CupMachine, type BrainEvent, type MachineOutput } from "../src/brain/machine.js";
import { normalizePerception, type RawPerception } from "../src/brain/perception.js";
import type { Presence } from "../src/brain/presence.js";

const CFG = { staleMs: 3000, awayMs: 5000, requestTimeoutMs: 60_000, clearMs: 2000, actionTimeoutMs: 120_000 };
const TASKS = ["컵 치우기", "사용자에게 물어보기"];

const view = (over: Partial<RawPerception> = {}) => normalizePerception({
  person_present: "no", person_holding_cup: "no", drinking: "no", cup_visible: "yes", cup_support: "table",
  cup_contents: { visible: false, value: "unknown", certain: false }, note: "", ...over,
});
const drinking = view({ person_present: "yes", person_holding_cup: "yes", drinking: "yes", cup_support: "hand" });
const hand = view({ person_present: "yes" });
const emptyInside = view({ cup_contents: { visible: true, value: "empty", certain: true } });

type Out = MachineOutput;
/** 존재 판정. 실제 마지막 검출 시각(seen)은 있음이면 이 프레임, 없음이면 없음으로 둔다(덮어쓸 수 있다). */
const pr = (atMs: number, over: Partial<Presence> = {}): Presence => {
  const base = { atMs, latestMs: atMs, person: "no" as const, cup: "yes" as const, table: "unknown" as const, frames: 5, scores: { person: 0, cup: 0.8 }, ...over };
  return { seen: { person: base.person === "yes" ? atMs : null, cup: base.cup === "yes" ? atMs : null }, ...base };
};
const yolo = (m: CupMachine, atMs: number, over: Partial<Presence> = {}, lagMs = 80): Out => m.observePresence(pr(atMs, over), atMs + lagMs);
const vlm = (m: CupMachine, atMs: number, p = view(), lagMs = 1500): Out => m.observe({ perception: p, evidenceAtMs: atMs }, atMs + lagMs);
const events = (outs: Out[]) => outs.flatMap((o) => o.events);
const notes = (outs: Out[]) => events(outs).filter((e): e is Extract<BrainEvent, { type: "brain" }> => e.type === "brain");
const of = <T extends BrainEvent["type"]>(outs: Out[], type: T) => events(outs).filter((e): e is Extract<BrainEvent, { type: T }> => e.type === type);

function machine(acting = true) {
  return new CupMachine(CFG, { presence: true, acting });
}

/** 마심(VLM) → 10초부터 YOLO가 사람 없음·컵 있음을 100ms마다 본다. VLM은 1초마다 부르고(거르기: VLM 확인을 기다림)
 *  10.5·11.5·…초 사진의 판정(사람 없음)이 1.5초 뒤에 온다. 첫 판정의 내용물은 absentVlm, 그 뒤는 내용물 모름. */
function leaveCup(m: CupMachine, untilMs = 15_100, over: Partial<Presence> = {}, absentVlm = view()): Out[] {
  const outs = [vlm(m, 1000, drinking), yolo(m, 9_900, { person: "yes" })];
  for (let t = 10_000; t <= untilMs; t += 100) {
    outs.push(yolo(m, t, over));
    if (t >= 12_000 && t % 1000 === 0) outs.push(vlm(m, t - 1500, t === 12_000 ? absentVlm : view()));
  }
  return outs;
}

describe("감지 모드: YOLO가 자리 비움 시계를 맡는다", () => {
  it("사용(VLM)을 본 뒤 YOLO 사람 없음·컵 있음 5초 + 그 사이 VLM 사람 없음 → 자리 비움 → 요청", () => {
    const m = machine();
    const outs = leaveCup(m);
    expect(m.state).toBe("requesting");
    expect(of(outs, "request")).toHaveLength(1);
    expect(notes(outs).some((n) => n.text.includes("자리 비움 확인(5.0초)"))).toBe(true);
  });

  it("YOLO 5초가 차도 자리 비움 뒤 찍힌 VLM 사람 없음이 없으면 기다리고, 오면 확인", () => {
    const m = machine();
    const outs = [vlm(m, 1000, drinking), yolo(m, 9_900, { person: "yes" })];
    for (let t = 10_000; t <= 16_000; t += 100) outs.push(yolo(m, t));
    expect(m.state).toBe("away_check");
    expect(m.needsVlm(16_080)).toBe(true);
    expect(notes(outs).some((n) => n.text.includes("VLM 판정(사람 없음)을 기다림"))).toBe(true);
    vlm(m, 15_500);
    expect(m.needsVlm(17_000)).toBe(false);
    yolo(m, 16_100);
    expect(m.state).toBe("requesting");
  });

  it("VLM이 손을 본 뒤 YOLO가 같은 장면을 다시 자리 비움으로 세도, 새 VLM 사람 없음 없이는 확인하지 않는다", () => {
    const m = machine();
    leaveCup(m, 11_900);
    vlm(m, 11_000, hand); // YOLO가 손을 놓침
    expect(m.state).toBe("in_use");
    for (let t = 12_000; t <= 18_000; t += 100) yolo(m, t);
    expect(m.state).toBe("away_check");
    expect(m.needsVlm(18_080)).toBe(true);
  });

  it("VLM 판정만으로는(감지 모드) 자리 비움 시계가 돌지 않는다", () => {
    const m = machine();
    vlm(m, 1000, drinking);
    for (let t = 10_000; t <= 20_000; t += 1000) vlm(m, t);
    expect(m.state).toBe("in_use");
  });

  it("YOLO 모름(프레임 모자람)·컵 없음·식탁 아니오면 처음부터", () => {
    for (const bad of [{ person: "unknown" as const }, { cup: "no" as const }, { table: "no" as const }]) {
      const m = machine();
      leaveCup(m, 13_000);
      expect(m.state).toBe("away_check");
      yolo(m, 13_100, bad);
      expect(m.state).toBe("in_use");
    }
  });

  it("식탁 모름(맞추기 전)은 막지 않는다, 식탁 예도 된다", () => {
    const m = machine();
    leaveCup(m, 15_100, { table: "yes" });
    expect(m.state).toBe("requesting");
  });

  it("YOLO 판정 사이가 3초 넘게 비면 시계를 처음부터", () => {
    const m = machine();
    leaveCup(m, 12_000);
    for (let t = 15_500; t <= 20_000; t += 100) yolo(m, t);
    expect(m.state).toBe("away_check");
  });

  it("YOLO 사람 있음이면 요청을 거두고 사용 중으로", () => {
    const m = machine();
    const outs = leaveCup(m);
    outs.push(yolo(m, 16_000, { person: "yes" }));
    expect(m.state).toBe("in_use");
    expect(of(outs, "request").map((r) => r.active)).toEqual([true, false]);
  });

  it("사람이 없어진 뒤 찍힌 VLM 판정이 손을 보면 취소, 그 전에 찍힌 판정은 지난 일이라 무시", () => {
    const m = machine();
    const outs = [vlm(m, 1000, drinking), yolo(m, 9_900, { person: "yes" })];
    for (let t = 10_000; t <= 12_000; t += 100) outs.push(yolo(m, t));
    vlm(m, 9_950, hand); // 사람이 없어지기(10.0초) 전 사진
    expect(m.state).toBe("away_check");
    vlm(m, 11_000, hand); // 없어진 뒤 사진에 손이 보임(YOLO가 놓침)
    expect(m.state).toBe("in_use");
  });

  it("자리 비움 중 VLM이 확신한 컵 안(빈 컵)을 보면 묻지 않고 바로 판단(내용물 근거 시각을 함께 넘김)", () => {
    const m = machine();
    let intents: Out["intents"] = [];
    for (const o of leaveCup(m, 15_100, {}, emptyInside)) intents = intents.concat(o.intents);
    expect(m.state).toBe("deciding");
    expect(intents).toMatchObject([{ kind: "decide", contents: "empty", contentsAtMs: 10_500 }]);
  });

  it("행동 전 재확인은 판단 뒤 찍힌 YOLO(사람 없음·컵 실제 검출)와 VLM(사람 없음)이 둘 다 있어야", () => {
    const m = machine(false);
    leaveCup(m);
    vlm(m, 16_000, emptyInside);
    expect(m.state).toBe("deciding");
    m.decided(m.generation, { observation: "o", reasoning: "빈 컵", task_index: 0 }, TASKS, 17_000);
    expect(m.state).toBe("confirming");
    yolo(m, 16_900); // 판단 전에 찍힘
    yolo(m, 17_100, { seen: { person: null, cup: 16_950 } }); // 창에 남은 판단 전 컵
    expect(m.state).toBe("confirming");
    yolo(m, 17_200); // YOLO는 통과, VLM이 아직
    expect(m.state).toBe("confirming");
    expect(m.needsVlm(17_280)).toBe(true);
    vlm(m, 17_150);
    const out = yolo(m, 17_300);
    expect(m.state).toBe("done");
    expect(notes([out]).find((n) => n.stage === "act")?.text).toMatch(/실행 제안: 컵 치우기/);
  });
});

/** 행동까지: 판단(17초) 뒤 VLM 사람 없음(17.05초 사진)과 YOLO(17.1초 사진, 17.18초 도착)로 재확인 통과.
 *  재확인 때 식탁 dining을 비췄다(table 인자로 바꿀 수 있다). */
const DINING = { table: "yes" as const, tableId: "dining" };
function toActing(m: CupMachine, task = 0, table: Partial<Presence> = DINING): Out[] {
  const outs = leaveCup(m);
  outs.push(vlm(m, 16_000, emptyInside));
  outs.push(m.decided(m.generation, { observation: "o", reasoning: "r", task_index: task }, TASKS, 17_000));
  outs.push(vlm(m, 17_050));
  outs.push(yolo(m, 17_100, table));
  return outs;
}

describe("모의 행동(acting)", () => {
  it("컵 치우기: 실제 명령 없이 폰으로 사람에게 부탁한다(dry_run)", () => {
    const m = machine();
    const outs = toActing(m);
    expect(m.state).toBe("acting");
    const [action] = of(outs, "action");
    expect(action).toMatchObject({ active: true, task: "컵 치우기", plan: { kind: "ask_person_to_clear", dry_run: true, check: "cup_gone" } });
    expect(action!.plan.prompt?.choices.map((c) => c.id)).toEqual(["done", "later"]);
  });

  it("행동 중에는 사람이 와도(치우러 옴) 거두지 않고, 식탁을 비추며 컵 없음이 2초 이어지면 치워짐", () => {
    const m = machine();
    toActing(m);
    const outs = [yolo(m, 18_000, { person: "yes", cup: "yes", ...DINING })];
    expect(m.state).toBe("acting");
    for (let t = 19_000; t <= 21_000; t += 100) outs.push(yolo(m, t, { person: "yes", cup: "no", ...DINING }));
    expect(m.state).toBe("done");
    expect(of(outs, "result")).toMatchObject([{ outcome: "cleared" }]);
    expect(of(outs, "action").at(-1)).toMatchObject({ active: false });
  });

  it("다른 식탁(책상)을 비춰 컵이 안 보이는 것은 치워짐이 아니다", () => {
    const m = machine();
    toActing(m);
    for (let t = 19_000; t <= 23_000; t += 100) yolo(m, t, { cup: "no", table: "yes", tableId: "desk" });
    expect(m.state).toBe("acting");
  });

  it("재확인 때 식탁을 몰랐으면 식탁 예라도 '치웠어요' 뒤의 컵 없음만 센다", () => {
    const m = machine();
    const id = of(toActing(m, 0, {}), "action")[0]!.id;
    for (let t = 19_000; t <= 22_000; t += 100) yolo(m, t, { cup: "no", ...DINING });
    expect(m.state).toBe("acting");
    m.actionReply(id, "done", 22_100);
    for (let t = 22_200; t <= 24_200; t += 100) yolo(m, t, { cup: "no", ...DINING });
    expect(m.state).toBe("done");
  });

  it("식탁 모름(맞추기 전)이면 카메라만 돌려 컵이 안 보여도 치워짐이 아니다. '치웠어요' 뒤의 컵 없음만 센다", () => {
    const m = machine();
    const id = of(toActing(m, 0, {}), "action")[0]!.id;
    for (let t = 19_000; t <= 22_000; t += 100) yolo(m, t, { cup: "no" });
    expect(m.state).toBe("acting");
    m.actionReply(id, "done", 22_100);
    for (let t = 22_200; t <= 24_100; t += 100) yolo(m, t, { cup: "no" });
    expect(m.state).toBe("acting");
    yolo(m, 24_200, { cup: "no" });
    expect(m.state).toBe("done");
  });

  it("컵 없음 중간에 컵이 다시 보이거나 식탁을 안 비추면 처음부터 센다", () => {
    const m = machine();
    toActing(m);
    for (let t = 19_000; t <= 20_500; t += 100) yolo(m, t, { cup: "no", ...DINING });
    yolo(m, 20_600, { cup: "no", table: "no" });
    for (let t = 20_700; t <= 22_000; t += 100) yolo(m, t, { cup: "no", ...DINING });
    expect(m.state).toBe("acting");
    for (let t = 22_100; t <= 22_800; t += 100) yolo(m, t, { cup: "no", ...DINING });
    expect(m.state).toBe("done");
  });

  it("행동을 낸 시각(17.18초) 전에 찍힌 판정은 결과로 쓰지 않는다", () => {
    const m = machine();
    toActing(m);
    yolo(m, 17_150, { cup: "no", ...DINING }); // 행동 전 사진: 세지 않음
    for (let t = 17_200; t <= 19_150; t += 50) yolo(m, t, { cup: "no", ...DINING });
    expect(m.state).toBe("acting"); // 17.2초부터 1.95초
    yolo(m, 19_200, { cup: "no", ...DINING });
    expect(m.state).toBe("done");
  });

  it("'나중에'는 미룸으로 끝, 다른 id의 답은 무시", () => {
    const m = machine();
    const outs = toActing(m);
    const id = of(outs, "action")[0]!.id;
    m.actionReply("other", "later", 18_000);
    expect(m.state).toBe("acting");
    const out = m.actionReply(id, "later", 18_100);
    expect(m.state).toBe("done");
    expect(of([out], "result")).toMatchObject([{ outcome: "declined" }]);
  });

  it("'치웠어요'만으로는 끝내지 않고 컵이 안 보이는지 본다", () => {
    const m = machine();
    const outs = toActing(m);
    m.actionReply(of(outs, "action")[0]!.id, "done", 18_000);
    expect(m.state).toBe("acting");
  });

  it("120초 안에 결과를 못 보면 확인 못 함", () => {
    const m = machine();
    toActing(m);
    const out = m.tick(17_180 + 120_001); // 행동을 낸 시각(도착 17.18초)부터
    expect(m.state).toBe("done");
    expect(of([out], "result")).toMatchObject([{ outcome: "unconfirmed" }]);
  });

  it("사용자에게 물어보기: 폰으로 묻고 답을 기록하고 끝", () => {
    const m = machine();
    const outs = toActing(m, 1);
    const [action] = of(outs, "action");
    expect(action!.plan).toMatchObject({ kind: "ask_user", check: "none" });
    const out = m.actionReply(action!.id, "clear", 18_000);
    expect(m.state).toBe("done");
    expect(of([out], "result")[0]).toMatchObject({ outcome: "answered" });
    expect(of([out], "result")[0]!.text).toMatch(/모의/);
  });

  it("VLM만 쓰는 모드(감지기 없음)는 식탁을 모르므로 '치웠어요' 뒤 VLM 컵 안 보임 2초로 결과를 본다", () => {
    const m = new CupMachine(CFG, { acting: true });
    vlm(m, 1000, drinking);
    for (let t = 10_000; t <= 15_000; t += 1000) vlm(m, t, emptyInside);
    m.decided(m.generation, { observation: "o", reasoning: "r", task_index: 0 }, TASKS, 17_000);
    const acted = vlm(m, 17_500, emptyInside); // 재확인 판정이 19.0초에 도착 → 행동
    expect(m.state).toBe("acting");
    vlm(m, 19_500, view({ person_present: "yes", cup_visible: "no" }));
    vlm(m, 21_500, view({ cup_visible: "no" }));
    expect(m.state).toBe("acting");
    m.actionReply(of([acted], "action")[0]!.id, "done", 23_100);
    vlm(m, 23_500, view({ cup_visible: "no" }));
    const out = vlm(m, 25_500, view({ cup_visible: "no" }));
    expect(m.state).toBe("done");
    expect(of([out], "result")).toMatchObject([{ outcome: "cleared" }]);
  });
});

describe("리뷰로 더한 규칙", () => {
  it("VLM 사람 없음도 오래되면(3초 넘음) 재확인에 쓰지 않는다", () => {
    const m = machine();
    leaveCup(m);
    vlm(m, 16_000, emptyInside);
    m.decided(m.generation, { observation: "o", reasoning: "r", task_index: 0 }, TASKS, 17_000);
    vlm(m, 17_050); // 판단 뒤 사람 없음
    yolo(m, 17_100, { cup: "no" }); // 컵을 못 봐 재확인 못 함
    yolo(m, 21_000); // 4초 뒤 YOLO 통과: VLM 판정은 3.95초 전이라 안 씀
    expect(m.state).toBe("confirming");
    expect(m.needsVlm(21_080)).toBe(true);
  });

  it("VLM 판정 실패가 오면 앞선 사람 없음으로 확인하지 않는다", () => {
    const m = machine();
    leaveCup(m, 14_900);
    m.observe({ perception: null, evidenceAtMs: 14_000, error: "x" }, 14_950);
    yolo(m, 15_000);
    expect(m.state).toBe("away_check");
  });

  it("구간 길이는 시작을 가장 늦은 시각, 끝을 가장 이른 시각으로 잰다(시계 오차가 줄어도 늘지 않음)", () => {
    const m = machine();
    toActing(m);
    // 시작 프레임은 오차 ±500(19.0~20.0초), 뒤 프레임은 오차 0: 실제 1.5초면 아직
    yolo(m, 19_000, { cup: "no", ...DINING, latestMs: 20_000 });
    for (let t = 19_100; t <= 21_500; t += 100) yolo(m, t, { cup: "no", ...DINING });
    expect(m.state).toBe("acting");
    yolo(m, 22_000, { cup: "no", ...DINING });
    expect(m.state).toBe("done");
  });

  it("답 사진은 더 새 장면 판정이 먼저 끝나도 받는다", () => {
    const m = machine();
    leaveCup(m); // 요청은 15.08초
    vlm(m, 15_600); // 장면 판정(15.6초 사진)이 먼저 끝남
    const out = m.observe({ perception: emptyInside, evidenceAtMs: 15_400, answer: true }, 17_200); // 15.4초 답 사진
    expect(m.state).toBe("deciding");
    expect(out.intents).toMatchObject([{ contents: "empty", contentsAtMs: 15_400 }]);
  });

  it("기계가 받아들인 컵 안 근거만 보존 대상(keepEvidence): 오래된 확신 판정은 바꾸지 않는다", () => {
    const notEmpty = view({ cup_contents: { visible: true, value: "not_empty", certain: true } });
    const m = machine();
    leaveCup(m, 12_900, {}, emptyInside); // 10.5초 사진에서 빈 컵 확신
    expect(m.keepEvidence()).toEqual([10_500]);
    m.observe({ perception: notEmpty, evidenceAtMs: 14_000 }, 20_000); // 6초 늦게 온 판정: 모름으로 버림
    expect(m.keepEvidence()).toEqual([10_500]);
  });

  it("둘째 답 사진이 다른 컵 안이면 판단 중이든 행동 중이든 거두고 다시 판단한다", () => {
    const notEmpty = view({ cup_contents: { visible: true, value: "not_empty", certain: true } });
    const m = machine();
    leaveCup(m);
    m.observe({ perception: emptyInside, evidenceAtMs: 15_400, answer: true }, 16_500);
    expect(m.state).toBe("deciding");
    const out = m.observe({ perception: notEmpty, evidenceAtMs: 15_500, answer: true }, 16_900);
    expect(out.intents).toMatchObject([{ contents: "not_empty" }]);

    const a = machine();
    const outs = toActing(a);
    expect(a.state).toBe("acting");
    const back = a.observe({ perception: notEmpty, evidenceAtMs: 16_500, answer: true }, 17_500);
    expect(of([back], "result")).toMatchObject([{ outcome: "withdrawn" }]);
    expect(of([back], "action")).toMatchObject([{ id: of(outs, "action")[0]!.id, active: false }]);
    expect(a.state).toBe("deciding");
  });

  it("답 사진이 8초보다 오래되면 쓰지 않는다", () => {
    const m = machine();
    leaveCup(m);
    const out = m.observe({ perception: emptyInside, evidenceAtMs: 15_400, answer: true }, 23_500);
    expect(m.state).toBe("requesting");
    expect(notes([out])[0]!.text).toMatch(/전 것이라 쓰지 않음/);
  });

  it("답 사진이 요청 전에 찍혔거나 컵 안을 확신하지 못하면 받지 않고 다시 찍어 달라고 한다", () => {
    const m = machine();
    leaveCup(m);
    m.observe({ perception: emptyInside, evidenceAtMs: 15_000, answer: true }, 15_500);
    expect(m.state).toBe("requesting");
    const out = m.observe({ perception: view(), evidenceAtMs: 15_300, answer: true }, 16_000);
    expect(m.state).toBe("requesting");
    expect(notes([out])[0]!.text).toMatch(/다시 찍어 주세요/);
  });
});

describe("planAction", () => {
  it("목록에 없는 작업은 지원하지 않음(기록만), 모든 행동은 dry_run", () => {
    const p = planAction("창문 열기", "act-1");
    expect(p).toMatchObject({ kind: "unsupported", dry_run: true, prompt: null, check: "none" });
    expect(planAction("컵 치우기", "a").would).toMatch(/컵/);
  });
});
