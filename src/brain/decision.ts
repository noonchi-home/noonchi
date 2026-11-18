// 판단 모델(PAM)을 도구로 부르는 자리: 기억 모양·seed·검사(행동 목록·기억·판단 답). 검사 글은 Python PAM(src/brain/pam/PROVENANCE.md)과 같다.
// decide(관찰 텍스트, 마지막 관찰 시각, 기억, 작업 목록) → {observation, reasoning, task_index}. task_index -1은 대기다. 사진은 넘기지 않는다.
// 판단 모델은 무엇을 도울지만 정한다. 언제 부를지는 판단 호출 시점(src/world/trigger.ts)이 정한다. 답 글 읽기는 src/brain/pam/answer.ts.
// 검사 메시지는 PAM 원문(영어)과 같게 두어 두 쪽 기록을 대조하기 쉽게 한다.

import type { CandidateFsm, Prediction, FsmStep } from "../contract/pam.js";
import { PAM_TEXT_MAX } from "../world/browser.js";
import { STATES } from "../world/vocab.js";
import { TASKS, TASK_NAMES } from "../act/tasks.js";
import { byCodePoint, isPyBlank, pyList, pyRepr } from "./pam/py.js";

export class ContractError extends Error {}

type Json = unknown;

function object(value: Json, fields: string[], path: string): Record<string, Json> {
  const proto = value && typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value) || (proto !== Object.prototype && proto !== null)) {
    throw new ContractError(`${path}: expected an object`);
  }
  const actual = Object.keys(value);
  const missing = fields.filter((f) => !actual.includes(f)).sort(byCodePoint);
  const extra = actual.filter((k) => !fields.includes(k)).map(pyRepr).sort(byCodePoint);
  if (missing.length || extra.length) throw new ContractError(`${path}: incorrect fields (missing=${pyList(missing)}, extra=${pyList(extra)})`);
  return value as Record<string, Json>;
}

function text(value: Json, path: string): string {
  if (typeof value !== "string" || isPyBlank(value)) throw new ContractError(`${path}: expected a nonempty string`);
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

/** 다른 어느 상태로든 가는 화살표의 도착(행동이 있을 때만). */
export const ANY_STATE = "*";
/** 사람이 안 보이는 상태(하나뿐, 처음 상태). */
export const AWAY_STATE = "away";
/** 임시 상태(기억에 없는 활동) 앞글자. 기억 상태 id로는 쓸 수 없다. */
export const TEMP_STATE = "~";
/** 상태 수 상한(사용자 결정 2026-11-18). */
export const MAX_STATES = 12;
/** 상태 activity에 쓸 수 있는 World State 사람 하는 일 값(모름·다른 일 빼고). */
export const PERSON_ACTIVITIES: readonly string[] = Object.entries(STATES)
  .filter(([k, s]) => s.facet === "activity" && k !== "other" && k !== "unknown").map(([k]) => k);

/** 사람 활동 FSM 화살표: 사람의 일이 바뀜(to, 또는 다른 어느 일로든 "*"), 사람 사건(on), 사람 쪽 조건(when), 로봇 행동(action, 없으면 상태만 넘어감). */
export interface FsmEdge { to: string; on: string; when?: string; action?: string }
/** 사람 활동 FSM 상태: 사람이 하는 일 하나. activity는 World State 사람 하는 일 값(away만 빈 목록). */
export interface FsmState { id: string; description: string; activity: string[]; next: FsmEdge[] }
export interface FsmMemory { initial_state: string; states: FsmState[] }
export type PamMemory = ListMemory | FsmMemory;

/** 칸이 정확히 required(+ optional 가운데 몇)인 객체. */
function objectWith(value: Json, required: string[], optional: string[], path: string): Record<string, Json> {
  const proto = value && typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value) || (proto !== Object.prototype && proto !== null)) throw new ContractError(`${path}: expected an object`);
  const actual = Object.keys(value);
  const missing = required.filter((f) => !actual.includes(f)).sort(byCodePoint);
  const extra = actual.filter((k) => !required.includes(k) && !optional.includes(k)).map(pyRepr).sort(byCodePoint);
  if (missing.length || extra.length) throw new ContractError(`${path}: incorrect fields (missing=${pyList(missing)}, extra=${pyList(extra)})`);
  return value as Record<string, Json>;
}

/** 행동 목록의 행동인가. */
const isAction = (a: string) => TASK_NAMES.includes(a);

/** 사람 활동 FSM 코드 검사(모양, 정답이 분명한 것). 뜻(상태가 사람이 하는 일인지·조건이 사람 쪽인지·합칠 상태)은 기억 뜻 검사(LLM)가 본다. */
function validateFsm(value: Json): FsmMemory {
  const m = object(value, ["initial_state", "states"], "memory");
  const initial = text(m.initial_state, "memory.initial_state");
  const states = array(m.states, "memory.states");
  if (!states.length) throw new ContractError("memory.states: at least one state is required");
  if (states.length > MAX_STATES) throw new ContractError(`memory.states: at most ${MAX_STATES} states`);
  const ids = new Set<string>();
  const owner = new Map<string, string>();
  const destinations: [string, string][] = [];
  states.forEach((state, i) => {
    const p = `memory.states[${i}]`;
    const s = object(state, ["id", "description", "activity", "next"], p);
    const id = text(s.id, `${p}.id`);
    if (id === ANY_STATE || id.startsWith(TEMP_STATE)) throw new ContractError(`${p}.id: '*' and '~...' are reserved`);
    if (ids.has(id)) throw new ContractError(`${p}.id: duplicate state identifier ${pyRepr(id)}`);
    ids.add(id);
    text(s.description, `${p}.description`);
    const acts = array(s.activity, `${p}.activity`);
    if (id !== AWAY_STATE && !acts.length) throw new ContractError(`${p}.activity: state ${pyRepr(id)} needs at least one activity`);
    if (id === AWAY_STATE && acts.length) throw new ContractError(`${p}.activity: 'away' has no activity`);
    acts.forEach((a, j) => {
      const v = text(a, `${p}.activity[${j}]`);
      if (!PERSON_ACTIVITIES.includes(v)) throw new ContractError(`${p}.activity[${j}]: unknown activity ${pyRepr(v)}`);
      if (owner.has(v)) throw new ContractError(`${p}.activity[${j}]: activity ${pyRepr(v)} is in two states`);
      owner.set(v, id);
    });
    const keys = new Set<string>();
    array(s.next, `${p}.next`).forEach((e, j) => {
      const ep = `${p}.next[${j}]`;
      const edge = objectWith(e, ["to", "on"], ["when", "action"], ep);
      const to = text(edge.to, `${ep}.to`);
      const on = text(edge.on, `${ep}.on`);
      const when = "when" in edge ? text(edge.when, `${ep}.when`) : null;
      const key = JSON.stringify([on, when]);
      if (keys.has(key)) throw new ContractError(`${ep}: duplicate transition (on, when) in state ${pyRepr(id)}`);
      keys.add(key);
      const action = "action" in edge ? text(edge.action, `${ep}.action`) : null;
      if (action !== null && !isAction(action)) throw new ContractError(`${ep}.action: ${pyRepr(action)} is not an action in the task list (no action means no transition)`);
      if (to === ANY_STATE && action === null) throw new ContractError(`${ep}.to: '*' needs an action`);
      if (to !== ANY_STATE) destinations.push([`${ep}.to`, to]);
    });
  });
  if (!ids.has(AWAY_STATE)) throw new ContractError("memory.states: the 'away' state is required");
  if (initial !== AWAY_STATE) throw new ContractError("memory.initial_state: must be 'away'");
  for (const [path, to] of destinations) if (!ids.has(to)) throw new ContractError(`${path}: unknown state identifier ${pyRepr(to)}`);
  return m as unknown as FsmMemory;
}

/** 후보 FSM 코드 검사(석준 님 validate_candidate_memory를 사람 상태 FSM 화살표로): 상태 모양은 사람 활동 FSM과 같고, next는 행동 없는 화살표,
 *  rules는 (출발 상태, 행동)마다 하나에 후보 1~3개(서로 다름), 한 상태 안의 (사건·조건)은 next와 후보를 통틀어 하나다.
 *  seed를 주면(반성 답) seed 상태가 같은 id·같은 하는 일 값으로 모두 있어야 하고, 새 상태는 seed 상태의 하는 일 값을 가질 수 없다(정한 습관이 붙는 상태가 바뀌지 않게). */
export function validateCandidateFsm(value: Json, seed?: FsmMemory): CandidateFsm {
  const m = object(value, ["initial_state", "states"], "memory");
  const initial = text(m.initial_state, "memory.initial_state");
  const states = array(m.states, "memory.states");
  if (!states.length) throw new ContractError("memory.states: at least one state is required");
  if (states.length > MAX_STATES) throw new ContractError(`memory.states: at most ${MAX_STATES} states`);
  const ids = new Set<string>();
  const owner = new Map<string, string>();
  const destinations: [string, string][] = [];
  const seedActs = new Map((seed?.states ?? []).flatMap((x) => x.activity.map((a) => [a, x.id] as const)));
  // 상태 칸 모양을 먼저 본 뒤 seed 상태가 다 있는지 본다(옛 모양은 칸 오류로, 이름을 바꾼 seed 상태는 「필요」로 알린다)
  const shaped = states.map((state, i) => object(state, ["id", "description", "activity", "next", "rules"], `memory.states[${i}]`));
  const named = new Set(shaped.map((s, i) => text(s.id, `memory.states[${i}].id`)));
  for (const x of seed?.states ?? []) if (!named.has(x.id)) throw new ContractError(`memory.states: seed state ${pyRepr(x.id)} is required`);
  shaped.forEach((s, i) => {
    const p = `memory.states[${i}]`;
    const id = text(s.id, `${p}.id`);
    if (id === ANY_STATE || id.startsWith(TEMP_STATE)) throw new ContractError(`${p}.id: '*' and '~...' are reserved`);
    if (ids.has(id)) throw new ContractError(`${p}.id: duplicate state identifier ${pyRepr(id)}`);
    ids.add(id);
    text(s.description, `${p}.description`);
    const acts = array(s.activity, `${p}.activity`);
    const own = seed?.states.find((x) => x.id === id);
    if (own && JSON.stringify(acts) !== JSON.stringify(own.activity)) throw new ContractError(`${p}.activity: activity of seed state ${pyRepr(id)} must stay ${pyList(own.activity.map(pyRepr))}`);
    if (id !== AWAY_STATE && !acts.length) throw new ContractError(`${p}.activity: state ${pyRepr(id)} needs at least one activity`);
    if (id === AWAY_STATE && acts.length) throw new ContractError(`${p}.activity: 'away' has no activity`);
    acts.forEach((a, j) => {
      const v = text(a, `${p}.activity[${j}]`);
      if (!PERSON_ACTIVITIES.includes(v)) throw new ContractError(`${p}.activity[${j}]: unknown activity ${pyRepr(v)}`);
      if (!own && seedActs.has(v)) throw new ContractError(`${p}.activity[${j}]: activity ${pyRepr(v)} belongs to seed state ${pyRepr(seedActs.get(v)!)}`);
      if (owner.has(v)) throw new ContractError(`${p}.activity[${j}]: activity ${pyRepr(v)} is in two states`);
      owner.set(v, id);
    });
    const keys = new Set<string>();
    const unique = (on: string, when: string | null, path: string) => {
      const key = JSON.stringify([on, when]);
      if (keys.has(key)) throw new ContractError(`${path}: duplicate transition (on, when) in state ${pyRepr(id)}`);
      keys.add(key);
    };
    array(s.next, `${p}.next`).forEach((e, j) => {
      const ep = `${p}.next[${j}]`;
      const edge = object(e, ["to", "on"], ep);
      const to = text(edge.to, `${ep}.to`);
      if (to === ANY_STATE) throw new ContractError(`${ep}.to: '*' needs an action (a rule)`);
      unique(text(edge.on, `${ep}.on`), null, ep);
      destinations.push([`${ep}.to`, to]);
    });
    const actions = new Set<string>();
    array(s.rules, `${p}.rules`).forEach((r, j) => {
      const rp = `${p}.rules[${j}]`;
      const rule = object(r, ["to", "action", "candidates"], rp);
      const to = text(rule.to, `${rp}.to`);
      const action = text(rule.action, `${rp}.action`);
      if (!isAction(action)) throw new ContractError(`${rp}.action: ${pyRepr(action)} is not an action in the task list (no action means no transition)`);
      if (actions.has(action)) throw new ContractError(`${rp}.action: one rule per action in state ${pyRepr(id)}`);
      actions.add(action);
      const cands = array(rule.candidates, `${rp}.candidates`);
      if (cands.length < 1 || cands.length > 3) throw new ContractError(`${rp}.candidates: expected 1 to 3 candidates`);
      const seen = new Set<string>();
      const parsed = cands.map((c, k) => {
        const cp = `${rp}.candidates[${k}]`;
        const cand = objectWith(c, ["on"], ["when"], cp);
        const on = text(cand.on, `${cp}.on`);
        const when = "when" in cand ? text(cand.when, `${cp}.when`) : null;
        const key = JSON.stringify([on, when]);
        if (seen.has(key)) throw new ContractError(`${rp}.candidates: candidates must differ`);
        seen.add(key);
        return { on, when, cp };
      });
      for (const c of parsed) unique(c.on, c.when, c.cp);
      if (to !== ANY_STATE) destinations.push([`${rp}.to`, to]);
    });
  });
  if (!ids.has(AWAY_STATE)) throw new ContractError("memory.states: the 'away' state is required");
  if (initial !== AWAY_STATE) throw new ContractError("memory.initial_state: must be 'away'");
  for (const [path, to] of destinations) if (!ids.has(to)) throw new ContractError(`${path}: unknown state identifier ${pyRepr(to)}`);
  return m as unknown as CandidateFsm;
}

/** 기억 모양만 검사한다. 규칙을 실행하거나 상태를 넘기지 않는다. */
export function validateMemory(value: Json, kind: "list" | "fsm"): PamMemory {
  if (kind === "list") {
    const m = object(value, ["rules"], "memory");
    rules(m.rules, "memory.rules");
    return m as unknown as ListMemory;
  }
  if (kind !== "fsm") throw new ContractError("memory kind: expected 'list' or 'fsm'");
  return validateFsm(value);
}

/** 기억에 없는 활동의 임시 상태(~<하는 일 값>): 그 값이 World State 하는 일 값이고 기억의 어느 상태도 갖지 않았다. */
export const isTempState = (memory: FsmMemory, id: string): boolean =>
  id.startsWith(TEMP_STATE) && PERSON_ACTIVITIES.includes(id.slice(TEMP_STATE.length)) && !memory.states.some((s) => s.activity.includes(id.slice(TEMP_STATE.length)));

/** fsm 기억의 판단 답(pam-predict/3): 지금 사람 상태(state), 일어난 화살표(from·next_index, 없으면 null·-1). 행동(task_index)은 그 화살표 action이
 *  지금 행동 목록에 있으면 그 번호, 아니면 -1(서버가 만든다). "*" 화살표는 출발 상태를 떠나기만 하면 켜지고(임시 상태로 떠나도), 이름 있는 도착 화살표는 state가 그 상태다. */
export function validateFsmPrediction(value: Json, memory: FsmMemory, tasks: string[]): Prediction {
  validateTasks(tasks);
  const p = object(value, ["observation", "reasoning", "state", "from", "next_index"], "prediction");
  text(p.observation, "prediction.observation");
  text(p.reasoning, "prediction.reasoning");
  const state = text(p.state, "prediction.state");
  const byId = (id: string) => memory.states.find((s) => s.id === id);
  if (!byId(state) && !isTempState(memory, state)) throw new ContractError(`prediction.state: unknown state identifier ${pyRepr(state)}`);
  const index = p.next_index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < -1) throw new ContractError("prediction.next_index: expected an integer from -1");
  if (index === -1) {
    if (p.from !== null) throw new ContractError("prediction.from: expected null when next_index is -1");
    return { observation: p.observation as string, reasoning: p.reasoning as string, task_index: -1, state, from: null, next_index: -1 };
  }
  const fromId = text(p.from, "prediction.from");
  const from = byId(fromId);
  if (!from) throw new ContractError(`prediction.from: unknown state identifier ${pyRepr(fromId)}`);
  const edge = from.next[index];
  if (!edge) throw new ContractError(`prediction.next_index: state ${pyRepr(from.id)} has ${from.next.length} transitions`);
  if (edge.to === ANY_STATE ? state === from.id : edge.to !== state) throw new ContractError(`prediction.state: transition ${from.id}[${index}] goes to ${pyRepr(edge.to)}`);
  const task = edge.action ? tasks.indexOf(edge.action) : -1;
  return { observation: p.observation as string, reasoning: p.reasoning as string, task_index: task, state, from: from.id, next_index: index };
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

/** PAM 판단 입력(pam-predict/3 칸과 같다). 사진 칸이 없다. */
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

/** 컵 시나리오의 사람 활동 FSM 기억(seed). 상태 = 사람이 하는 일 하나, 행동은 화살표에만(사람 FSM 만드는 규칙, 2026-11-18 사용자 결정).
 *  사용자가 정한 습관(물 채우기·콜라·에어컨·코치)은 늘 있고, 배우는 습관(컵 치우기, 말없이 TV 보기 시작 → 에어컨)은 seed에 없다: 떠날 때는 묻고,
 *  채택 검사를 지난 후보가 같은 트리거의 묻기 화살표를 그 자리에서 바꾼다. 물건·집 조건(컵 남음·내용물)은 행동의 실행 전 검사가 본다.
 *  상태 id를 더하면 화면 이름표(src/world/labels.ts FSM_STATE_TEXT)도 더한다. */
export const CUP_FSM_MEMORY: FsmMemory = {
  initial_state: "away",
  states: [
    {
      id: "drinking", description: "사용자가 먹거나 마시는 중이다.", activity: ["drinking", "eating"],
      next: [
        // 컵 치우기는 배우는 습관이라 seed에 없다(2026-11-18 사용자 답): 떠날 때는 묻고, 채택 검사를 지난 컵 치우기 후보가 이 화살표를 바꾼다
        { to: "*", on: "사용자가 먹거나 마시기를 끝내고 다른 일로 넘어간다.", action: "사용자에게 물어보기" },
        { to: "drinking", on: "사용자가 마시던 것을 다 마시고 계속 먹는다.", action: "컵에 물 채워 주기" },
      ],
    },
    {
      id: "watching_tv", description: "사용자가 TV를 보는 중이다.", activity: ["watching_tv"],
      next: [
        { to: "watching_tv", on: "사용자가 TV를 보며 마시던 것을 다 마신다.", when: "같이 마시는 중이었다.", action: "컵에 콜라 따라 주기" },
        // 의도 파악(2026-11-13): 바라는 것을 돌려 말한 혼잣말(「아 덥다」)이나 부채질
        { to: "watching_tv", on: "사용자가 덥다고 말하거나 더워서 부채질을 한다.", action: "에어컨 켜기" },
        { to: "*", on: "사용자가 TV 보기를 끝내고 다른 일로 넘어간다.", when: "같이 마시는 중이었다.", action: "사용자에게 물어보기" },
      ],
    },
    // 코치(2026-11-13): 코치 모드에서만 이 화살표의 행동이 행동 목록에 있다(src/act/tasks.ts tasksFor)
    {
      id: "cooking", description: "사용자가 요리하는 중이다.", activity: ["cooking"],
      next: [
        { to: "cooking", on: "사용자가 라면 끓이는 법을 알려 달라고 말했거나, 라면을 끓이다 무엇을 해야 할지 모르겠다고 말한다.", action: "라면 끓이기 알려 주기" },
        { to: "cooking", on: "사용자가 전자레인지 쓰는 법을 묻거나 이거 어떻게 하냐고 말한다.", action: "전자레인지로 데우기 알려 주기" },
        { to: "drinking", on: "사용자가 요리를 마치고 먹기 시작한다." },
      ],
    },
    {
      id: "away", description: "사용자가 카메라에 보이지 않는다.", activity: [],
      next: [
        { to: "drinking", on: "사용자가 돌아와 먹거나 마신다." },
        { to: "watching_tv", on: "사용자가 돌아와 TV를 본다." },
        { to: "cooking", on: "사용자가 돌아와 요리를 시작한다." },
      ],
    },
  ],
};

/** 2026-11-18 전 모양(상태 안 rules)인가. 옮기지 않는다(합성 기록에서 나온 기억이라 새 seed로 다시 시작, 사용자 답). */
export const isOldFsm = (v: unknown): boolean =>
  !!v && typeof v === "object" && Array.isArray((v as { states?: unknown }).states)
  && (v as { states: unknown[] }).states.some((s) => !!s && typeof s === "object" && "rules" in s);

/** seed에 같은 출발·사건·행동 화살표가 없으면 배운 화살표다(묻기 자리를 바꾼 컵 치우기도 배운 것). */
export function edgeLearned(from: string, edge: Pick<FsmEdge, "on" | "action">): boolean {
  return !CUP_FSM_MEMORY.states.find((s) => s.id === from)?.next.some((e) => e.on === edge.on && e.action === edge.action);
}
/** seed 그 상태에 같은 트리거(on, when)가 있는가: 묻기 자리를 바꾼 배운 컵 치우기도 사용자가 정한 짧은 꼴(RULE_IF)로 쓴다. */
export function seedTrigger(from: string, on: string, when: string | null): boolean {
  return !!CUP_FSM_MEMORY.states.find((s) => s.id === from)?.next.some((e) => e.on === on && (e.when ?? null) === when);
}
/** PAM 답 → 판단 기록 fsm(답을 그대로, 화살표는 기억에서 그 번호). 거꾸로 찾지 않는다. */
export function fsmStep(memory: FsmMemory, p: Prediction): FsmStep {
  const edge = p.from ? memory.states.find((s) => s.id === p.from)?.next[p.next_index ?? -1] ?? null : null;
  return {
    state: p.state!, from: edge ? p.from! : null, next_index: edge ? p.next_index! : -1, to: edge?.to ?? null, on: edge?.on ?? null, when: edge?.when ?? null, action: edge?.action ?? null,
    learned: edge ? edgeLearned(p.from!, edge) : false,
  };
}

/** PAM 판단 관찰 텍스트 상한(글자 수). pam-predict/3과 같다. 관찰 텍스트를 만드는 World State(world/text.ts)와 한 값이다. */
export const MAX_OBSERVATION_TEXT = PAM_TEXT_MAX;

/** PAM 반성 칸 상한(글자 수). pam-reflect/3과 같다. UTF-8 바이트로 이 안에 맞추면 글자 수도 넘지 않는다. */
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
