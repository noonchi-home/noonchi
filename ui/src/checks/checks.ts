// 트윈 위 말풍선 목록(순수 리듀서). 에이전트가 판단하면서 확인한 기기와 컵 두뇌가 지켜보는 식탁만 담는다.
// 에이전트: 이번 요청에서 다룬 기기마다 한 줄(번호는 처음 다룬 차례). 새 요청이 시작되면 지운다.
// 컵 두뇌: 두뇌 메시지가 오는 동안 식탁에 「지켜봄」 한 줄. 마지막 메시지 뒤 30초가 지나면 지운다.
import type { AgentAction, BrainLog, PendingView, ServerMessage, Tri } from "../../../src/contract/events.ts";
import { stepKind } from "../chat/labels";

export type CheckVerb = "확인" | "바꿈" | "승인 대기" | "실패" | "취소" | "지켜봄";

export type Check = {
  key: string;
  /** 이번 요청 안에서 처음 다룬 차례(1부터). */
  order: number;
  source: "agent" | "brain";
  deviceId?: string;
  /** 물건 id. 두뇌 줄은 checkList가 식탁 id를 채운다. */
  objectId?: string;
  verb: CheckVerb;
  note?: string;
  at: number;
  /** 승인 대기 표(취소 알림은 표만 온다). */
  token?: string;
};

export interface ChecksState {
  turn: Check[];
  brain: Check[];
  brainAt: number | null;
  /** 진행 중인 요청의 세션. null이면 다음 에이전트 이벤트가 새 요청이다. */
  open: string | null;
}

export type ChecksEvent =
  | { type: "message"; message: ServerMessage; now: number }
  | { type: "ask"; now: number }
  | { type: "tick"; now: number };

export const EMPTY_CHECKS: ChecksState = { turn: [], brain: [], brainAt: null, open: null };

/** 마지막 두뇌 메시지 뒤 이만큼 지나면 식탁 줄을 지운다. */
export const BRAIN_TTL_MS = 30_000;

function verbOf(a: AgentAction): CheckVerb {
  if (a.needsConfirmation) return "승인 대기";
  if (!a.ok) return "실패";
  return stepKind(a.tool) === "확인" ? "확인" : "바꿈";
}

/** 기기 한 줄을 더하거나 고친다. 같은 기기는 번호를 두고 verb만 바꾼다. 바꾼·기다리는·실패한 기기를 다시 읽기만 하면 verb를 그대로 둔다. */
function touch(turn: Check[], deviceId: string, verb: CheckVerb, now: number): Check[] {
  const i = turn.findIndex((c) => c.deviceId === deviceId);
  if (i === -1) return [...turn, { key: `device:${deviceId}`, order: turn.length + 1, source: "agent", deviceId, verb, at: now }];
  const c = turn[i]!;
  if (verb === "확인" && c.verb !== "확인") return turn;
  return turn.map((x, j) => (j === i ? { ...c, verb, at: now } : x));
}

function withToken(turn: Check[], p: PendingView): Check[] {
  return turn.map((c) => (c.deviceId === p.deviceId && c.verb === "승인 대기" ? { ...c, token: p.token } : c));
}

/** 승인 결과: 표가 같거나(취소는 표만 온다) 기기가 같은 승인 대기 줄을 바꾼다. */
function settle(turn: Check[], match: (c: Check) => boolean, verb: CheckVerb, now: number): Check[] {
  return turn.some((c) => c.verb === "승인 대기" && match(c))
    ? turn.map((c) => (c.verb === "승인 대기" && match(c) ? { ...c, verb, at: now } : c))
    : turn;
}

const HAS: Record<Tri, string> = { yes: "있음", no: "없음", unknown: "모름" };
const YN: Record<string, Tri> = { 예: "yes", 아니오: "no", 모름: "unknown" };
const seen = (person: Tri, cup: Tri) => `사람 ${HAS[person]} · 컵 ${HAS[cup]}`;

/** 판정 요약 한 줄: YOLO 존재 판정, 또는 VLM 판정 요약(src/brain/brain.ts summarize)의 사람·컵. 못 읽으면 null. */
function noteOf(e: BrainLog): string | null {
  if (e.type === "presence") return seen(e.person, e.cup);
  if (e.type !== "perception" || e.error) return null;
  const person = /^사람 (예|아니오|모름)/.exec(e.summary)?.[1];
  const cup = /(?:^| · )컵 (예|아니오|모름)/.exec(e.summary)?.[1];
  return person && cup ? seen(YN[person]!, YN[cup]!) : null;
}

function onBrain(s: ChecksState, e: BrainLog, now: number): ChecksState {
  const prev = s.brain[0];
  const note = noteOf(e) ?? prev?.note;
  return { ...s, brainAt: now, brain: [{ key: "brain", order: 1, source: "brain", verb: "지켜봄", ...(note ? { note } : {}), at: now }] };
}

function onAgent(s: ChecksState, m: Extract<ServerMessage, { type: "agent" }>, now: number): ChecksState {
  switch (m.event) {
    case "action": {
      const turn = s.open === m.sessionId ? s.turn : [];
      const id = m.action.deviceId;
      return { ...s, open: m.sessionId, turn: id ? touch(turn, id, verbOf(m.action), now) : turn };
    }
    case "reply": {
      // 실시간 행동 없이 답만 오면 답에 실린 행동으로 채운다(이미 있는 기기는 실시간 결과를 둔다)
      let turn = s.open === m.sessionId ? s.turn : [];
      const known = new Set(turn.map((c) => c.deviceId));
      for (const a of m.actions) if (a.deviceId && !known.has(a.deviceId)) turn = touch(turn, a.deviceId, verbOf(a), now);
      for (const p of m.pendingConfirmations) turn = withToken(turn, p);
      return { ...s, open: null, turn };
    }
    case "pending":
      return { ...s, turn: withToken(s.turn, m.pending) };
    case "confirmed":
      return { ...s, turn: settle(s.turn, (c) => c.token === m.token || (!!m.deviceId && c.deviceId === m.deviceId), m.ok ? "바꿈" : "실패", now) };
    case "cancelled":
      return { ...s, turn: settle(s.turn, (c) => c.token === m.token, "취소", now) };
  }
}

export function checksReducer(s: ChecksState, e: ChecksEvent): ChecksState {
  if (e.type === "ask") return { ...s, turn: [], open: null };
  if (e.type === "tick") return s.brainAt !== null && e.now - s.brainAt >= BRAIN_TTL_MS ? { ...s, brain: [], brainAt: null } : s;
  const m = e.message;
  if (m.type === "agent") {
    const next = onAgent(s, m, e.now);
    return next.turn === s.turn && next.open === s.open ? s : next;
  }
  if (m.type === "brain") return onBrain(s, m.event, e.now);
  return s;
}

/** 그릴 목록: 이번 요청의 기기들 뒤에 두뇌 줄. 두뇌 줄은 식탁 id에 붙이고, 식탁이 없으면 뺀다. */
export function checkList(s: ChecksState, tableId: string | null): Check[] {
  return [...s.turn, ...(tableId ? s.brain.map((c) => ({ ...c, objectId: tableId })) : [])];
}
