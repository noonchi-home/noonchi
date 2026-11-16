// 대시보드 자료 리듀서(data.ts): 서버 메시지 → 단계 번호·마스코트 방향·말·생각 말풍선. 자료는 가짜 단계(fake-run.json, scripts/twin3d/fake-run.ts).
// 생각 말풍선은 서버가 보낸 짧은 메시지(thought)가 카톡처럼 차례로 쌓인 것이다(최근 3개를 보인다). PAM 원래 생각(reasoning)은 싣지 않는다.
import { describe, expect, it } from "vitest";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { EMPTY_DASH, facingOf, reduceDash, stepIndex, THOUGHT_SHOWN, thoughtOf } from "../../src/dashboard/data";
import run from "../../src/dashboard/fake-run.json";
import { CUP_FSM_MEMORY, fsmRuleOf } from "../../../src/brain/decision.ts";
import { BRANCHES, COACH, LEFT_SAY, MESSAGES, REASON, branchDecision, type Branch } from "./fixtures";

const feed = (ms: ServerMessage[], now = 0) => ms.reduce((s, m) => reduceDash(s, m, now), EMPTY_DASH);
const at = (i: number) => feed(run.moments[i]!.messages as ServerMessage[]);
/** 서버 메시지 묶음 하나: 판단 id와 시각으로 id를 붙인 짧은 문장들. */
const said = (decision: string, atMs: number, ...texts: string[]): ServerMessage =>
  ({ type: "thought", messages: texts.map((text, i) => ({ id: `${decision}@${atMs}:${i}`, text, at_ms: atMs, decision })) });
const textsOf = (s: ReturnType<typeof feed>) => thoughtOf(s)?.messages.map((m) => m.text);
const WAIT = "식탁 위 컵을 지켜보고 있어요";

describe("대시보드 자료", () => {
  it("지켜보기: 계획 없음, 마스코트는 그림 그대로. PAM이 대기여도 생각 메시지가 있으면 말풍선에 보이고 칩은 없다", () => {
    const s = at(0);
    expect([stepIndex(s.plan), facingOf(s.plan)]).toEqual([0, "video"]);
    expect(thoughtOf(s)).toEqual({ messages: [{ id: expect.any(String), text: WAIT }], state: null, habit: false, assist: "noonchi", action: null });
    expect(thoughtOf(EMPTY_DASH)).toBeNull();
  });
  it("생각 말풍선: 계획 순간은 메시지가 차례로 쌓인 최근 3개와 칩(FSM 상태 이름표·행동 이름)이다. 원래 생각(reasoning)은 싣지 않는다", () => {
    const t = thoughtOf(at(1))!;
    expect(t.messages.map((m) => m.text)).toEqual([WAIT, ...MESSAGES.map((m) => m.text)]);
    expect(t).toMatchObject({ state: "컵을 두고 자리를 뜸", habit: false, assist: "noonchi", action: "컵 치우기" });
    expect(JSON.stringify(t)).not.toContain("사람이 자리를 비운 뒤에도 컵이 식탁에 남아 있어요.");
  });

  describe("생각 메시지(thought)", () => {
    const decided = branchDecision(BRANCHES.clear, 3);
    it("메시지가 하나도 없으면 행동 판단이어도 말풍선을 숨긴다(null). 메시지가 오면 판단과 상관없이 보인다", () => {
      expect(thoughtOf(feed([decided]))).toBeNull();
      expect(textsOf(feed([decided, said("pam-3", 10, "사람이 컵을 두고 떠났어요")]))).toEqual(["사람이 컵을 두고 떠났어요"]);
      expect(textsOf(feed([branchDecision(null, 4), said("pam-4", 10, WAIT)]))).toEqual([WAIT]);
    });
    it("새 메시지는 아래(뒤)에 붙고, 보이는 것은 최근 THOUGHT_SHOWN(3)개다. 같은 id는 한 번만, 시각 차례로 둔다", () => {
      expect(THOUGHT_SHOWN).toBe(3);
      const s = feed([said("pam-1", 10, "하나"), said("pam-2", 20, "둘", "셋"), said("pam-3", 30, "넷")]);
      expect(textsOf(s)).toEqual(["둘", "셋", "넷"]);
      // 접속 때 다시 받은 최근 메시지(replay)는 이미 있는 것과 겹치지 않는다. 늦게 온 앞 메시지는 시각 자리에 들어간다
      const again = reduceDash(s, { ...said("pam-2", 20, "둘", "셋"), replay: true } as ServerMessage, 0);
      expect(textsOf(again)).toEqual(["둘", "셋", "넷"]);
      expect(textsOf(reduceDash(s, said("pam-0", 5, "영"), 0))).toEqual(["둘", "셋", "넷"]);
      expect(s.thoughts.map((m) => m.text)).toEqual(["하나", "둘", "셋", "넷"]);
    });
    it("자료에는 최근 6개까지만 둔다", () => {
      const s = feed(Array.from({ length: 8 }, (_, i) => said(`pam-${i}`, i, `메시지 ${i}`)));
      expect(s.thoughts.map((m) => m.text)).toEqual(["메시지 2", "메시지 3", "메시지 4", "메시지 5", "메시지 6", "메시지 7"]);
    });
    it("칩은 지금 판단을 따른다: 행동 판단이면 상태·행동, 대기 판단이면 칩이 없다. 메시지는 그대로 남는다", () => {
      const s = feed([decided, said("pam-3", 10, "사람이 컵을 두고 떠났어요"), branchDecision(null, 4)]);
      expect(thoughtOf(s)).toEqual({ messages: [{ id: "pam-3@10:0", text: "사람이 컵을 두고 떠났어요" }], state: null, habit: false, assist: "noonchi", action: null });
      expect(thoughtOf(reduceDash(s, branchDecision(BRANCHES.clear, 5), 0))).toMatchObject({ state: "컵을 두고 자리를 뜸", action: "컵 치우기" });
    });
    it("원래 생각(reasoning)·관찰은 말풍선 자료에 없다", () => {
      expect(JSON.stringify(thoughtOf(feed([decided, said("pam-3", 10, "치우는 습관이라 컵을 치울게요")]))!)).not.toContain(REASON);
    });
    it("hello면 메시지도 지운다(접속 때 최근 메시지를 다시 받는다)", () => {
      expect(reduceDash(feed([decided, said("pam-3", 10, "하나")]), { type: "hello", devices: 1, provider: null, hub: "memory", home: "apartment" }, 0)).toEqual(EMPTY_DASH);
    });
  });

  it("서버가 상태를 못 찾았거나(fsm null·없음, fsm.state null) 상태는 null이다(칩을 숨긴다). 이름표가 없는 상태면 그 트리거를 보인다", () => {
    const s = at(1);
    const d = s.decision!;
    expect(thoughtOf({ ...s, decision: { ...d, fsm: null } })?.state).toBeNull();
    expect(thoughtOf({ ...s, decision: { ...d, fsm: undefined } })?.state).toBeNull();
    expect(thoughtOf({ ...s, decision: { ...d, fsm: { state: null, trigger: "t", learned: false } } })?.state).toBeNull();
    expect(thoughtOf({ ...s, decision: { ...d, fsm: { state: "made_by_reflector", trigger: "t", learned: false } } })).toMatchObject({ state: "t", action: "컵 치우기" });
    expect(thoughtOf({ ...s, decision: { ...d, fsm: { state: "made_by_reflector", trigger: null, learned: false } } })?.state).toBeNull();
  });
  it("고른 행동에 배운 규칙이 있으면 습관이고, 서버가 붙인 행동 종류(눈치·코치)를 그대로 보인다", () => {
    const s = at(1);
    const d = s.decision!;
    expect(thoughtOf({ ...s, decision: { ...d, action: "에어컨 켜기", fsm: { state: "watching_tv", trigger: null, learned: true }, assist: "noonchi" } }))
      .toMatchObject({ state: "TV 보는 중", habit: true, assist: "noonchi", action: "에어컨 켜기" });
    expect(thoughtOf({ ...s, decision: { ...d, action: "에어컨 켜기", fsm: { state: null, trigger: null, learned: true }, assist: "noonchi" } }))
      .toMatchObject({ state: null, habit: true });
    expect(thoughtOf({ ...s, decision: { ...d, action: "라면 끓이기 알려 주기", fsm: null, assist: "coach" } })).toMatchObject({ habit: false, assist: "coach" });
  });
  describe("컵 갈래(그대로 두기·채워 주기)", () => {
    const decided = (b: Branch | null, seq: number): ServerMessage => branchDecision(b, seq);
    const chips = (s: ReturnType<typeof feed>) => { const t = thoughtOf(s)!; return [t.state, t.assist, t.action]; };
    const one = said("pam-1", 10, "컵을 살피고 있어요");
    it("그대로 두기 판단이면 칩은 「상태 · 컵을 두고 자리를 뜸」, 「눈치 · 컵 그대로 두기」다. 계획이 없어 마스코트는 그림 그대로다", () => {
      const s = feed([decided(BRANCHES.leave, 1), one, { type: "say", text: LEFT_SAY }]);
      expect(chips(s)).toEqual(["컵을 두고 자리를 뜸", "noonchi", "컵 그대로 두기"]);
      expect([stepIndex(s.plan), facingOf(s.plan), s.say]).toEqual([0, "video", "컵을 그대로 두기로 했어요."]);
    });
    it("물 채워 주기 판단이면 「상태 · 먹거나 마시는 중」, 「눈치 · 컵에 물 채워 주기」, 콜라면 「상태 · TV 보는 중」, 「눈치 · 컵에 콜라 따라 주기」다", () => {
      expect(chips(feed([decided(BRANCHES.water, 1), one]))).toEqual(["먹거나 마시는 중", "noonchi", "컵에 물 채워 주기"]);
      expect(chips(feed([decided(BRANCHES.cola, 1), one]))).toEqual(["TV 보는 중", "noonchi", "컵에 콜라 따라 주기"]);
    });
    it("그 뒤 대기 판단이 오면 칩이 없어지고, 다시 치우기 판단이 오면 그 판단의 칩이다(더 보다가 치움)", () => {
      const waited = feed([decided(BRANCHES.leave, 1), one, decided(null, 2)]);
      expect(chips(waited)).toEqual([null, "noonchi", null]);
      expect(chips(reduceDash(waited, decided(BRANCHES.clear, 3), 0))).toEqual(["컵을 두고 자리를 뜸", "noonchi", "컵 치우기"]);
    });
    it("코치 판단이면 「상태 · 주방에서 할 일을 찾음」, 「코치 · 라면 끓이기 알려 주기」다. 그 규칙은 서버 FSM 기억의 cooking 상태에 있다", () => {
      expect(chips(feed([decided(COACH, 1), one]))).toEqual(["주방에서 할 일을 찾음", "coach", "라면 끓이기 알려 주기"]);
      expect(fsmRuleOf(CUP_FSM_MEMORY, "fsm", COACH.action)).toEqual({ state: COACH.state, trigger: COACH.trigger, learned: false });
    });
    it("치우기·물·콜라 갈래 판단의 상태 id는 서버 FSM 기억(CUP_FSM_MEMORY)에서 그 행동의 규칙이 있는 상태다. 그대로 두기는 seed 규칙이 없다(컵을 두고 떠나면 치우는 습관, 반성이 배우면 생긴다)", () => {
      for (const b of [BRANCHES.clear, BRANCHES.water, BRANCHES.cola]) expect(fsmRuleOf(CUP_FSM_MEMORY, "fsm", b.action), b.action).toEqual({ state: b.state, trigger: b.trigger, learned: false });
      expect(fsmRuleOf(CUP_FSM_MEMORY, "fsm", BRANCHES.leave.action)).toBeNull();
    });
  });
  it("계획 단계마다 번호·마스코트·말이 따라간다", () => {
    const says = ["식탁으로 가라고 했어요.", "컵을 들라고 했어요.", "싱크대로 가라고 했어요.", "컵을 싱크대에 넣으라고 했어요."];
    for (let n = 1; n <= 4; n++) {
      const s = at(n);
      expect([stepIndex(s.plan), facingOf(s.plan), s.say, thoughtOf(s)?.action]).toEqual([n, "twin", says[n - 1], "컵 치우기"]);
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
    expect(Object.keys(s).sort()).toEqual(["decision", "eye", "plan", "reflection", "say", "thoughts"]);
  });
  describe("반성 뒤 생각 말풍선", () => {
    const AIRCON = { state: "watching_tv", trigger: "사용자가 TV를 보러 소파에 앉는다.", action: "에어컨 켜기" };
    const NIGHT = { state: "left_cup", trigger: "밤에 사용자가 식탁을 떠난다.", action: "컵 치우기" };
    const reflected = (at: number, learned: typeof AIRCON[], active: typeof AIRCON[], replay = false): ServerMessage => ({
      type: "brain", ...(replay ? { replay: true as const } : {}),
      event: { type: "reflection", at_ms: at, day: "2026-11-08", ok: true, version: 3, applies_day: "2026-11-09", text: "반성 완료", learned, active, dropped: [] },
    });
    const decidedAt = (at: number): ServerMessage => {
      const m = branchDecision(BRANCHES.clear, 1) as Extract<ServerMessage, { type: "brain" }>;
      return { ...m, event: { ...m.event, at_ms: at } } as ServerMessage;
    };

    it("마지막 유효 판단보다 새 반성에 새로 배운 규칙이 있으면 첫 규칙이 메시지 둘(그 규칙의 상황 → 「새로 배운 습관이에요」)로 쌓이고, 칩은 「습관 · 새로 배움」, 「눈치 · 행동」", () => {
      expect(thoughtOf(feed([decidedAt(1000), reflected(2000, [NIGHT], [AIRCON, NIGHT])]))).toEqual({
        messages: [{ id: "reflection@2000:0", text: "밤에 사용자가 식탁을 떠난다" }, { id: "reflection@2000:1", text: "새로 배운 습관이에요" }],
        state: "새로 배움", habit: true, assist: "noonchi", action: NIGHT.action,
      });
    });

    it("새로 배운 규칙이 없고 쓰는 습관이 있으면 첫 규칙: 「전에 배운 습관이에요」, 칩 「습관 · 배운 규칙」(상태 null). 다시 받은 반성(replay)도 같다", () => {
      expect(thoughtOf(feed([reflected(2000, [], [AIRCON], true)]))).toEqual({
        messages: [{ id: "reflection@2000:0", text: "사용자가 TV를 보러 소파에 앉는다" }, { id: "reflection@2000:1", text: "전에 배운 습관이에요" }],
        state: null, habit: true, assist: "noonchi", action: AIRCON.action,
      });
    });

    it("다음 판단이 오면 칩은 그 판단으로 바뀌고 메시지는 남는다. 규칙이 비면 메시지도 칩도 그대로다", () => {
      const s = feed([reflected(2000, [NIGHT], [NIGHT]), decidedAt(3000)]);
      expect(thoughtOf(s)).toMatchObject({ action: "컵 치우기", state: "컵을 두고 자리를 뜸", habit: false });
      expect(textsOf(s)).toEqual(["밤에 사용자가 식탁을 떠난다", "새로 배운 습관이에요"]);
      expect(thoughtOf(feed([decidedAt(1000), reflected(2000, [], [])]))).toBeNull();
    });
  });

  it("hello면 처음으로 돌린다(접속 스냅숏이 뒤따름)", () => {
    expect(reduceDash(at(3), { type: "hello", devices: 1, provider: null, hub: "memory", home: "mokryeon_180b" }, 0)).toEqual(EMPTY_DASH);
  });
});
