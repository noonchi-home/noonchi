// 답 검사: 완전한 JSON 객체만 받고, 고치지 않고, invalid는 대기(-1)와 구분한다. 검사 글은 Python PAM과 같다.
import { describe, expect, it } from "vitest";
import { validateMemory, validatePrediction, validateTasks } from "../src/brain/decision.js";
import { parseMemory, parsePrediction } from "../src/brain/pam/index.js";

const T = ["컵 치우기", "사용자에게 물어보기"];
const MEMORY = { initial_state: "active", states: [
  { id: "active", description: "A person is using a workspace.", rules: [{ trigger: "A spare tool is needed.", action: "Offer the spare tool." }], next: [{ to: "done", on: "The person leaves the workspace." }] },
  { id: "done", description: "The workspace is empty.", rules: [], next: [] }] };

describe("행동 목록·기억", () => {
  it("행동 목록은 비지 않은 배열이고 글은 Python strip() 기준으로 비지 않는다", () => {
    expect(validateTasks(T)).toEqual(T);
    for (const bad of [[], [""], [" "], ["\u3000"], ["\x1f"], [1], "a"]) expect(() => validateTasks(bad)).toThrow();
    expect(validateTasks(["\ufeff"])).toEqual(["\ufeff"]);
  });

  it("기억: 빈 규칙·끝 상태를 받고, 받은 것을 바꾸지 않는다", () => {
    const copy = structuredClone(MEMORY);
    expect(validateMemory(copy, "fsm")).toEqual(MEMORY);
    expect(copy).toEqual(MEMORY);
  });

  it("기억: 상태 id 중복·모르는 상태·모양 틀림은 Python과 같은 글로 실패", () => {
    const dup = { ...MEMORY, states: [MEMORY.states[0]!, { ...MEMORY.states[1]!, id: "active" }] };
    expect(() => validateMemory(dup, "fsm")).toThrow("memory.states[1].id: duplicate state identifier 'active'");
    const unknown = { ...MEMORY, states: [{ ...MEMORY.states[0]!, next: [{ to: "nowhere", on: "x" }] }, MEMORY.states[1]!] };
    expect(() => validateMemory(unknown, "fsm")).toThrow("memory.states[0].next[0].to: unknown state identifier 'nowhere'");
    expect(() => validateMemory({ ...MEMORY, label: "x" }, "fsm")).toThrow(`memory: incorrect fields (missing=[], extra=["'label'"])`);
    expect(() => validateMemory({ rules: [] }, "fsm")).toThrow("memory: incorrect fields (missing=['initial_state', 'states'], extra=[\"'rules'\"])");
  });
});

describe("판단 답", () => {
  it("행동 번호를 행동 이름으로, 원문은 그대로 남긴다", () => {
    const raw = '{"observation":"o","reasoning":"r","task_index":1}';
    expect(parsePrediction(raw, T)).toEqual({ status: "valid", raw_response: raw, prediction: { observation: "o", reasoning: "r", task_index: 1 }, selected_action: "사용자에게 물어보기", errors: [] });
  });

  it("대기(-1)는 invalid가 아니다", () => {
    expect(parsePrediction('{"observation":"o","reasoning":"r","task_index":-1}', T)).toMatchObject({ status: "valid", selected_action: null });
  });

  it("틀린 행동 번호는 대기가 되지 않는다(1.0·1e0·true·범위 밖)", () => {
    for (const i of ["2", "-2", "1.0", "1e0", "true", '"0"']) {
      const r = parsePrediction(`{"observation":"o","reasoning":"r","task_index":${i}}`, T);
      expect(r, i).toMatchObject({ status: "invalid", prediction: null, selected_action: null });
    }
    expect(() => validatePrediction({ observation: "o", reasoning: "r", task_index: 2 }, T)).toThrow("prediction.task_index: expected an integer from -1 to 1");
  });

  it("엄격한 JSON: 중복 키(안쪽 먼저)·상수·고치기 없음", () => {
    expect(parsePrediction('{"observation":"o","observation":{"x":1,"x":2},"reasoning":"r","task_index":0}', T).errors).toEqual(["response JSON: duplicate key 'x'"]);
    expect(parsePrediction('{"observation":"o","reasoning":"r","task_index":NaN}', T).errors).toEqual(["response JSON: nonstandard numeric constant 'NaN'"]);
    expect(parsePrediction('{"a":{"b":1,"c":"\\"b\\":"},"d":[{"b":1},{"b":2}]}', T).errors[0]).not.toMatch(/duplicate/);
    for (const raw of ["```json\n{}\n```", '답: {"observation":"o","reasoning":"r","task_index":0}', "", "[]"]) expect(parsePrediction(raw, T).status, raw).toBe("invalid");
  });

  it("칸이 정확히 셋이고 글이 비지 않는다", () => {
    expect(parsePrediction('{"observation":"o","reasoning":"r","task_index":0,"x":1}', T).errors).toEqual([`prediction: incorrect fields (missing=[], extra=["'x'"])`]);
    expect(parsePrediction('{"observation":" ","reasoning":"r","task_index":0}', T).errors).toEqual(["prediction.observation: expected a nonempty string"]);
  });
});

describe("반성 답", () => {
  it("완전한 JSON 기억만 받는다", () => {
    expect(parseMemory(JSON.stringify(MEMORY), "fsm")).toEqual({ ok: true, memory: MEMORY });
    expect(parseMemory('{"rules": [], "rules": []}', "list")).toEqual({ ok: false, error: "duplicate key: rules" });
    expect(parseMemory('{"rules": [{"trigger": "a", "action": NaN}]}', "list")).toEqual({ ok: false, error: "nonstandard constant: NaN" });
    for (const raw of ["```json\n{}\n```", "[]"]) expect(parseMemory(raw, "list").ok, raw).toBe(false);
  });
});
