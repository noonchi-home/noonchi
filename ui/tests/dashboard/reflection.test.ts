// @vitest-environment node
// 밤 반성 화면 차례(ui/src/dashboard/reflection.ts): 반성 자료 하나 → 단계 순간 목록(트윈 맞출 곳·밝힐 방·표시, 「FSM 바뀜」 칸 화살표, 머무는 시간).
import { describe, expect, it } from "vitest";
import type { ReflectionDetail } from "../../../src/contract/reflection.ts";
import { HOLD, graphOf, reflectionMoments, startMoment, type ReflectionMoment } from "../../src/dashboard/reflection";

const shape = (id: string, x: number) => ({ id, label: id, floor: [[x, 0], [x + 100, 0], [x + 100, 100], [x, 100]] as [number, number][], top: [] as [number, number][], sides: [], path: "", center: [x + 50, 50] as [number, number] });
const PLACE = { shapes: [shape("kitchen", 0), shape("living", 400)], table: { at: [1, 0.75, 1] as [number, number, number], px: [450, 50] as [number, number] }, sink: { at: [5.86, 0.9, 0.693] as [number, number, number], px: [50, 60] as [number, number] } };
const ASK = "사용자에게 물어보기", CUP = "컵 치우기";
const GRAPH = { states: ["drinking", "watching_tv", "cooking", "away"], edges: [
  { from: "drinking", to: "*", action: ASK }, { from: "watching_tv", to: "*", action: ASK },
  { from: "cooking", to: "cooking", action: "라면 끓이기 알려 주기" }, { from: "away", to: "drinking", action: null },
] };
const DETAIL: ReflectionDetail = {
  ok: true, day: "2026-11-27", state: "done", rejected: false, at_ms: 1, before: { version: 2 }, after: { version: 4, applies_day: "2026-11-28" },
  graph: GRAPH,
  after_graph: { states: GRAPH.states, edges: GRAPH.edges.map((e) => (e.from === "drinking" ? { ...e, action: CUP } : e)) },
  chunks: [{ start: "08:10:00", end: "08:24:30", state: "drinking", room: "kitchen" }, { start: "14:30:00", end: "14:40:00", state: null, room: "living" }],
  did: [{ action: CUP, at: "14:41:10", via: "person" }],
  candidates: [{ state: "drinking", to: "*", action: CUP }, { state: "watching_tv", to: "*", action: CUP }],
  dropped: [{ from: "cooking", to: "cooking", action: "라면 끓이기 알려 주기", reason: "coach", seen: null, fired: null, p: null }],
  checks: [
    { state: "drinking", to: "*", action: CUP, n: 2, k: 2, unknown: 0, rate: 1, p_value: 0.0001, passed: true, moments: [
      { day: "2026-11-26", at: "08:24:00", verdict: "followed", action_at: "08:25:10", via: "person" },
      { day: "2026-11-27", at: "14:40:20", verdict: "followed", action_at: "14:41:10", via: "person" },
    ] },
    { state: "watching_tv", to: "*", action: CUP, n: 3, k: 1, unknown: 1, rate: 1 / 3, p_value: 0.0297, passed: false, moments: [
      { day: "2026-11-25", at: "21:00:00", verdict: "not_followed", action_at: null, via: null },
      { day: "2026-11-26", at: "21:10:00", verdict: "followed", action_at: "21:12:00", via: "person" },
      { day: "2026-11-26", at: "22:00:00", verdict: "unseen", action_at: null, via: null },
      { day: "2026-11-27", at: "13:00:00", verdict: "not_followed", action_at: null, via: null },
    ] },
  ],
  learned: [{ from: "drinking", to: "*", action: CUP, was: ASK, was_to: "*" }],
  skipped_to: "2026-11-28", window_s: 300, rate_min: 0.75, alpha: 0.001,
};
const DRINK = `cand:drinking>*:${CUP}`, TV = `cand:watching_tv>*:${CUP}`, DROP = "drop:cooking>cooking:라면 끓이기 알려 주기";
const edge = (m: ReflectionMoment, key: string) => m.pane.edges.find((e) => e.key === key);

describe("밤 반성 단계 순간", () => {
  const ms = reflectionMoments(DETAIL, PLACE);
  it("단계 차례: 덩어리마다 1 → 2 → 3 → 날마다 4 → 5 → 6 → 7", () => {
    expect(ms.map((m) => m.step)).toEqual([1, 1, 2, 3, 4, 4, 4, 5, 6, 7]);
    expect(ms.map((m) => m.holdMs)).toEqual([HOLD.chunk, HOLD.chunk, HOLD.did, HOLD.candidate, HOLD.day, HOLD.day, HOLD.day, HOLD.adopt, HOLD.fsm, HOLD.end]);
    expect(ms.map((m) => m.pane.step)).toEqual(["하루 묶기", "하루 묶기", "사람이 한 일", "후보", "날마다 셈", "날마다 셈", "날마다 셈", "채택 검사", "FSM 바뀜", "밤 반성 끝"]);
  });

  it("트윈: 하루 묶기는 그 방만 밝히고 상태는 짧은 이름, 모르면 시각만. 2~6단계는 식탁과 싱크대", () => {
    expect(ms[0]).toMatchObject({ rooms: ["kitchen"], marks: [{ text: "08:10~08:24 · 마시는 중", px: [50, 50] }] });
    expect(ms[1]!.marks.map((m) => m.text)).toEqual(["14:30~14:40"]);
    expect(ms[2]!.marks.map((m) => m.text)).toEqual(["14:41 · 컵 치우기 · 직접 함"]);
    expect(ms[3]!.marks.map((m) => [m.kind, m.text])).toEqual([["goal", "후보 · 컵 치우기"]]);
    expect(ms[4]!.marks).toEqual([]);
    expect(ms[5]!.marks.map((m) => m.text)).toContain("11월 26일 · 1분 10초 뒤 따라옴");
    expect(ms[7]!.marks.map((m) => m.text)).toEqual(["채택 · 컵 치우기"]);
    expect(ms[8]!.marks.map((m) => m.text)).toEqual(["11월 28일부터 · 컵 치우기"]);
    expect(ms[2]!.focus).toEqual(ms[7]!.focus);
  });

  it("FSM 칸: 지금 FSM은 실선, 후보는 점선과 「컵 치우기?」, 뺀 후보는 회색 점선과 까닭", () => {
    expect(ms[0]!.pane.edges.every((e) => e.line === "solid" && e.tone === "current")).toBe(true);
    expect(edge(ms[3]!, DRINK)).toMatchObject({ from: "drinking", to: "*", line: "dashed", tone: "candidate", chips: ["컵 치우기?"] });
    expect(edge(ms[3]!, DROP)).toMatchObject({ line: "dashed", tone: "rejected", chips: ["라면 끓이기 알려 주기", "코치 행동"] });
  });

  it("날마다 뒤따름 수가 늘고, 못 봄은 끝에 붙는다. 마지막 날 수는 채택 셈과 같다", () => {
    expect(edge(ms[4]!, DRINK)!.chips).toEqual(["컵 치우기?"]);
    expect(edge(ms[4]!, TV)!.chips).toEqual(["컵 치우기?", "뒤따름 0 / 1"]);
    expect(edge(ms[5]!, TV)!.chips).toEqual(["컵 치우기?", "뒤따름 1 / 2", "못 봄 1"]);
    expect(edge(ms[6]!, DRINK)!.chips).toEqual(["컵 치우기?", "뒤따름 2 / 2"]);
    expect(edge(ms[6]!, TV)!.chips).toEqual(["컵 치우기?", "뒤따름 1 / 3", "못 봄 1"]);
  });

  it("채택 검사: 숫자와 기준을 붙이고, 못 지난 후보는 회색이 된다", () => {
    expect(edge(ms[7]!, DRINK)).toMatchObject({ tone: "candidate", chips: ["컵 치우기?", "뒤따름 2 / 2", "100% (75% 이상) · 우연일 확률 0.0001 (0.001 미만) · 통과"] });
    expect(edge(ms[7]!, TV)).toMatchObject({ tone: "rejected", chips: ["컵 치우기?", "뒤따름 1 / 3", "못 봄 1", "33% (75% 이상) · 우연일 확률 0.03 (0.001 미만) · 통과 못 함"] });
  });

  it("FSM 바뀜: 배운 화살표는 실선과 「11월 28일부터」, 바꾼 묻기 화살표는 지우고, 못 지난 후보는 숫자 까닭만 남긴다", () => {
    expect(edge(ms[8]!, DRINK)).toMatchObject({ line: "solid", tone: "adopted", chips: ["컵 치우기", "11월 28일부터"] });
    expect(edge(ms[8]!, "cur:drinking>*")).toBeUndefined();
    expect(edge(ms[8]!, "cur:watching_tv>*")).toMatchObject({ line: "solid", tone: "current" });
    expect(edge(ms[8]!, TV)).toMatchObject({ line: "dashed", tone: "rejected", chips: ["컵 치우기", "뒤따름 1 / 3"] });
    expect(ms[9]!.pane.edges).toEqual(ms[8]!.pane.edges);
  });

  it("전에 배운 화살표가 새 판본(after_graph)에서 빠지면 FSM 바뀜에서 그 실선을 지운다", () => {
    const learnedBefore = { ...GRAPH, edges: [...GRAPH.edges, { from: "drinking", to: "away", action: CUP }] };
    const out = reflectionMoments({ ...DETAIL, graph: learnedBefore, after_graph: GRAPH, learned: [], after: { version: 4, applies_day: "2026-11-28" } }, PLACE);
    expect(edge(out[0]!, "cur:drinking>away")).toBeDefined();
    expect(edge(out.find((m) => m.step === 6)!, "cur:drinking>away")).toBeUndefined();
    expect(edge(out.find((m) => m.step === 6)!, "cur:drinking>*")).toMatchObject({ line: "solid", tone: "current" });
  });

  it("후보 없이 배운 화살표(맥주 규칙)도 FSM 바뀜에 실선으로 나오고, 검사가 없는 밤에도 FSM 바뀜 단계가 있다. 끝 칸은 그 칸이다", () => {
    const BEER = "맥주 가져다주기";
    const out = reflectionMoments({ ...DETAIL, candidates: [], checks: [], dropped: [],
      after_graph: { states: GRAPH.states, edges: [...GRAPH.edges, { from: "watching_tv", to: "watching_tv", action: BEER }] },
      learned: [{ from: "watching_tv", to: "watching_tv", action: BEER, was: null, was_to: null }] }, PLACE);
    expect(out.map((m) => m.step)).toEqual([1, 1, 2, 3, 6, 7]);
    const six = out.find((m) => m.step === 6)!;
    expect(edge(six, `learn:watching_tv>watching_tv:${BEER}`)).toMatchObject({ line: "solid", tone: "adopted", chips: [BEER, "11월 28일부터"] });
    expect(edge(six, "cur:watching_tv>watching_tv")).toBeUndefined();
    expect(out.at(-1)!.pane.edges).toEqual(six.pane.edges);
  });

  it("검사가 있는 밤에도 후보와 짝이 없는 배운 화살표(물 습관)를 더하고, 새 판본에만 있는 새 상태도 그린다", () => {
    const WATER = "물 한 잔 가져다주기";
    const out = reflectionMoments({ ...DETAIL,
      after_graph: { states: [...GRAPH.states, "studying", "reading"], edges: [...DETAIL.after_graph!.edges, { from: "studying", to: "studying", action: WATER }, { from: "reading", to: "away", action: null }] },
      learned: [...DETAIL.learned, { from: "studying", to: "studying", action: WATER, was: null, was_to: null }] }, PLACE);
    const six = out.find((m) => m.step === 6)!;
    expect(six.pane.states).toEqual(expect.arrayContaining(["studying", "reading"]));
    expect(edge(six, "cur:reading>away")).toMatchObject({ line: "solid", tone: "current" });
    expect(edge(six, `learn:studying>studying:${WATER}`)).toMatchObject({ line: "solid", tone: "adopted" });
    expect(edge(six, DRINK)).toMatchObject({ line: "solid", tone: "adopted" });
    expect(edge(six, `learn:drinking>*:${CUP}`)).toBeUndefined();
  });

  it("비율은 넘었는데 우연일 확률로 못 지나면 그 숫자가 까닭이다", () => {
    const one = reflectionMoments({ ...DETAIL, learned: [], after_graph: GRAPH, candidates: [DETAIL.candidates[0]!],
      checks: [{ ...DETAIL.checks[0]!, n: 1, k: 1, p_value: 0.01, passed: false, moments: [DETAIL.checks[0]!.moments[1]!] }] }, PLACE);
    expect(edge(one.at(-1)!, DRINK)).toMatchObject({ tone: "rejected", chips: ["컵 치우기", "우연일 확률 0.01"] });
    expect(edge(one.at(-1)!, "cur:drinking>*")).toBeDefined();
  });

  it("반성이 실패하면 끝 순간 하나이고 지금 FSM 그림에 「반성 실패」, 기억 검사를 못 지나면 「반성 기억 안 씀」", () => {
    const failed = reflectionMoments({ ...DETAIL, state: "failed", chunks: [], did: [], candidates: [], dropped: [], checks: [], learned: [], after: null, after_graph: null }, PLACE);
    expect(failed.map((m) => m.step)).toEqual([7]);
    expect(failed[0]).toMatchObject({ holdMs: HOLD.failed, focus: null, pane: { step: "반성 실패" } });
    expect(reflectionMoments({ ...DETAIL, state: "failed", rejected: true }, PLACE)[0]!.pane.step).toBe("반성 기억 안 씀");
  });

  it("0단계는 대시보드가 받은 지금 FSM 그림이고 반성이 끝날 때까지 머문다. 조건 글(trigger)은 버린다", () => {
    const graph = graphOf({ version: 3, initial: "away", states: [{ id: "drinking", name: "먹거나 마시는 중", learned: false }],
      transitions: [{ from: "drinking", to: "*", trigger: "모델 글", action: ASK, learned: false }] });
    expect(graph).toEqual({ states: ["drinking"], edges: [{ from: "drinking", to: "*", action: ASK }] });
    expect(startMoment(graph)).toMatchObject({ step: 0, holdMs: Infinity, focus: null, pane: { step: "밤 반성 중", states: ["drinking"], edges: [{ key: "cur:drinking>*", line: "solid", tone: "current", chips: [] }] } });
  });
});
