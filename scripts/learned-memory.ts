// 배운 뒤 기억: 채택 검사를 지난 뒤(합성 3일째부터)의 로봇 FSM. 치우기를 보는 시험·영상·시연이 쓴다(seed 기억이면 떠날 때 묻는다).
// 서버를 끈 채 그 runtime 기록 DB에 오늘 판본으로 넣는다(scripts/demo-setup.ts learned, tests/helpers/memory.ts useLearnedMemory).
import { ANY_STATE, CUP_FSM_MEMORY, validateMemory, type FsmMemory } from "../src/brain/decision.js";
import type { HistoryDb } from "../src/brain/history/db.js";
import { ASK_ACTION } from "../src/act/tasks.js";

/** seed에서 그 상태들의 떠날 때 묻기 화살표만 컵 치우기로(같은 번호·on·when). 기본은 마시는 중 하나(합성 일주일이 배우는 것). */
export function learnedFsm(states: readonly string[] = ["drinking"]): FsmMemory {
  const m = structuredClone(CUP_FSM_MEMORY);
  for (const s of m.states) if (states.includes(s.id)) for (const e of s.next) if (e.to === ANY_STATE && e.action === ASK_ACTION) e.action = "컵 치우기";
  return validateMemory(m, "fsm") as FsmMemory;
}
export const LEARNED_FSM_MEMORY = learnedFsm();

/** 배운 뒤 기억을 그날 판본(합성, 전날 반성 자리)으로 넣고 그날을 고정한다(바꿈). 서버를 끈 채 쓴다(시험·영상·시연 준비). */
export function saveLearned(db: HistoryDb, day: string, memory: FsmMemory = LEARNED_FSM_MEMORY): number {
  const before = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const version = db.saveMemory({ kind: "fsm", memory, day: before, appliesDay: day, source: "synthetic" });
  db.pinMemory(day, version, true);
  return version;
}
