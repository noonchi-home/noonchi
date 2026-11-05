import { describe, expect, it } from "vitest";
import {
  CUP_MEMORY, CUP_TASKS, MockDecision, findDuplicateKey, parsePrediction, selectDecisionFrames, validateDecisionFrames,
  validateMemory, validatePrediction, validateTasks, type DecisionInput,
} from "../src/brain/decision.js";
import { PamDecision } from "../src/brain/pam.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const frames = (n = 5) => Array.from({ length: n }, (_, i) => ({ timestamp: `2026-11-04T12:00:0${i * 2}.000+09:00`, jpeg: JPEG }));
const input = (contents: "empty" | "not_empty" | "unknown"): DecisionInput => ({
  frames: frames(), memory: CUP_MEMORY, memoryKind: "list", tasks: [...CUP_TASKS], facts: { contents },
});

describe("PAM 계약 검사(ai/pam/contracts.py와 같은 규칙)", () => {
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

  it("판단 사진은 2초 격자(PAM predictor 규칙)", () => {
    const off = frames().map((f, i) => (i === 4 ? { ...f, timestamp: "2026-11-04T12:00:08.500+09:00" } : f));
    expect(() => validateDecisionFrames(off)).toThrow(/2초 간격/);
  });

  it("버퍼에서 t-8..t 자리마다 ±0.5초 안의 실제 사진을 고르고 명목 시각을 붙인다", () => {
    const buf = Array.from({ length: 12 * 9 + 1 }, (_, i) => ({ id: `f${i}`, capturedAtMs: Math.round((i * 1000) / 12), jpeg: JPEG }));
    const picked = selectDecisionFrames(buf, 9000, { stepMs: 2000, toleranceMs: 500, offsetMinutes: 540, epochMs: Date.parse("2026-11-04T03:00:00Z") });
    expect(picked).not.toBeNull();
    expect(picked!.map((f) => f.timestamp)).toEqual([
      "2026-11-04T12:00:01.000+09:00", "2026-11-04T12:00:03.000+09:00", "2026-11-04T12:00:05.000+09:00",
      "2026-11-04T12:00:07.000+09:00", "2026-11-04T12:00:09.000+09:00",
    ]);
    expect(picked!.every((f, i) => Math.abs(f.capturedAtMs! - (1000 + i * 2000)) <= 500)).toBe(true);
    expect(() => validateDecisionFrames(picked!)).not.toThrow();
    const gap = buf.filter((f) => f.capturedAtMs < 4000 || f.capturedAtMs > 6000);
    expect(selectDecisionFrames(gap, 9000, { stepMs: 2000, toleranceMs: 500, offsetMinutes: 540, epochMs: 0 })).toBeNull();
  });

  it("판단 사진은 정확히 5장, 시간대 있는 시각, 증가 순서", () => {
    expect(() => validateDecisionFrames(frames())).not.toThrow();
    expect(() => validateDecisionFrames(frames(4))).toThrow(/5장/);
    const noTz = frames().map((f, i) => (i === 2 ? { ...f, timestamp: "2026-11-04T12:00:04" } : f));
    expect(() => validateDecisionFrames(noTz)).toThrow(/시간대/);
    const back = frames().map((f, i) => (i === 3 ? { ...f, timestamp: "2026-11-04T12:00:01.000+09:00" } : f));
    expect(() => validateDecisionFrames(back)).toThrow(/증가/);
  });
});

describe("판단 모델", () => {
  const mock = new MockDecision();

  it("빈 컵이면 컵 치우기, 남았으면 대기, 모르면 묻기", async () => {
    const tasks = [...CUP_TASKS];
    expect(tasks[(await mock.decide(input("empty"))).task_index]).toBe("컵 치우기");
    expect((await mock.decide(input("not_empty"))).task_index).toBe(-1);
    expect(tasks[(await mock.decide(input("unknown"))).task_index]).toBe("사용자에게 물어보기");
  });

  it("what-if로 내용물이 결정을 바꾸는지 알 수 있다", () => {
    expect(mock.whatIf({ contents: "empty" }, [...CUP_TASKS])).not.toBe(mock.whatIf({ contents: "not_empty" }, [...CUP_TASKS]));
  });

  it("계약에 어긋난 입력은 거절한다", async () => {
    await expect(mock.decide({ ...input("empty"), frames: frames(3) })).rejects.toThrow(/5장/);
    await expect(mock.decide({ ...input("empty"), tasks: [] })).rejects.toThrow();
  });

  it("PAM은 주소(PAM_URL) 없이는 부르지 않는다(pam.ts)", async () => {
    await expect(new PamDecision().decide(input("empty"))).rejects.toThrow(/PAM/);
  });
});
