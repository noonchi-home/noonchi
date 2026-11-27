// 밤 반성 화면 차례(순수 함수): 반성 자료(GET /api/reflection/:day) → 단계 순간 목록. 화면은 순간마다 holdMs 머문 뒤 다음으로 간다.
// 트윈: 1단계는 덩어리 방에 맞추고 그 방만 밝힌다. 2~6단계는 식탁 + 싱크대(고른 검사가 컵 치우기일 때). 0·7단계는 집 전체.
// 「FSM 바뀜」 칸: 지금 FSM(실선) 위에 후보(점선) → 날마다 뒤따름 수 → 채택 검사 숫자 → 바뀐 FSM(새 판본 그림 after_graph). 모델이 쓴 글은 쓰지 않는다.
import type { HabitFsm } from "../../../src/contract/habit.ts";
import type { FsmGraphData, ReflectionCheck, ReflectionDetail } from "../../../src/contract/reflection.ts";
import { headWithin } from "../../../src/shared/cut.ts";
import { atLeast, boundsOf, MIN_FOCUS, MIN_WATCH, type Bounds, type Px } from "./camera";
import type { RoomShape } from "./home";
import type { Vec3 } from "./plan-marks";
import { RW } from "./reflection-words";
import type { MarkTone, TraceMark } from "./trace-marks";

export type ReflectionStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** 트윈 표시 하나: 트레이스 표시 꼴에 그림 위 자리(px)와 정한 색. */
export type ReflectionMark = TraceMark & { px: Px; tone: MarkTone };
export type PaneLine = "solid" | "dashed";
/** current 지금 FSM 화살표, candidate 후보, adopted 채택돼 FSM에 들어감, rejected 채택되지 않음(뺀 후보 포함). */
export type PaneTone = "current" | "candidate" | "adopted" | "rejected";
export interface PaneEdge { key: string; from: string; to: string; line: PaneLine; tone: PaneTone; chips: string[] }
export interface FsmPaneState { step: string; states: string[]; edges: PaneEdge[] }
export interface ReflectionMoment { step: ReflectionStep; focus: Bounds | null; rooms: string[]; marks: ReflectionMark[]; pane: FsmPaneState; holdMs: number }
/** 트윈 자리: 방 모양, 식탁·싱크대(트윈 좌표와 그림 위 자리). 모르면 null. */
export interface ReflectionPlace { shapes: RoomShape[]; table: { at: Vec3; px: Px } | null; sink: { at: Vec3; px: Px } | null }

/** 단계마다 머무는 시간(ms). */
export const HOLD = { chunk: 1500, did: 2500, candidate: 2500, day: 1800, adopt: 3000, fsm: 3000, end: 2000, failed: 3000 };
/** 하루 묶기는 마지막 이만큼 덩어리, 날마다 셈은 마지막 이만큼 날. */
export const MAX_CHUNKS = 6;
export const MAX_DAYS = 8;

/** 트윈을 식탁·싱크대에 맞추는 행동(컵을 다루는 일). */
const TABLE_ACTION = "컵 치우기";
const ANY = "*";
const md = (day: string) => `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일`;
const hm = (t: string) => headWithin(t, 5);
const sec = (t: string) => { const [h = 0, m = 0, s = 0] = t.split(":").map(Number); return h * 3600 + m * 60 + s; };
const gap = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}분${s % 60 ? ` ${s % 60}초` : ""}` : `${s}초`);
const stateName = (id: string) => RW.stateName[id] ?? RW.newState;
/** 지금 FSM 화살표: (출발, 도착) 쌍마다 하나, 그 쌍의 행동 목록을 들고 있다(배운 화살표가 바꾼 행동을 지울 때 쓴다). */
type Base = PaneEdge & { actions: (string | null)[] };

/** 대시보드가 받은 지금 FSM(habit 메시지)의 그림 자료. 조건 글(trigger)은 버린다. */
export function graphOf(h: HabitFsm | null): FsmGraphData | null {
  return h && { states: h.states.map((s) => s.id), edges: h.transitions.map(({ from, to, action }) => ({ from, to, action })) };
}

function baseOf(graph: FsmGraphData | null): Base[] {
  const out = new Map<string, Base>();
  for (const e of graph?.edges ?? []) {
    const key = `cur:${e.from}>${e.to}`;
    const was = out.get(key);
    if (was) was.actions.push(e.action);
    else out.set(key, { key, from: e.from, to: e.to, line: "solid", tone: "current", chips: [], actions: [e.action] });
  }
  return [...out.values()];
}
const plain = (b: readonly Base[]): PaneEdge[] => b.map(({ actions: _, ...e }) => ({ ...e, chips: [...e.chips] }));
/** 쌍 (from, to)의 행동 목록에서 action 하나를 지우고, 비면 그 화살표를 뺀다. */
function dropAction(b: Base[], from: string, to: string, action: string): Base[] {
  return b.flatMap((e) => {
    if (e.from !== from || e.to !== to) return [e];
    const i = e.actions.indexOf(action);
    if (i === -1) return [e];
    const actions = e.actions.filter((_, j) => j !== i);
    return actions.length ? [{ ...e, actions }] : [];
  });
}

/** 0단계: 대시보드가 받은 지금 FSM 그림. 반성이 끝날 때까지 머문다. */
export function startMoment(graph: FsmGraphData | null): ReflectionMoment {
  return { step: 0, focus: null, rooms: [], marks: [], holdMs: Infinity, pane: { step: RW.step.start, states: graph?.states ?? [], edges: plain(baseOf(graph)) } };
}
/** 반성 실패·자료를 못 받음: 끝 순간 하나(지금 FSM 그림에 「반성 실패」, 기억 검사를 못 지났으면 「반성 기억 안 씀」). */
export function failedMoment(graph: FsmGraphData | null, rejected: boolean): ReflectionMoment {
  return { step: 7, focus: null, rooms: [], marks: [], holdMs: HOLD.failed, pane: { step: rejected ? RW.step.rejected : RW.step.failed, states: graph?.states ?? [], edges: plain(baseOf(graph)) } };
}

/** 그 검사의 발생 가운데 day까지(없으면 전부): n 못 봄 아닌 수, k 따라온 수, u 못 봄 수. */
function counts(c: ReflectionCheck, day?: string): { n: number; k: number; u: number } {
  const ms = c.moments.filter((m) => day === undefined || m.day <= day);
  return { n: ms.filter((m) => m.verdict !== "unseen").length, k: ms.filter((m) => m.verdict === "followed").length, u: ms.filter((m) => m.verdict === "unseen").length };
}
const countChips = ({ n, k, u }: { n: number; k: number; u: number }) =>
  n + u > 0 ? [RW.followCount(k, n), ...(u > 0 ? [RW.unseenCount(u)] : [])] : [];

export function reflectionMoments(d: ReflectionDetail, place: ReflectionPlace): ReflectionMoment[] {
  if (d.state !== "done") return [failedMoment(d.graph, d.rejected)];
  const states = [...d.graph.states];
  for (const id of [...d.candidates.flatMap((c) => [c.state, c.to ?? ANY]), ...d.dropped.flatMap((x) => [x.from, x.to]), ...d.learned.flatMap((x) => [x.from, x.to])]) {
    if (id !== ANY && !states.includes(id)) states.push(id);
  }
  const base = baseOf(d.graph);
  const checkOf = (c: { state: string; to: string | null; action: string }) => d.checks.find((x) => x.state === c.state && x.to === c.to && x.action === c.action) ?? null;
  const candKey = (c: { state: string; to: string | null; action: string }) => `cand:${c.state}>${c.to ?? ANY}:${c.action}`;
  const dropReason = (x: ReflectionDetail["dropped"][number]) =>
    x.p !== null ? RW.chance(x.p) : x.fired !== null && x.seen !== null ? RW.followCount(x.fired, x.seen) : RW.dropReason[x.reason];
  const drops: PaneEdge[] = d.dropped.map((x) => ({ key: `drop:${x.from}>${x.to}:${x.action}`, from: x.from, to: x.to, line: "dashed", tone: "rejected", chips: [x.action, dropReason(x)] }));
  const cands = (chips: (c: ReflectionDetail["candidates"][number]) => string[], tone: (c: ReflectionDetail["candidates"][number]) => PaneTone = () => "candidate"): PaneEdge[] =>
    d.candidates.map((c) => ({ key: candKey(c), from: c.state, to: c.to ?? ANY, line: "dashed", tone: tone(c), chips: chips(c) }));
  const pane = (step: string, edges: PaneEdge[]): FsmPaneState => ({ step, states: [...states], edges: edges.map((e) => ({ ...e, chips: [...e.chips] })) });

  // 트윈: 고른 검사(통과한 것, 없으면 첫 검사)가 컵 치우기일 때만 식탁·싱크대에 맞추고 표시한다
  const pick = d.checks.find((c) => c.passed) ?? d.checks[0] ?? null;
  const onTable = pick?.action === TABLE_ACTION;
  const tableFocus = onTable ? atLeast(boundsOf([place.table?.px, place.sink?.px].filter((p): p is Px => !!p)), MIN_FOCUS) : null;
  let serial = 0;
  const mark = (kind: TraceMark["kind"], spot: { at: Vec3; px: Px } | null, text: string, tone: MarkTone): ReflectionMark[] =>
    onTable && spot ? [{ rowId: `reflect:${++serial}`, kind, at: spot.at, px: spot.px, text, state: "done", tone }] : [];
  const out: ReflectionMoment[] = [];

  // 1) 하루 묶기: 같은 방·같은 상태가 이어지면 한 덩어리, 마지막 MAX_CHUNKS개
  const merged: { start: string; end: string; state: string | null; room: string | null }[] = [];
  for (const c of d.chunks) {
    const last = merged.at(-1);
    if (last && last.room === c.room && last.state === c.state) last.end = c.end;
    else merged.push({ ...c });
  }
  for (const c of merged.slice(-MAX_CHUNKS)) {
    const shape = c.room ? place.shapes.find((s) => s.id === c.room) : undefined;
    const text = c.state ? RW.tagChunk(hm(c.start), hm(c.end), stateName(c.state)) : RW.tagChunkTime(hm(c.start), hm(c.end));
    out.push({
      step: 1, holdMs: HOLD.chunk,
      focus: shape ? atLeast(boundsOf([...shape.floor, ...shape.top]), MIN_WATCH) : null,
      rooms: shape ? [shape.id] : [],
      marks: shape ? [{ rowId: `reflect:${++serial}`, kind: "spot", at: [0, 0, 0], px: shape.center, text, state: "done", tone: "default" }] : [],
      pane: pane(RW.step.chunk, plain(base)),
    });
  }

  // 2) 그날 사람이 한 일: 고른 검사 행동의 마지막 것(싱크대)
  const did = pick ? d.did.filter((x) => x.action === pick.action).at(-1) : undefined;
  out.push({
    step: 2, holdMs: HOLD.did, focus: tableFocus, rooms: [],
    marks: did ? mark("spot", place.sink, RW.tagDid(hm(did.at), did.action, did.via === "person" ? RW.didPerson : RW.didAnswer), "success") : [],
    pane: pane(RW.step.did, plain(base)),
  });

  // 3) 후보: 점선과 「행동?」, 뺀 후보는 회색 점선과 까닭
  out.push({
    step: 3, holdMs: HOLD.candidate, focus: tableFocus, rooms: [],
    marks: pick ? mark("goal", place.table, RW.tagCandidate(pick.action), "brand") : [],
    pane: pane(RW.step.candidate, [...plain(base), ...cands((c) => [RW.maybe(c.action)]), ...drops]),
  });

  if (d.checks.length) {
    // 4) 날마다 셈: 발생 날 차례로(마지막 MAX_DAYS일, 그 앞 날은 첫 날 수에 들어간다)
    const days = [...new Set(d.checks.flatMap((c) => c.moments.map((m) => m.day)))].sort().slice(-MAX_DAYS);
    for (const day of days) {
      const today = pick ? pick.moments.filter((m) => m.day === day) : [];
      const followed = today.find((m) => m.verdict === "followed");
      const last = today.at(-1);
      const marks = !pick ? []
        : followed ? [...mark("goal", place.table, RW.tagCandidate(pick.action), "brand"),
          ...mark("spot", place.sink, RW.tagFollowed(md(day), gap(sec(followed.action_at!) - sec(followed.at))), "success")]
          : last ? mark("goal", place.table, last.verdict === "answered_no" ? RW.tagAnsweredNo(md(day)) : last.verdict === "unseen" ? RW.tagUnseen(md(day)) : RW.tagNotFollowed(md(day)), "default")
            : [];
      out.push({
        step: 4, holdMs: HOLD.day, focus: tableFocus, rooms: [], marks,
        pane: pane(RW.step.count, [...plain(base), ...cands((c) => { const x = checkOf(c); return [RW.maybe(c.action), ...(x ? countChips(counts(x, day)) : [])]; }), ...drops]),
      });
    }

    // 5) 채택 검사: 숫자와 기준, 못 지난 후보는 회색
    out.push({
      step: 5, holdMs: HOLD.adopt, focus: tableFocus, rooms: [],
      marks: pick ? mark("goal", place.table, RW.tagAdopted(pick.passed, pick.action), pick.passed ? "success" : "default") : [],
      pane: pane(RW.step.adopt, [...plain(base), ...cands((c) => {
        const x = checkOf(c);
        return [RW.maybe(c.action), ...(x ? [...countChips({ n: x.n, k: x.k, u: x.unknown }), RW.checkLine(x.rate, d.rate_min, x.p_value, d.alpha, x.passed)] : [])];
      }, (c) => (checkOf(c)?.passed ? "candidate" : "rejected")), ...drops]),
    });

    // 6) FSM 바뀜: 배운 화살표는 실선, 반성이 저장한 새 판본(after_graph)에 없는 지금 화살표는 지운다, 못 지난 후보는 숫자 까닭만
    const learnedOf = (c: { state: string; to: string | null; action: string }) => d.learned.find((l) => l.from === c.state && l.to === (c.to ?? ANY) && l.action === c.action);
    let after: Base[];
    if (d.after_graph) {
      after = baseOf(d.after_graph);
      for (const l of d.learned) after = dropAction(after, l.from, l.to, l.action);
    } else {
      after = base.map((e) => ({ ...e, actions: [...e.actions] }));
      for (const l of d.learned) if (l.was) after = dropAction(after, l.from, l.was_to ?? l.to, l.was);
    }
    const sixth: PaneEdge[] = d.candidates.flatMap((c): PaneEdge[] => {
      const x = checkOf(c);
      if (learnedOf(c) && d.after) return [{ key: candKey(c), from: c.state, to: c.to ?? ANY, line: "solid", tone: "adopted", chips: [c.action, RW.from(md(d.after.applies_day))] }];
      if (x?.passed) return [];
      return [{ key: candKey(c), from: c.state, to: c.to ?? ANY, line: "dashed", tone: "rejected",
        chips: [c.action, ...(x ? [x.rate < d.rate_min ? RW.followCount(x.k, x.n) : RW.chance(x.p_value)] : [])] }];
    });
    const fsm = pane(RW.step.fsm, [...plain(after), ...sixth, ...drops]);
    out.push({
      step: 6, holdMs: HOLD.fsm, focus: tableFocus, rooms: [],
      marks: pick && learnedOf(pick) && d.after ? mark("goal", place.table, RW.tagFrom(md(d.after.applies_day), pick.action), "success") : [],
      pane: fsm,
    });
    out.push({ step: 7, holdMs: HOLD.end, focus: null, rooms: [], marks: [], pane: pane(RW.step.end, fsm.edges) });
  } else {
    out.push({ step: 7, holdMs: HOLD.end, focus: null, rooms: [], marks: [], pane: pane(RW.step.end, out.at(-1)!.pane.edges) });
  }
  return out;
}
