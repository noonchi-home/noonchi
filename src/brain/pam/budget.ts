// 문맥 길이 검사: 입력 추정 토큰 + max_tokens ≤ max_model_len. 추정은 UTF-8 바이트 ÷ 3(한국어 한 글자를 1토큰으로 넉넉히 센다).
import { PamBudgetError } from "./errors.js";
import { buildPredictMessages, buildReflectMessages, type PamMessage } from "./prompt.js";
import { predictRequest, reflectRequest } from "./request.js";

export const PER_MESSAGE = 8;
export const RESERVE = 256;
export interface PamLimits { max_model_len: number; predict_input_bytes: number; reflect_input_bytes: number }
export interface BudgetSettings { maxModelLen: number; maxTokens: { predictor: number; reflector: number } }

const texts = (ms: PamMessage[]) => ms.flatMap((m) => (typeof m.content === "string" ? [m.content] : m.content.map((p) => p.text ?? "")));

export const estimateTokens = (ms: PamMessage[]): number =>
  texts(ms).reduce((n, t) => n + Math.ceil(Buffer.byteLength(t, "utf8") / 3), 0) + PER_MESSAGE * ms.length;

export function checkBudget(ms: PamMessage[], maxTokens: number, maxModelLen: number): void {
  const n = estimateTokens(ms);
  if (n + maxTokens > maxModelLen) throw new PamBudgetError(`입력이 문맥 길이를 넘음: 추정 ${n} + 출력 ${maxTokens} > ${maxModelLen}`);
}

/** 판단·반성 요청에서 바뀌는 글(관찰 텍스트·행동 요약·피드백·기억 JSON·행동 목록)에 쓸 수 있는 UTF-8 바이트 수. */
export function pamLimits(s: BudgetSettings): PamLimits {
  const empty = { initial_state: "away", states: [{ id: "away", description: "d", activity: [], next: [] }] };
  const p = buildPredictMessages(predictRequest({ contract: "pam-predict/3", final_time: "2026-01-01T00:00:00+09:00", observation_text: "x", memory_kind: "fsm", memory: empty, tasks: ["t"], last_state: null })).messages;
  const r = buildReflectMessages(reflectRequest({ contract: "pam-reflect/2", day: "2026-01-01", memory_kind: "fsm", memory: empty, observation_text: "x", action_summary: "x", feedback: null })).messages;
  const room = (ms: PamMessage[], role: "predictor" | "reflector") => Math.max(0, (s.maxModelLen - s.maxTokens[role] - estimateTokens(ms) - RESERVE) * 3);
  return { max_model_len: s.maxModelLen, predict_input_bytes: room(p, "predictor"), reflect_input_bytes: room(r, "reflector") };
}
