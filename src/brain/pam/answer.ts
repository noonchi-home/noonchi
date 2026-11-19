// LLM 답 검사. 원문을 고치지 않는다: 완전한 JSON 객체만 받고(마크다운 울타리·앞뒤 글·중복 키·NaN 같은 상수 거절), invalid는 대기(-1)와 구분한다.
// 검사 글은 Python PAM과 같다. JSON 문법 오류 글만 다르다.
import type { Prediction } from "../../contract/pam.js";
import { ContractError, validateFsmPrediction, validateMemory, validatePrediction, type FsmMemory, type PamMemory } from "../decision.js";
import { pyRepr } from "./py.js";
import { PyJsonFail, readPyJson } from "./pyjson.js";

export interface ParsedPrediction {
  status: "valid" | "invalid";
  raw_response: string;
  prediction: Prediction | null;
  selected_action: string | null;
  errors: string[];
}

/** fsm이 있으면(fsm 기억과 요청의 직전 상태) 답은 사람 상태·화살표(validateFsmPrediction, 행동은 서버가 화살표에서 만든다), 아니면 task_index 답. */
export function parsePrediction(raw: string, tasks: string[], fsm?: { memory: FsmMemory; lastState: string | null }): ParsedPrediction {
  const result: ParsedPrediction = { status: "invalid", raw_response: raw, prediction: null, selected_action: null, errors: [] };
  try {
    const prediction = fsm ? validateFsmPrediction(readPyJson(raw), fsm.memory, tasks, fsm.lastState) : validatePrediction(readPyJson(raw), tasks);
    result.status = "valid";
    result.prediction = prediction;
    result.selected_action = prediction.task_index === -1 ? null : tasks[prediction.task_index]!;
  } catch (e) {
    if (e instanceof PyJsonFail) {
      const r = e.reason;
      result.errors.push(r.kind === "duplicate" ? `response JSON: duplicate key ${pyRepr(r.key)}` : r.kind === "constant" ? `response JSON: nonstandard numeric constant ${pyRepr(r.value)}` : e.message);
    } else if (e instanceof ContractError) result.errors.push(e.message);
    else throw e;
  }
  return result;
}

export type ParsedMemory = { ok: true; memory: PamMemory } | { ok: false; error: string };

export function parseMemory(raw: string, kind: "list" | "fsm"): ParsedMemory {
  try {
    return { ok: true, memory: validateMemory(readPyJson(raw), kind) };
  } catch (e) {
    if (e instanceof PyJsonFail || e instanceof ContractError) return { ok: false, error: e.message };
    throw e;
  }
}
