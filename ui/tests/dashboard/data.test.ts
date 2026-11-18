// 대시보드 자료 리듀서(data.ts): 서버 메시지 → 단계 번호·마스코트 방향·말·메시지 상자. 자료는 가짜 단계(fake-run.json, scripts/twin3d/fake-run.ts).
// 메시지 상자는 서버가 보낸 짧은 메시지(thought)와 말풍선 카드 말(say)을 받은 차례로 쌓아 최근 두 줄을 보인다. PAM 원래 생각(reasoning)은 싣지 않는다.
import { describe, expect, it } from "vitest";
import type { ServerMessage } from "../../../src/contract/events.ts";
import type { PendingGoal } from "../../../src/contract/goal.ts";
import { EMPTY_DASH, modeNow, reduceDash, stepIndex, TALK_SHOWN, talkOf } from "../../src/dashboard/data";
import run from "../../src/dashboard/fake-run.json";
import { CUP_FSM_MEMORY, fsmRuleOf } from "../../../src/brain/decision.ts";
import { BRANCHES, COACH, LEFT_SAY, MESSAGES, PLAN, REASON, branchDecision, type Branch } from "./fixtures";

const feed = (ms: ServerMessage[], now = 0) => ms.reduce((s, m) => reduceDash(s, m, now), EMPTY_DASH);
const at = (i: number) => feed(run.moments[i]!.messages as ServerMessage[]);
/** 서버 메시지 묶음 하나: 판단 id와 시각으로 id를 붙인 짧은 문장들. */
const said = (decision: string, atMs: number, ...texts: string[]): ServerMessage =>
  ({ type: "thought", messages: texts.map((text, i) => ({ id: `${decision}@${atMs}:${i}`, text, at_ms: atMs, decision })) });
const textsOf = (s: ReturnType<typeof feed>) => talkOf(s)?.lines.map((m: { text: string }) => m.text);

describe("대시보드 자료", () => {
  it("지켜보기: 계획 없음, 마스코트는 그림 그대로. 줄이 없으면 메시지 상자 자료가 없다", () => {
    const s = at(0);
    expect(stepIndex(s.plan)).toBe(0);
    expect(talkOf(s)!.lines.length).toBeGreaterThan(0);
    expect(talkOf(EMPTY_DASH)).toBeNull();
  });
  it("메시지 상자 줄: 생각 메시지와 말풍선 카드 말을 받은 차례로 쌓고 최근 TALK_SHOWN(3)줄을 보인다. 같은 id·같은 말은 한 번만이고 원래 생각은 싣지 않는다", () => {
    expect(TALK_SHOWN).toBe(3);
    const s = feed([said("pam-1", 10, "사람이 컵을 두고 떠났어요", "컵이 비어 보여요"), { type: "say", text: "컵을 치울게요." }, { type: "say", text: "컵을 치울게요." }]);
    expect(textsOf(s)).toEqual(["사람이 컵을 두고 떠났어요", "컵이 비어 보여요", "컵을 치울게요."]);
    expect(textsOf(reduceDash(s, said("pam-1", 10, "사람이 컵을 두고 떠났어요"), 0))).toEqual(["사람이 컵을 두고 떠났어요", "컵이 비어 보여요", "컵을 치울게요."]);
    expect(textsOf(reduceDash(s, said("pam-2", 1, "컵을 찾았어요"), 0))).toEqual(["컵이 비어 보여요", "컵을 치울게요.", "컵을 찾았어요"]);
    expect(JSON.stringify(talkOf(feed([branchDecision(BRANCHES.clear, 1), said("pam-1", 10, "컵을 두고 자리를 뜨면 치워도 된다고 하셨어요")]))!)).not.toContain(REASON);
  });
  it("메시지 상자 자료는 줄만이다: 알약(상태·트리거·액션)·목표 알약이 없다(습관 FSM은 FSM 카드, fsm.ts)", () => {
    const one = said("pam-1", 10, "컵을 살피고 있어요");
    expect(talkOf(feed([branchDecision(BRANCHES.clear, 1), one]))).toEqual({ lines: [{ id: "pam-1@10:0", text: "컵을 살피고 있어요" }] });
    expect(talkOf(feed([branchDecision(BRANCHES.clear, 1)]))).toBeNull();
    expect(JSON.stringify(talkOf(feed([branchDecision(BRANCHES.clear, 1), one])))).not.toContain("배운 습관");
  });
  // Codex(2a449e5 data.ts:75·126): 쓰러짐·끄기 안내 뒤 생각 두 줄이 오면 아직 유효한 안전 알림이 밀려 사라졌다
  it("안전 알림(say safety)이 유효한 동안 메시지 상자 최신 줄은 늘 그 알림이고, 안전 아닌 말이 오면 풀린다", () => {
    const fall = "사람이 쓰러진 것 같아요.";
    const s = feed([said("pam-0", 5, "식탁을 보고 있어요"), { type: "say", text: fall, safety: true }, said("pam-1", 10, "사람이 보여요", "자세가 낮아요")]);
    expect(textsOf(s)).toEqual(["사람이 보여요", "자세가 낮아요", fall]);
    const more = reduceDash(s, said("pam-2", 20, "계속 지켜볼게요"), 0);
    expect(textsOf(more)).toEqual(["자세가 낮아요", "계속 지켜볼게요", fall]);
    const over = reduceDash(more, { type: "say", text: "지켜보고 있어요." }, 0);
    expect(textsOf(over)).toEqual(["자세가 낮아요", "계속 지켜볼게요", "지켜보고 있어요."]);
    expect(textsOf(reduceDash(more, { type: "say", text: null }, 0))).toEqual(["사람이 보여요", "자세가 낮아요", "계속 지켜볼게요"]);
  });
  it("지금 행동의 모드(modeNow)는 서버가 정한 mode 메시지 그대로다(src/act/mode.ts): 판단·계획의 행동 종류로 화면이 따로 정하지 않는다. 받기 전이면 없다", () => {
    const one = said("pam-1", 10, "컵을 살피고 있어요");
    const mode = (m: "noonchi" | "coach"): ServerMessage => ({ type: "mode", mode: m });
    expect(modeNow(feed([one]))).toBeNull();
    expect(modeNow(feed([mode("noonchi"), branchDecision(COACH, 1), one]))).toBe("noonchi");
    expect(modeNow(feed([mode("coach"), branchDecision(BRANCHES.clear, 1), { type: "plan", plan: PLAN }]))).toBe("coach");
    expect(modeNow(feed([mode("coach"), one, mode("noonchi")]))).toBe("noonchi");
  });
  // Codex(f8b6209 data.ts:93): 동시에 나간 판단의 옛 응답이 화면을 덮었다
  it("seq가 더 작은 늦은 판단은 화면에 쓰지 않는다", () => {
    const one = said("pam-1", 10, "컵을 살피고 있어요");
    const late = feed([branchDecision(BRANCHES.clear, 2), { type: "plan", plan: PLAN }, branchDecision(COACH, 1), one]);
    expect(late.decision!.seq).toBe(2);
    expect(late.decision!.action).toBe("컵 치우기");
  });
  it("계획 단계마다 번호·마스코트·말이 따라간다", () => {
    const says = ["식탁으로 갈게요.", "컵을 들게요.", "싱크대로 갈게요.", "컵을 싱크대에 넣을게요."];
    for (let n = 1; n <= 4; n++) {
      const s = at(n);
      expect([stepIndex(s.plan), s.say, textsOf(s)?.at(-1)]).toEqual([n, says[n - 1], says[n - 1]]);
    }
  });
  it("추정 눈은 버리고, 같은 계획의 옛 번호도 버린다", () => {
    const s = at(2);
    const eye = reduceDash(s, { type: "eye", eye: { ...s.eye!, position: [0, 0], estimated: true } }, 0);
    expect(eye.eye!.position).toEqual(s.eye!.position);
    const old = reduceDash(s, { type: "plan", plan: { ...s.plan!, revision: s.plan!.revision - 1 } }, 0);
    expect(old.plan).toBe(s.plan);
  });
  it("물체 모양(seen)은 대시보드 자료에 넣지 않는다(초당 10번 와도 화면 전체를 다시 그리지 않게, masks.ts 저장소가 든다). 가짜 단계에는 컵 모양 seen이 있다", () => {
    const s = at(1);
    const seen = (run.moments[1]!.messages as ServerMessage[]).find((m) => m.type === "seen")!;
    expect(seen).toMatchObject({ type: "seen", frame: { width: 405, height: 720 }, shapes: [{ label: "cup" }] });
    expect(reduceDash(s, seen, 5)).toBe(s);
    expect(Object.keys(s).sort()).toEqual(["decision", "eye", "fsmAt", "goal", "habit", "mode", "plan", "reflection", "safety", "say", "says", "talk", "thoughts"]);
  });
  describe("반성 뒤 메시지 상자", () => {
    const NIGHT = { state: "left_cup", trigger: "밤에 사용자가 식탁을 떠난다.", action: "컵 치우기" };
    const AIRCON = { state: "watching_tv", trigger: "사용자가 TV를 보러 소파에 앉는다.", action: "에어컨 켜기" };
    const reflected = (at: number, learned: typeof NIGHT[], active: typeof NIGHT[], replay = false): ServerMessage => ({
      type: "brain", ...(replay ? { replay: true as const } : {}),
      event: { type: "reflection", at_ms: at, day: "2026-11-08", ok: true, version: 3, applies_day: "2026-11-09", text: "반성 완료", learned, active, dropped: [] },
    });
    it("새로 배운 규칙이 있으면 그 규칙의 상황 → 「새로 배운 습관이에요」 두 줄, 쓰는 습관뿐이면 「전에 배운 습관이에요」다. 규칙이 비면 줄이 없다", () => {
      expect(textsOf(feed([reflected(2000, [NIGHT], [AIRCON, NIGHT])]))).toEqual(["밤에 사용자가 식탁을 떠난다", "새로 배운 습관이에요"]);
      expect(textsOf(feed([reflected(2000, [], [AIRCON], true)]))).toEqual(["사용자가 TV를 보러 소파에 앉는다", "전에 배운 습관이에요"]);
      expect(talkOf(feed([reflected(2000, [], [])]))).toBeNull();
    });
  });

  it("미리 세운 목표(goal)와 습관 FSM 그림(habit)은 받은 것을 그대로 두고 메시지 상자 줄은 바꾸지 않는다. 같은 판본 habit은 같은 자료다. hello는 지운다", () => {
    const g: PendingGoal = {
      id: "goal-1", action: "컵 치우기", state: "left_cup", trigger: "t", object: "cup_1", cls: "cup", status: "armed", prep: "ready", reason: null, text: "컵을 두고 자리를 뜨면 컵을 치울게요",
      armed_ms: 1, ready_ms: 2, gone_ms: null, fired_ms: null, plan: null,
    };
    const habit = { version: 1, initial: "drinking", states: [{ id: "drinking", name: "먹거나 마시는 중", learned: false }], transitions: [] };
    let s = reduceDash(EMPTY_DASH, { type: "goal", goal: g }, 0);
    expect(s.goal).toEqual(g);
    expect(talkOf(s)).toBeNull();
    s = reduceDash(s, { type: "habit", habit }, 0);
    expect(s.habit).toEqual(habit);
    expect(reduceDash(s, { type: "habit", habit: { ...habit } }, 0)).toBe(s);
    s = reduceDash(s, { type: "hello", devices: 0, provider: null, hub: "memory", home: null }, 0);
    expect([s.goal, s.habit]).toEqual([null, null]);
  });

  it("hello면 처음으로 돌린다(접속 스냅숏이 뒤따름)", () => {
    expect(reduceDash(at(3), { type: "hello", devices: 1, provider: null, hub: "memory", home: "mokryeon_180b" }, 0)).toEqual(EMPTY_DASH);
  });
});
