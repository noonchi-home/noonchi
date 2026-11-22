import { describe, expect, it } from "vitest";
import {
  CUP_FSM_MEMORY, CUP_MEMORY, CUP_TASKS, PERSON_ACTIVITIES, checkInput, isoWithOffset,
  validateCandidateFsm, validateMemory, validatePrediction, validateTasks, type DecisionInput, type FsmMemory,
} from "../src/brain/decision.js";
import { candidateFsmOf } from "../src/brain/pam/adopt.js";
import { MEMORY_CHECK_PROMPT } from "../src/brain/pam/memoryCheck.js";
import { FSM_STATE_TEXT } from "../src/world/labels.js";
import { LEARNED_ACTIONS } from "../src/act/tasks.js";
import { LEARNED_FSM_MEMORY, learnedFsm } from "../scripts/learned-memory.js";

const input = (over: Partial<DecisionInput> = {}): DecisionInput => ({
  text: "12:00:00 사람 보임", finalTime: "2026-11-04T12:00:08.000+09:00", memory: CUP_MEMORY, memoryKind: "list", tasks: [...CUP_TASKS], lastState: null,
  facts: { contents: "empty" }, ...over,
});

describe("PAM 계약 검사(Python PAM과 같은 규칙, 검사 글도 같다)", () => {
  it("작업 목록은 비어 있지 않은 글 목록", () => {
    expect(validateTasks(["컵 치우기"])).toEqual(["컵 치우기"]);
    expect(() => validateTasks([])).toThrow(/at least one/);
    expect(() => validateTasks(["  "])).toThrow();
  });

  it("list 기억은 rules만, 규칙은 trigger·action만", () => {
    expect(validateMemory({ rules: [{ trigger: "a", action: "b" }] }, "list")).toBeTruthy();
    expect(() => validateMemory({ rules: [], extra: 1 }, "list")).toThrow(/incorrect fields/);
    expect(() => validateMemory({ rules: [{ trigger: "a" }] }, "list")).toThrow();
  });

  it("fsm 기억은 상태 id가 겹치지 않고, 전이 대상이 있어야 한다", () => {
    const ok = { initial_state: "away", states: [
      { id: "away", description: "d", activity: [], next: [{ to: "s2", on: "e" }] },
      { id: "s2", description: "d", activity: ["reading"], next: [{ to: "*", on: "t", action: "컵 치우기" }] },
    ] };
    expect(validateMemory(ok, "fsm")).toBeTruthy();
    expect(() => validateMemory({ ...ok, states: [ok.states[0], { ...ok.states[0] }] }, "fsm")).toThrow(/duplicate/);
    expect(() => validateMemory({ ...ok, states: [ok.states[0]] }, "fsm")).toThrow(/unknown state/);
    expect(() => validateMemory(ok, "tree" as "fsm")).toThrow();
  });

  it("예측은 observation·reasoning·task_index만, 번호는 -1..n-1 정수", () => {
    const tasks = ["a", "b"];
    expect(validatePrediction({ observation: "o", reasoning: "r", task_index: -1 }, tasks).task_index).toBe(-1);
    expect(() => validatePrediction({ observation: "o", reasoning: "r", task_index: 2 }, tasks)).toThrow(/-1 to 1/);
    expect(() => validatePrediction({ observation: "o", reasoning: "r", task_index: 1.5 }, tasks)).toThrow();
    expect(() => validatePrediction({ observation: "o", reasoning: "r", task_index: true }, tasks)).toThrow();
    expect(() => validatePrediction({ observation: "o", reasoning: "r", task_index: 0, extra: 1 }, tasks)).toThrow();
  });
});

describe("판단 입력(텍스트)", () => {
  it("관찰 텍스트·시간대 있는 최종 시각·작업 목록·기억 모양을 검사한다", () => {
    expect(() => checkInput(input())).not.toThrow();
    expect(() => checkInput(input({ text: "  " }))).toThrow(/관찰 텍스트/);
    expect(() => checkInput(input({ text: "가".repeat(20_001) }))).toThrow(/20000/);
    expect(() => checkInput(input({ finalTime: "2026-11-04T12:00:08" }))).toThrow(/시간대/);
    expect(() => checkInput(input({ finalTime: "어제" }))).toThrow(/시간대/);
    expect(() => checkInput(input({ tasks: [] }))).toThrow(/at least one/);
    expect(() => checkInput(input({ memoryKind: "fsm" }))).toThrow(/incorrect fields/);
  });

  it("판단 입력 타입에 사진 칸이 없다", () => {
    // @ts-expect-error 판단 입력에는 사진 칸이 없다
    const bad: DecisionInput = { ...input(), frames: [] };
    expect(bad).toBeTruthy();
  });

  it("시각은 그 시간대의 ISO", () => {
    expect(isoWithOffset(Date.parse("2026-11-04T03:00:01Z"), 540)).toBe("2026-11-04T12:00:01.000+09:00");
    expect(isoWithOffset(Date.parse("2026-11-04T03:00:01Z"), -90)).toBe("2026-11-04T01:30:01.000-01:30");
  });
});

describe("사람 활동 FSM 상태 이름표", () => {
  it("컵 FSM 기억의 상태마다 화면용 짧은 한국어 이름표가 있다(12자 아래, 영어 id가 아니다)", () => {
    for (const s of CUP_FSM_MEMORY.states) {
      const label = FSM_STATE_TEXT[s.id];
      expect(label, s.id).toBeTruthy();
      expect(label!.length, s.id).toBeLessThanOrEqual(12);
      expect(label, s.id).toMatch(/[가-힣]/);
      // 영어 id가 아니다(「TV」는 한국어 화면 글에 쓰는 낱말이라 뺀다)
      expect(label!.replace(/TV/g, ""), s.id).not.toMatch(/[A-Za-z_()（）]/);
    }
    expect(FSM_STATE_TEXT).toMatchObject({ drinking: "먹거나 마시는 중", watching_tv: "TV 보는 중", away: "자리에 없음" });
  });
});

describe("사람 활동 FSM 코드 검사", () => {
  const base = () => structuredClone(CUP_FSM_MEMORY) as FsmMemory;
  const drink = (m: FsmMemory) => m.states.find((s) => s.id === "drinking")!;
  it("seed는 사람 상태 넷이고 처음은 자리에 없음, 행동은 화살표에만, 물건 조건이 없다", () => {
    expect(validateMemory(CUP_FSM_MEMORY, "fsm")).toBe(CUP_FSM_MEMORY);
    expect(CUP_FSM_MEMORY.initial_state).toBe("away");
    expect(CUP_FSM_MEMORY.states.map((s) => s.id)).toEqual(["drinking", "watching_tv", "cooking", "away"]);
    expect(CUP_FSM_MEMORY.states.some((s) => "rules" in s)).toBe(false);
    expect(drink(CUP_FSM_MEMORY).next[0]).toEqual({ to: "*", on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.", action: "사용자에게 물어보기" });
  });
  it("seed에는 컵 치우기 화살표가 없고(배우는 습관) 사용자가 정한 습관 화살표는 있다. 배운 뒤 기억은 마시는 중에서 떠나는 묻기 화살표 자리만 컵 치우기다", () => {
    const actions = (m: FsmMemory) => m.states.flatMap((s) => s.next.flatMap((e) => (e.action ? [e.action] : [])));
    expect(LEARNED_ACTIONS).toEqual(["컵 치우기", "에어컨 켜기"]);
    expect(actions(CUP_FSM_MEMORY)).not.toContain("컵 치우기");
    expect(actions(CUP_FSM_MEMORY)).toEqual(expect.arrayContaining(["컵에 물 채워 주기", "컵에 콜라 따라 주기", "에어컨 켜기", "라면 끓이기 알려 주기", "전자레인지로 데우기 알려 주기"]));
    expect(validateMemory(LEARNED_FSM_MEMORY, "fsm")).toBe(LEARNED_FSM_MEMORY);
    expect(drink(LEARNED_FSM_MEMORY).next[0]).toEqual({ ...drink(CUP_FSM_MEMORY).next[0]!, action: "컵 치우기" });
    expect(LEARNED_FSM_MEMORY.states.map((s) => s.next.length)).toEqual(CUP_FSM_MEMORY.states.map((s) => s.next.length));
    expect(learnedFsm(["drinking", "watching_tv"]).states.find((s) => s.id === "watching_tv")!.next.find((e) => e.to === "*")).toMatchObject({ when: "같이 마시는 중이었다.", action: "컵 치우기" });
  });
  it("같은 (출발·사건·조건) 화살표 둘은 거절한다. 조건이 다르면 된다", () => {
    const m = base();
    drink(m).next.push({ ...drink(m).next[0]!, action: "컵 치우기" });
    expect(() => validateMemory(m, "fsm")).toThrow(/duplicate transition/);
    const ok = base();
    drink(ok).next.push({ ...drink(ok).next[0]!, when: "같이 TV를 보는 중이었다.", action: "컵 치우기" });
    expect(validateMemory(ok, "fsm")).toBe(ok);
  });
  it("목록 밖 행동·안 하기 행동은 거절한다", () => {
    const m = base(); drink(m).next[0]!.action = "컵 닦기";
    expect(() => validateMemory(m, "fsm")).toThrow(/not an action/);
    const keep = base(); drink(keep).next[0]!.action = "컵 그대로 두기";
    expect(() => validateMemory(keep, "fsm")).toThrow(/not an action/);
  });
  it("행동 없는 \"*\" 화살표, 상태 12개 초과, 자리에 없음이 없거나 처음 상태가 아니면 거절한다", () => {
    const any = base(); drink(any).next.push({ to: "*", on: "사용자가 일어난다." });
    expect(() => validateMemory(any, "fsm")).toThrow(/needs an action/);
    const many = base();
    const free = PERSON_ACTIVITIES.filter((a) => !many.states.some((s) => s.activity.includes(a)));
    for (let i = 0; i < 9; i++) many.states.push({ id: `extra_${i}`, description: "사용자가 다른 일을 한다.", activity: [free[i]!], next: [] });
    expect(() => validateMemory(many, "fsm")).toThrow(/at most 12 states/);
    const first = base(); first.initial_state = "drinking";
    expect(() => validateMemory(first, "fsm")).toThrow(/initial_state: must be 'away'/);
    const noAway = base(); noAway.states = noAway.states.filter((s) => s.id !== "away").map((s) => ({ ...s, next: s.next.filter((e) => e.to !== "away") })); noAway.initial_state = "drinking";
    expect(() => validateMemory(noAway, "fsm")).toThrow(/'away' state is required/);
  });
  it("모양: 없는 상태로 가는 화살표, 모르는 하는 일 값, 한 값이 두 상태에, 자리에 없음 밖의 상태에 하는 일 값 없음, 옛 모양(rules)", () => {
    const to = base(); drink(to).next.push({ to: "nap", on: "사용자가 잔다." });
    expect(() => validateMemory(to, "fsm")).toThrow(/unknown state identifier 'nap'/);
    const act = base(); drink(act).activity.push("flying");
    expect(() => validateMemory(act, "fsm")).toThrow(/unknown activity 'flying'/);
    const two = base(); two.states[1]!.activity.push("drinking");
    expect(() => validateMemory(two, "fsm")).toThrow(/activity 'drinking' is in two states/);
    const none = base(); drink(none).activity = [];
    expect(() => validateMemory(none, "fsm")).toThrow(/needs at least one activity/);
    const old = { initial_state: "away", states: [{ id: "away", description: "d", rules: [], next: [] }] };
    expect(() => validateMemory(old, "fsm")).toThrow(/incorrect fields/);
  });
});

// 2026-11-22 사용자 결정: 규칙에 요일·시각 맥락을 붙인다(맥락 없음 → 하나 → 둘). 맥락은 코드가 붙이고 반성 모델은 모른다. dow 월요일=0…일요일=6, slot 3시간 칸 0~7(0=0~3시, 6=18~21시).
describe("화살표 맥락(ctx) 칸", () => {
  const base = () => structuredClone(CUP_FSM_MEMORY) as FsmMemory;
  const drink = (m: FsmMemory) => m.states.find((s) => s.id === "drinking")!;
  const edge = (m: FsmMemory, ctx?: unknown) => ({ ...drink(m).next[0]!, action: "컵 치우기", ...(ctx === undefined ? {} : { ctx }) }) as FsmMemory["states"][number]["next"][number];
  it("맥락이 있는 행동 화살표를 받는다: 요일만, 시각 칸만, 둘 다. 없는 화살표는 지금과 같다", () => {
    for (const ctx of [{ dow: 5 }, { slot: 6 }, { dow: 0, slot: 0 }, { dow: 6, slot: 7 }]) {
      const m = base(); drink(m).next.push(edge(m, ctx));
      expect(validateMemory(m, "fsm")).toBe(m);
    }
    expect(validateMemory(CUP_FSM_MEMORY, "fsm")).toBe(CUP_FSM_MEMORY);
  });
  // base()의 drinking.next[0]은 맥락 없는 「묻기」 화살표다. 같은 (사건·조건)에 맥락 있는 행동 화살표를 더해도 된다(맥락이 맞는 때는 맥락 있는 쪽이 이긴다. 5단계)
  it("같은 (사건·조건)에서 맥락 없는 화살표는 하나까지, 맥락 있는 화살표끼리는 겹치지 않아야 한다", () => {
    const ok = base(); drink(ok).next.push(edge(ok, { dow: 5 }), edge(ok, { dow: 6 }));          // 토요일·일요일 + 맥락 없는 묻기
    expect(validateMemory(ok, "fsm")).toBe(ok);
    const slots = base(); drink(slots).next.push(edge(slots, { slot: 2 }), edge(slots, { slot: 6 }));   // 6~9시·18~21시
    expect(validateMemory(slots, "fsm")).toBe(slots);
    const split = base(); drink(split).next.push(edge(split, { dow: 5, slot: 6 }), edge(split, { dow: 5, slot: 7 }), edge(split, { dow: 6, slot: 6 }));
    expect(validateMemory(split, "fsm")).toBe(split);
    const same = base(); drink(same).next.push(edge(same, { dow: 5 }), edge(same, { dow: 5 }));
    expect(() => validateMemory(same, "fsm")).toThrow(/duplicate transition/);
    const cross = base(); drink(cross).next.push(edge(cross, { dow: 5 }), edge(cross, { slot: 6 }));   // 토요일 18~21시에 둘 다 맞는다
    expect(() => validateMemory(cross, "fsm")).toThrow(/duplicate transition/);
    const loose = base(); drink(loose).next.push(edge(loose));                                  // 맥락 없는 화살표가 둘
    expect(() => validateMemory(loose, "fsm")).toThrow(/duplicate transition/);
  });
  it("맥락 모양: 빈 값, 범위 밖, 정수 아님, 모르는 칸, 객체 아님은 거절한다", () => {
    for (const bad of [{}, { dow: 7 }, { dow: -1 }, { slot: 8 }, { slot: -1 }, { dow: 1.5 }, { dow: "월" }, { slot: null }, { dow: 1, extra: 1 }, "토요일", [5], null]) {
      const m = base(); drink(m).next.push(edge(m, bad));
      expect(() => validateMemory(m, "fsm"), JSON.stringify(bad)).toThrow(/ctx/);
    }
  });
  it("행동 없는 화살표에는 맥락을 못 붙인다", () => {
    const m = base(); drink(m).next.push({ to: "away", on: "사용자가 잔다.", ctx: { dow: 5 } } as never);
    expect(() => validateMemory(m, "fsm")).toThrow(/ctx: a context needs an action/);
  });
});

// 2026-11-19 사용자 「그래 그렇게 해」(glass pfsm4-2: 마시는 중 물 채우기 화살표를 잘못 일으켜 목표가 버려짐): 물 채우기는 식탁에 앉아 있을 때만. 사람 자세는 사람 쪽 사실이다
describe("seed 물 채우기 화살표 조건", () => {
  const water = (m: FsmMemory) => m.states.find((st) => st.id === "drinking")!.next.find((e) => e.action === "컵에 물 채워 주기");
  it("drinking 자기 화살표(물 채우기)는 조건 「식탁에 앉아 있다.」를 갖고, 배운 뒤 기억도 같다", () => {
    expect(water(CUP_FSM_MEMORY)).toEqual({ to: "drinking", on: "사용자가 마시던 것을 다 마시고 계속 먹는다.", when: "식탁에 앉아 있다.", action: "컵에 물 채워 주기" });
    expect(water(LEARNED_FSM_MEMORY)).toEqual(water(CUP_FSM_MEMORY));
  });
  it("코드 검사(기억·후보 FSM)가 받고, 뜻 검사 지시문은 사람 자세를 사람 쪽 조건으로 받는다", () => {
    expect(validateMemory(structuredClone(CUP_FSM_MEMORY), "fsm")).toEqual(CUP_FSM_MEMORY);
    expect(() => validateCandidateFsm(structuredClone(candidateFsmOf(CUP_FSM_MEMORY)) as never, CUP_FSM_MEMORY)).not.toThrow();
    expect(MEMORY_CHECK_PROMPT).toMatch(/posture/);
  });
});
