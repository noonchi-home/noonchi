// 메시지 상자 FSM 카드 자료(순수 함수, ui/src/dashboard/fsm.ts): 서버가 보낸 습관 FSM 그림(habit: 상태 목록 + 전이 목록 from·to·trigger·action)·
// 판단으로 쌓은 지금 상태와 막 일어난 전이(data.ts fsmAt) → 그릴 상태 원·선·글 자리. 카드는 지금 상태를 가운데에 둔다.
// 카드에는 사람 상태와 전이만 있고 미리 세운 목표는 없다(목표는 트윈 고리, goal.test.ts).
// 상태를 모르는 판단은 마지막 상태를 그대로 두고, 대기·그대로 두기(계획 없는 행동)는 화살표를 켜지 않는다. 카드에 안쪽 말(모름·규칙 여럿·규칙 없음·대기)은 없다.
import { describe, expect, it } from "vitest";
import type { ServerMessage } from "../../../src/contract/events.ts";
import type { PendingGoal } from "../../../src/contract/goal.ts";
import { CUP_FSM_MEMORY } from "../../../src/brain/decision.ts";
import { habitView } from "../../../src/brain/habit.ts";
import { EMPTY_DASH, reduceDash } from "../../src/dashboard/data";
import { FSM_R, fsmLayout, fsmOf, type FsmNow } from "../../src/dashboard/fsm";
import { FSM } from "../../src/lib/tokens";
import { BRANCHES, branchDecision, PLAN } from "./fixtures";

const feed = (ms: ServerMessage[]) => ms.reduce((s, m) => reduceDash(s, m, 0), EMPTY_DASH);
const HABIT: ServerMessage = { type: "habit", habit: habitView(CUP_FSM_MEMORY, 1) };
const GOAL: PendingGoal = {
  id: "goal-1", action: "컵 치우기", state: "left_cup", trigger: CUP_FSM_MEMORY.states[2]!.rules[0]!.trigger, object: "cup_1", cls: "cup", status: "armed", prep: "ready",
  reason: null, text: "컵을 두고 자리를 뜨면 컵을 치울게요", armed_ms: 1, ready_ms: 2, gone_ms: null, fired_ms: null, plan: null,
};
const BOX = { width: 460, height: 140 };
const lineOf = (v: ReturnType<typeof fsmLayout>, from: string, to: string) => v.lines.filter((l) => l.from === from && l.to === to);
const dist = (a: [number, number], b: { x: number; y: number }) => Math.hypot(a[0] - b.x, a[1] - b.y);
/** 판단 하나: 행동(null이면 대기)과 판단의 FSM 상태(null이면 모름). */
const decided = (seq: number, action: string | null, state: string | null, matched = action !== null): ServerMessage => {
  const m = branchDecision(BRANCHES.clear, seq) as Extract<ServerMessage, { type: "brain" }>;
  const e = m.event as Extract<typeof m.event, { type: "decision" }>;
  return { ...m, event: { ...e, action, fsm: { state, trigger: null, learned: false, matched } } };
};
const INSIDE = /모름|규칙 여럿|규칙 없음|대기/;

describe("FSM 카드 자료(fsmOf)", () => {
  it("습관 그림이 없으면 없다. 판단 전이면 지금 상태는 기억의 처음 상태이고 막 일어난 전이·하는 일·목표가 없다. hello면 지운다", () => {
    expect(fsmOf(EMPTY_DASH)).toBeNull();
    expect(fsmOf(feed([HABIT]))).toEqual({ habit: (HABIT as Extract<ServerMessage, { type: "habit" }>).habit, state: "drinking", from: null, doing: null });
    expect(fsmOf(feed([HABIT, { type: "hello", devices: 0, provider: null, hub: "memory", home: null }]))).toBeNull();
  });

  it("행동하는 판단이 상태를 바꾸면 지금 상태와 막 일어난 전이(앞 상태)가 된다", () => {
    expect(fsmOf(feed([HABIT, decided(1, null, "drinking"), branchDecision(BRANCHES.clear, 2)]))).toMatchObject({ state: "left_cup", from: "drinking", doing: "컵 치우기" });
  });

  it("상태를 모르는 판단(fsm.state null)은 마지막 상태·전이를 그대로 둔다", () => {
    const s = feed([HABIT, decided(1, null, "drinking"), branchDecision(BRANCHES.clear, 2), decided(3, "컵 치우기", null)]);
    expect(fsmOf(s)).toMatchObject({ state: "left_cup", from: "drinking" });
  });

  it("대기·그대로 두기(계획 없는 행동)는 화살표를 켜지 않는다: 상태가 바뀌어도 막 일어난 전이가 없고 하는 일이 없다", () => {
    const leave = fsmOf(feed([HABIT, decided(1, null, "drinking"), decided(2, "컵 그대로 두기", "left_cup")]))!;
    expect(leave).toMatchObject({ state: "left_cup", from: null, doing: null });
    const idle = fsmOf(feed([HABIT, decided(1, null, "drinking"), decided(2, null, "watching_tv", false)]))!;
    expect(idle).toMatchObject({ state: "watching_tv", from: null, doing: null });
  });

  it("하는 일은 계획이 열려 있는 동안 남고, 계획이 끝나면 없다(지켜봄). 상태와 막 일어난 전이는 그대로다", () => {
    const run = [HABIT, decided(1, null, "drinking"), branchDecision(BRANCHES.clear, 2), { type: "plan", plan: PLAN } as ServerMessage];
    expect(fsmOf(feed([...run, decided(3, null, "left_cup", false)]))).toMatchObject({ state: "left_cup", from: "drinking", doing: "컵 치우기" });
    expect(fsmOf(feed([...run, { type: "plan", plan: { ...PLAN, revision: 9, status: "done" } }]))).toMatchObject({ state: "left_cup", from: "drinking", doing: null });
  });

  it("목표가 서 있어도 카드 자료에 목표가 없다(목표는 따로 된 상태 머신)", () => {
    expect(fsmOf(feed([HABIT, { type: "goal", goal: GOAL }]))).not.toHaveProperty("goal");
  });
});

describe("FSM 카드 그림 자리(fsmLayout)", () => {
  const now = (over: Partial<FsmNow> = {}): FsmNow => ({ ...fsmOf(feed([HABIT]))!, ...over });
  const texts = (v: ReturnType<typeof fsmLayout>) => [
    ...v.nodes.flatMap((n) => [n.name, n.does]), ...[...v.lines, ...(v.loop ? [v.loop] : [])].flatMap((l) => [l.label?.text, l.label?.sub]),
  ].filter((t): t is string => !!t);

  it("상태는 한 줄로 선다: 전이 선 길이 합이 가장 작은 차례(같으면 기억 차례가 앞선 것). 컵 습관은 TV 보는 중 · 마시는 중 · 컵 두고 뜸 · 주방", () => {
    const v = fsmLayout(now(), BOX);
    expect([...v.nodes].sort((a, b) => a.x - b.x).map((n) => n.id)).toEqual(["watching_tv", "drinking", "left_cup", "cooking"]);
    expect(new Set(v.nodes.map((n) => n.y)).size).toBe(1);
  });

  it("카드가 크면 원·간격·선 굵기가 같은 배율로 커진다(글은 부품 원래 크기 그대로). 작은 카드(높이 140)는 반지름 FSM_R(44)이다", () => {
    const small = fsmLayout(now(), BOX);
    const big = fsmLayout(now(), { width: 560, height: 240 });
    expect(small.r).toBe(FSM_R);
    expect(big.r).toBeGreaterThan(small.r * 1.3);
    expect(big.k).toBeCloseTo(big.r / FSM_R, 5);
    const gap = (v: typeof small) => Math.abs(v.nodes[1]!.x - v.nodes[0]!.x);
    expect(gap(big) / gap(small)).toBeCloseTo(big.k, 5);
    expect(big.width(FSM.taken.width)).toBeCloseTo(FSM.taken.width * big.k, 5);
    const taken = (v: typeof small) => fsmLayout({ ...now(), state: "left_cup", from: "drinking" }, v === small ? BOX : { width: 560, height: 240 }).lines.find((l) => l.kind === "taken")!;
    expect(dist(taken(big).track[0]!, fsmLayout(now(), { width: 560, height: 240 }).nodes.find((n) => n.id === "drinking")!)).toBeCloseTo(big.r, 0);
  });

  it("원 위는 이름, 아래는 그 상태에서 하는 일: 지금 상태는 하는 일(없으면 「지켜봄」), 다른 상태는 제자리 전이 행동(여럿이면 「외 N」, 없으면 「지켜봄」). 카드 가운데는 지금 상태다", () => {
    const v = fsmLayout(now(), BOX);
    const at = (id: string) => v.nodes.find((n) => n.id === id)!;
    expect(at("drinking")).toMatchObject({ name: "먹거나 마시는 중", does: "지켜봄", now: true, prev: false });
    expect(at("left_cup")).toMatchObject({ name: "컵을 두고 자리를 뜸", does: "컵 치우기", now: false });
    expect(at("watching_tv").does).toBe("컵에 콜라 따라 주기 외 1");
    expect(v.focus).toEqual({ x: at("drinking").x, y: at("drinking").y });
  });

  it("전이 선: 오른쪽으로 가는 선은 위로, 왼쪽으로 가는 선은 아래로 휜다(마주 보는 두 선이 겹치지 않는다). 글은 지금 상태에서 나가는 선 중 카드 안에 드는 것만", () => {
    const v = fsmLayout(now(), BOX);
    const go = lineOf(v, "drinking", "left_cup")[0]!;
    const back = lineOf(v, "left_cup", "drinking")[0]!;
    const row = v.focus.y;
    expect(go.label).toMatchObject({ text: "컵을 두고 떠남", side: "above" });
    expect(go.label!.y).toBeLessThan(row);
    expect(back.label).toBeNull();
    expect(back.track[8]![1]).toBeGreaterThan(row);
    expect(go.track[8]![1]).toBeLessThan(row);
    expect(lineOf(v, "drinking", "watching_tv")[0]!.label).toMatchObject({ text: "TV를 보기 시작함", side: "below" });
    // 두 칸 떨어진 주방은 카드 밖이라 글이 없다
    expect(lineOf(v, "drinking", "cooking")[0]!.label).toBeNull();
    for (const t of texts(v)) expect(t).not.toMatch(/→|->/);
  });

  it("지금 상태의 제자리 고리: 하는 일이 아닌 제자리 전이의 조건과 행동(「조건 / 로봇 행동」 두 줄)", () => {
    const v = fsmLayout(now(), BOX);
    expect(v.loop).toMatchObject({ from: "drinking", to: "drinking", kind: "edge", label: { text: "식사 중 컵이 비면", sub: "컵에 물 채워 주기" } });
    // 글(왼쪽 글: 오른쪽 끝이 그 자리)은 고리 왼쪽 끝보다 왼쪽이라 고리를 가리지 않는다
    expect(v.loop!.label!.side).toBe("left");
    expect(v.loop!.label!.x).toBeLessThan(Math.min(...v.loop!.track.map((q) => q[0])));
  });

  it("전이에 행동이 있으면 선 글은 「조건」과 「로봇 행동」 두 줄이다(사람 상태 FSM 모양)", () => {
    const h = habitView(CUP_FSM_MEMORY, 1);
    const habit = { ...h, transitions: h.transitions.map((t) => (t.from === "drinking" && t.to === "left_cup" ? { ...t, action: "컵 치우기" } : t)) };
    const v = fsmLayout(now({ habit }), BOX);
    expect(lineOf(v, "drinking", "left_cup")[0]!.label).toMatchObject({ text: "컵을 두고 떠남", sub: "컵 치우기" });
  });

  // 사람 상태 FSM(feat/person-fsm): 원 = 사람이 하는 일, 화살표 = 다른 일로 넘어감, 화살표 위 = 「조건 / 로봇 행동」. 같은 자료 모양(상태·전이·지금 상태·막 일어난 전이)을 받는다
  it("사람 상태 FSM 모양도 그린다: 제자리 전이 없이 행동이 붙은 전이만 있어도 지나온 선은 「조건 / 로봇 행동」 두 줄, 지금 원은 그 행동, 고리 없음", () => {
    const person: FsmNow = {
      habit: {
        version: 7, initial: "drinking",
        states: [{ id: "drinking", name: "마시는 중", learned: false }, { id: "tv", name: "TV 보는 중", learned: false }, { id: "away", name: "자리 비움", learned: false }],
        transitions: [
          { from: "drinking", to: "away", trigger: "컵 두고 떠남", action: "컵 치우기", learned: false },
          { from: "away", to: "drinking", trigger: "돌아와 앉음", action: null, learned: false },
          { from: "drinking", to: "tv", trigger: "TV를 켬", action: null, learned: false },
          { from: "tv", to: "drinking", trigger: "식탁에 앉음", action: null, learned: false },
        ],
      },
      state: "away", from: "drinking", doing: "컵 치우기",
    };
    const v = fsmLayout(person, { width: 560, height: 240 });
    expect(lineOf(v, "drinking", "away")[0]).toMatchObject({ kind: "taken", label: { text: "컵 두고 떠남", sub: "컵 치우기" } });
    expect(v.nodes.find((n) => n.id === "away")).toMatchObject({ now: true, does: "컵 치우기" });
    expect(v.nodes.find((n) => n.id === "drinking")).toMatchObject({ prev: true });
    expect(v.loop).toBeNull();
    for (const t of texts(v)) expect(t).not.toMatch(INSIDE);
  });

  it("카드 선에는 목표 선·목표 글·점선이 없다: 선은 그 밖의 전이·나가는 전이·막 지나온 전이뿐이다", () => {
    const v = fsmLayout(fsmOf(feed([HABIT, { type: "goal", goal: GOAL }]))!, BOX);
    for (const l of [...v.lines, ...(v.loop ? [v.loop] : [])]) expect(["edge", "out", "taken"]).toContain(l.kind);
    expect(texts(v).join(" ")).not.toContain("목표");
    for (const l of v.lines) expect(l.d.match(/M/g)).toHaveLength(1);
  });

  it("막 일어난 전이(앞 상태 → 지금 상태)는 지나온 선이고 그 글을 보인다. 빨간 점은 앞 상태 원 가장자리에서 지금 상태 원 가장자리까지 간다. 앞 상태는 흐린 원이다", () => {
    const v = fsmLayout(now({ state: "left_cup", from: "drinking", doing: "컵 치우기" }), BOX);
    const taken = lineOf(v, "drinking", "left_cup")[0]!;
    const from = v.nodes.find((n) => n.id === "drinking")!;
    const to = v.nodes.find((n) => n.id === "left_cup")!;
    expect(taken).toMatchObject({ kind: "taken", label: { text: "컵을 두고 떠남" } });
    expect(dist(taken.track[0]!, from)).toBeCloseTo(FSM_R, 0);
    expect(dist(taken.track.at(-1)!, to)).toBeLessThan(FSM_R + 4);
    expect(from).toMatchObject({ prev: true, now: false });
    expect(to).toMatchObject({ now: true, does: "컵 치우기" });
    expect(lineOf(v, "left_cup", "drinking")[0]!.label).toMatchObject({ text: "돌아와 컵을 듦", side: "below" });
    expect(lineOf(v, "left_cup", "cooking")[0]!.label).toMatchObject({ text: "주방으로 감" });
    // 하는 일인 제자리 전이만 있으면 고리가 없다
    expect(v.loop).toBeNull();
    expect(v.focus).toEqual({ x: to.x, y: to.y });
  });

  it("막 일어난 전이가 없으면(대기·그대로 두기로 바뀜) 지나온 선·흐린 원이 없다", () => {
    const v = fsmLayout(now({ state: "left_cup", from: null, doing: null }), BOX);
    expect(v.lines.some((l) => l.kind === "taken")).toBe(false);
    expect(v.nodes.some((n) => n.prev)).toBe(false);
    expect(v.nodes.find((n) => n.id === "left_cup")).toMatchObject({ now: true, does: "지켜봄" });
  });

  it("카드 글에 안쪽 말(모름·규칙 여럿·규칙 없음·대기)이 없다: 상태를 모르는 판단·규칙 없는 행동·대기 판단 뒤에도", () => {
    const states = [
      feed([HABIT, decided(1, "컵 치우기", null)]),
      feed([HABIT, decided(1, "사용자에게 물어보기", "drinking", false)]),
      feed([HABIT, decided(1, null, null, false), { type: "goal", goal: GOAL }]),
      feed([HABIT, decided(1, null, "drinking"), branchDecision(BRANCHES.clear, 2), decided(3, null, null, false)]),
    ];
    for (const s of states) for (const t of texts(fsmLayout(fsmOf(s)!, BOX))) expect(t).not.toMatch(INSIDE);
  });
});
