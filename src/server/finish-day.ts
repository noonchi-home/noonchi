// 하루 마치기(POST /api/day/finish): 막기 규칙, 지금 날짜 상태, 진행 중인 일, 반성 잠금, 차례(finishDayRunner). 실제 의존은 src/server/start.ts가 넣는다.
import { calendarDay, DAY_TEXT, REFLECT_TEXT, type HistoryDb, type ReflectResult } from "../brain/index.js";
import type { BrainLog } from "../contract/events.js";
import type { DayView, FinishResult } from "../contract/reflection.js";
import type { ControlMode } from "../contract/setup.js";
import { HttpError } from "./routes/kit.js";

type ReflectionEvent = Extract<BrainLog, { type: "reflection" }>;

export interface FinishState { enabled: boolean; mode: ControlMode; closing: boolean; reflecting: boolean; today: string; day: string; busy: boolean }

export function finishBlock(s: FinishState): { status: 404 | 409; error: string } | null {
  if (!s.enabled) return { status: 404, error: DAY_TEXT.off };
  if (s.mode === "live") return { status: 409, error: DAY_TEXT.live };
  if (s.closing || s.reflecting) return { status: 409, error: REFLECT_TEXT.running };
  if (s.day !== s.today) return { status: 409, error: DAY_TEXT.notToday(s.today) };
  if (s.busy) return { status: 409, error: DAY_TEXT.busy };
  return null;
}

export function dayViewOf(db: Pick<HistoryDb, "dayOf" | "skips" | "offsetMinutes">, now: number, finish: boolean, closing: boolean): DayView {
  return { today: db.dayOf(now), real_today: calendarDay(now, db.offsetMinutes), shift: db.skips().filter((s) => s.atMs <= now).length, finish, closing };
}

/** 시스템 날짜를 다시 보는 간격(ms): 달력 자정이 지나면 이 안에 대시보드에 새 오늘을 보낸다. */
export const DAY_CHECK_MS = 60_000;

/** day 메시지 보내기: 보낸 오늘을 기억하고, check()는 시스템 날짜가 바뀌었을 때만 보낸다(DAY_CHECK_MS마다 부른다). */
export function dayBroadcast(o: { view: () => DayView; send: (day: DayView) => void }): { send(): void; check(): void } {
  let sent = o.view().today;
  const send = () => { const day = o.view(); sent = day.today; o.send(day); };
  return { send, check: () => { if (o.view().today !== sent) send(); } };
}

/** 진행 중인 일: 열린 계획, 세운·확인 중·떠남 목표, 확인 방문, 답을 기다리는 판단, 습관 방문, 사용자 찾기. */
export interface BusyState { plan: { status: string } | null; goal: { status: string } | null; checking: boolean; deciding: number; habitVisit: boolean; roomVisit: boolean }
export function busyNow(s: BusyState): boolean {
  const open = s.plan !== null && (s.plan.status === "planned" || s.plan.status === "running");
  const goal = s.goal !== null && (s.goal.status === "armed" || s.goal.status === "checking" || s.goal.status === "fired");
  return open || goal || s.checking || s.deciding > 0 || s.habitVisit || s.roomVisit;
}

/** 집 묶음(HomeCore)에서 진행 중인 일을 읽는 칸. */
export interface BusyCore {
  plans: { current(): { status: string } | null };
  goal: { status: string } | null;
  checkingVisit: unknown;
  decider?: { inflight(): number } | null;
  habitWatch?: { waiting(): boolean };
  roomWatch?: { isBusy(): boolean };
}
export const homeBusy = (c: BusyCore): boolean => busyNow({
  plan: c.plans.current(), goal: c.goal, checking: c.checkingVisit !== null, deciding: c.decider?.inflight() ?? 0,
  habitVisit: c.habitWatch?.waiting() ?? false, roomVisit: c.roomWatch?.isBusy() ?? false,
});

/** 넘긴 뒤(HomeRuntime.dayMoved): 판단 기억·도움 습관을 새로 읽고, 넘기기 전 반성이 배운 것을 말풍선에 넘긴다. */
export function homeDayMoved(c: { invalidateMemory(): void; routinesChanged(): void }, event: ReflectionEvent | null, speak: (event: ReflectionEvent) => void): void {
  c.invalidateMemory();
  c.routinesChanged();
  if (event) speak(event);
}

/** 반성 잠금: 반성 중이면 막고, 하루 마치기 중이면 그 반성(finish)만 지난다(쓰기 비우기를 기다리는 동안 23:30 타이머·POST /api/reflection/run이 먼저 잡지 않게). */
export const reflectBlocked = (s: { reflecting: boolean; closing: string | null; finish: boolean }): boolean => s.reflecting || (s.closing !== null && !s.finish);

export interface FinishDeps {
  enabled: boolean;
  mode: () => ControlMode;
  /** 지금 시스템 날짜(db.dayOf(now)). */
  today: () => string;
  reflecting: () => boolean;
  busy: () => boolean;
  /** 판단·습관 방문 멈춤(HomeRuntime.hold). */
  hold: (on: boolean) => void;
  flush: () => Promise<void>;
  reflect: (day: string) => Promise<ReflectResult>;
  /** 넘김과 새 날 판본 고정(write.finishDay). */
  skip: (day: string) => Promise<{ from: string; to: string; version: number }>;
  /** 넘긴 뒤: 판단 기억·도움 습관 새로 읽기, 넘기기 전 반성이 배운 것을 말풍선이 말한다(HomeRuntime.dayMoved). */
  moved: (event: ReflectionEvent | null) => void;
  /** 하루 마치기 밖의 반성 사건(HomeRuntime.onReflection). */
  speak: (event: ReflectionEvent) => void;
  sendDay: () => void;
  log: (line: string) => void;
}
export interface FinishRunner { run(day: string): Promise<FinishResult>; closing(): string | null; onReflection(event: ReflectionEvent): void }

export function finishDayRunner(d: FinishDeps): FinishRunner {
  let closing: string | null = null;
  let last: ReflectionEvent | null = null;
  return {
    closing: () => closing,
    // 하루 마치기 중이면 말풍선은 넘긴 뒤에 말한다(「어제 기록으로…」가 맞게)
    onReflection(event) { last = event; if (closing === null) d.speak(event); },
    async run(day) {
      const blocked = finishBlock({ enabled: d.enabled, mode: d.mode(), closing: closing !== null, reflecting: d.reflecting(), today: d.today(), day, busy: d.busy() });
      if (blocked) throw new HttpError(blocked.status, blocked.error);
      closing = day;
      d.hold(true);
      d.sendDay();
      try {
        await d.flush();
        const r = await d.reflect(day);
        // 실패 까닭은 모델이 쓴 글(뜻 검사 거절)일 수 있어 서버 로그에만 남기고, 응답은 고정 글이다
        if (!r.ok) {
          d.log(DAY_TEXT.failedLog(day, r.error));
          throw new HttpError(r.empty ? 409 : 502, r.empty ? DAY_TEXT.empty : DAY_TEXT.failed);
        }
        // 반성하는 동안 생긴 일(멈추기 전에 나간 판단의 계획 등)이 있으면 넘기지 않는다. 반성은 저장돼 다시 누르면 그 결과로 넘긴다
        if (d.busy()) throw new HttpError(409, DAY_TEXT.busy);
        const moved = await d.skip(day);
        d.moved(last?.day === day ? last : null);
        d.log(DAY_TEXT.moved(moved.from, moved.to));
        return { ok: true, from: moved.from, to: moved.to, version: moved.version, applies_day: r.appliesDay };
      } finally {
        closing = null;
        d.hold(false);
        d.sendDay();
      }
    },
  };
}
