// 대시보드 자료 리듀서(data.ts): 서버 메시지 → 단계 번호·마스코트 방향·말·메시지 상자. 자료는 가짜 단계(fake-run.json, scripts/twin3d/fake-run.ts).
// 메시지 상자는 서버가 보낸 짧은 메시지(thought)와 말풍선 카드 말(say)을 받은 차례로 쌓아 최근 두 줄을 보인다. PAM 원래 생각(reasoning)은 싣지 않는다.
import { describe, expect, it } from "vitest";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { EMPTY_DASH, facingOf, reduceDash, stepIndex, TALK_SHOWN, talkOf } from "../../src/dashboard/data";
import run from "../../src/dashboard/fake-run.json";
import { CUP_FSM_MEMORY, fsmRuleOf } from "../../../src/brain/decision.ts";
import { BRANCHES, COACH, LEFT_SAY, MESSAGES, PLAN, REASON, branchDecision, type Branch } from "./fixtures";

const feed = (ms: ServerMessage[], now = 0) => ms.reduce((s, m) => reduceDash(s, m, now), EMPTY_DASH);
const at = (i: number) => feed(run.moments[i]!.messages as ServerMessage[]);
/** 서버 메시지 묶음 하나: 판단 id와 시각으로 id를 붙인 짧은 문장들. */
const said = (decision: string, atMs: number, ...texts: string[]): ServerMessage =>
  ({ type: "thought", messages: texts.map((text, i) => ({ id: `${decision}@${atMs}:${i}`, text, at_ms: atMs, decision })) });
const textsOf = (s: ReturnType<typeof feed>) => talkOf(s)?.lines.map((m: { text: string }) => m.text);
const WAIT = "식탁 위 컵을 지켜보고 있어요";

describe("대시보드 자료", () => {
  it("지켜보기: 계획 없음, 마스코트는 그림 그대로. 줄이 없으면 메시지 상자 자료가 없다", () => {
    const s = at(0);
    expect([stepIndex(s.plan), facingOf(s.plan)]).toEqual([0, "video"]);
    expect(talkOf(s)!.lines.length).toBeGreaterThan(0);
    expect(talkOf(EMPTY_DASH)).toBeNull();
  });
  it("메시지 상자 줄: 생각 메시지와 말풍선 카드 말을 받은 차례로 쌓고 최근 TALK_SHOWN(2)줄을 보인다. 같은 id·같은 말은 한 번만이고 원래 생각은 싣지 않는다", () => {
    expect(TALK_SHOWN).toBe(2);
    const s = feed([said("pam-1", 10, "사람이 컵을 두고 떠났어요", "컵이 비어 보여요"), { type: "say", text: "컵을 치우기로 했어요." }, { type: "say", text: "컵을 치우기로 했어요." }]);
    expect(textsOf(s)).toEqual(["컵이 비어 보여요", "컵을 치우기로 했어요."]);
    expect(textsOf(reduceDash(s, said("pam-1", 10, "사람이 컵을 두고 떠났어요"), 0))).toEqual(["컵이 비어 보여요", "컵을 치우기로 했어요."]);
    expect(textsOf(reduceDash(s, said("pam-2", 1, "컵을 찾았어요"), 0))).toEqual(["컵을 치우기로 했어요.", "컵을 찾았어요"]);
    expect(JSON.stringify(talkOf(feed([branchDecision(BRANCHES.clear, 1), said("pam-1", 10, "치우는 습관이라 컵을 치울게요")]))!)).not.toContain(REASON);
  });
  it("알약 셋(상태·트리거·액션)은 서버 판단의 FSM으로 정한다: 규칙대로 고르면 상태 이름·트리거·행동, 대기면 트리거·액션 「대기」, 규칙 없는 행동은 트리거 「규칙 없음」, 규칙이 여럿이면 「규칙 여럿」. 판단 전·FSM 없음이면 없다", () => {
    const one = said("pam-1", 10, "컵을 살피고 있어요");
    const withFsm = (fsm: { state: string | null; trigger: string | null; learned: boolean; matched?: boolean } | null) => {
      const m = branchDecision(BRANCHES.clear, 1) as Extract<ServerMessage, { type: "brain" }>;
      const e = m.event as Extract<typeof m.event, { type: "decision" }>;
      return { ...m, event: { ...e, fsm } } as ServerMessage;
    };
    expect(talkOf(feed([branchDecision(BRANCHES.clear, 1), one]))!.fsm).toEqual({ state: "컵을 두고 자리를 뜸", trigger: BRANCHES.clear.trigger, action: "컵 치우기" });
    expect(talkOf(feed([branchDecision(BRANCHES.clear, 1), one, branchDecision(null, 2)]))!.fsm).toEqual({ state: "먹거나 마시는 중", trigger: "대기", action: "대기" });
    expect(talkOf(feed([withFsm({ state: "left_cup", trigger: null, learned: false, matched: false }), one]))!.fsm).toEqual({ state: "컵을 두고 자리를 뜸", trigger: "규칙 없음", action: "컵 치우기" });
    expect(talkOf(feed([withFsm({ state: "left_cup", trigger: null, learned: true, matched: true }), one]))!.fsm!.trigger).toBe("규칙 여럿");
    // 상태를 정할 수 없으면(그 행동 규칙이 여러 상태) 「모름」
    expect(talkOf(feed([withFsm({ state: null, trigger: null, learned: true, matched: true }), one]))!.fsm).toEqual({ state: "모름", trigger: "규칙 여럿", action: "컵 치우기" });
    expect(talkOf(feed([withFsm(null), one]))!.fsm).toBeNull();
    expect(talkOf(feed([one]))!.fsm).toBeNull();
    expect(JSON.stringify(talkOf(feed([branchDecision(BRANCHES.clear, 1), one])))).not.toContain("배운 습관");
  });
  // Codex(2a449e5 data.ts:75·126): 쓰러짐·끄기 안내 뒤 생각 두 줄이 오면 아직 유효한 안전 알림이 밀려 사라졌다
  it("안전 알림(say safety)이 유효한 동안 메시지 상자 최신 줄은 늘 그 알림이고, 안전 아닌 말이 오면 풀린다", () => {
    const fall = "사람이 쓰러진 것 같아요.";
    const s = feed([said("pam-0", 5, "식탁을 보고 있어요"), { type: "say", text: fall, safety: true }, said("pam-1", 10, "사람이 보여요", "자세가 낮아요")]);
    expect(textsOf(s)).toEqual(["자세가 낮아요", fall]);
    const more = reduceDash(s, said("pam-2", 20, "계속 지켜볼게요"), 0);
    expect(textsOf(more)).toEqual(["계속 지켜볼게요", fall]);
    const over = reduceDash(more, { type: "say", text: "지켜보고 있어요." }, 0);
    expect(textsOf(over)).toEqual(["계속 지켜볼게요", "지켜보고 있어요."]);
    expect(textsOf(reduceDash(more, { type: "say", text: null }, 0))).toEqual(["자세가 낮아요", "계속 지켜볼게요"]);
  });
  it("메시지 상자 머리는 지금 판단의 행동이 어느 모드로 하는 행동인지다: 코치 행동이면 「코치 모드」, 다른 행동이면 「눈치 모드」, 대기·판단 전이면 없다", () => {
    const one = said("pam-1", 10, "컵을 살피고 있어요");
    expect(talkOf(feed([branchDecision(BRANCHES.clear, 1), one]))!.mode).toBe("눈치 모드");
    expect(talkOf(feed([branchDecision(COACH, 1), one]))!.mode).toBe("코치 모드");
    expect(talkOf(feed([branchDecision(BRANCHES.clear, 1), one, branchDecision(null, 2)]))!.mode).toBeNull();
    expect(talkOf(feed([one]))!.mode).toBeNull();
  });
  // Codex(f8b6209 data.ts:93): 동시에 나간 판단의 옛 응답이 화면을 덮어, 실행 추적이 거절한 옛 코치 판단 때문에 진행 중 눈치 계획의 머리가 「코치 모드」로 바뀔 수 있었다
  it("seq가 더 작은 늦은 판단은 화면에 쓰지 않고, 진행 중 계획이 있으면 머리는 그 계획 행동의 모드다", () => {
    const one = said("pam-1", 10, "컵을 살피고 있어요");
    const plan: ServerMessage = { type: "plan", plan: PLAN };
    // 컵 치우기(seq 2)로 계획이 도는데 옛 코치 판단(seq 1)이 늦게 온다
    const late = feed([branchDecision(BRANCHES.clear, 2), plan, branchDecision(COACH, 1), one]);
    expect(late.decision!.seq).toBe(2);
    expect(talkOf(late)!.mode).toBe("눈치 모드");
    expect(talkOf(late)!.fsm!.action).toBe("컵 치우기");
    // 실행 추적이 받아들이지 않은 새 코치 판단(seq 3)이 와도 진행 중 계획(컵 치우기)이 머리를 정한다
    expect(talkOf(feed([branchDecision(BRANCHES.clear, 2), plan, branchDecision(COACH, 3), one]))!.mode).toBe("눈치 모드");
    // 계획이 없으면 가장 새 판단이다
    expect(talkOf(feed([branchDecision(BRANCHES.clear, 2), branchDecision(COACH, 3), one]))!.mode).toBe("코치 모드");
  });
  it("계획 단계마다 번호·마스코트·말이 따라간다", () => {
    const says = ["식탁으로 가라고 했어요.", "컵을 들라고 했어요.", "싱크대로 가라고 했어요.", "컵을 싱크대에 넣으라고 했어요."];
    for (let n = 1; n <= 4; n++) {
      const s = at(n);
      expect([stepIndex(s.plan), facingOf(s.plan), s.say, textsOf(s)?.at(-1)]).toEqual([n, "twin", says[n - 1], says[n - 1]]);
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
    expect(Object.keys(s).sort()).toEqual(["decision", "eye", "modes", "plan", "reflection", "safety", "say", "talk", "thoughts"]);
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

  it("hello면 처음으로 돌린다(접속 스냅숏이 뒤따름)", () => {
    expect(reduceDash(at(3), { type: "hello", devices: 1, provider: null, hub: "memory", home: "mokryeon_180b" }, 0)).toEqual(EMPTY_DASH);
  });
});
