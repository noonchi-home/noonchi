// 하루 끝 반성: 그날 관찰 텍스트 + 행동 요약 + 사용자 피드백 → pam-reflect/2 → 새 기억 판본.
// 새 판본은 다음 날부터 쓴다. 그날 판단은 그날 처음 정한 판본만 쓴다(논문 memory_lifecycle: fixed_during_day, following_day).
// 다음 날 판단이 이미 판본을 정했으면 그다음 날부터 쓴다. 보내기 전에 PAM /health의 입력 한도(reflect_input_bytes)에서
// 기억 JSON·피드백 크기를 빼고 그 안으로 하루 요약을 줄인다. 칸마다 pam-reflect/2 상한도 넘지 않게 하고, 피드백은 최근 것부터 담는다.
// 결과는 기록 DB(reflection)와 판단 기록(brain)에 남긴다.
// fsm 기억은 저장 전에 반성 뒤 검사를 거친다(src/brain/history/habits.ts): 코치 규칙 지키기 → 습관 거르기(기본 모두 남기기) → 코치 규칙 지키기 → 모양 검사.
import { TASKS } from "../../act/tasks.js";
import { CUP_FSM_MEMORY, MAX_REFLECT_TEXT, validateMemory, type FsmMemory, type PamMemory } from "../decision.js";
import type { PamClient } from "../pam.js";
import type { BrainLog } from "../../contract/events.js";
import type { HistoryDb } from "./db.js";
import { coachGuard, keepAll, learnedRules, type HabitFilter, type HabitRuleNote, type RuleLine } from "./habits.js";
import { REFLECT_TEXT } from "./labels.js";
import { daySummary } from "./summary.js";

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const bytes = (s: string) => Buffer.byteLength(s, "utf8");

/** 최근 줄부터 max 바이트까지 담는다(시각 순으로 돌려줌). */
function latestWithin(lines: string[], max: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const b = bytes(lines[i]!) + (out.length ? 1 : 0);
    if (used + b > max) break;
    out.unshift(lines[i]!);
    used += b;
  }
  return out;
}
/** 그날 기록이 있다고 보는 종류. */
const DAY_KINDS = ["detection", "world", "device", "vlm", "yolo", "decision", "execution", "feedback"] as const;

export interface DayMemory { memory: PamMemory; kind: "list" | "fsm"; version: number }
/** ok면 learned(이번에 새로 더한 규칙)·active(새 판본의 규칙 가운데 seed에 없는 것)·dropped(반성 뒤 검사가 뺀 규칙)를 함께 준다. learned·active는 코치 행동을 뺀다. */
export type ReflectResult = { ok: true; version: number; appliesDay: string; learned: RuleLine[]; active: RuleLine[]; dropped: HabitRuleNote[] } | { ok: false; error: string; empty?: true };

/** 습관 거르기에 넘기는 기록 종류. */
const HABIT_KINDS = ["world", "device", "decision", "execution", "feedback"] as const;

/** 그날 고정한 판본. 없으면 그날 쓸 수 있는 가장 새 판본을 고정하고, 판본이 하나도 없으면 컵 FSM 기억을 seed로 저장한다.
 *  seed 판본 올리기: 그날 쓸 판본이 seed인데 내용이 지금 코드의 seed(CUP_FSM_MEMORY)와 다르고(JSON 글 비교) DB에서 가장 새 판본도 seed면,
 *  지금 seed 판본(가장 새 판본이 이미 그것이면 그 판본, 아니면 새로 저장)을 그날에 다시 고정한다.
 *  가장 새 판본이 반성 판본(또는 합성 기록)이면 건드리지 않는다: seed는 seed 뒤에만 올리므로 새 seed가 반성 판본을 덮지 않는다. */
export function memoryForDay(db: HistoryDb, day: string): DayMemory {
  const pinned = db.pinnedMemory(day);
  const m = pinned !== null ? db.memoryVersion(pinned) : db.memoryFor(day);
  const seed = JSON.stringify(CUP_FSM_MEMORY);
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

/** filter: 습관 거르기(기본 keepAll, 기록 줄을 읽지 않고 rows는 빈 목록). windowDays: 따로 넘긴 거르기에 주는 지난 기록 날 수(기본 30, 반성한 날 포함). */
export async function runReflection(db: HistoryDb, pam: PamClient, day: string, o: { now?: () => number; emit?: (l: BrainLog) => void; filter?: HabitFilter; windowDays?: number } = {}): Promise<ReflectResult> {
  const now = o.now ?? (() => Date.now());
  const done = (ok: boolean, text: string, version: number | null, appliesDay: string | null, found?: { learned: RuleLine[]; active: RuleLine[]; dropped: HabitRuleNote[] }) => {
    const at = now();
    db.add("reflection", at, text, { data: { day, ok, version, applies_day: appliesDay, ...found } });
    o.emit?.({ type: "reflection", at_ms: at, day, ok, version, applies_day: appliesDay, text, ...found });
  };
  if (!db.list({ day, kinds: [...DAY_KINDS], limit: 1 }).length) {
    done(false, REFLECT_TEXT.failed(REFLECT_TEXT.empty), null, null);
    return { ok: false, empty: true, error: REFLECT_TEXT.empty };
  }
  try {
    const cur = memoryForDay(db, day);
    const feedback = latestWithin(db.list({ day, kinds: ["feedback"] }).map((r) => r.text), MAX_REFLECT_TEXT.feedback).join("\n") || null;
    const limits = await pam.limits();
    // 요약이 비면 대신 보내는 글(관찰 없음·행동 없음)도 한도 안에 들게 미리 뺀다
    const maxBytes = limits.reflect_input_bytes - bytes(JSON.stringify(cur.memory, null, 2)) - bytes(feedback ?? "") - bytes(REFLECT_TEXT.noObservation) - bytes(REFLECT_TEXT.noAction);
    if (maxBytes <= 0) throw new Error(REFLECT_TEXT.tooBig);
    const summary = daySummary(db, day, { maxBytes, caps: MAX_REFLECT_TEXT });
    let memory = await pam.reflect({
      day, memory_kind: cur.kind, memory: cur.memory, observation_text: summary.observation_text || REFLECT_TEXT.noObservation,
      action_summary: summary.action_summary || REFLECT_TEXT.noAction, feedback,
    }, cur.kind);
    let learned: RuleLine[] = [];
    let active: RuleLine[] = [];
    let dropped: HabitRuleNote[] = [];
    if (cur.kind === "fsm") {
      // 반성 뒤 검사: 코치 규칙은 seed 그대로, 습관 거르기, 거르기가 코치 규칙을 바꾸지 못하게 한 번 더, 그 뒤 모양 검사
      const previous = cur.memory as FsmMemory;
      const first = coachGuard(CUP_FSM_MEMORY, validateMemory(memory, "fsm") as FsmMemory);
      const windowDays = o.windowDays ?? 30;
      const dayStart = Date.parse(`${day}T00:00:00Z`) - db.offsetMinutes * 60_000;
      // 기록 줄은 따로 넘긴 거르기만 읽는다: 기본(keepAll)은 쓰지 않으니 30일 기록을 올리지 않는다(기록 DB가 커도 서버를 멈추지 않게)
      const rows = o.filter ? db.list({ since: dayStart - (windowDays - 1) * 86_400_000, until: dayStart + 86_400_000 - 1, kinds: [...HABIT_KINDS], limit: Number.MAX_SAFE_INTEGER }) : [];
      const filtered = await (o.filter ?? keepAll)({ day, windowDays, offsetMinutes: db.offsetMinutes, previous, proposed: first.memory, rows });
      const second = coachGuard(CUP_FSM_MEMORY, filtered.memory);
      memory = validateMemory(second.memory, "fsm");
      dropped = [...first.notes, ...filtered.notes, ...second.notes].filter((n) => !n.kept);
      learned = learnedRules(previous, memory as FsmMemory).filter((r) => !TASKS[r.action]?.coach);
      active = learnedRules(CUP_FSM_MEMORY, memory as FsmMemory).filter((r) => !TASKS[r.action]?.coach);
    }
    let appliesDay = nextDay(day);
    while (db.pinnedMemory(appliesDay) !== null) appliesDay = nextDay(appliesDay);
    const version = db.saveMemory({ kind: cur.kind, memory, day, appliesDay, source: "reflection" });
    const text = REFLECT_TEXT.done(version, appliesDay) + (learned.length ? ` · ${REFLECT_TEXT.learned(learned.length)}` : "");
    done(true, text, version, appliesDay, { learned, active, dropped });
    return { ok: true, version, appliesDay, learned, active, dropped };
  } catch (e) {
    const error = (e as Error).message;
    done(false, REFLECT_TEXT.failed(error), null, null);
    return { ok: false, error };
  }
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
export function scheduleReflection(o: { at: string; offsetMinutes: number; run: (day: string) => Promise<unknown>; now?: () => number }): { stop(): void } {
  const [h, m] = o.at.split(":").map(Number) as [number, number];
  const now = o.now ?? (() => Date.now());
  const offset = o.offsetMinutes * 60_000;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const next = () => {
    if (stopped) return;
    const local = new Date(now() + offset);
    let target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m) - offset;
    if (target <= now()) target += 86_400_000;
    timer = setTimeout(() => {
      void o.run(new Date(target + offset).toISOString().slice(0, 10)).catch(() => {}).finally(next);
    }, target - now());
    timer.unref?.();
  };
  next();
  return { stop: () => { stopped = true; clearTimeout(timer); } };
}
