// 기억 판본(그날 판단이 쓰는 판본 고르기·고정, 옛 모양 기억이면 새 seed로 다시 시작)과 하루 끝 반성의 입구.
// 새 판본은 다음 날부터 쓴다. 그날 판단은 그날 처음 정한 판본만 쓴다(논문 memory_lifecycle: fixed_during_day, following_day).
// 하루 끝 반성은 밤 흐름(src/brain/history/night.ts runNight)이다: 덩어리 기록 → 반성(후보 FSM) → 코드·뜻 검사 → 시각 찾기 → 채택 검사 → 로봇 FSM → 한 트랜잭션 저장.
import { CUP_FSM_MEMORY, isOldFsm, validateMemory, type PamMemory } from "../decision.js";
import type { PamClient } from "../pam/index.js";
import type { HistoryDb } from "./db.js";
import type { EdgeLine, HabitRuleNote } from "./habits.js";
import { MEMORY_TEXT } from "./labels.js";
import { runNight, type NightOptions } from "./night.js";

export interface DayMemory { memory: PamMemory; kind: "list" | "fsm"; version: number }
/** ok면 learned(이번에 새로 더한 화살표)·active(새 로봇 판본의 화살표 가운데 seed에 없는 것)·dropped(반성 뒤 검사가 뺀 후보)를 함께 준다. learned·active는 코치 행동을 뺀다.
 *  version은 새 로봇 판본(fsm) 번호다. */
export type ReflectResult = { ok: true; version: number; appliesDay: string; learned: EdgeLine[]; active: EdgeLine[]; dropped: HabitRuleNote[] } | { ok: false; error: string; empty?: true };

/** 그날 고정한 판본. 없으면 그날 쓸 수 있는 가장 새 판본을 고정하고, 판본이 하나도 없으면 컵 FSM 기억을 seed로 저장한다.
 *  seed 판본 올리기: 그날 쓸 판본이 seed인데 내용이 지금 코드의 seed(CUP_FSM_MEMORY)와 다르고(JSON 글 비교) DB에서 가장 새 판본도 seed면,
 *  지금 seed 판본(가장 새 판본이 이미 그것이면 그 판본, 아니면 새로 저장)을 그날에 다시 고정한다.
 *  가장 새 판본이 반성 판본(또는 합성 기록)이면 건드리지 않는다: seed는 seed 뒤에만 올리므로 새 seed가 반성 판본을 덮지 않는다.
 *  옛 모양 기억(상태 안 rules, isOldFsm)은 옮기지 않는다: 새 seed 판본으로 다시 시작하고(가장 새 판본이 이미 지금 seed면 그 판본) log에 한 줄 남긴다(2026-11-18 사용자 답). */
export function memoryForDay(db: HistoryDb, day: string, o: { log?: (line: string) => void } = {}): DayMemory {
  return dayMemory(db, day, o);
}

/** 반성이 읽는 그날 기억: 고정·저장하지 않는다. 그날 고정 판본 → 그날 쓸 판본 → 지금 seed 차례(dayMemory와 같은 골라내기). */
export function readDayMemory(db: HistoryDb, day: string): { memory: PamMemory; kind: "list" | "fsm" } {
  const pinned = db.pinnedMemory(day);
  const m = pinned !== null ? db.memoryVersion(pinned) : db.memoryFor(day);
  if (!m) return { memory: CUP_FSM_MEMORY, kind: "fsm" };
  // 옛 모양 기억은 읽지 않는다(새 seed로 반성한다)
  if (m.kind === "fsm" && isOldFsm(m.memory)) return { memory: CUP_FSM_MEMORY, kind: "fsm" };
  const seed = JSON.stringify(CUP_FSM_MEMORY);
  if (m.source === "seed" && JSON.stringify(m.memory) !== seed && db.memoryVersion(db.latestMemoryVersion() ?? m.version)?.source === "seed") {
    return { memory: CUP_FSM_MEMORY, kind: "fsm" };
  }
  return { memory: validateMemory(m.memory, m.kind), kind: m.kind };
}

function dayMemory(db: HistoryDb, day: string, o: { log?: (line: string) => void }): DayMemory {
  const pinned = db.pinnedMemory(day);
  const m = pinned !== null ? db.memoryVersion(pinned) : db.memoryFor(day);
  const seed = JSON.stringify(CUP_FSM_MEMORY);
  if (m && m.kind === "fsm" && isOldFsm(m.memory)) {
    const latest = db.memoryVersion(db.latestMemoryVersion() ?? m.version);
    const version = latest && latest.source === "seed" && JSON.stringify(latest.memory) === seed
      ? latest.version : db.saveMemory({ kind: "fsm", memory: CUP_FSM_MEMORY, day: null, appliesDay: null, source: "seed" });
    db.pinMemory(day, version, true);
    o.log?.(MEMORY_TEXT.restart(m.version));
    return { memory: CUP_FSM_MEMORY, kind: "fsm", version };
  }
  if (m && m.source === "seed" && JSON.stringify(m.memory) !== seed) {
    const latest = db.memoryVersion(db.latestMemoryVersion() ?? m.version);
    if (latest?.source === "seed") {
      const version = JSON.stringify(latest.memory) === seed ? latest.version : db.saveMemory({ kind: "fsm", memory: CUP_FSM_MEMORY, day: null, appliesDay: null, source: "seed" });
      db.pinMemory(day, version, true);
      return { memory: CUP_FSM_MEMORY, kind: "fsm", version };
    }
  }
  if (m) {
    if (pinned === null) db.pinMemory(day, m.version);
    return { memory: validateMemory(m.memory, m.kind), kind: m.kind, version: m.version };
  }
  const version = db.saveMemory({ kind: "fsm", memory: CUP_FSM_MEMORY, day: null, appliesDay: null, source: "seed" });
  db.pinMemory(day, version);
  return { memory: CUP_FSM_MEMORY, kind: "fsm", version };
}

/** 하루 끝 반성 = 밤 흐름(src/brain/history/night.ts runNight): 덩어리 기록 → 반성 → 검사 → 시각 찾기 → 채택 검사 → 로봇 FSM → 한 트랜잭션 저장.
 *  filter: 습관 거르기(기본 keepAll, 기록 줄을 읽지 않는다). windowDays: 따로 넘긴 거르기에 주는 지난 기록 날 수(기본 30, 반성한 날 포함).
 *  dir: 시각 찾기·검사 결과 사본 폴더(runtime/homes/<집>/habit). signal로 끊으면(서버를 끌 때) PAM 요청을 끊고 기록 DB에 아무것도 쓰지 않는다. */
export async function runReflection(db: HistoryDb, pam: PamClient, day: string, o: NightOptions = {}): Promise<ReflectResult> {
  const r = await runNight(db, pam, day, o);
  if (!r.ok) return { ok: false, error: r.error, ...(r.empty ? { empty: true as const } : {}) };
  return { ok: true, version: r.version, appliesDay: r.appliesDay, learned: r.learned, active: r.active, dropped: r.dropped };
}

/** REFLECT_AT: 매일 반성할 시각 HH:MM(기록 시간대). 비우면 23:30, off면 끔. 틀린 값이면 시작을 막는다. */
export function loadReflectAt(env: Record<string, string | undefined>): string | null {
  const raw = env.REFLECT_AT?.trim();
  if (!raw) return "23:30";
  if (raw === "off") return null;
  const m = /^(\d{2}):(\d{2})$/.exec(raw);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`REFLECT_AT=${raw}: HH:MM(00:00~23:59) 또는 off여야 합니다`);
  return raw;
}

/** 매일 at(HH:MM, offsetMinutes 시간대)에 그날을 반성한다. 끝나면 다음 날 같은 시각을 잡는다. */
export function scheduleReflection(o: { at: string; offsetMinutes: number; run: (day: string) => Promise<unknown>; now?: () => number; after?: (ms: number, fn: () => void) => () => void }): { stop(): void } {
  const [h, m] = o.at.split(":").map(Number) as [number, number];
  const now = o.now ?? (() => Date.now());
  const offset = o.offsetMinutes * 60_000;
  const after = o.after ?? ((ms, fn) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return () => clearTimeout(t);
  });
  let cancel: (() => void) | undefined;
  let stopped = false;
  const next = () => {
    if (stopped) return;
    const local = new Date(now() + offset);
    let target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m) - offset;
    if (target <= now()) target += 86_400_000;
    cancel = after(target - now(), () => {
      void o.run(new Date(target + offset).toISOString().slice(0, 10)).catch(() => {}).finally(next);
    });
  };
  next();
  return { stop: () => { stopped = true; cancel?.(); } };
}
