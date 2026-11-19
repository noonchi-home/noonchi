// 시험 서버를 띄우기 전 그 runtime 기록 DB에 배운 뒤 기억(scripts/learned-memory.ts)을 오늘 판본으로 넣는다. 치우기를 보는 시험이 쓴다.
import { join } from "node:path";
import { HistoryDb, historyTzMinutes } from "../../src/brain/history/db.js";
import { LEARNED_FSM_MEMORY, saveLearned } from "../../scripts/learned-memory.js";
import type { FsmMemory } from "../../src/brain/decision.js";

/** memory(기본 배운 뒤 기억)를 오늘 판본으로 넣는다. */
export function useLearnedMemory(runtimeDir: string, memory: FsmMemory = LEARNED_FSM_MEMORY): number {
  const db = HistoryDb.open(join(runtimeDir, "noonchi.db"), historyTzMinutes({}));
  try { return saveLearned(db, db.dayOf(Date.now()), memory); } finally { db.close(); }
}
