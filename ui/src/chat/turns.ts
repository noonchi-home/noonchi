// 대화 기록(순수 리듀서). web/app.js 추론 과정(newTurn·addStep·finishTurn·addConfirm·settle·onBrain·addPhoto)의 규칙을 옮겼다.
// 요청마다 카드 한 장: 행동 단계(실시간 action 이벤트, 없으면 답의 actions)와 답·초점·승인 결과 줄이 쌓인다.
// 폰에서 말한 대화·사진, 컵 두뇌 흐름도 같은 목록에 카드로 쌓인다.
import type { ActionOutcome, AgentAction, BrainLog, PendingView, PhotoRecord, ServerMessage } from "../../../src/contract/events.ts";
import { BRAIN_STATE } from "./labels";

/** 폰(클로이드의 눈)에서 말한 대화의 세션 id(서버 start.ts와 같다). */
export const PHONE_SESSION = "phone";

export type TurnSource = "dashboard" | "phone" | "brain";
export type TurnState = "busy" | "ok" | "wait" | "fail" | "cancel";
export type PendingStatus = "open" | "busy" | "ok" | "fail" | "cancel";
export type PendingCard = PendingView & { status: PendingStatus };

/** 행동 한 단계, 또는 글 한 줄(답·초점·취소·승인 결과·찍은 자리·두뇌 단계). mark는 두뇌 줄의 아이콘 자리. */
export type Step =
  | { kind: "action"; action: AgentAction }
  | { kind: "line"; label: string; text: string; tone?: "fail" | "wait"; mark?: string };

export interface Turn {
  id: string;
  source: TurnSource;
  ask: string;
  state: TurnState;
  /** 상태 알약 글. 없으면 state의 기본 글. */
  label?: string;
  answer: string;
  steps: Step[];
  pending: PendingCard[];
  /** 컵 두뇌: 지금 보이는 것·최근 판정(장마다 갈아 끼운다). */
  now?: { seen: string; judged: string };
  photo?: string;
  /** 컵 두뇌 카드가 끝났는가(다음 이벤트는 새 카드). */
  ended?: boolean;
  outcome?: ActionOutcome;
}

export type TurnEvent =
  | { type: "ask"; id: string; source: TurnSource; text: string }
  | { type: "message"; message: ServerMessage; sessionId: string }
  /** POST /api/agent/chat 응답. 실시간 답이 먼저 와서 이미 끝났으면 무시한다. */
  | { type: "result"; id: string; reply?: string; actions?: AgentAction[]; pending?: PendingView[]; error?: string }
  | { type: "confirming"; token: string }
  | { type: "settle"; token: string; ok: boolean; reply: string; cancelled?: boolean }
  | { type: "reset" };

export const STATE_LABELS: Record<TurnState, string> = { busy: "생각 중", ok: "완료", wait: "승인 대기", fail: "실패", cancel: "취소" };

const at = (turns: Turn[], i: number, turn: Turn) => turns.map((t, j) => (j === i ? turn : t));
const lastIndex = (turns: Turn[], ok: (t: Turn) => boolean) => {
  for (let i = turns.length - 1; i >= 0; i--) if (ok(turns[i]!)) return i;
  return -1;
};
const line = (label: string, text: string, extra: { tone?: "fail" | "wait"; mark?: string } = {}): Step => ({ kind: "line", label, text, ...extra });
const isFocus = (s: Step) => s.kind === "line" && s.label === "초점";

function finish(turn: Turn, reply: string | null, actions: AgentAction[] = [], pending: PendingView[] = [], error?: string): Turn {
  let steps = turn.steps.some((s) => s.kind === "action") ? turn.steps : [...turn.steps, ...actions.map((action): Step => ({ kind: "action", action }))];
  const text = reply ?? error ?? "";
  const state: TurnState = error ? "fail"
    : pending.length ? "wait"
    : actions.some((a) => !a.ok && !a.needsConfirmation) && !actions.some((a) => a.ok) ? "fail"
    : "ok";
  // 초점 이벤트가 답보다 먼저 올 수 있다: 답을 초점 줄 앞에 둔다
  const focusAt = steps.findIndex(isFocus);
  const answer = line("답", text);
  steps = focusAt === -1 ? [...steps, answer] : [...steps.slice(0, focusAt), answer, ...steps.slice(focusAt)];
  return {
    ...turn, steps, state, label: error ? "오류" : undefined, answer: text,
    pending: [...turn.pending, ...pending.map((p): PendingCard => ({ ...p, status: "open" }))],
  };
}

function settle(turns: Turn[], token: string, ok: boolean, reply: string, cancelled = false): Turn[] {
  const i = lastIndex(turns, (t) => t.pending.some((p) => p.token === token && (p.status === "open" || p.status === "busy")));
  if (i === -1) return turns;
  const t = turns[i]!;
  const status: PendingStatus = cancelled ? "cancel" : ok ? "ok" : "fail";
  return at(turns, i, {
    ...t,
    pending: t.pending.map((p) => (p.token === token ? { ...p, status } : p)),
    steps: [...t.steps, line(cancelled ? "취소" : ok ? "승인 후 실행" : "승인 실패", reply, !ok && !cancelled ? { tone: "fail" } : {})],
    state: ok ? "ok" : cancelled ? "cancel" : "fail",
    label: undefined,
    answer: reply,
  });
}

const fresh = (id: string, source: TurnSource, ask: string): Turn => ({ id, source, ask, state: "busy", answer: "", steps: [], pending: [] });

function photoTurn(id: string, p: PhotoRecord): Turn {
  const pose = p.measured_pose;
  const where = pose
    ? `위치 (${pose.position[0].toFixed(2)}, ${pose.position[1].toFixed(2)}) · 방향 ${Math.round(pose.yaw_deg)}° · 높이 ${pose.height_m.toFixed(2)}m`
    : "위치 모름";
  return { ...fresh(id, "phone", "사진 찍기"), state: "ok", label: "저장", answer: where, steps: [line("찍은 자리", where)], photo: p.url };
}

// ── 컵 두뇌 ──────────────────────────────────────────────
// 흐름마다 카드 하나: 단계 글을 쌓고, 지금 보이는 것(존재 판정)과 최근 판정은 두 줄에서 갈아 끼운다. 행동은 모두 모의다.

const HAS = { yes: "있음", no: "없음", unknown: "모름" } as const;
const ago = (ms: number | null | undefined) => (ms === null || ms === undefined ? "" : ` · 근거 ${(ms / 1000).toFixed(1)}초 전`);
const ENDS = new Set(["wait", "error", "act", "result"]);

function onBrain(turns: Turn[], e: BrainLog): Turn[] {
  let i = lastIndex(turns, (t) => t.source === "brain" && !t.ended);
  if (i === -1) {
    turns = [...turns, { ...fresh(`b${turns.length}`, "brain", "컵 지켜보기"), label: BRAIN_STATE.watching, answer: "폰 카메라로 컵을 지켜봐요", now: { seen: "", judged: "" }, ended: false }];
    i = turns.length - 1;
  }
  const t = turns[i]!;
  const now = t.now ?? { seen: "", judged: "" };
  const step = (text: string, extra: { tone?: "fail" | "wait"; mark?: string } = {}) => ({ steps: [...t.steps, line("", text, extra)], answer: text });
  switch (e.type) {
    case "presence":
      return at(turns, i, { ...t, now: { ...now, seen: `사람 ${HAS[e.person]} · 컵 ${HAS[e.cup]}` } });
    case "perception":
      return at(turns, i, { ...t, now: { ...now, judged: `${e.answer ? "답 사진: " : ""}${e.error ? "판정하지 못했어요" : e.summary}${ago(e.evidence_age_ms)}` } });
    case "brain": {
      const next: Turn = { ...t, label: BRAIN_STATE[e.state] ?? e.state, ...step(`${e.text}${ago(e.evidence_age_ms)}`, { mark: e.stage, ...(e.stage === "error" ? { tone: "fail" as const } : {}) }) };
      if (e.state === "done" && ENDS.has(e.stage)) {
        const state: TurnState = e.stage === "error" ? "fail" : t.outcome && t.outcome !== "cleared" && t.outcome !== "answered" ? "wait" : "ok";
        return at(turns, i, { ...next, ended: true, state, label: BRAIN_STATE.done });
      }
      return at(turns, i, next);
    }
    case "request":
      return at(turns, i, { ...t, ...step(e.active ? `폰에 요청: ${e.text}` : "폰 요청 거둠", { mark: "phone" }) });
    case "action": {
      if (!e.active) return turns;
      const ask = `폰에 부탁: ${e.plan.prompt?.text ?? e.plan.dashboard}`;
      return at(turns, i, { ...t, steps: [...t.steps, line("", ask, { mark: "phone", tone: "wait" }), line("", `클로이드라면: ${e.plan.would}`, { mark: "would" })], answer: ask });
    }
    case "result":
      return at(turns, i, { ...t, outcome: e.outcome }); // 바로 뒤 result 단계 글이 카드를 닫는다
  }
}

function onMessage(turns: Turn[], m: ServerMessage, sessionId: string): Turn[] {
  const live = () => lastIndex(turns, (t) => t.source === "dashboard" && t.state === "busy");
  if (m.type === "agent") {
    if (m.event === "action") {
      const i = m.sessionId === sessionId ? live() : -1;
      return i === -1 ? turns : at(turns, i, { ...turns[i]!, steps: [...turns[i]!.steps, { kind: "action", action: m.action }] });
    }
    if (m.event === "reply") {
      if (m.sessionId === PHONE_SESSION) return [...turns, finish(fresh(`m${turns.length}`, "phone", m.message), m.reply, m.actions, m.pendingConfirmations)];
      const i = m.sessionId === sessionId ? live() : -1;
      return i === -1 ? turns : at(turns, i, finish(turns[i]!, m.reply, m.actions, m.pendingConfirmations));
    }
    if (m.event === "confirmed") return settle(turns, m.token, m.ok, m.reply);
    if (m.event === "cancelled") return settle(turns, m.token, false, "취소했어요.", true);
    return turns;
  }
  if (m.type === "photo") return [...turns, photoTurn(`m${turns.length}`, m.photo)];
  if (m.type === "focus") {
    const i = lastIndex(turns, (t) => t.source !== "brain");
    if (i === -1 || !m.focus?.targets?.length) return turns;
    return at(turns, i, { ...turns[i]!, steps: [...turns[i]!.steps, line("초점", m.focus.targets.map((t) => t.label).join(", "))] });
  }
  if (m.type === "brain") return onBrain(turns, m.event);
  return turns;
}

export function turnsReducer(turns: Turn[], e: TurnEvent): Turn[] {
  switch (e.type) {
    case "ask":
      return [...turns, fresh(e.id, e.source, e.text)];
    case "message":
      return onMessage(turns, e.message, e.sessionId);
    case "result": {
      const i = turns.findIndex((t) => t.id === e.id);
      if (i === -1 || turns[i]!.state !== "busy") return turns;
      return at(turns, i, e.reply ? finish(turns[i]!, e.reply, e.actions, e.pending) : finish(turns[i]!, null, [], [], e.error ?? "에이전트가 답하지 못했습니다."));
    }
    case "confirming": {
      const i = lastIndex(turns, (t) => t.pending.some((p) => p.token === e.token && p.status === "open"));
      if (i === -1) return turns;
      return at(turns, i, { ...turns[i]!, pending: turns[i]!.pending.map((p) => (p.token === e.token ? { ...p, status: "busy" } : p)) });
    }
    case "settle":
      return settle(turns, e.token, e.ok, e.reply, e.cancelled);
    case "reset":
      return [];
  }
}
