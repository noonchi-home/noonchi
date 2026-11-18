// 트윈 위 말풍선 목록(순수 리듀서). 에이전트가 판단하면서 확인한 기기와 클로이드가 지금 보는 자리만 담는다.
// 에이전트: 이번 요청에서 다룬 기기마다 한 줄(번호는 처음 다룬 차례). 새 요청이 시작되면 지운다.
// 판단·확인 표시(두뇌 줄 하나)는 판단을 내린 자리가 아니라 지금 그 대상이 있는 자리(spotOf)를 따라간다(2026-11-18 사용자 지적):
// 열린 판단 계획이면 지금 단계의 자리에 「확인」, 계획이 없으면 관찰 기록이 오는 동안 지켜보는 대상의 지금 자리에 「지켜봄」(메모는 마지막 YOLO 글).
// 마지막 기록 뒤 30초가 지나면 「지켜봄」을 지운다. 접속 때 다시 온 옛 기록(replay)은 넣지 않는다.
import type { AgentAction, BrainLog, PendingView, ServerMessage } from "../../../../src/contract/events.ts";
import type { PlanView } from "../../../../src/contract/plan.ts";
import type { EyeEvent } from "../../../../src/contract/events.ts";
import type { WorldObject, WorldView } from "../../../../src/contract/world.ts";
import { STATE_TEXT } from "../../../../src/world/labels.ts";
import { CLASSES } from "../../../../src/world/vocab.ts";
import { TASKS } from "../../../../src/act/tasks.ts";

export type CheckVerb = "확인" | "바꿈" | "승인 대기" | "실패" | "취소" | "지켜봄";

export type Check = {
  key: string;
  /** 이번 요청 안에서 처음 다룬 차례(1부터). */
  order: number;
  source: "agent" | "brain";
  deviceId?: string;
  /** 물건 id. 두뇌 줄은 checkList가 지금 자리(spotOf) id를 채운다(장면 물건 id 또는 spot:로 시작하는 자리). */
  objectId?: string;
  /** 장면 물건이 아닌 자리(폰 눈·World State 물건)의 트윈 자리 [x, 높이, y]. 있으면 이 자리에 붙는다. */
  pos?: [number, number, number];
  /** 장면 이름이 없는 자리의 이름(물건 종류·폰 눈 방). */
  label?: string;
  verb: CheckVerb;
  /** 관찰 기록 YOLO 글(확신 숫자 포함, 개발용 보기에서만 보인다). */
  note?: string;
  /** 로봇이 믿는 상태 한 줄(숫자 없음, beliefOf). */
  belief?: string;
  at: number;
  /** 승인 대기 표(취소 알림은 표만 온다). */
  token?: string;
};

export interface ChecksState {
  turn: Check[];
  /** 지금 열린 판단·task planner 계획이 있으면 그 「확인」 줄 하나(자리는 checkList가 지금 단계 자리로 채운다). 계획이 끝나면 지운다. */
  plan: Check[];
  /** 마지막 두뇌 계획의 act 단계 대상 id(장면 물건이나 World State 물건). 계획이 없을 때 지켜보는 대상이다. */
  targets?: string[];
  /** 마지막 유효 판단의 행동(대기면 null). 대상이 없을 때 그 행동의 대상 종류를 본다. */
  action?: string | null;
  brain: Check[];
  brainAt: number | null;
  /** 진행 중인 요청의 세션. null이면 다음 에이전트 이벤트가 새 요청이다. */
  open: string | null;
  /** 마지막 World State(식탁 줄의 믿는 상태를 쓴다). */
  world?: WorldView | null;
}

export type ChecksEvent =
  | { type: "message"; message: ServerMessage; now: number }
  | { type: "ask"; now: number }
  | { type: "tick"; now: number };

export const EMPTY_CHECKS: ChecksState = { turn: [], plan: [], brain: [], brainAt: null, open: null };

/** 마지막 관찰 기록 뒤 이만큼 지나면 식탁 줄을 지운다. */
export const BRAIN_TTL_MS = 30_000;

/** 상태를 읽기만 하는 도구. 나머지는 바꾸는 도구다. */
const READ_TOOLS = new Set(["list_rooms", "list_devices", "find_devices", "get_state", "find_objects", "find_object_types"]);

function verbOf(a: AgentAction): CheckVerb {
  if (a.needsConfirmation) return "승인 대기";
  if (!a.ok) return "실패";
  return READ_TOOLS.has(a.tool) ? "확인" : "바꿈";
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

/** 메모: 관찰 기록의 YOLO 글(감지 없음 포함). 다른 기록이면 null. */
function noteOf(e: BrainLog): string | null {
  return e.type === "observe" ? e.yolo : null;
}

/** 화면 이름 → 낱말 표 종류(YOLO 글은 화면 이름으로 온다). */
const CLASS_OF_LABEL: Record<string, string> = Object.fromEntries(Object.entries(CLASSES).map(([k, c]) => [c.label, k]));

/** 식탁 줄의 믿는 상태: YOLO 글에 나온 종류마다 「사람 마시는 중」(하는 일, 없으면 자세, 그것도 없으면 보임), 「컵 내용물 있음」(확인된 물건의 안·자리, 없으면 보임),
 *  확인된 물건이 없는 종류는 「컵 확인 중」. 숫자는 쓰지 않는다. YOLO 글이 없거나 감지가 없으면 undefined. */
export function beliefOf(yolo: string | undefined, world: WorldView | null | undefined): string | undefined {
  const labels = [...new Set((yolo ?? "").split("·").map((p) => p.trim().split(/\s+/)[0] ?? "").filter((l) => CLASS_OF_LABEL[l]))];
  if (!labels.length) return undefined;
  return labels.map((label) => {
    const cls = CLASS_OF_LABEL[label]!;
    if (cls === "person") {
      const f = world?.person.facts;
      const v = f?.activity?.value ?? f?.posture?.value;
      return `${label} ${v ? STATE_TEXT[v] ?? v : "보임"}`;
    }
    const o = (world?.objects ?? []).filter((x) => x.cls === cls && x.status !== "gone").sort((a, b) => b.last_seen_ms - a.last_seen_ms)[0];
    if (!o) return `${label} 확인 중`;
    const v = o.facts.contents?.value ?? o.facts.place?.value;
    return `${label} ${v ? STATE_TEXT[v] ?? v : "보임"}`;
  }).join(" · ");
}

function onBrain(s: ChecksState, e: BrainLog, now: number): ChecksState {
  if (e.type === "decision" && e.status === "valid") s = { ...s, action: e.action };
  const prev = s.brain[0];
  const note = noteOf(e) ?? prev?.note;
  const belief = beliefOf(note, s.world);
  return { ...s, brainAt: now, brain: [{ key: "brain", order: 1, source: "brain", verb: "지켜봄", ...(note ? { note } : {}), ...(belief ? { belief } : {}), at: now }] };
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

/** 열린 판단·task planner 계획이면 「확인」 줄 하나(자리는 지금 단계 자리), 두뇌 계획의 act 단계 대상을 지켜보는 대상으로 남긴다.
 *  에이전트 기기 계획은 에이전트 줄이 이미 있어 넣지 않는다. */
function onPlan(s: ChecksState, p: PlanView | null, now: number): ChecksState {
  const brainPlan = !!p && p.source !== "agent";
  const targets = brainPlan ? [...new Set(p.steps.flatMap((x) => (x.kind === "act" && x.target?.objectId ? [x.target.objectId] : [])))] : s.targets;
  const open = brainPlan && (p.status === "planned" || p.status === "running");
  const next = targets === s.targets ? s : { ...s, targets };
  if (!open) return next.plan.length ? { ...next, plan: [] } : next;
  return { ...next, plan: [{ key: "plan", order: 1, source: "brain", verb: "확인", at: s.plan[0]?.at ?? now }] };
}

/** 판단·확인 표시가 붙을 자리: 장면 물건·가전 id(device면 가전)이거나, 트윈 자리 at(폰 눈 spot:eye, World State 물건 spot:<id>)과 이름. */
export interface Spot { id: string; device?: true; at?: [number, number, number]; label?: string }

/** 폰 눈 자리 표시 높이(m): 손에 든 물건 높이쯤. */
const EYE_MARK_H = 0.9;

/**
 * 판단·확인 표시 자리(2026-11-18 사용자 지적: 컵을 들고 싱크대에 왔는데 표시는 판단을 내린 식탁에 남았다). 판단을 내린 자리가 아니라 지금 그 대상이 있는 자리다.
 * - 열린 계획: 지금 단계(active, 없으면 첫 pending)의 대상: 가는 곳·넣는 곳(장면 물건), 가전, 집는 물건(World State 물건이면 그 물건의 지금 자리).
 *   대상이 없는 단계(묻기·기다리기)는 폰 눈.
 * - 계획이 없으면: 지켜보는 대상(마지막 두뇌 계획의 act 대상 가운데 World State 물건, 없으면 마지막 판단 행동의 대상 종류 중 가장 최근에 본 물건)의 지금 자리.
 *   대상이 없는 대기 판단이면 폰 눈.
 * - World State 물건의 지금 자리: 손에 있으면(확인됨) 폰 눈, 장면 면 위면 그 면, 아니면 그 물건 자리. 폰 눈을 모르면 null(표시 없음).
 * scene: 장면 물건·가전 id인가(트윈 고리가 있다).
 */
export function spotOf(o: {
  plan: PlanView | null; world: WorldView | null | undefined; eye: Pick<EyeEvent, "position"> | null; scene: (id: string) => boolean;
  targets: readonly string[]; action: string | null;
}): Spot | null {
  const eye: Spot | null = o.eye
    ? { id: "spot:eye", at: [o.eye.position[0], EYE_MARK_H, o.eye.position[1]], ...(o.world?.eye?.room_label ? { label: o.world.eye.room_label } : {}) }
    : null;
  const objects = (o.world?.objects ?? []).filter((x) => x.status !== "gone");
  const thingAt = (x: WorldObject): Spot | null => {
    const label = CLASSES[x.cls as keyof typeof CLASSES]?.label ?? x.cls;
    if (x.facts.place?.value === "in_hand" && x.facts.place.certainty === "confirmed") return eye && { ...eye, label };
    if (x.surface && o.scene(x.surface)) return { id: x.surface };
    if (x.position) return { id: `spot:${x.id}`, at: [...x.position] as [number, number, number], label };
    return eye && { ...eye, label };
  };
  const plan = o.plan && (o.plan.status === "planned" || o.plan.status === "running") ? o.plan : null;
  if (plan) {
    const step = plan.steps.find((x) => x.status === "active") ?? plan.steps.find((x) => x.status === "pending");
    const t = step?.target;
    if (t?.deviceId) return { id: t.deviceId, device: true };
    if (t?.objectId && o.scene(t.objectId)) return { id: t.objectId };
    const thing = t?.objectId ? objects.find((x) => x.id === t.objectId) : undefined;
    if (thing) return thingAt(thing);
    if (t?.position) return { id: `spot:${step!.id}`, at: [t.position[0], 0, t.position[1]], label: step!.label };
    return eye;
  }
  const kept = o.targets.map((id) => objects.find((x) => x.id === id)).find((x): x is WorldObject => !!x);
  const cls = o.action ? TASKS[o.action]?.target : undefined;
  const latest = cls ? objects.filter((x) => x.cls === cls).sort((a, b) => b.last_seen_ms - a.last_seen_ms)[0] : undefined;
  const thing = kept ?? latest;
  return thing ? thingAt(thing) : eye;
}

export function checksReducer(s: ChecksState, e: ChecksEvent): ChecksState {
  if (e.type === "ask") return { ...s, turn: [], open: null };
  if (e.type === "tick") return s.brainAt !== null && e.now - s.brainAt >= BRAIN_TTL_MS ? { ...s, brain: [], brainAt: null } : s;
  const m = e.message;
  if (m.type === "agent") {
    const next = onAgent(s, m, e.now);
    return next.turn === s.turn && next.open === s.open ? s : next;
  }
  if (m.type === "brain") return m.replay ? s : onBrain(s, m.event, e.now);
  if (m.type === "plan") return onPlan(s, m.plan, e.now);
  if (m.type === "world") {
    // 식탁 줄이 있으면 믿는 상태를 새 World State로 다시 쓴다
    const row = s.brain[0];
    const belief = row ? beliefOf(row.note, m.world) : undefined;
    return { ...s, world: m.world, ...(row ? { brain: [{ ...row, ...(belief ? { belief } : { belief: undefined }) }] } : {}) };
  }
  return s;
}

/** 그릴 목록: 이번 요청의 기기들, 판단·확인 표시 하나(열린 계획이면 「확인」, 아니면 「지켜봄」)를 지금 자리 spot(spotOf)에 붙인 것.
 *  자리가 없으면 표시를 뺀다. 같은 가전이 에이전트 줄에 있으면 한 번만. */
export function checkList(s: ChecksState, spot: Spot | null): Check[] {
  const row = s.plan[0] ?? s.brain[0];
  if (!row || !spot) return [...s.turn];
  const placed: Check = {
    ...row, ...(spot.device ? { deviceId: spot.id, objectId: undefined } : { objectId: spot.id }),
    ...(spot.at ? { pos: spot.at } : {}), ...(spot.label ? { label: spot.label } : {}),
  };
  const known = new Set(s.turn.map((c) => c.deviceId));
  return [...s.turn, ...(placed.deviceId && known.has(placed.deviceId) ? [] : [placed])];
}

/** 대시보드에 그릴 목록: 승인 대기 줄을 뺀다. 대시보드에는 승인을 기다리는 것을 보이지 않는다(승인은 실제 폰에서 한다). */
export function dashboardChecks(list: Check[]): Check[] {
  return list.filter((c) => c.verb !== "승인 대기");
}
