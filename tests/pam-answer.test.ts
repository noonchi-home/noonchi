// 답 검사: 완전한 JSON 객체만 받고, 고치지 않고, invalid는 대기(-1)와 구분한다. 검사 글은 Python PAM과 같다.
import { describe, expect, it } from "vitest";
import { CUP_FSM_MEMORY, validateMemory, validatePrediction, validateTasks } from "../src/brain/decision.js";
import { parseMemory, parsePrediction } from "../src/brain/pam/index.js";
import { LEARNED_FSM_MEMORY } from "../scripts/learned-memory.js";

const T = ["컵 치우기", "사용자에게 물어보기"];
const MEMORY = { initial_state: "away", states: [
  { id: "active", description: "A person is drinking.", activity: ["drinking"], next: [{ to: "*", on: "The person leaves the table.", action: "컵 치우기" }] },
  { id: "away", description: "The person is not visible.", activity: [], next: [{ to: "active", on: "The person comes back and drinks." }] }] };

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
    const unknown = { ...MEMORY, states: [{ ...MEMORY.states[0]!, next: [{ to: "nowhere", on: "x", action: "컵 치우기" }] }, MEMORY.states[1]!] };
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

describe("사람 상태 FSM 판단 답", () => {
  const tasks = ["컵 치우기", "사용자에게 물어보기", "컵에 물 채워 주기"];
  const ok = (o: object) => JSON.stringify({ observation: "o", reasoning: "r", ...o });
  it("화살표의 행동을 서버가 task_index로 만든다(답에 task_index 칸이 없다): 배운 뒤 기억은 컵 치우기, seed는 같은 화살표가 묻기다", () => {
    const p = parsePrediction(ok({ state: "away", from: "drinking", next_index: 0 }), tasks, LEARNED_FSM_MEMORY);
    expect(p).toMatchObject({ status: "valid", selected_action: "컵 치우기", prediction: { task_index: 0, state: "away", from: "drinking", next_index: 0 } });
    expect(parsePrediction(ok({ state: "away", from: "drinking", next_index: 0 }), tasks, CUP_FSM_MEMORY)).toMatchObject({ status: "valid", selected_action: "사용자에게 물어보기", prediction: { task_index: 1 } });
  });
  it("화살표 없음(-1, from null)은 대기다", () => {
    expect(parsePrediction(ok({ state: "drinking", from: null, next_index: -1 }), tasks, CUP_FSM_MEMORY)).toMatchObject({ status: "valid", selected_action: null, prediction: { task_index: -1 } });
  });
  it("배운 뒤에도 식탁(마시는 중)에서 떠나면 치우고 TV 앞(같이 마시는 중)에서 떠나면 묻는다(사용자 답 2026-11-19)", () => {
    const tvLeave = LEARNED_FSM_MEMORY.states.find((s) => s.id === "watching_tv")!.next.findIndex((e) => e.to === "*");
    expect(parsePrediction(ok({ state: "away", from: "drinking", next_index: 0 }), tasks, LEARNED_FSM_MEMORY).selected_action).toBe("컵 치우기");
    expect(parsePrediction(ok({ state: "away", from: "watching_tv", next_index: tvLeave }), tasks, LEARNED_FSM_MEMORY).selected_action).toBe("사용자에게 물어보기");
  });
  it("화살표 행동이 지금 행동 목록에 없으면(코치 행동을 눈치 모드에서) 화살표는 남기고 행동은 대기다", () => {
    const p = parsePrediction(ok({ state: "cooking", from: "cooking", next_index: 0 }), tasks, CUP_FSM_MEMORY);
    expect(p).toMatchObject({ status: "valid", selected_action: null, prediction: { task_index: -1, from: "cooking", next_index: 0 } });
  });
  it("기억에 없는 활동은 임시 상태(~하는 일 값)로 내고, \"*\" 화살표는 그 임시 상태로 떠나도 켜진다", () => {
    expect(parsePrediction(ok({ state: "~using_laptop", from: "drinking", next_index: 0 }), tasks, LEARNED_FSM_MEMORY)).toMatchObject({ status: "valid", selected_action: "컵 치우기", prediction: { state: "~using_laptop" } });
    for (const bad of [
      { state: "~using_laptop", from: "away", next_index: 1 },   // 이름 있는 도착(watching_tv) 화살표
      { state: "~flying", from: null, next_index: -1 },           // 모르는 하는 일 값
      { state: "~drinking", from: null, next_index: -1 },         // 기억 상태가 가진 하는 일 값
    ]) expect(parsePrediction(ok(bad), tasks, CUP_FSM_MEMORY).status).toBe("invalid");
  });
  it("없는 상태, 넘는 번호, 도착 상태가 화살표와 다름, \"*\" 화살표인데 같은 상태, task_index 칸이 있으면 invalid다", () => {
    for (const bad of [
      { state: "nap", from: null, next_index: -1 },
      { state: "away", from: "drinking", next_index: 9 },
      { state: "cooking", from: "drinking", next_index: 1 },
      { state: "drinking", from: "drinking", next_index: 0 },
      { state: "away", from: "drinking", next_index: 0, task_index: 0 },
    ]) expect(parsePrediction(ok(bad), tasks, CUP_FSM_MEMORY).status).toBe("invalid");
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
