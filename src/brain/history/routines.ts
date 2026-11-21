// 도움 습관 찾기(시나리오 2): 여러 날의 도움 기록(help 줄, src/act/help-record.ts)에서 「같은 일을 같은 자리에서 매일 비슷한 시각에 부탁받음」을 찾는다.
// 3일 이상, 그날 처음 부탁받은 시각이 모두 가운데 시각 ±15분 안이면 습관이다. 부탁은 사람이 직접 시킨 일이라(답·말) 시각 찾기(LLM)를 거치지 않고 기록 시각을 그대로 쓴다.
// 찾은 습관은 하루 끝 반성이 다음 날 로봇 FSM에 「공부하는 중」 상태와 그 화살표로 더하고(src/brain/history/night.ts), 목표 노드가 그 시각에 확인하러 간다(src/goal/habit-watch.ts).
import type { HelpRecord, HistoryRow } from "../../contract/history.js";
import { STUDY_ACTIVITIES } from "../../act/tasks.js";
import type { FsmEdge, FsmMemory, FsmState } from "../decision.js";

/** 습관으로 보는 최소 날 수와 시각 폭(분, 가운데 ±). */
export const ROUTINE_DAYS = 3;
export const ROUTINE_WINDOW_MIN = 15;
/** 공부하는 중 상태 id(습관 화살표의 출발·도착). */
export const STUDY_STATE = "studying";

/** 습관 하나: 행동, 가져다준 자리(평면도 id·이름), 그 방, 하루 중 가운데 시각(자정부터 분)과 폭, 본 날들. */
export interface HelpRoutine {
  action: string; place: string; place_label: string; room: string | null;
  center_min: number; window_min: number; days: string[];
}

const DAY_MIN = 24 * 60;
/** 집 시간대 자정부터 분. */
export const minuteOfDay = (atMs: number, offsetMinutes: number): number => {
  const d = new Date(atMs + offsetMinutes * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
/** 「저녁 8시」 꼴 시각 글(정각이 아니면 「저녁 7시 58분」). */
export function hourText(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  const part = h < 6 ? "새벽" : h < 12 ? "아침" : h < 18 ? "낮" : "저녁";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${part} ${h12}시${m ? ` ${m}분` : ""}`;
}

function isHelp(row: HistoryRow): row is HistoryRow & { data: HelpRecord } {
  const d = row.data as Partial<HelpRecord> | null;
  return row.kind === "help" && !!d && typeof d.action === "string" && typeof d.asked_ms === "number" && typeof d.place === "string" && typeof d.place_label === "string";
}

/** help 줄들 → 습관 목록(행동·자리마다 하나). */
export function findRoutines(rows: readonly HistoryRow[], offsetMinutes: number): HelpRoutine[] {
  const groups = new Map<string, (HistoryRow & { data: HelpRecord })[]>();
  for (const r of rows) if (isHelp(r)) {
    const k = JSON.stringify([r.data.action, r.data.place]);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: HelpRoutine[] = [];
  for (const list of groups.values()) {
    // 날마다 그날 처음 부탁받은 시각
    const first = new Map<string, HistoryRow & { data: HelpRecord }>();
    for (const r of [...list].sort((a, b) => a.data.asked_ms - b.data.asked_ms)) if (!first.has(r.day)) first.set(r.day, r);
    if (first.size < ROUTINE_DAYS) continue;
    const mins = [...first.values()].map((r) => minuteOfDay(r.data.asked_ms, offsetMinutes)).sort((a, b) => a - b);
    const center = mins[Math.floor((mins.length - 1) / 2)]!;
    const far = (m: number) => Math.min(Math.abs(m - center), DAY_MIN - Math.abs(m - center));
    if (mins.some((m) => far(m) > ROUTINE_WINDOW_MIN)) continue;
    const last = [...first.values()].at(-1)!.data;
    out.push({ action: last.action, place: last.place!, place_label: last.place_label!, room: last.room, center_min: center, window_min: ROUTINE_WINDOW_MIN, days: [...first.keys()].sort() });
  }
  return out.sort((a, b) => a.center_min - b.center_min);
}

/** 습관 → 로봇 FSM 화살표(공부하는 중 → 공부하는 중). on은 시각과 자리, when은 그 자리에 마실 물이 없음. */
export function routineEdge(r: HelpRoutine): FsmEdge {
  return { to: STUDY_STATE, on: `사용자가 ${hourText(r.center_min)} 전후에 ${r.place_label}에서 공부한다.`, when: `${r.place_label} 위에 마실 물이 없다.`, action: r.action };
}

/** 공부하는 중 상태(없으면 더한다): 책상에서 노트북·책. */
export const STUDY_FSM_STATE: FsmState = {
  id: STUDY_STATE, description: "사용자가 책상에서 공부하거나 노트북으로 일하는 중이다.", activity: [...STUDY_ACTIVITIES],
  next: [{ to: "away", on: "사용자가 공부를 마치고 자리를 뜬다." }],
};

/** 로봇 FSM에 습관 화살표를 더한 사본. 공부하는 중 상태가 없으면 더하고, 자리에 없음에서 그 상태로 가는 넘김도 더한다. 같은 화살표는 한 번만. */
export function withRoutines(memory: FsmMemory, routines: readonly HelpRoutine[]): FsmMemory {
  if (!routines.length) return memory;
  const m = structuredClone(memory);
  let study = m.states.find((s) => s.id === STUDY_STATE);
  if (!study) {
    study = structuredClone(STUDY_FSM_STATE);
    m.states.push(study);
    const away = m.states.find((s) => s.id === "away");
    if (away && !away.next.some((e) => e.to === STUDY_STATE)) away.next.push({ to: STUDY_STATE, on: "사용자가 돌아와 책상에서 공부한다." });
  }
  for (const r of routines) {
    const e = routineEdge(r);
    if (!study.next.some((x) => x.on === e.on && x.action === e.action)) study.next.unshift(e);
  }
  return m;
}
