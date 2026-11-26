// 시각 찾기 답 검사(석준 님 ai 저장소 pam/contracts.py validate_marks, origin/main 48d56a1 그대로, 오류 글도 같다). 덩어리 기록 검사(validate_chunks)는 2026-11-25에 덩어리 기록과 함께 뺐다.
// within은 석준 님 꼴(첫 줄 시각, 끝 줄 시각, 줄 사이 초) 또는 그날 기록 줄 시각 목록(이 저장소 기록은 줄 사이가 고르지 않다)이다. 답의 시각은 그 줄 시각만 받는다.
import { ContractError } from "../decision.js";
import { byCodePoint, isPyBlank, pyList, pyRepr } from "./py.js";

export interface Marks {
  candidates: { state: string; candidate: string; times: string[] }[];
  actions: { action: string; times: string[] }[];
  unseen: { start: string; end: string }[];
}
/** 받을 시각: [첫 줄, 끝 줄, 줄 사이 초](석준 님 꼴) 또는 기록 줄 시각 목록. */
export type Within = readonly [string, string, number] | readonly string[];

const CLOCK = /^(\d{2}):(\d{2}):(\d{2})$/;

function object(value: unknown, keys: string[], path: string): Record<string, unknown> {
  const proto = value && typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value) || (proto !== Object.prototype && proto !== null)) throw new ContractError(`${path}: expected an object`);
  const actual = Object.keys(value);
  const missing = keys.filter((f) => !actual.includes(f)).sort(byCodePoint);
  const extra = actual.filter((k) => !keys.includes(k)).map(pyRepr).sort(byCodePoint);
  if (missing.length || extra.length) throw new ContractError(`${path}: incorrect fields (missing=${pyList(missing)}, extra=${pyList(extra)})`);
  return value as Record<string, unknown>;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new ContractError(`${path}: expected an array`);
  return value;
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string" || isPyBlank(value)) throw new ContractError(`${path}: expected a nonempty string`);
  return value;
}
/** "HH:MM:SS" → 자정부터 초. */
export function clock(value: unknown, path: string): number {
  const m = typeof value === "string" ? CLOCK.exec(value) : null;
  if (!m) throw new ContractError(`${path}: expected a time as HH:MM:SS`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** 그 시각이 읽은 기록의 줄 시각인가. */
function lineTime(value: unknown, path: string, within: Within | undefined): number {
  const moment = clock(value, path);
  if (within === undefined) return moment;
  const isSteps = within.length === 3 && typeof within[2] === "number";
  const ok = isSteps
    ? (() => { const first = clock(within[0], "within"), last = clock(within[1], "within"), step = within[2] as number; return first <= moment && moment <= last && (moment - first) % step === 0; })()
    : (within as readonly string[]).includes(value as string);
  if (!ok) throw new ContractError(`${path}: ${String(value)} is not the time of a line of the record`);
  return moment;
}

/** 물은 (상태, 후보)·행동마다 꼭 한 번씩 시각을 답하고, 사람이 안 보인 구간을 낸다. within이 있으면 시각은 읽은 기록 줄의 시각이어야 한다. */
export function validateMarks(value: unknown, candidates: readonly (readonly [string, string])[], actions: readonly string[], within?: Within): Marks {
  const marks = object(value, ["candidates", "actions", "unseen"], "marks");
  const answered: string[] = [];
  array(marks.candidates, "marks.candidates").forEach((item, index) => {
    const path = `marks.candidates[${index}]`;
    const it = object(item, ["state", "candidate", "times"], path);
    answered.push(JSON.stringify([text(it.state, `${path}.state`), text(it.candidate, `${path}.candidate`)]));
    array(it.times, `${path}.times`).forEach((m, i) => lineTime(m, `${path}.times[${i}]`, within));
  });
  const asked = candidates.map((c) => JSON.stringify([c[0], c[1]]));
  if (JSON.stringify([...answered].sort()) !== JSON.stringify([...asked].sort())) throw new ContractError("marks.candidates: answer every asked candidate exactly once");
  const found: string[] = [];
  array(marks.actions, "marks.actions").forEach((item, index) => {
    const path = `marks.actions[${index}]`;
    const it = object(item, ["action", "times"], path);
    found.push(text(it.action, `${path}.action`));
    array(it.times, `${path}.times`).forEach((m, i) => lineTime(m, `${path}.times[${i}]`, within));
  });
  if (JSON.stringify([...found].sort()) !== JSON.stringify([...actions].sort())) throw new ContractError("marks.actions: answer every asked action exactly once");
  array(marks.unseen, "marks.unseen").forEach((interval, index) => {
    const path = `marks.unseen[${index}]`;
    const it = object(interval, ["start", "end"], path);
    if (lineTime(it.end, `${path}.end`, within) < lineTime(it.start, `${path}.start`, within)) throw new ContractError(`${path}: end must not come before start`);
  });
  return marks as unknown as Marks;
}
