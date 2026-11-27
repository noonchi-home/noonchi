// 반성 하나 읽기(GET /api/reflection/:day): 밤 반성 화면이 단계마다 쓰는 자료. 읽기만 한다.
// 채택 검사 숫자(n·k·비율·p_value)와 기준(RATE_MIN·ALPHA)은 싣는다. p0·base_rate, 모델이 쓴 글(덩어리 text, 후보 사건 on·when, 거절 까닭, 기록 줄 글, 새 상태 설명)은 싣지 않는다.
import type { CheckMoment, DropReason, FsmGraphData, ReflectionCheck, ReflectionDetail } from "../../contract/reflection.js";
import { CUP_FSM_MEMORY, type FsmMemory } from "../decision.js";
import { ALPHA, FOLLOW_SECONDS, RATE_MIN } from "../pam/adopt.js";
import type { HistoryDb } from "./db.js";

type SavedCheck = { state: string; to?: string; action: string; n: number; k: number; unknown: number; rate: number; p_value: number; passed: boolean; moments?: CheckMoment[] };
type Saved = {
  ok?: boolean; applies_day?: string | null; rejected?: string | null;
  chunks?: ReflectionDetail["chunks"]; did?: ReflectionDetail["did"];
  learned?: { from: string; to: string; on: string; when: string | null; action: string }[];
  dropped?: { from: string; to: string; action: string; reason: DropReason; seen?: number; fired?: number; p?: number }[];
  checks?: SavedCheck[];
};

/** 같은 (출발 상태, 도착, 행동) 검사는 하나로: 통과한 것, 없으면 k가 큰 것(같으면 n이 큰 것). 화면은 후보 사건 글을 보이지 않아 같은 줄이 되풀이된다. */
function grouped(checks: readonly SavedCheck[]): SavedCheck[] {
  const best = new Map<string, SavedCheck>();
  for (const c of checks) {
    const key = JSON.stringify([c.state, c.to ?? null, c.action]);
    const was = best.get(key);
    if (!was || (c.passed && !was.passed) || (c.passed === was.passed && (c.k > was.k || (c.k === was.k && c.n > was.n)))) best.set(key, c);
  }
  return [...best.values()];
}

/** FSM 그림 자료: 상태 id(기억 차례)와 화살표(출발·도착·행동). 사건·조건 글과 상태 설명은 싣지 않는다. */
const graphOf = (m: FsmMemory): FsmGraphData => ({
  states: m.states.map((s) => s.id),
  edges: m.states.flatMap((s) => s.next.map((e) => ({ from: s.id, to: e.to, action: e.action ?? null }))),
});

export function reflectionDetail(db: HistoryDb, day: string): ReflectionDetail {
  const row = db.list({ kinds: ["reflection"], latest: true, limit: 200 }).reverse().find((r) => (r.data as { day?: string } | null)?.day === day) ?? null;
  const night = db.night(day);
  const data = ((night?.result ?? row?.data) ?? {}) as Saved;
  const pinned = db.pinnedMemory(day) ?? db.memoryFor(day)?.version ?? null;
  const memory = (pinned === null ? undefined : db.memoryVersion(pinned)?.memory as FsmMemory | undefined) ?? CUP_FSM_MEMORY;
  const next = night ? db.memoryVersion(night.robot)?.memory as FsmMemory | undefined : undefined;
  const old = (e: { from: string; on: string; when: string | null }) =>
    memory.states.find((s) => s.id === e.from)?.next.find((x) => x.on === e.on && (x.when ?? null) === e.when) ?? null;
  const checks: ReflectionCheck[] = grouped(data.checks ?? []).map((c) => ({
    state: c.state, to: c.to ?? null, action: c.action, n: c.n, k: c.k, unknown: c.unknown, rate: c.rate, p_value: c.p_value, passed: c.passed, moments: c.moments ?? [],
  }));
  const dropped = [...new Map((data.dropped ?? []).map((x) => [JSON.stringify([x.from, x.to, x.action, x.reason]), x])).values()];
  return {
    ok: true, day,
    state: night ? "done" : row ? (data.ok ? "done" : "failed") : "none",
    rejected: !!data.rejected,
    at_ms: row?.at_ms ?? null,
    before: pinned === null ? null : { version: pinned },
    after: night && data.applies_day ? { version: night.robot, applies_day: data.applies_day } : null,
    graph: graphOf(memory),
    after_graph: next ? graphOf(next) : null,
    chunks: (data.chunks ?? []).map(({ start, end, state, room }) => ({ start, end, state, room })),
    did: (data.did ?? []).map(({ action, at, via }) => ({ action, at, via })),
    candidates: checks.map(({ state, to, action }) => ({ state, to, action })),
    dropped: dropped.map(({ from, to, action, reason, seen, fired, p }) => ({ from, to, action, reason, seen: seen ?? null, fired: fired ?? null, p: p ?? null })),
    checks,
    learned: (data.learned ?? []).map((e) => { const was = old(e); return { from: e.from, to: e.to, action: e.action, was: was?.action ?? null, was_to: was?.to ?? null }; }),
    skipped_to: db.skips().find((s) => s.from === day)?.to ?? null,
    window_s: FOLLOW_SECONDS, rate_min: RATE_MIN, alpha: ALPHA,
  };
}
