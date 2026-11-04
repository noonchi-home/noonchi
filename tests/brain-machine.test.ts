import { describe, expect, it } from "vitest";
import { CupMachine, type BrainEvent, type MachineOutput } from "../src/brain/machine.js";
import { normalizePerception, type RawPerception } from "../src/brain/perception.js";

const CFG = { staleMs: 3000, awayMs: 5000, requestTimeoutMs: 60_000 };
const TASKS = ["컵 치우기", "사용자에게 물어보기"];

const view = (over: Partial<RawPerception> = {}) => normalizePerception({
  person_present: "no", person_holding_cup: "no", drinking: "no", cup_visible: "yes", cup_support: "table",
  cup_contents: { visible: false, value: "unknown", certain: false }, note: "", ...over,
});
const drinking = view({ person_present: "yes", person_holding_cup: "yes", drinking: "yes", cup_support: "hand" });
const away = view();
const emptyInside = view({ cup_contents: { visible: true, value: "empty", certain: true } });

/** 사진이 찍히자마자(지연 0.5초) 판정이 왔다고 본다. */
function see(m: CupMachine, atMs: number, p = away, lagMs = 500): MachineOutput {
  return m.observe({ perception: p, evidenceAtMs: atMs }, atMs + lagMs);
}
const notes = (outs: MachineOutput[]) => outs.flatMap((o) => o.events).filter((e): e is Extract<BrainEvent, { type: "brain" }> => e.type === "brain");
const requests = (outs: MachineOutput[]) => outs.flatMap((o) => o.events).filter((e): e is Extract<BrainEvent, { type: "request" }> => e.type === "request");

function leftAlone(m: CupMachine, from = 10_000): MachineOutput[] {
  const outs = [see(m, 1000, drinking)];
  for (let t = from; t <= from + 5000; t += 1000) outs.push(see(m, t));
  return outs;
}

describe("컵 상태 기계", () => {
  it("마시는 장면을 보면 사용 중", () => {
    const m = new CupMachine(CFG);
    const out = see(m, 1000, drinking);
    expect(m.state).toBe("in_use");
    expect(notes([out]).map((n) => n.text)).toContain("컵으로 마시는 중");
  });

  it("사용을 못 봤으면 사람 없는 컵만으로 자리 비움을 정하지 않는다", () => {
    const m = new CupMachine(CFG);
    for (let t = 0; t <= 8000; t += 1000) see(m, t);
    expect(m.state).toBe("watching");
  });

  it("컵이 보이고 사람이 없는 새 판정이 5초 이어지면 자리 비움 → 내용물 모름이면 요청", () => {
    const m = new CupMachine(CFG);
    const outs = leftAlone(m);
    expect(m.state).toBe("requesting");
    const req = requests(outs);
    expect(req).toHaveLength(1);
    expect(req[0]).toMatchObject({ active: true, text: "컵 안이 보이게 위에서 찍어 주세요" });
    expect(notes(outs).some((n) => n.stage === "away" && n.text.includes("자리 비움 확인"))).toBe(true);
  });

  it("판정 사이가 3초 넘게 비면 자리 비움 시계를 처음부터 센다", () => {
    const m = new CupMachine(CFG);
    see(m, 1000, drinking);
    see(m, 10_000);
    see(m, 14_000); // 4초 공백
    see(m, 15_000);
    expect(m.state).toBe("away_check");
    for (let t = 16_000; t <= 19_000; t += 1000) see(m, t);
    expect(m.state).toBe("requesting");
  });

  it("사람 여부를 모르거나 컵이 안 보이면 시계를 처음으로 되돌린다", () => {
    const m = new CupMachine(CFG);
    see(m, 1000, drinking);
    see(m, 10_000);
    see(m, 11_000);
    see(m, 12_000, view({ person_present: "unknown" }));
    expect(m.state).toBe("in_use");
    see(m, 13_000);
    see(m, 14_000, view({ cup_visible: "no" }));
    expect(m.state).toBe("in_use");
  });

  it("판정 실패와 오래된 근거는 모름: 상태를 넘기지 않고 시계를 되돌린다", () => {
    const m = new CupMachine(CFG);
    see(m, 1000, drinking);
    see(m, 10_000);
    const stale = m.observe({ perception: away, evidenceAtMs: 11_000 }, 15_000);
    expect(notes([stale])[0]).toMatchObject({ stage: "stale", evidence_age_ms: 4000 });
    expect(m.state).toBe("in_use");
    see(m, 16_000);
    const failed = m.observe({ perception: null, evidenceAtMs: 17_000, error: "HTTP 500" }, 17_500);
    expect(notes([failed])[0]?.stage).toBe("error");
    expect(m.state).toBe("in_use");
  });

  it("요청 중 사람이 돌아오면 요청을 거두고 사용 중으로, 이전 세대 판단 결과는 버린다", () => {
    const m = new CupMachine(CFG);
    leftAlone(m);
    const gen = m.generation;
    const back = see(m, 16_000, view({ person_present: "yes" }));
    expect(m.state).toBe("in_use");
    expect(requests([back])).toEqual([expect.objectContaining({ active: false })]);
    expect(m.generation).toBeGreaterThan(gen);
    const late = m.decided(gen, { observation: "o", reasoning: "r", task_index: 0 }, TASKS, 17_000);
    expect(late.intents).toEqual([]);
    expect(m.state).toBe("in_use");
  });

  it("요청 전에 찍힌 사진은 답으로 받지 않고, 요청 뒤 사진의 내용물로 판단을 부른다", () => {
    const m = new CupMachine(CFG);
    leftAlone(m); // 요청은 15.5초에 나감
    const early = m.observe({ perception: emptyInside, evidenceAtMs: 15_200 }, 16_000);
    expect(early.intents).toEqual([]);
    const answer = see(m, 17_000, emptyInside);
    expect(answer.intents).toEqual([{ kind: "decide", generation: m.generation, contents: "empty", endMs: 17_000 }]);
    expect(requests([answer])).toEqual([expect.objectContaining({ active: false })]);
    expect(m.state).toBe("deciding");
  });

  it("요청 답으로는 확신한 내용물만 받는다(옆모습 추정은 답이 아님)", () => {
    const m = new CupMachine(CFG);
    leftAlone(m);
    const guess = see(m, 17_000, view({ cup_contents: { visible: true, value: "not_empty", certain: false } }));
    expect(guess.intents).toEqual([]);
    expect(m.state).toBe("requesting");
  });

  it("행동 전 재확인은 판단이 끝난 뒤 찍힌 사진으로만 한다", () => {
    const m = new CupMachine(CFG);
    leftAlone(m);
    see(m, 17_000, emptyInside);
    const decided = m.decided(m.generation, { observation: "o", reasoning: "컵이 비어 있음", task_index: 0 }, TASKS, 18_000);
    expect(m.state).toBe("confirming");
    expect(notes([decided]).some((n) => n.text.includes("컵 치우기"))).toBe(true);
    const before = m.observe({ perception: away, evidenceAtMs: 17_800 }, 18_200);
    expect(m.state).toBe("confirming");
    expect(notes([before]).every((n) => n.stage !== "act")).toBe(true);
    const after = see(m, 18_500);
    expect(m.state).toBe("done");
    expect(notes([after]).find((n) => n.stage === "act")?.text).toMatch(/실행 제안: 컵 치우기/);
  });

  it("재확인에서 내용물이 바뀌면(빈 컵 → 음료 남음 확신) 행동하지 않고 다시 판단한다", () => {
    const m = new CupMachine(CFG);
    leftAlone(m);
    see(m, 17_000, emptyInside);
    m.decided(m.generation, { observation: "o", reasoning: "r", task_index: 0 }, TASKS, 18_000);
    const flipped = see(m, 18_500, view({ cup_contents: { visible: true, value: "not_empty", certain: true } }));
    expect(notes([flipped]).some((n) => n.stage === "act")).toBe(false);
    expect(flipped.intents).toEqual([expect.objectContaining({ kind: "decide", contents: "not_empty", generation: m.generation })]);
    expect(m.state).toBe("deciding");
  });

  it("판단 중에 확신한 내용물이 바뀌면 바로 다시 판단하고, 이전 판단 결과는 버린다", () => {
    const m = new CupMachine(CFG);
    leftAlone(m);
    see(m, 17_000, emptyInside);
    const first = m.generation;
    const changed = see(m, 17_500, view({ cup_contents: { visible: true, value: "not_empty", certain: true } }));
    expect(changed.intents).toEqual([expect.objectContaining({ contents: "not_empty", generation: m.generation })]);
    expect(m.generation).toBeGreaterThan(first);
    m.decided(first, { observation: "o", reasoning: "r", task_index: 0 }, TASKS, 18_000);
    expect(m.state).toBe("deciding");
  });

  it("판단 중에 찍혔지만 판단 뒤에 도착한 내용물 변경도 행동을 막고 다시 판단한다", () => {
    const m = new CupMachine(CFG);
    leftAlone(m);
    see(m, 17_000, emptyInside);
    m.decided(m.generation, { observation: "o", reasoning: "r", task_index: 0 }, TASKS, 18_000);
    const late = m.observe({ perception: view({ cup_contents: { visible: true, value: "not_empty", certain: true } }), evidenceAtMs: 17_800 }, 18_200);
    expect(late.intents).toEqual([expect.objectContaining({ contents: "not_empty" })]);
    const after = see(m, 18_500);
    expect(notes([after]).some((n) => n.stage === "act")).toBe(false);
  });

  it("사람 없음인데 마시는 중처럼 서로 맞지 않는 판정은 자리 비움으로 세지 않는다", () => {
    const m = new CupMachine(CFG);
    see(m, 1000, drinking);
    for (let t = 10_000; t <= 16_000; t += 1000) see(m, t, view({ person_present: "no", drinking: "yes" }));
    expect(m.state).toBe("in_use");
  });

  it("판단 모델이 대기(-1)면 행동 없이 끝낸다", () => {
    const m = new CupMachine(CFG);
    leftAlone(m);
    see(m, 17_000, view({ cup_contents: { visible: true, value: "not_empty", certain: true } }));
    const out = m.decided(m.generation, { observation: "o", reasoning: "음료가 남아 있음", task_index: -1 }, TASKS, 18_000);
    expect(m.state).toBe("done");
    expect(notes([out])[0]).toMatchObject({ stage: "wait" });
  });

  it("내용물이 결정을 바꾸지 않으면 묻지 않고 바로 판단한다", () => {
    const m = new CupMachine(CFG, { decisive: () => false });
    const outs = leftAlone(m);
    expect(requests(outs)).toEqual([]);
    expect(outs.flatMap((o) => o.intents)).toEqual([expect.objectContaining({ kind: "decide", contents: "unknown" })]);
  });

  it("자리 비움 때 이미 안이 보였으면 묻지 않는다", () => {
    const m = new CupMachine(CFG);
    see(m, 1000, drinking);
    const outs: MachineOutput[] = [];
    for (let t = 10_000; t <= 15_000; t += 1000) outs.push(see(m, t, emptyInside));
    expect(requests(outs)).toEqual([]);
    expect(outs.flatMap((o) => o.intents)).toEqual([expect.objectContaining({ contents: "empty" })]);
  });

  it("요청에 답이 없으면 시간이 지나 거두고 대기한다", () => {
    const m = new CupMachine(CFG);
    leftAlone(m);
    const out = m.tick(15_500 + 60_001);
    expect(m.state).toBe("done");
    expect(requests([out])).toEqual([expect.objectContaining({ active: false })]);
  });

  it("실제 VLM처럼 답이 2초 늦게 와도, 판정이 계속 오면 시간 검사로 끊지 않는다", () => {
    const m = new CupMachine(CFG);
    see(m, 1000, drinking);
    for (let t = 10_000; t <= 16_000; t += 1500) {
      see(m, t, away, 2000); // 근거 2초 뒤 도착
      m.tick(t + 2000 + 1400); // 다음 답 직전
    }
    expect(m.state).toBe("requesting");
  });

  it("내용물이 추정(확신 아님)이면 결정을 바꾸므로 그래도 묻는다", () => {
    const m = new CupMachine(CFG);
    see(m, 1000, drinking);
    const guess = view({ cup_contents: { visible: true, value: "not_empty", certain: false } });
    const outs: MachineOutput[] = [];
    for (let t = 10_000; t <= 15_000; t += 1000) outs.push(see(m, t, guess));
    expect(requests(outs)).toEqual([expect.objectContaining({ active: true })]);
  });

  it("자리 비움 확인 중 새 판정이 끊기면 멈춘다", () => {
    const m = new CupMachine(CFG);
    see(m, 1000, drinking);
    see(m, 10_000);
    m.tick(13_600);
    expect(m.state).toBe("in_use");
  });
});
