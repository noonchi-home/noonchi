// LLM 답 검사. 원문을 고치지 않는다: 완전한 JSON 객체만 받고(마크다운 울타리·앞뒤 글·중복 키·NaN 같은 상수 거절), invalid는 대기(-1)와 구분한다.
// 검사 글은 Python PAM과 같다. JSON 문법 오류 글만 다르다.
import type { Prediction } from "../../contract/pam.js";
import { ContractError, validateMemory, validatePrediction, type PamMemory } from "../decision.js";
import { pyRepr } from "./py.js";
import { PyJsonFail, readPyJson } from "./pyjson.js";

export interface ParsedPrediction {
  status: "valid" | "invalid";
  raw_response: string;
  prediction: Prediction | null;
  selected_action: string | null;
  errors: string[];
}

export function parsePrediction(raw: string, tasks: string[]): ParsedPrediction {
  const result: ParsedPrediction = { status: "invalid", raw_response: raw, prediction: null, selected_action: null, errors: [] };
  try {
    const prediction = validatePrediction(readPyJson(raw), tasks);
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
