// 문맥 길이 검사: limits()가 알리는 반성 입력 한도 안의 요청은 통과하고, 넘으면 거절한다.
import { describe, expect, it } from "vitest";
import { PamBudgetError, buildReflectMessages, checkBudget, pamLimits, reflectRequest } from "../src/brain/pam/index.js";

const MEMORY = { initial_state: "drinking", states: [
  { id: "drinking", description: "마시는 중", rules: [], next: [{ to: "left_cup", on: "컵을 두고 떠남" }] },
  { id: "left_cup", description: "컵을 두고 자리를 비움", rules: [{ trigger: "빈 컵이 식탁에 남음", action: "컵 치우기" }], next: [] }] };
const S = { maxModelLen: 32768, maxTokens: { predictor: 2048, reflector: 16384 } };
const reflect = (obs: string, actions: string) => buildReflectMessages(reflectRequest({ contract: "pam-reflect/2", day: "2026-11-07",
  memory_kind: "fsm", memory: MEMORY, observation_text: obs, action_summary: actions, feedback: null })).messages;

describe("문맥 길이", () => {
  it("알린 한도 안의 글은 max_tokens와 함께 들어간다", () => {
    const room = pamLimits(S).reflect_input_bytes - Buffer.byteLength(JSON.stringify(MEMORY, null, 2));
    const obs = ("가".repeat(30) + "\n").repeat(Math.floor((room * 0.7) / 91));
    const actions = ("나".repeat(30) + "\n").repeat(Math.floor((room * 0.3) / 91));
    expect(() => checkBudget(reflect(obs, actions), S.maxTokens.reflector, S.maxModelLen)).not.toThrow();
  });

  it("넘으면 PamBudgetError", () => {
    expect(() => checkBudget(reflect("가".repeat(40_000), "나"), S.maxTokens.reflector, S.maxModelLen)).toThrow(PamBudgetError);
  });

  it("한도는 문맥 길이를 따른다", () => {
    const small = pamLimits({ ...S, maxModelLen: 20_000 });
    const big = pamLimits(S);
    expect(small.max_model_len).toBe(20_000);
    expect(small.reflect_input_bytes).toBeGreaterThan(0);
    expect(small.reflect_input_bytes).toBeLessThan(big.reflect_input_bytes);
  });
});
