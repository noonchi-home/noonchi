// 시나리오 2 나흘째 시연 준비: 지난 사흘(20:00·19:58·20:04에 부름) 침실 1 책상 물 한 잔 도움 기록과, 그 기록으로 찾은 습관 화살표를 든 오늘 기억.
// 밤 흐름(src/brain/history/night.ts)의 도움 습관 단계(findRoutines → withRoutines)를 그대로 쓴다. 그 단계는 모델을 부르지 않는다.
// 서버를 끈 채 쓴다(scripts/demo-setup.ts water).
import { helpRecord } from "../src/act/help-record.js";
import { WATER_ACTION } from "../src/act/tasks.js";
import { CUP_FSM_MEMORY, type FsmMemory } from "../src/brain/decision.js";
import type { HistoryDb } from "../src/brain/history/db.js";
import { findRoutines, withRoutines, type HelpRoutine } from "../src/brain/history/routines.js";
import { learnedEdges } from "../src/brain/history/habits.js";
import { REFLECT_TEXT } from "../src/brain/history/labels.js";
import type { WorldView } from "../src/contract/world.js";
import { saveLearned } from "./learned-memory.js";

const DESK = { id: "desk_small_ce7e768b", label: "책상", room: "bed_sw" } as const;
/** 부른 시각(사흘 전부터 하루씩, 집 시간대). 전달은 부른 뒤 2분. */
export const WATER_CALLS = ["20:00", "19:58", "20:04"] as const;
const DELIVER_MS = 120_000;
const DAY_MS = 86_400_000;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export function seedWaterHabit(db: HistoryDb, today: string, atMs: number): { version: number; routines: HelpRoutine[] } {
  const off = db.offsetMinutes;
  WATER_CALLS.forEach((hm, i) => {
    const day = addDays(today, i - WATER_CALLS.length);
    const asked = Date.parse(`${day}T${hm}:00Z`) - off * 60_000, at = asked + DELIVER_MS;
    const dayStart = Date.parse(`${day}T00:00:00Z`) - off * 60_000;
    if (db.list({ since: dayStart, until: dayStart + DAY_MS - 1, kinds: ["help"] }).length) return;
    // 책상 앞에서 공부하던 사용자(전달할 때 본 하던 일)
    const world = { person: { room: DESK.room, facts: { activity: { value: "using_laptop", at_ms: at, since_ms: at, certainty: "confirmed" } } } } as unknown as WorldView;
    const record = helpRecord({ atMs: at, askedMs: asked, offsetMinutes: off, action: WATER_ACTION, via: "call", place: DESK.id, placeLabel: DESK.label, world });
    db.add("help", at, record.text, { subject: WATER_ACTION, data: record });
  });
  const todayStart = Date.parse(`${today}T00:00:00Z`) - off * 60_000;
  const helps = db.list({ since: todayStart - 30 * DAY_MS, until: todayStart - 1, kinds: ["help"], limit: Number.MAX_SAFE_INTEGER });
  const routines = findRoutines(helps, off);
  const before = (db.memoryFor(today)?.memory as FsmMemory | undefined) ?? CUP_FSM_MEMORY;
  const memory = withRoutines(before, routines);
  const version = saveLearned(db, today, memory);
  db.add("reflection", atMs, REFLECT_TEXT.done(version, today), {
    data: { day: addDays(today, -1), ok: true, version, applies_day: today, synthetic: true, learned: learnedEdges(before, memory), active: learnedEdges(CUP_FSM_MEMORY, memory), dropped: [] },
  });
  return { version, routines };
}
