// 판단 모델(박석준 PAM)을 도구로 부르는 자리. 계약은 ai/pam/contracts.py와 같다:
// decide(사진 5장, 기억, 작업 목록) → {observation, reasoning, task_index}. task_index -1은 대기다.
// 판단 모델은 무엇을 도울지만 정한다. 언제 더 볼지·행동 전 재확인은 상태 기계(machine.ts)가 정한다.
// 검사 메시지는 PAM 원문(영어)과 같게 두어 두 쪽 기록을 대조하기 쉽게 한다.

import type { Contents } from "./perception.js";
import type { Frame } from "./window.js";

export class ContractError extends Error {}

type Json = unknown;

function object(value: Json, fields: string[], path: string): Record<string, Json> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ContractError(`${path}: expected an object`);
  const actual = Object.keys(value);
  const missing = fields.filter((f) => !actual.includes(f)).sort();
  const extra = actual.filter((k) => !fields.includes(k)).sort();
  if (missing.length || extra.length) {
    throw new ContractError(`${path}: incorrect fields (missing=${JSON.stringify(missing)}, extra=${JSON.stringify(extra)})`);
  }
  return value as Record<string, Json>;
}

function text(value: Json, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ContractError(`${path}: expected a nonempty string`);
  return value;
}

function array(value: Json, path: string): Json[] {
  if (!Array.isArray(value)) throw new ContractError(`${path}: expected an array`);
  return value;
}

export function validateTasks(value: Json): string[] {
  const tasks = array(value, "tasks");
  if (!tasks.length) throw new ContractError("tasks: at least one available action is required");
  tasks.forEach((t, i) => text(t, `tasks[${i}]`));
  return tasks as string[];
}

function rules(value: Json, path: string): void {
  array(value, path).forEach((rule, i) => {
    const p = `${path}[${i}]`;
    const r = object(rule, ["trigger", "action"], p);
    text(r.trigger, `${p}.trigger`);
    text(r.action, `${p}.action`);
  });
}

export interface ListMemory { rules: { trigger: string; action: string }[] }
export interface FsmMemory {
  initial_state: string;
  states: { id: string; description: string; rules: { trigger: string; action: string }[]; next: { to: string; on: string }[] }[];
}
export type PamMemory = ListMemory | FsmMemory;

/** 기억 모양만 검사한다. 규칙을 실행하거나 상태를 넘기지 않는다. */
export function validateMemory(value: Json, kind: "list" | "fsm"): PamMemory {
  if (kind === "list") {
    const m = object(value, ["rules"], "memory");
    rules(m.rules, "memory.rules");
    return m as unknown as ListMemory;
  }
  if (kind !== "fsm") throw new ContractError("memory kind: expected 'list' or 'fsm'");
  const m = object(value, ["initial_state", "states"], "memory");
  const initial = text(m.initial_state, "memory.initial_state");
  const states = array(m.states, "memory.states");
  if (!states.length) throw new ContractError("memory.states: at least one state is required");
  const ids = new Set<string>();
  const destinations: [string, string][] = [];
  states.forEach((state, i) => {
    const p = `memory.states[${i}]`;
    const s = object(state, ["id", "description", "rules", "next"], p);
    const id = text(s.id, `${p}.id`);
    if (ids.has(id)) throw new ContractError(`${p}.id: duplicate state identifier '${id}'`);
    ids.add(id);
    text(s.description, `${p}.description`);
    rules(s.rules, `${p}.rules`);
    array(s.next, `${p}.next`).forEach((t, j) => {
      const tp = `${p}.next[${j}]`;
      const tr = object(t, ["to", "on"], tp);
      destinations.push([`${tp}.to`, text(tr.to, `${tp}.to`)]);
      text(tr.on, `${tp}.on`);
    });
  });
  if (!ids.has(initial)) throw new ContractError("memory.initial_state: must name an existing state");
  for (const [path, to] of destinations) {
    if (!ids.has(to)) throw new ContractError(`${path}: unknown state identifier '${to}'`);
  }
  return m as unknown as FsmMemory;
}

export interface Prediction { observation: string; reasoning: string; task_index: number }

export function validatePrediction(value: Json, tasks: string[]): Prediction {
  validateTasks(tasks);
  const p = object(value, ["observation", "reasoning", "task_index"], "prediction");
  text(p.observation, "prediction.observation");
  text(p.reasoning, "prediction.reasoning");
  const index = p.task_index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < -1 || index >= tasks.length) {
    throw new ContractError(`prediction.task_index: expected an integer from -1 to ${tasks.length - 1}`);
  }
  return p as unknown as Prediction;
}

/** 이미 올바른 JSON 글에서 같은 객체 안의 중복 키를 찾는다(JSON.parse는 마지막 값으로 덮어쓴다). */
export function findDuplicateKey(raw: string): string | null {
  const stack: (Set<string> | null)[] = [];
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === "{") { stack.push(new Set()); i++; continue; }
    if (ch === "[") { stack.push(null); i++; continue; }
    if (ch === "}" || ch === "]") { stack.pop(); i++; continue; }
    if (ch === '"') {
      let j = i + 1;
      while (raw[j] !== '"') j += raw[j] === "\\" ? 2 : 1;
      const str = JSON.parse(raw.slice(i, j + 1)) as string;
      let k = j + 1;
      while (/\s/.test(raw[k] ?? "")) k++;
      const keys = stack.at(-1);
      if (raw[k] === ":" && keys) {
        if (keys.has(str)) return str;
        keys.add(str);
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  return null;
}

export interface ParsedPrediction {
  status: "valid" | "invalid";
  raw_response: string;
  prediction: Prediction | null;
  selected_action: string | null;
  errors: string[];
}

/** 원문을 고치지 않는다: 완전한 JSON 객체만 받고, invalid는 대기(-1)와 구분한다. */
export function parsePrediction(raw: string, tasks: string[]): ParsedPrediction {
  const result: ParsedPrediction = { status: "invalid", raw_response: raw, prediction: null, selected_action: null, errors: [] };
  try {
    const value = JSON.parse(raw) as Json;
    const dup = findDuplicateKey(raw);
    if (dup !== null) throw new ContractError(`response JSON: duplicate key '${dup}'`);
    const prediction = validatePrediction(value, tasks);
    result.status = "valid";
    result.prediction = prediction;
    result.selected_action = prediction.task_index === -1 ? null : tasks[prediction.task_index]!;
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
  }
  return result;
}

export interface DecisionFrame {
  /** PAM에 넘길 명목 시각: 시간대가 있는 ISO, 2초 격자(t-8..t). */
  timestamp: string;
  /** 실제 촬영 시각(ms). 명목 시각과 ±0.5초 안. */
  capturedAtMs?: number;
  jpeg?: Buffer;
  path?: string;
}

const TZ = /(Z|[+-]\d{2}:\d{2})$/;

/** PAM predictor 입력 규칙: 정확히 5장, 시간대 있는 시각, 증가, 정확히 stepMs 간격(PAM은 2초). */
export function validateDecisionFrames(frames: DecisionFrame[], stepMs = 2000): void {
  if (frames.length !== 5) throw new ContractError(`판단 사진은 5장이어야 합니다(지금 ${frames.length}장)`);
  let previous = Number.NEGATIVE_INFINITY;
  frames.forEach((f, i) => {
    if (!TZ.test(f.timestamp) || Number.isNaN(Date.parse(f.timestamp))) {
      throw new ContractError(`frames[${i}].timestamp: 시간대가 있는 ISO 시각이어야 합니다`);
    }
    const t = Date.parse(f.timestamp);
    if (t <= previous) throw new ContractError(`frames[${i}].timestamp: 시각이 증가해야 합니다`);
    if (i > 0 && t - previous !== stepMs) throw new ContractError(`frames[${i}].timestamp: 판단 사진은 ${stepMs / 1000}초 간격이어야 합니다`);
    previous = t;
  });
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** ms → 그 시간대(분)의 ISO 시각. 예: 2026-11-04T12:00:01.000+09:00 */
export function isoWithOffset(ms: number, offsetMinutes: number): string {
  const local = new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 23);
  const a = Math.abs(offsetMinutes);
  return `${local}${offsetMinutes >= 0 ? "+" : "-"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export interface DecisionFrameOptions {
  stepMs: number;
  toleranceMs: number;
  /** 명목 시각을 쓸 시간대(분). 한국은 540. */
  offsetMinutes: number;
  /** capturedAtMs가 상대 시각이면 그 0의 실제 시각(ms). 절대 시각(Date.now)이면 0. */
  epochMs: number;
}

/** 끝 시각 endMs에서 t-8..t 자리마다 ±toleranceMs 안의 가장 가까운 실제 사진을 고른다. 한 자리라도 없으면 null. */
export function selectDecisionFrames(frames: readonly Frame[], endMs: number, opts: DecisionFrameOptions): DecisionFrame[] | null {
  const picked: DecisionFrame[] = [];
  const used = new Set<string>();
  for (let k = 4; k >= 0; k--) {
    const nominal = endMs - k * opts.stepMs;
    let best: Frame | undefined;
    for (const f of frames) {
      const d = Math.abs(f.capturedAtMs - nominal);
      if (d <= opts.toleranceMs && f.capturedAtMs <= endMs && (!best || d < Math.abs(best.capturedAtMs - nominal))) best = f;
    }
    if (!best || used.has(best.id)) return null;
    used.add(best.id);
    picked.push({ timestamp: isoWithOffset(opts.epochMs + nominal, opts.offsetMinutes), capturedAtMs: best.capturedAtMs, jpeg: best.jpeg });
  }
  return picked;
}

/** 우리 쪽 관찰 사실. PAM은 사진과 기억만 보지만, 모의 모델과 기록에는 이것을 쓴다. */
export interface DecisionFacts { contents: Contents }

/** 장면 사진 5장 밖의 근거. 요청 답 사진처럼 5장 격자에 들지 않는 사진과, 그 사진에서 VLM이 확신한 사실(컵 안). */
export interface DecisionEvidence {
  kind: "cup_contents";
  value: Contents;
  certain: boolean;
  /** 근거 사진 촬영 시각(시간대 있는 ISO). */
  timestamp: string;
  source: "request_answer_photo" | "scene_frame";
  jpeg?: Buffer;
}

export interface DecisionInput {
  frames: DecisionFrame[];
  memory: PamMemory;
  memoryKind: "list" | "fsm";
  tasks: string[];
  facts: DecisionFacts;
  evidence?: DecisionEvidence[];
}

export interface DecisionModel {
  readonly name: string;
  decide(input: DecisionInput): Promise<Prediction>;
  /** 사진 없이 사실만으로 결과를 미리 볼 수 있으면 준다(요청이 결정을 바꾸는지 따질 때). */
  whatIf?(facts: DecisionFacts, tasks: string[]): number;
}

/** 컵 시나리오의 작업 목록(임시). 실제 목록은 박석준과 정한다. */
export const CUP_TASKS = ["컵 치우기", "사용자에게 물어보기"] as const;

/** 컵 시나리오의 list 기억(임시, 모의 모델 설명용). 실제 기억은 PAM이 만든다. */
export const CUP_MEMORY: ListMemory = {
  rules: [
    { trigger: "사용자가 컵을 두고 자리를 비웠고 컵이 비어 있음", action: "컵 치우기" },
    { trigger: "사용자가 자리를 비웠지만 컵에 음료가 남아 있음", action: "대기" },
    { trigger: "컵 안을 확인할 수 없음", action: "사용자에게 물어보기" },
  ],
};

/** 컵 시나리오의 FSM 기억(임시). PAM fsm 기억 모양(ai/pam/contracts.py validate_memory)을 따른다.
 *  실제 기억은 PAM 반성기(reflector)가 만든다. 작업 이름은 CUP_TASKS와 같게 둔다. */
export const CUP_FSM_MEMORY: FsmMemory = {
  initial_state: "drinking",
  states: [
    {
      id: "drinking",
      description: "사용자가 식탁에서 컵으로 음료를 마시는 중이라 컵은 사용 중이다.",
      rules: [],
      next: [{ to: "left_cup", on: "사용자가 컵을 식탁에 내려놓고 자리를 떠나 보이지 않는다." }],
    },
    {
      id: "left_cup",
      description: "사용자가 컵을 식탁에 두고 자리를 비웠다. 화면에 안 보이는 것만으로 떠났다고 보지 않는다.",
      rules: [
        { trigger: "사용자가 자리를 비웠고 식탁 위 컵이 비어 있으며 아무도 컵을 들거나 만지지 않는다.", action: "컵 치우기" },
        { trigger: "사용자가 자리를 비웠고 컵 안을 확인할 수 없다.", action: "사용자에게 물어보기" },
      ],
      next: [{ to: "drinking", on: "사용자가 돌아와 컵을 다시 든다." }],
    },
  ],
};

export function checkInput(input: DecisionInput): void {
  validateDecisionFrames(input.frames);
  validateTasks(input.tasks);
  validateMemory(input.memory, input.memoryKind);
}

/** 결정론 모의 모델: 빈 컵 → 컵 치우기, 남음 → 대기, 모름 → 묻기(목록에 없으면 대기). */
export class MockDecision implements DecisionModel {
  readonly name = "mock";

  whatIf(facts: DecisionFacts, tasks: string[]): number {
    if (facts.contents === "empty") return tasks.indexOf("컵 치우기");
    if (facts.contents === "not_empty") return -1;
    return tasks.indexOf("사용자에게 물어보기");
  }

  async decide(input: DecisionInput): Promise<Prediction> {
    checkInput(input);
    const index = this.whatIf(input.facts, input.tasks);
    const said = { empty: "컵이 비어 있음", not_empty: "컵에 음료가 남아 있음", unknown: "컵 안을 확인할 수 없음" }[input.facts.contents];
    const reasoning = index === -1 ? `${said} → 기다린다` : `${said} → ${input.tasks[index]}`;
    return validatePrediction({ observation: `사용자는 자리에 없고 ${said}`, reasoning, task_index: index }, input.tasks);
  }
}

// 박석준 PAM을 HTTP로 부르는 어댑터는 pam.ts(PamDecision)에 있다.
