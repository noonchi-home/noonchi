import { describe, expect, it } from "vitest";
import {
  CUP_FSM_MEMORY, CUP_MEMORY, CUP_TASKS, checkInput, findDuplicateKey, fsmRuleOf, isoWithOffset, parsePrediction,
  validateMemory, validatePrediction, validateTasks, type DecisionInput, type FsmMemory,
} from "../src/brain/decision.js";
import { FSM_STATE_TEXT } from "../src/world/labels.js";
import { TASK_NAMES } from "../src/act/tasks.js";
import { STATES } from "../src/world/vocab.js";

const input = (over: Partial<DecisionInput> = {}): DecisionInput => ({
  text: "12:00:00 사람 보임", finalTime: "2026-11-04T12:00:08.000+09:00", memory: CUP_MEMORY, memoryKind: "list", tasks: [...CUP_TASKS],
  facts: { contents: "empty" }, ...over,
});

describe("PAM 계약 검사(services/pam/pam/contracts.py와 같은 규칙)", () => {
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

  it("fsm 기억은 상태 id가 겹치지 않고, 시작·전이 대상이 있어야 한다", () => {
    const ok = { initial_state: "s1", states: [
      { id: "s1", description: "d", rules: [], next: [{ to: "s2", on: "e" }] },
      { id: "s2", description: "d", rules: [{ trigger: "t", action: "a" }], next: [] },
    ] };
    expect(validateMemory(ok, "fsm")).toBeTruthy();
    expect(() => validateMemory({ ...ok, initial_state: "x" }, "fsm")).toThrow(/initial_state/);
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

  it("원문 답은 고치지 않는다: 마크다운·중복 키는 invalid, 대기와 구분", () => {
    const tasks = ["컵 치우기"];
    expect(parsePrediction('{"observation":"o","reasoning":"r","task_index":0}', tasks)).toMatchObject({ status: "valid", selected_action: "컵 치우기" });
    expect(parsePrediction('{"observation":"o","reasoning":"r","task_index":-1}', tasks)).toMatchObject({ status: "valid", selected_action: null });
    expect(parsePrediction('```json\n{"observation":"o","reasoning":"r","task_index":0}\n```', tasks).status).toBe("invalid");
    const dup = parsePrediction('{"observation":"o","reasoning":"r","task_index":0,"task_index":-1}', tasks);
    expect(dup.status).toBe("invalid");
    expect(dup.errors[0]).toMatch(/duplicate key/);
  });

  it("중복 키는 중첩·문자열 안까지 정확히 찾는다", () => {
    expect(findDuplicateKey('{"a":{"b":1,"c":"\\"b\\":"},"d":[{"b":1},{"b":2}]}')).toBeNull();
    expect(findDuplicateKey('{"a":{"b":1,"b":2}}')).toBe("b");
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

describe("고른 행동의 FSM 상태(대시보드 생각 말풍선 「상태」 칩)", () => {
  it("seed만 있는 기억에서 고른 행동의 규칙이 하나면 그 상태와 트리거를 주고, 배운 규칙이 없다(learned false)", () => {
    const left = CUP_FSM_MEMORY.states.find((s) => s.id === "left_cup")!;
    expect(fsmRuleOf(CUP_FSM_MEMORY, "fsm", "컵 치우기")).toEqual({ state: "left_cup", trigger: left.rules[0]!.trigger, learned: false });
    // 컵을 두고 떠나면 치우는 습관 하나만 있다(그대로 두기·물어보기 규칙 없음)
    expect(left.rules).toEqual([{ trigger: "사용자가 컵을 식탁 등에 두고 자리를 비웠고, 아무도 컵을 들거나 만지지 않는다.", action: "컵 치우기" }]);
    expect(fsmRuleOf(CUP_FSM_MEMORY, "fsm", "사용자에게 물어보기")).toBeNull();
  });

  // 반성이 배운 규칙: seed에 없는 트리거·행동 쌍
  const HOT = { trigger: "사용자가 덥다고 말하거나 더워서 부채질을 한다.", action: "에어컨 켜기" };
  const TV = { trigger: "사용자가 TV를 보러 소파에 앉는다.", action: "에어컨 켜기" };
  const withRules = (add: Record<string, { trigger: string; action: string }[]>, extra: FsmMemory["states"] = []): FsmMemory => ({
    ...CUP_FSM_MEMORY,
    states: [...CUP_FSM_MEMORY.states.map((s) => ({ ...s, rules: [...s.rules, ...(add[s.id] ?? [])] })), ...extra],
  });

  it("seed 덥다 규칙과 배운 TV 규칙이 둘 다 watching_tv에 있으면 에어컨 켜기는 그 상태이고 트리거는 모르며 배운 규칙이 있다", () => {
    expect(fsmRuleOf(withRules({ watching_tv: [HOT, TV] }), "fsm", "에어컨 켜기")).toEqual({ state: "watching_tv", trigger: null, learned: true });
  });

  it("배운 규칙이 다른 상태(evening_tv)에 있으면 상태도 트리거도 모르고 배운 규칙이 있다", () => {
    const evening: FsmMemory["states"][number] = { id: "evening_tv", description: "저녁에 TV를 본다", rules: [TV], next: [] };
    expect(fsmRuleOf(withRules({ watching_tv: [HOT] }, [evening]), "fsm", "에어컨 켜기")).toEqual({ state: null, trigger: null, learned: true });
  });

  it("의도 파악 seed 규칙: TV 보는 중에 덥다고 말하거나 부채질하면 에어컨 켜기다(seed 규칙이라 배운 규칙이 아니다)", () => {
    expect(fsmRuleOf(CUP_FSM_MEMORY, "fsm", "에어컨 켜기")).toMatchObject({ state: "watching_tv", learned: false });
    expect(CUP_FSM_MEMORY.states.find((s) => s.id === "watching_tv")!.rules).toContainEqual({ trigger: "사용자가 덥다고 말하거나 더워서 부채질을 한다.", action: "에어컨 켜기" });
  });

  it("컵 FSM 기억은 상태 넷(먹는 중·TV 보는 중·자리를 뜸·요리)이고 모양이 맞으며, 규칙의 행동은 모두 행동 목록에 있다", () => {
    expect(validateMemory(CUP_FSM_MEMORY, "fsm")).toBe(CUP_FSM_MEMORY);
    expect(CUP_FSM_MEMORY.initial_state).toBe("drinking");
    expect(CUP_FSM_MEMORY.states.map((s) => s.id)).toEqual(["drinking", "watching_tv", "left_cup", "cooking"]);
    for (const s of CUP_FSM_MEMORY.states) for (const r of s.rules) expect(TASK_NAMES, `${s.id}: ${r.action}`).toContain(r.action);
  });

  it("요리 상태(cooking)의 규칙이 코치 행동 「전자레인지로 데우기 알려 주기」도 고른다. 상태 설명은 만들거나 데우려 할 때다", () => {
    expect(fsmRuleOf(CUP_FSM_MEMORY, "fsm", "전자레인지로 데우기 알려 주기")).toEqual({
      state: "cooking", trigger: "사용자가 전자레인지 앞에서 쓰는 법을 묻거나 이거 어떻게 하냐고 말한다.", learned: false,
    });
    expect(CUP_FSM_MEMORY.states.find((s) => s.id === "cooking")!.description).toBe("사용자가 주방에서 음식을 만들거나 데우려 한다. 방법을 묻거나 무엇을 할지 몰라 멈춰 있으면 단계마다 알려 준다.");
    expect(FSM_STATE_TEXT.cooking).toBe("주방에서 할 일을 찾음");
  });

  it("요리 상태(cooking)의 규칙이 코치 행동 「라면 끓이기 알려 주기」를 고르고, 다른 상태마다 요리로 가는 길이 있다", () => {
    expect(fsmRuleOf(CUP_FSM_MEMORY, "fsm", "라면 끓이기 알려 주기")).toEqual({
      state: "cooking", trigger: "사용자가 라면 끓이는 법을 알려 달라고 말했거나, 주방에서 라면을 끓이려다 무엇을 해야 할지 모르겠다고 말한다.", learned: false,
    });
    const cooking = CUP_FSM_MEMORY.states.find((s) => s.id === "cooking")!;
    expect(cooking.next).toEqual([{ to: "drinking", on: "사용자가 음식을 들고 식탁에 앉는다." }]);
    for (const s of CUP_FSM_MEMORY.states.filter((x) => x.id !== "cooking")) {
      expect(s.next, s.id).toContainEqual({ to: "cooking", on: "사용자가 주방으로 가서 요리를 시작하려 한다." });
    }
    expect(FSM_STATE_TEXT.cooking).toBe("주방에서 할 일을 찾음");
  });

  it("컵 갈래 seed: 자리를 뜨면 내용물과 상관없이 치우기(습관), 물은 먹는 중, 콜라는 TV 보는 중. 그대로 두기·물어보기 규칙은 없다", () => {
    const at = (action: string) => fsmRuleOf(CUP_FSM_MEMORY, "fsm", action);
    expect(at("컵 치우기")).toEqual({ state: "left_cup", trigger: "사용자가 컵을 식탁 등에 두고 자리를 비웠고, 아무도 컵을 들거나 만지지 않는다.", learned: false });
    expect(at("컵 그대로 두기")).toBeNull();
    expect(at("사용자에게 물어보기")).toBeNull();
    expect(at("컵에 물 채워 주기")).toEqual({ state: "drinking", trigger: "사용자가 식탁에서 먹는 중이고 식탁 위 컵이 비어 있으며 컵을 들거나 만지지 않는다.", learned: false });
    expect(at("컵에 콜라 따라 주기")).toEqual({ state: "watching_tv", trigger: "사용자가 TV를 보는 중이고 곁의 컵이 비어 있으며 컵을 들거나 만지지 않는다.", learned: false });
    // 물·콜라를 가르는 사실은 관찰 텍스트 낱말(먹는 중·TV 보는 중)이다
    expect(STATES.eating.label).toBe("먹는 중");
    expect(STATES.watching_tv.label).toBe("TV 보는 중");
  });

  it("대기·기억에 없는 행동·list 기억이면 null이다", () => {
    expect(fsmRuleOf(CUP_FSM_MEMORY, "fsm", null)).toBeNull();
    expect(fsmRuleOf(CUP_FSM_MEMORY, "fsm", "창문 닫기")).toBeNull();
    expect(fsmRuleOf(CUP_MEMORY, "list", "컵 치우기")).toBeNull();
  });

  it("같은 행동이 여러 상태에 있으면 상태·트리거를 모르고, 한 상태 안에 여러 번 있으면 상태만 안다. seed에 없는 규칙이면 배운 규칙이다", () => {
    const two: FsmMemory = {
      initial_state: "a",
      states: [
        { id: "a", description: "가", rules: [{ trigger: "ㄱ", action: "컵 치우기" }], next: [] },
        { id: "b", description: "나", rules: [{ trigger: "ㄴ", action: "컵 치우기" }], next: [] },
      ],
    };
    expect(fsmRuleOf(two, "fsm", "컵 치우기")).toEqual({ state: null, trigger: null, learned: true });
    const twice: FsmMemory = { initial_state: "a", states: [{ id: "a", description: "가", rules: [{ trigger: "ㄱ", action: "컵 치우기" }, { trigger: "ㄴ", action: "컵 치우기" }], next: [] }] };
    expect(fsmRuleOf(twice, "fsm", "컵 치우기")).toEqual({ state: "a", trigger: null, learned: true });
  });

  it("컵 FSM 기억의 상태마다 화면용 짧은 한국어 이름표가 있다(12자 아래, 영어 id가 아니다)", () => {
    for (const s of CUP_FSM_MEMORY.states) {
      const label = FSM_STATE_TEXT[s.id];
      expect(label, s.id).toBeTruthy();
      expect(label!.length, s.id).toBeLessThanOrEqual(12);
      expect(label, s.id).toMatch(/[가-힣]/);
      // 영어 id가 아니다(「TV」는 한국어 화면 글에 쓰는 낱말이라 뺀다)
      expect(label!.replace(/TV/g, ""), s.id).not.toMatch(/[A-Za-z_()（）]/);
    }
    expect(FSM_STATE_TEXT).toMatchObject({ cooking: "주방에서 할 일을 찾음", drinking: "먹거나 마시는 중", watching_tv: "TV 보는 중", left_cup: "컵을 두고 자리를 뜸" });
  });
});
