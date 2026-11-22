// 시간 줄 카드 자료(순수 함수): 대시보드 자료(data.ts) → 사람 · 로봇 두 줄의 구간(ms 시각)과 사람이 떠난 때 → 첫 명령 간격.
// 숫자는 모두 서버 자료에서 온다: 사람 줄은 서버 사람 상태(person 메시지, 받기 전에는 유효한 판단의 습관 FSM 상태와 그 판단 시각, people), 로봇 줄은 실행 전이의 since_ms(이전 기록은 계획 단계의 started_ms·ended_ms),
// 간격은 목표의 사람이 떠난 때(gone_ms)와 첫 단계 시작. 계획 밖 로봇은 지켜봄이다. 예상 줄(목표 구간·글)은 없다(2026-11-19 사용자 「예상을 없애자」).
// 그리기(지금이 오른쪽 끝, 초 눈금)는 TimelineCard가 한다.
import type { PlanView } from "../../../src/contract/plan.ts";
import { isOpen, type DashData } from "./data";
import { WORDS } from "./words";

export type TimelineRow = "person" | "robot";
export interface StatusRow {
  id: TimelineRow;
  previous: string | null;
  current: string | null;
  since: number | null;
}
/** 구간 색: plain 카드 바탕(지켜봄), muted 옅은 바탕(사람 상태·지난 단계), brand 빨강(지금 단계). */
export type SpanTone = "plain" | "muted" | "brand";
/** 구간 하나: from 시작(보이는 때보다 앞이면 -Infinity), to 끝(아직이면 null). */
export interface TimeSpan { id: string; row: TimelineRow; from: number; to: number | null; text: string; tone: SpanTone }
export interface TimelineData {
  spans: TimeSpan[];
  /** 사람이 떠난 때 → 그 뒤 같은 행동 계획의 첫 명령(첫 단계 시작) 간격 「N.N초」. 없으면 null. */
  gap: { from: number; to: number; text: string } | null;
}

/** 사람 줄: 상태가 바뀐 때마다 구간(마지막은 지금까지). 이름은 서버가 붙인 것, 없으면 습관 그림 이름이고 둘 다 없는 상태는 그리지 않는다. */
function personSpans(s: DashData): TimeSpan[] {
  const name = (id: string) => s.habit?.states.find((x) => x.id === id)?.name ?? null;
  const spans:TimeSpan[] = s.people.flatMap((p, i) => {
    const text = p.name ?? name(p.state);
    return text ? [{ id: `person:${p.at_ms}`, row: "person" as const, from: p.at_ms, to: s.people[i + 1]?.at_ms ?? null, text, tone: "muted" as const }] : [];
  });
  const g = s.goal;
  if (!g || g.checking_ms == null) return spans;
  const from = g.checking_ms;
  const until = g.confirmed_ms ?? null;
  if (g.status !== "checking" && until === null) return spans;
  const before = spans.filter(p=>p.from<from).map(p=>({...p,to:Math.min(p.to??from,from)}));
  const checking:TimeSpan = {id:"checking:"+g.id,row:"person",from,to:until,text:WORDS.timeline.checking,tone:"muted"};
  const after = until === null ? [] : spans.filter(p=>p.from>=from && (p.to===null || p.to>until))
    .map(p=>({...p,from:Math.max(p.from,until)}));
  return [...before,checking,...after];
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

type StatusChange = { text: string; from: number | null };

/** 같은 시각에 서로 다른 전이가 있을 수 있다. 같은 사건을 다시 받으면 첫 수신 위치를 보존한다. */
function distinctEvents<T>(events: readonly T[], keyOf: (event: T) => string): T[] {
  const seen = new Set<string>();
  return events.filter(event => {
    const key = keyOf(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** robot가 없는 기록에서만 계획을 쓴다. updatedAt은 판본 순서로만 쓰고 실제 전이 시각은 단계에서 읽는다. */
function robotChanges(dash: DashData): StatusChange[] {
  if (dash.robots.length) {
    const robots = distinctEvents(dash.robots, r => JSON.stringify([r.since_ms, r.state, r.step?.plan_id, r.step?.number, r.step?.label]));
    return robots.sort((a, b) => a.since_ms - b.since_ms).map(r => ({
      text: r.state === "run" && r.step ? r.step.label : WORDS.timeline.robot[r.state],
      from: r.since_ms,
    }));
  }
  const plans = [...dash.plans].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt)
    || (a.supersedes === b.id ? 1 : b.supersedes === a.id ? -1 : 0));
  const latest = plans.at(-1);
  const changes: StatusChange[] = [];
  let ended: number | null = null;
  for (const plan of plans) {
    for (const step of plan.steps) {
      if (step.status === "pending" || (step.status === "skipped" && step.started_ms === undefined)) continue;
      if (ended !== null && step.started_ms !== undefined && ended < step.started_ms) {
        changes.push({ text: WORDS.timeline.watch, from: ended });
      }
      changes.push({ text: step.label, from: step.started_ms ?? null });
      ended = step.ended_ms ?? null;
    }
  }
  const active = dash.plan && latest && isOpen(latest) && latest.steps.some(s => s.status === "active");
  if (changes.length && !active) changes.push({ text: WORDS.timeline.watch, from: ended });
  return changes;
}

export function currentStatusRowsOf(dash: DashData): StatusRow[] {
  function row(id: TimelineRow, changes: StatusChange[]): StatusRow {
    const result: StatusRow = { id, current: null, previous: null, since: null };
    for (const change of changes) {
      if (change.text === result.current) continue;
      result.previous = result.current;
      result.current = change.text;
      result.since = change.from;
    }
    return result;
  }
  const people = distinctEvents(dash.people, p => JSON.stringify([p.at_ms, p.state, p.name])).sort((a, b) => a.at_ms - b.at_ms);
  const person = personSpans({ ...dash, people });
  const user = row("person", person);
  // 이름 없는 상태나 확인 종료 뒤 새 관찰이 없으면 닫힌 구간을 현재로 되풀이하지 않는다.
  if (person.length && person.at(-1)!.to !== null) {
    user.previous = user.current;
    user.current = null;
    user.since = null;
  }
  return [user, row("robot", robotChanges(dash))];
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
  if (!s.people.length && s.goal?.status !== "checking") return null;
  const robot = s.robots.length ? s.robots.map((r, i): TimeSpan => ({
    id: `robot:${r.since_ms}:${r.state}:${r.step?.plan_id ?? ""}:${r.step?.number ?? ""}`, row: "robot",
    from: r.since_ms, to: s.robots[i + 1]?.since_ms ?? null, text: r.step?.label ?? WORDS.timeline.robot[r.state],
    tone: r.state === "idle" ? "plain" : i === s.robots.length - 1 ? "brand" : "muted",
  })) : robotSpans(s.plans);
  return { spans: [...personSpans(s), ...robot], gap: gapOf(s) };
}

/** 자료 가운데 가장 늦은 시각(가짜 단계 화면은 이 때를 지금으로 그린다). 없으면 null. */
export function timelineLast(s: DashData): number | null {
  const g = s.goal;
  const all = [
    ...s.people.map((p) => p.at_ms),
    ...s.robots.map((r) => r.since_ms),
    ...(g ? [g.armed_ms, g.ready_ms, g.gone_ms, g.checking_ms, g.confirmed_ms, g.fired_ms] : []),
    ...s.plans.flatMap((p) => p.steps.flatMap((x) => [x.started_ms, x.ended_ms])),
  ].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return all.length ? Math.max(...all) : null;
}
