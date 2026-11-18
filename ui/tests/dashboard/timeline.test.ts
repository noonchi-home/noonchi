// 시간 줄 자료(순수 함수, ui/src/dashboard/timeline.ts): 사람 · 예상 · 로봇 세 줄의 구간과 예상 줄 글, 사람이 떠난 때 → 첫 명령 간격.
// 숫자는 모두 서버 자료(판단 at_ms·fsm.state, 목표 armed_ms·ready_ms·gone_ms·ended_ms, 계획 단계 started_ms·ended_ms)에서 온다(2026-11-19 사용자 결정 「만들기, 1.6초 크게」).
import { describe, expect, it } from "vitest";
import type { PendingGoal } from "../../../src/contract/goal.ts";
import type { ServerMessage } from "../../../src/contract/events.ts";
import type { PlanView } from "../../../src/contract/plan.ts";
import { EMPTY_DASH, reduceDash } from "../../src/dashboard/data";
import { timelineLast, timelineOf } from "../../src/dashboard/timeline";
import { HABIT, planAt } from "./fixtures";

const feed = (ms: ServerMessage[]) => ms.reduce((s, m) => reduceDash(s, m, 0), EMPTY_DASH);
const habit: ServerMessage = { type: "habit", habit: HABIT };

/** 판단 한 줄: at 시각, state 판단 때 FSM 상태(null 모름), action 고른 행동(null 대기). */
function decision(seq: number, at: number, state: string | null, action: string | null = null, status: "valid" | "failed" = "valid"): ServerMessage {
  return {
    type: "brain",
    event: {
      type: "decision", at_ms: at, id: `pam-${seq}`, seq, text_sent: "관찰", status, prediction: null, action,
      fsm: state === null ? null : { state, from: null, next_index: -1, to: null, on: null, when: null, action, learned: false }, memory_version: 1,
      world: { objects: [], person_visible: false, vlm_missing: 0, yolo_missing: 0 },
    },
  };
}

// 실제 영상 wide-glass n2(2026-11-18) 시각: 목표 세움 4.1초, 준비됨 13.5초, 사람 떠남 15.8초, 첫 명령 19.1초
const T = 1_794_214_800_000;
const s = (sec: number) => T + Math.round(sec * 1000);
const GOAL: PendingGoal = {
  id: "goal-1", action: "컵 치우기", state: "drinking", trigger: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.", object: "cup_1", cls: "cup", status: "armed", prep: "ready",
  reason: null, text: "컵을 두고 자리를 뜨면 컵을 치울게요", armed_ms: s(4.1), ready_ms: s(13.5), gone_ms: null, fired_ms: null, plan: null,
};
/** 컵 치우기 계획: 첫 두 단계를 시작한 것(식탁으로 가기 19.1~19.2초, 컵 집기 19.2초~). */
function running(): PlanView {
  const p = planAt(2);
  return {
    ...p, steps: p.steps.map((x, i) => (i === 0 ? { ...x, status: "done", started_ms: s(19.1), ended_ms: s(19.2) } : i === 1 ? { ...x, status: "active", started_ms: s(19.2) } : { ...x, status: "pending" })),
  };
}

describe("시간 줄 자료(timelineOf)", () => {
  it("판단 전이면 없다(첫 판단 전에는 카드가 없다)", () => {
    expect(timelineOf(EMPTY_DASH)).toBeNull();
    expect(timelineOf(feed([habit]))).toBeNull();
  });

  it("사람 줄: 유효한 판단의 습관 FSM 상태가 바뀐 때마다 구간을 이어 간다(이름은 습관 그림의 상태 이름). 상태를 모르는 판단·실패한 판단은 구간을 바꾸지 않는다", () => {
    const t = timelineOf(feed([
      habit, decision(1, s(3), "drinking"), decision(2, s(8), "drinking"), decision(3, s(10), null), decision(4, s(12), "away", "컵 치우기", "failed"),
      decision(5, s(17.3), "away", "컵 치우기"),
    ]))!;
    expect(t.spans.filter((x) => x.row === "person").map(({ from, to, text }) => ({ from, to, text }))).toEqual([
      { from: s(3), to: s(17.3), text: "먹거나 마시는 중" },
      { from: s(17.3), to: null, text: "자리에 없음" },
    ]);
  });

  // 사용자 결정(2026-11-19): 「예상을 없애자」. 줄은 사람 · 로봇 둘이고 목표 글(「… · 준비됨」·「N초 먼저」)이 없다
  it("예상 줄이 없다: 목표가 서도 구간은 사람·로봇 줄뿐이고 목표 글 칸(caption)이 없다", () => {
    const used = { ...GOAL, status: "used" as const, gone_ms: s(15.8), fired_ms: s(15.8) };
    for (const goal of [GOAL, used]) {
      const t = timelineOf(feed([habit, decision(1, s(3), "drinking"), { type: "goal", goal }, { type: "plan", plan: running() }]))!;
      expect(new Set(t.spans.map((x) => x.row))).toEqual(new Set(["person", "robot"]));
      expect(Object.keys(t).sort()).toEqual(["gap", "spans"]);
      expect(JSON.stringify(t)).not.toMatch(/준비됨|세움|먼저|컵을 두고 자리를 뜨면/);
    }
  });

  it("로봇 줄: 계획 단계가 시작한 때부터 끝난 때까지(지금 단계는 brand), 계획 밖은 「지켜봄」이다", () => {
    const t = timelineOf(feed([habit, decision(1, s(3), "drinking"), { type: "plan", plan: running() }]))!;
    expect(t.spans.filter((x) => x.row === "robot").map(({ from, to, text, tone }) => ({ from, to, text, tone }))).toEqual([
      { from: Number.NEGATIVE_INFINITY, to: s(19.1), text: "지켜봄", tone: "plain" },
      { from: s(19.1), to: s(19.2), text: "식탁으로 가기", tone: "muted" },
      { from: s(19.2), to: null, text: "컵 집기", tone: "brand" },
    ]);
    const done = running();
    const closed: PlanView = { ...done, status: "done", steps: done.steps.map((x, i) => ({ ...x, status: "done", started_ms: x.started_ms ?? s(20 + i * 10), ended_ms: x.ended_ms ?? s(30 + i * 10) })) };
    const after = timelineOf(feed([habit, decision(1, s(3), "drinking"), { type: "plan", plan: closed }]))!;
    expect(after.spans.filter((x) => x.row === "robot").at(-1)).toEqual(expect.objectContaining({ from: s(60), to: null, text: "지켜봄", tone: "plain" }));
    expect(after.spans.some((x) => x.row === "robot" && x.tone === "brand")).toBe(false);
  });

  it("반응 간격: 사람이 떠난 때 → 그 뒤 같은 행동 계획의 첫 명령(첫 단계 시작) 「N.N초」. 떠나기 전 시작한 계획·다른 행동 계획은 아니다", () => {
    const used = { ...GOAL, status: "used" as const, gone_ms: s(15.8), fired_ms: s(15.8) };
    const t = timelineOf(feed([habit, decision(1, s(3), "drinking"), { type: "goal", goal: used }, { type: "plan", plan: running() }]))!;
    expect(t.gap).toEqual({ from: s(15.8), to: s(19.1), text: "3.3초" });
    const early = timelineOf(feed([habit, decision(1, s(3), "drinking"), { type: "goal", goal: { ...used, gone_ms: s(19.5) } }, { type: "plan", plan: running() }]))!;
    expect(early.gap).toBeNull();
    const other = timelineOf(feed([habit, decision(1, s(3), "drinking"), { type: "goal", goal: used }, { type: "plan", plan: { ...running(), goal: "에어컨 켜기" } }]))!;
    expect(other.gap).toBeNull();
    const none = timelineOf(feed([habit, decision(1, s(3), "drinking"), { type: "plan", plan: running() }]))!;
    expect(none.gap).toBeNull();
  });

  it("앞 계획 단계도 남는다: 새 계획이 와도 앞 계획의 시작한 단계 구간을 그대로 둔다", () => {
    const first: PlanView = { ...running(), id: "plan:pam-1", status: "cancelled", steps: running().steps.map((x, i) => (i === 1 ? { ...x, status: "skipped", ended_ms: s(21) } : x)) };
    const next: PlanView = { ...planAt(1), id: "plan:pam-2", steps: planAt(1).steps.map((x, i) => (i === 0 ? { ...x, status: "active", started_ms: s(25) } : { ...x, status: "pending" })) };
    const t = timelineOf(feed([habit, decision(1, s(3), "drinking"), { type: "plan", plan: first }, { type: "plan", plan: next }]))!;
    expect(t.spans.filter((x) => x.row === "robot").map((x) => [x.from, x.to, x.text])).toEqual([
      [Number.NEGATIVE_INFINITY, s(19.1), "지켜봄"], [s(19.1), s(19.2), "식탁으로 가기"], [s(19.2), s(21), "컵 집기"], [s(21), s(25), "지켜봄"], [s(25), null, "식탁으로 가기"],
    ]);
  });

  it("timelineLast: 자료 가운데 가장 늦은 시각(가짜 단계 화면의 지금). 없으면 null", () => {
    expect(timelineLast(EMPTY_DASH)).toBeNull();
    expect(timelineLast(feed([habit, decision(1, s(3), "drinking"), { type: "plan", plan: running() }]))).toBe(s(19.2));
  });
});
