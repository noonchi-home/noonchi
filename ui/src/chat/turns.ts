// 판단 기록(순수 리듀서). 대시보드는 보기만 한다: 요청·승인은 폰에서 음성으로 오고, 서버 메시지만으로 카드를 쌓는다.
// 요청마다 카드 한 장: 행동 단계(실시간 action 이벤트, 없으면 답의 actions)와 답·초점·승인 결과 줄이 쌓인다.
// 실시간 행동은 세션마다 진행 중 카드에 붙고, 그 세션의 답이 카드를 끝낸다. 사진, 관찰과 판단 흐름도 같은 목록에 카드로 쌓인다.
import type { AgentAction, BrainLog, DecisionWorld, PendingView, PhotoRecord, ServerMessage } from "../../../src/contract/events.ts";
import { BRAIN_CARD, EXEC_LABEL, VLM_MISSING, YOLO_MISSING } from "./labels";

/** 폰(클로이드의 눈)에서 말한 대화의 세션 id(서버 start.ts와 같다). */
export const PHONE_SESSION = "phone";

/** phone: 거주자가 폰에서 말함, brain: 클로이드 관찰과 판단, other: 다른 화면(폰이 아닌 세션). */
export type TurnSource = "phone" | "brain" | "other";
export type TurnState = "busy" | "ok" | "wait" | "fail" | "cancel";
/** 승인 대기 카드: 폰에서 승인·취소하면 결과로 바뀐다. */
export type PendingStatus = "open" | "ok" | "fail" | "cancel";
export type PendingCard = PendingView & { status: PendingStatus };

/** 판단 줄을 펼치면 보이는 근거: PAM에 보낸 관찰 텍스트, 판단할 때 World State 요약, 참조한 기억 판본. */
export interface DecisionDetail { text_sent: string; world: DecisionWorld; memory_version: number }

/** 한 프레임의 YOLOX 결과(seen)와 VLM 답(judged). 분석 없음이면 그 글. */
export interface FramePair { frame_id: string; captured_at_ms: number; seen: string; judged: string }
export type FrameHalf = { frame_id: string; captured_at_ms: number; seen?: string; judged?: string };

/** 행동 한 단계, 또는 글 한 줄(답·초점·취소·승인 결과·찍은 자리·관찰 기록). mark는 관찰 기록 줄의 종류(아이콘·단계 이름). detail은 판단 줄의 근거. */
export type Step =
  | { kind: "action"; action: AgentAction }
  | { kind: "line"; label: string; text: string; tone?: "fail" | "wait"; mark?: string; detail?: DecisionDetail };

export interface Turn {
  id: string;
  source: TurnSource;
  /** 에이전트 세션 id(두뇌·사진 카드는 없음). */
  session?: string;
  /** 폰에서 들은 말. 답이 오기 전 진행 중 카드는 비어 있다. */
  ask: string;
  state: TurnState;
  /** 상태 알약 글. 없으면 state의 기본 글. */
  label?: string;
  answer: string;
  steps: Step[];
  pending: PendingCard[];
  /** 관찰과 판단: YOLOX 결과와 VLM 답이 둘 다 온 가장 새 프레임 하나의 짝. */
  now?: FramePair;
  /** 아직 짝이 안 찬 프레임(YOLOX 결과나 VLM 답 하나만 옴). */
  frames?: FrameHalf[];
  photo?: string;
  /** 관찰과 판단 카드가 끝났는가(판단 줄이 닫는다. 다음 기록은 새 카드). */
  ended?: boolean;
  /** 이 카드를 닫은 판단 id(pam-N). 그 판단의 실행 줄(plan_id plan:pam-N)이 이 카드에 쌓인다. */
  decision?: string;
}

export const STATE_LABELS: Record<TurnState, string> = { busy: "생각 중", ok: "완료", wait: "승인 대기", fail: "실패", cancel: "취소" };

const at = (turns: Turn[], i: number, turn: Turn) => turns.map((t, j) => (j === i ? turn : t));
const lastIndex = (turns: Turn[], ok: (t: Turn) => boolean) => {
  for (let i = turns.length - 1; i >= 0; i--) if (ok(turns[i]!)) return i;
  return -1;
};
const line = (label: string, text: string, extra: { tone?: "fail" | "wait"; mark?: string; detail?: DecisionDetail } = {}): Step => ({ kind: "line", label, text, ...extra });
const isFocus = (s: Step) => s.kind === "line" && s.label === "초점";

function finish(turn: Turn, text: string, actions: AgentAction[] = [], pending: PendingView[] = []): Turn {
  let steps = turn.steps.some((s) => s.kind === "action") ? turn.steps : [...turn.steps, ...actions.map((action): Step => ({ kind: "action", action }))];
  const state: TurnState = pending.length ? "wait"
    : actions.some((a) => !a.ok && !a.needsConfirmation) && !actions.some((a) => a.ok) ? "fail"
    : "ok";
  // 초점 이벤트가 답보다 먼저 올 수 있다: 답을 초점 줄 앞에 둔다
  const focusAt = steps.findIndex(isFocus);
  const answer = line("답", text);
  steps = focusAt === -1 ? [...steps, answer] : [...steps.slice(0, focusAt), answer, ...steps.slice(focusAt)];
  return {
    ...turn, steps, state, label: undefined, answer: text,
    pending: [...turn.pending, ...pending.map((p): PendingCard => ({ ...p, status: "open" }))],
  };
}

function settle(turns: Turn[], token: string, ok: boolean, reply: string, cancelled = false): Turn[] {
  const i = lastIndex(turns, (t) => t.pending.some((p) => p.token === token && p.status === "open"));
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
const sourceOf = (session: string): TurnSource => (session === PHONE_SESSION ? "phone" : "other");
const sessionTurn = (id: string, session: string): Turn => ({ ...fresh(id, sourceOf(session), ""), session });

function photoTurn(id: string, p: PhotoRecord): Turn {
  const pose = p.measured_pose;
  const where = pose
    ? `위치 (${pose.position[0].toFixed(2)}, ${pose.position[1].toFixed(2)}) · 방향 ${Math.round(pose.yaw_deg)}° · 높이 ${pose.height_m.toFixed(2)}m`
    : "위치 모름";
  return { ...fresh(id, "phone", "사진 찍기"), state: "ok", label: "저장", answer: where, steps: [line("찍은 자리", where)], photo: p.url };
}

// ── 관찰과 판단 ──────────────────────────────────────────
// 판단마다 카드 하나: World State 변화·연결·판단 시점 줄을 쌓고, 판단 줄이 카드를 닫는다.
// YOLOX·VLM 기록은 프레임 번호로 짝을 지어, 둘 다 온 가장 새 프레임 하나를 지금·판정 두 줄에 보인다. 다른 프레임의 결과를 섞지 않는다.
// 실행 줄(판단 → 계획 → 실행 중 → 결과 확인 → 완료·실패)은 그 판단 카드(plan:pam-N → pam-N)에 쌓이고, 못 찾으면 지금 카드에 쌓인다.

/** 카드 하나에 둘 줄 수(오래된 줄부터 뺀다). */
const MAX_BRAIN_STEPS = 40;
/** 짝을 기다리는 프레임 수(오래된 것부터 뺀다). VLM 동시 요청 상한보다 넉넉하다. */
const MAX_HALF_FRAMES = 16;

/** observe 기록 하나를 프레임 짝에 넣는다. 짝이 차고 지금 짝보다 새 프레임이면 지금 짝을 바꾼다. */
function onObserve(t: Turn, e: Extract<BrainLog, { type: "observe" }>): Turn {
  const seen = e.yolo ?? (e.yolo_missing ? YOLO_MISSING[e.yolo_missing] : undefined);
  const judged = e.vlm ?? (e.vlm_missing ? VLM_MISSING[e.vlm_missing] : undefined);
  if (t.now?.frame_id === e.frame_id) return { ...t, now: { ...t.now, seen: seen ?? t.now.seen, judged: judged ?? t.now.judged } };
  const frames = t.frames ?? [];
  const old = frames.find((f) => f.frame_id === e.frame_id);
  const half: FrameHalf = { ...(old ?? { frame_id: e.frame_id, captured_at_ms: e.captured_at_ms }), ...(seen !== undefined ? { seen } : {}), ...(judged !== undefined ? { judged } : {}) };
  const rest = frames.filter((f) => f.frame_id !== e.frame_id);
  if (half.seen === undefined || half.judged === undefined) return { ...t, frames: [...rest, half].slice(-MAX_HALF_FRAMES) };
  const pair: FramePair = { frame_id: half.frame_id, captured_at_ms: half.captured_at_ms, seen: half.seen, judged: half.judged };
  if (t.now && pair.captured_at_ms < t.now.captured_at_ms) return { ...t, frames: rest };
  // 지금 짝보다 앞 프레임은 더 보일 일이 없으니 뺀다
  return { ...t, now: pair, frames: rest.filter((f) => f.captured_at_ms > pair.captured_at_ms) };
}

function onBrain(turns: Turn[], e: BrainLog): Turn[] {
  if (e.type === "execution") {
    const id = e.plan_id.replace(/^plan:/, "");
    const card = lastIndex(turns, (t) => t.source === "brain" && t.decision === id);
    if (card !== -1) return onExecution(turns, card, e);
  }
  let i = lastIndex(turns, (t) => t.source === "brain" && !t.ended);
  if (i === -1) {
    // 판단 줄이 닫은 카드에서 짝을 기다리던 프레임은 새 카드로 옮긴다
    const prev = lastIndex(turns, (t) => t.source === "brain");
    const frames = prev === -1 ? [] : turns[prev]!.frames ?? [];
    if (prev !== -1 && frames.length) turns = at(turns, prev, { ...turns[prev]!, frames: [] });
    turns = [...turns, { ...fresh(`b${turns.length}`, "brain", BRAIN_CARD.ask), label: BRAIN_CARD.watching, frames, ended: false }];
    i = turns.length - 1;
  }
  const t = turns[i]!;
  const add = (text: string, extra: { tone?: "fail" | "wait"; detail?: DecisionDetail } = {}) => ({ ...t, steps: [...t.steps, line("", text, { ...extra, mark: e.type })].slice(-MAX_BRAIN_STEPS) });
  switch (e.type) {
    case "observe":
      return at(turns, i, onObserve(t, e));
    case "decision": {
      const ok = e.status === "valid";
      const choice = ok ? e.action ?? BRAIN_CARD.wait : BRAIN_CARD.failed;
      const why = ok ? e.prediction?.reasoning : e.error;
      const detail: DecisionDetail = { text_sent: e.text_sent, world: e.world, memory_version: e.memory_version };
      const next = add(why ? `${choice} · ${why}` : choice, ok ? { detail } : { tone: "fail", detail });
      return at(turns, i, { ...next, ended: true, state: ok ? "ok" : "fail", label: choice, decision: e.id });
    }
    case "link":
      return at(turns, i, add(e.text, e.up ? {} : { tone: "fail" }));
    case "execution":
      return onExecution(turns, i, e);
    case "reflection":
      return at(turns, i, add(e.text, e.ok ? {} : { tone: "fail" }));
    case "world_change":
    case "trigger":
      return at(turns, i, add(e.text));
  }
}

/** 실행 줄을 카드 i의 단계로 쌓는다. 진행 중·끝 단계는 카드 알약을 바꾼다. */
function onExecution(turns: Turn[], i: number, e: Extract<BrainLog, { type: "execution" }>): Turn[] {
  const t = turns[i]!;
  const steps = [...t.steps, line("", e.text, { mark: e.type, ...(e.state === "failed" ? { tone: "fail" as const } : {}) })].slice(-MAX_BRAIN_STEPS);
  if (e.state === "decided") return at(turns, i, { ...t, steps });
  const state: TurnState = e.state === "done" ? "ok" : e.state === "failed" ? "fail" : "busy";
  return at(turns, i, { ...t, steps, state, label: EXEC_LABEL[e.state] });
}

function onMessage(turns: Turn[], m: ServerMessage): Turn[] {
  if (m.type === "agent") {
    const live = (session: string) => lastIndex(turns, (t) => t.session === session && t.state === "busy");
    if (m.event === "action") {
      const i = live(m.sessionId);
      if (i === -1) return [...turns, { ...sessionTurn(`m${turns.length}`, m.sessionId), steps: [{ kind: "action", action: m.action }] }];
      return at(turns, i, { ...turns[i]!, steps: [...turns[i]!.steps, { kind: "action", action: m.action }] });
    }
    if (m.event === "reply") {
      // 답에는 그 세션의 승인 대기가 모두 온다: 앞 카드에 이미 있는 것은 빼고 새 것만 이 카드에 둔다
      const known = new Set(turns.flatMap((t) => t.pending.map((p) => p.token)));
      const added = m.pendingConfirmations.filter((p) => !known.has(p.token));
      const i = live(m.sessionId);
      if (i === -1) return [...turns, finish({ ...sessionTurn(`m${turns.length}`, m.sessionId), ask: m.message }, m.reply, m.actions, added)];
      return at(turns, i, finish({ ...turns[i]!, ask: turns[i]!.ask || m.message }, m.reply, m.actions, added));
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

/** 서버 메시지 하나를 판단 기록에 반영한다. */
export function turnsReducer(turns: Turn[], message: ServerMessage): Turn[] {
  return onMessage(turns, message);
}
