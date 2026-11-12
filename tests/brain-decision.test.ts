import { describe, expect, it } from "vitest";
import {
  CUP_FSM_MEMORY, CUP_MEMORY, CUP_TASKS, checkInput, findDuplicateKey, fsmRuleOf, isoWithOffset, parsePrediction,
  validateMemory, validatePrediction, validateTasks, type DecisionInput, type FsmMemory,
} from "../src/brain/decision.js";
import { FSM_STATE_TEXT } from "../src/world/labels.js";

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
  it("고른 행동을 FSM 기억 규칙에서 찾아 그 규칙의 상태와 트리거를 준다", () => {
    const rule = CUP_FSM_MEMORY.states[1]!.rules[0]!;
    expect(fsmRuleOf(CUP_FSM_MEMORY, "fsm", "컵 치우기")).toEqual({ state: "left_cup", trigger: rule.trigger });
    expect(fsmRuleOf(CUP_FSM_MEMORY, "fsm", "사용자에게 물어보기")).toEqual({ state: "left_cup", trigger: CUP_FSM_MEMORY.states[1]!.rules[1]!.trigger });
  });

  it("대기·기억에 없는 행동·list 기억이면 null이다", () => {
    expect(fsmRuleOf(CUP_FSM_MEMORY, "fsm", null)).toBeNull();
    expect(fsmRuleOf(CUP_FSM_MEMORY, "fsm", "창문 닫기")).toBeNull();
    expect(fsmRuleOf(CUP_MEMORY, "list", "컵 치우기")).toBeNull();
  });

  it("같은 행동이 여러 상태에 있으면 null이다(어느 상태인지 모른다). 한 상태 안에 여러 번 있어도 null이다", () => {
    const two: FsmMemory = {
      initial_state: "a",
      states: [
        { id: "a", description: "가", rules: [{ trigger: "ㄱ", action: "컵 치우기" }], next: [] },
        { id: "b", description: "나", rules: [{ trigger: "ㄴ", action: "컵 치우기" }], next: [] },
      ],
    };
    expect(fsmRuleOf(two, "fsm", "컵 치우기")).toBeNull();
    const twice: FsmMemory = { initial_state: "a", states: [{ id: "a", description: "가", rules: [{ trigger: "ㄱ", action: "컵 치우기" }, { trigger: "ㄴ", action: "컵 치우기" }], next: [] }] };
    expect(fsmRuleOf(twice, "fsm", "컵 치우기")).toBeNull();
  });

  it("컵 FSM 기억의 상태마다 화면용 짧은 한국어 이름표가 있다(12자 아래, 영어 id가 아니다)", () => {
    for (const s of CUP_FSM_MEMORY.states) {
      const label = FSM_STATE_TEXT[s.id];
      expect(label, s.id).toBeTruthy();
      expect(label!.length, s.id).toBeLessThanOrEqual(12);
      expect(label, s.id).toMatch(/[가-힣]/);
      expect(label, s.id).not.toMatch(/[A-Za-z_()（）]/);
    }
  });
});
