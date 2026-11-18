// 시간 줄 카드 자료(순수 함수): 대시보드 자료(data.ts) → 사람 · 로봇 두 줄의 구간(ms 시각)과 사람이 떠난 때 → 첫 명령 간격.
// 숫자는 모두 서버 자료에서 온다: 사람 줄은 유효한 판단의 습관 FSM 상태와 그 판단 시각(people), 로봇 줄은 계획 단계의 started_ms·ended_ms(실행 추적이 단다),
// 간격은 목표의 사람이 떠난 때(gone_ms)와 첫 단계 시작. 계획 밖 로봇은 지켜봄이다. 예상 줄(목표 구간·글)은 없다(2026-11-19 사용자 「예상을 없애자」).
// 그리기(지금이 오른쪽 끝, 초 눈금)는 TimelineCard가 한다.
import type { PlanView } from "../../../src/contract/plan.ts";
import { isOpen, type DashData } from "./data";
import { WORDS } from "./words";

export type TimelineRow = "person" | "robot";
/** 구간 색: plain 카드 바탕(지켜봄), muted 옅은 바탕(사람 상태·지난 단계), brand 빨강(지금 단계). */
export type SpanTone = "plain" | "muted" | "brand";
/** 구간 하나: from 시작(보이는 때보다 앞이면 -Infinity), to 끝(아직이면 null). */
export interface TimeSpan { id: string; row: TimelineRow; from: number; to: number | null; text: string; tone: SpanTone }
export interface TimelineData {
  spans: TimeSpan[];
  /** 사람이 떠난 때 → 그 뒤 같은 행동 계획의 첫 명령(첫 단계 시작) 간격 「N.N초」. 없으면 null. */
  gap: { from: number; to: number; text: string } | null;
}

/** 사람 줄: 상태가 바뀐 때마다 구간(마지막은 지금까지). 습관 그림에 이름이 없는 상태는 그리지 않는다. */
function personSpans(s: DashData): TimeSpan[] {
  const name = (id: string) => s.habit?.states.find((x) => x.id === id)?.name ?? null;
  return s.people.flatMap((p, i) => {
    const text = name(p.state);
    return text ? [{ id: `person:${p.at_ms}`, row: "person" as const, from: p.at_ms, to: s.people[i + 1]?.at_ms ?? null, text, tone: "muted" as const }] : [];
  });
}

/** 로봇 줄: 시작한 계획 단계(지금 단계는 brand)와 그 사이 지켜봄. */
function robotSpans(plans: PlanView[]): TimeSpan[] {
  const busy: TimeSpan[] = plans.flatMap((p) => p.steps.flatMap((x) => {
    if (x.started_ms === undefined) return [];
    const to = x.ended_ms ?? (isOpen(p) ? null : undefined);
    if (to === undefined) return [];
    const tone: SpanTone = to === null && x.status === "active" ? "brand" : "muted";
    return [{ id: `${p.id}:${x.id}`, row: "robot" as const, from: x.started_ms, to, text: x.label, tone }];
  })).sort((a, b) => a.from - b.from);
  const out: TimeSpan[] = [];
  let free = Number.NEGATIVE_INFINITY;
  const watch = (from: number, to: number | null) => out.push({ id: `watch:${from}`, row: "robot", from, to, text: WORDS.timeline.watch, tone: "plain" });
  for (const b of busy) {
    if (b.from > free) watch(free, b.from);
    out.push(b);
    free = b.to === null ? Number.POSITIVE_INFINITY : Math.max(free, b.to);
  }
  if (free !== Number.POSITIVE_INFINITY) watch(free, null);
  return out;
}

/** 사람이 떠난 때 → 그 뒤 첫 명령: 목표 행동과 같은 계획 가운데 첫 단계가 떠난 뒤 가장 먼저 시작한 것. */
function gapOf(s: DashData): TimelineData["gap"] {
  const g = s.goal;
  if (!g || g.gone_ms === null) return null;
  const gone = g.gone_ms;
  const first = s.plans.flatMap((p) => {
    const at = p.steps[0]?.started_ms;
    return p.goal === g.action && at !== undefined && at >= gone ? [at] : [];
  }).sort((a, b) => a - b)[0];
  return first === undefined ? null : { from: gone, to: first, text: WORDS.timeline.gap(((first - gone) / 1000).toFixed(1)) };
}

/** 시간 줄 자료. 사람 상태를 모르면(첫 판단 전) null이고 카드를 두지 않는다. */
export function timelineOf(s: DashData): TimelineData | null {
  if (!s.people.length) return null;
  return { spans: [...personSpans(s), ...robotSpans(s.plans)], gap: gapOf(s) };
}

/** 자료 가운데 가장 늦은 시각(가짜 단계 화면은 이 때를 지금으로 그린다). 없으면 null. */
export function timelineLast(s: DashData): number | null {
  const g = s.goal;
  const all = [
    ...s.people.map((p) => p.at_ms),
    ...(g ? [g.armed_ms, g.ready_ms, g.gone_ms, g.fired_ms] : []),
    ...s.plans.flatMap((p) => p.steps.flatMap((x) => [x.started_ms, x.ended_ms])),
  ].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return all.length ? Math.max(...all) : null;
}
