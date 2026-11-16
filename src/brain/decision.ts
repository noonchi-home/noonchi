// 판단 모델(PAM)을 도구로 부르는 자리. 검사 규칙은 services/pam/pam/contracts.py와 같다:
// decide(관찰 텍스트, 마지막 관찰 시각, 기억, 작업 목록) → {observation, reasoning, task_index}. task_index -1은 대기다. 사진은 넘기지 않는다.
// 판단 모델은 무엇을 도울지만 정한다. 언제 부를지는 판단 호출 시점(src/world/trigger.ts)이 정한다.
// 검사 메시지는 PAM 원문(영어)과 같게 두어 두 쪽 기록을 대조하기 쉽게 한다.



import type { Prediction, FsmRuleAt } from "../contract/pam.js";
import { PAM_TEXT_MAX } from "../world/index.js";

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

const TZ = /(Z|[+-]\d{2}:\d{2})$/;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** ms → 그 시간대(분)의 ISO 시각. 예: 2026-11-04T12:00:01.000+09:00 */
export function isoWithOffset(ms: number, offsetMinutes: number): string {
  const local = new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 23);
  const a = Math.abs(offsetMinutes);
  return `${local}${offsetMinutes >= 0 ? "+" : "-"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** 컵 안: 비어 있음·남음·모름. */
export type Contents = "empty" | "not_empty" | "unknown";

/** 우리 쪽 관찰 사실. PAM은 관찰 텍스트와 기억만 보고, 시험용 판단 모델과 기록은 이것을 쓴다. */
export interface DecisionFacts { contents: Contents }

/** PAM 판단 입력(pam-predict/2 칸과 같다). 사진 칸이 없다. */
export interface DecisionInput {
  /** World State 관찰 텍스트(src/world/text.ts buildPamText). */
  text: string;
  /** 마지막 관찰 시각(시간대 있는 ISO). */
  finalTime: string;
  memory: PamMemory;
  memoryKind: "list" | "fsm";
  tasks: string[];
  facts: DecisionFacts;
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
  rules: [{ trigger: "사용자가 컵을 식탁 등에 두고 자리를 비웠고, 아무도 컵을 들거나 만지지 않는다.", action: "컵 치우기" }],
};

/** 컵 시나리오의 FSM 기억(임시, seed). PAM fsm 기억 모양(services/pam/pam/contracts.py validate_memory)을 따른다.
 *  실제 기억은 PAM 반성기(reflector)가 만든다. 규칙의 행동 이름은 행동 목록(src/act/tasks.ts TASK_NAMES)에 있는 것이다.
 *  컵 갈래(2026-11-13)는 여기 글로 정한다: 물은 「먹는 중」, 콜라는 「TV 보는 중」, 컵을 두고 자리를 비우면 내용물과 상관없이 치운다(습관).
 *  이 글을 바꾸면 기록 DB의 seed 판본이 새로 올라간다(src/brain/history/reflect.ts memoryForDay). 상태 id를 더하면 화면 이름표(src/world/labels.ts FSM_STATE_TEXT)도 더한다. */
export const CUP_FSM_MEMORY: FsmMemory = {
  initial_state: "drinking",
  states: [
    {
      id: "drinking",
      description: "사용자가 식탁에 앉아 먹거나 마시는 중이다. 들고 있는 컵은 사용 중이라 건드리지 않는다.",
      rules: [{ trigger: "사용자가 식탁에서 먹는 중이고 식탁 위 컵이 비어 있으며 컵을 들거나 만지지 않는다.", action: "컵에 물 채워 주기" }],
      next: [{ to: "watching_tv", on: "사용자가 TV를 보기 시작한다." }, { to: "left_cup", on: "사용자가 컵을 두고 자리를 떠나 보이지 않는다." }, { to: "cooking", on: "사용자가 주방으로 가서 요리를 시작하려 한다." }],
    },
    {
      id: "watching_tv",
      description: "사용자가 TV를 보며 컵으로 음료를 마신다.",
      rules: [
        { trigger: "사용자가 TV를 보는 중이고 곁의 컵이 비어 있으며 컵을 들거나 만지지 않는다.", action: "컵에 콜라 따라 주기" },
        // 의도 파악(2026-11-13): 바라는 것을 돌려 말한 혼잣말(「아 덥다」)이나 부채질
        { trigger: "사용자가 덥다고 말하거나 더워서 부채질을 한다.", action: "에어컨 켜기" },
      ],
      next: [{ to: "drinking", on: "사용자가 식탁에 앉아 먹기 시작한다." }, { to: "left_cup", on: "사용자가 컵을 두고 자리를 떠나 보이지 않는다." }, { to: "cooking", on: "사용자가 주방으로 가서 요리를 시작하려 한다." }],
    },
    {
      id: "left_cup",
      description: "사용자가 컵을 두고 자리를 비웠다. 화면에 안 보이는 것만으로 떠났다고 보지 않는다.",
      // 이미 배운 습관(2026-11-16 사용자 결정): 컵을 두고 자리를 비우면 내용물과 상관없이 치운다
      rules: [{ trigger: "사용자가 컵을 식탁 등에 두고 자리를 비웠고, 아무도 컵을 들거나 만지지 않는다.", action: "컵 치우기" }],
      next: [{ to: "drinking", on: "사용자가 돌아와 컵을 다시 든다." }, { to: "cooking", on: "사용자가 주방으로 가서 요리를 시작하려 한다." }],
    },
    // 코치(2026-11-13): 코치 모드에서만 이 규칙의 행동이 행동 목록에 있다(src/act/tasks.ts tasksFor). 눈치 모드에서는 PAM이 고를 수 없다
    {
      id: "cooking",
      description: "사용자가 주방에서 음식을 만들거나 데우려 한다. 방법을 묻거나 무엇을 할지 몰라 멈춰 있으면 단계마다 알려 준다.",
      rules: [
        { trigger: "사용자가 라면 끓이는 법을 알려 달라고 말했거나, 주방에서 라면을 끓이려다 무엇을 해야 할지 모르겠다고 말한다.", action: "라면 끓이기 알려 주기" },
        { trigger: "사용자가 전자레인지 앞에서 쓰는 법을 묻거나 이거 어떻게 하냐고 말한다.", action: "전자레인지로 데우기 알려 주기" },
      ],
      next: [{ to: "drinking", on: "사용자가 음식을 들고 식탁에 앉는다." }],
    },
  ],
};


/** 이미 배운 기억(반성·합성 판본)에도 한 번 넣는 seed 바뀜: 그 상태의 규칙을 지금 seed의 규칙으로 바꾼다(다른 상태의 배운 규칙은 둔다).
 *  seed 판본은 seed 올리기(src/brain/history/reflect.ts memoryForDay)가 바꾸므로, 가장 새 판본이 반성·합성 판본인 DB에만 쓴다. DB마다 한 번(그 뒤 반성이 배운 것은 둔다). */
export const SEED_PATCHES: readonly { id: string; state: string }[] = [
  // 컵을 두고 자리를 비우면 내용물과 상관없이 치우는 습관(2026-11-16 사용자 결정): 그대로 두기·물어보기 규칙을 뺀다
  { id: "2026-11-16-clear-habit", state: "left_cup" },
];

/** seed 바뀜 하나를 넣은 기억. 그 상태가 없으면 null. */
export function patchMemory(memory: FsmMemory, patch: { state: string }): FsmMemory | null {
  const seed = CUP_FSM_MEMORY.states.find((s) => s.id === patch.state);
  if (!seed || !memory.states.some((s) => s.id === patch.state)) return null;
  return { ...memory, states: memory.states.map((s) => (s.id === patch.state ? { ...s, rules: seed.rules.map((r) => ({ ...r })) } : s)) };
}

/** 대기(null)·list 기억·기억에 없는 행동이면 null. */
export function fsmRuleOf(memory: PamMemory, kind: "list" | "fsm", action: string | null): FsmRuleAt | null {
  if (action === null || kind !== "fsm" || !("states" in memory)) return null;
  const hits = memory.states.flatMap((s) => s.rules.filter((r) => r.action === action).map((r) => ({ state: s.id, trigger: r.trigger })));
  if (hits.length === 0) return null;
  const seed = CUP_FSM_MEMORY.states.flatMap((s) => s.rules);
  return {
    state: new Set(hits.map((h) => h.state)).size === 1 ? hits[0]!.state : null,
    trigger: hits.length === 1 ? hits[0]!.trigger : null,
    learned: hits.some((h) => !seed.some((r) => r.trigger === h.trigger && r.action === action)),
  };
}

/** PAM 판단 관찰 텍스트 상한(글자 수). PAM 서비스 pam-predict/2와 같다. 관찰 텍스트를 만드는 World State(world/text.ts)와 한 값이다. */
export const MAX_OBSERVATION_TEXT = PAM_TEXT_MAX;

/** PAM 반성 칸 상한(글자 수). PAM 서비스 pam-reflect/2와 같다. UTF-8 바이트로 이 안에 맞추면 글자 수도 넘지 않는다. */
export const MAX_REFLECT_TEXT = { observation: 100_000, action: 50_000, feedback: 8_000 } as const;

/** 보내기 전 검사: 관찰 텍스트, 시간대 있는 마지막 관찰 시각, 작업 목록, 기억 모양. */
export function checkInput(input: Pick<DecisionInput, "text" | "finalTime" | "memory" | "memoryKind" | "tasks">): void {
  if (typeof input.text !== "string" || !input.text.trim()) throw new ContractError("관찰 텍스트가 비어 있습니다");
  if (input.text.length > MAX_OBSERVATION_TEXT) throw new ContractError(`관찰 텍스트는 ${MAX_OBSERVATION_TEXT}자까지입니다(지금 ${input.text.length}자)`);
  if (!TZ.test(input.finalTime) || Number.isNaN(Date.parse(input.finalTime))) throw new ContractError("finalTime: 시간대가 있는 ISO 시각이어야 합니다");
  validateTasks(input.tasks);
  validateMemory(input.memory, input.memoryKind);
}

// PAM 서비스를 HTTP로 부르는 어댑터는 pam.ts(PamClient·PamDecision)에 있다.
