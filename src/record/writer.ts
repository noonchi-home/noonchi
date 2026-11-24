// writer.ts — 기록 DB(noonchi.db) 쓰기 일 표(WRITE_OPS)와 그 일을 부르는 쓰기 창구(HistoryWriter).
// 서버는 작업 스레드 창구(writer-thread.ts ThreadWriter)를 쓴다: 쓰기 연결을 작업 스레드 혼자 갖고 메인 스레드는 읽기 전용 연결만 쓴다.
// 시험·오프라인 도구는 같은 스레드 창구(directWriter)를 쓴다: 같은 일 표를 부르는 즉시 그 연결에서 돈다.
// 일마다 넘기는 값은 구조 복제(structured clone)가 되는 값이어야 한다(함수를 넘기지 않는다).
import {
  MODE_TEXT, datasetWriter, deviceRecorder, findRoutines, memoryForDay, nightSave, readDayMemory, recordBrainLog, recordPlan, routineEdge, sweep,
  type DeviceNote, type HelpRoutine, type HistoryDb, type HistoryKind, type InterventionPreference, type NightSave, type StoredPhoto,
} from "../brain/index.js";
import type { BrainLog } from "../contract/events.js";
import type { DeviceState } from "../contract/devices.js";
import type { EngineFrame } from "../contract/observe.js";
import type { PlanView } from "../contract/plan.js";
import type { ControlMode } from "../contract/setup.js";
import { msgId, type Envelope, type TopicName } from "../bus/index.js";
import { recordWrites, type RecordOptions } from "./history.js";

/** 기록 노드가 받은 메시지 하나: 처리표(bus_seen)와 기록 줄을 한 트랜잭션으로 쓴다. session은 기록 노드 하나(같은 기록 노드의 상태를 잇는다). */
export interface RecordJob extends RecordOptions { session: string; e: Envelope<TopicName>; now: number }

/** 일 표가 쓰는 것: 쓰기 연결과 기록 노드마다의 쓰기 표. */
export interface WriteCtx { db: HistoryDb; sessions: Map<string, { now: number; writes: ReturnType<typeof recordWrites> }> }

const DAY_MS = 86_400_000;

export const WRITE_OPS = {
  /** 기록 노드 메시지 하나(src/record/history.ts의 토픽별 쓰기). 이미 처리한 메시지면 쓰지 않고 false. */
  record(ctx: WriteCtx, job: RecordJob): boolean {
    let s = ctx.sessions.get(job.session);
    if (!s) {
      const made: { now: number; writes: ReturnType<typeof recordWrites> } = { now: job.now, writes: {} };
      made.writes = recordWrites(ctx.db, { now: () => made.now, keepHeard: job.keepHeard, machinesOnly: job.machinesOnly });
      ctx.sessions.set(job.session, (s = made));
    }
    s.now = job.now;
    const write = s.writes[job.e.topic];
    if (!write) return false;
    const { e } = job;
    return ctx.db.once({ topic: e.topic, group: "recorder", key: e.key, msg: msgId(e.header), boot: e.header.boot },
      () => write(e.body as Record<string, unknown>, e.header.stamp, e.header));
  },
  add(ctx: WriteCtx, kind: HistoryKind, atMs: number, text: string, o: { subject?: string; data?: unknown } = {}): void {
    ctx.db.add(kind, atMs, text, o);
  },
  /** 가전 상태 하나(가전 기록기: 지난 값과 견줘 바뀐 속성마다 device 줄). */
  device(ctx: WriteCtx, s: DeviceState, note: DeviceNote | undefined, now: number): void {
    deviceRecorder(ctx.db, () => now)(s, note);
  },
  brainLog(ctx: WriteCtx, l: BrainLog): void {
    recordBrainLog(ctx.db, l);
  },
  plan(ctx: WriteCtx, p: PlanView, now: number): void {
    recordPlan(ctx.db, p, now);
  },
  mode(ctx: WriteCtx, m: ControlMode, now: number): void {
    ctx.db.add("mode", now, MODE_TEXT[m], { data: { mode: m } });
  },
  /** 사진 찍기 사진: 보관 표 줄과 기록 줄을 함께. */
  photo(ctx: WriteCtx, p: Omit<StoredPhoto, "origin">, text: string): void {
    ctx.db.addPhoto({ ...p, origin: "photo" });
    ctx.db.add("photo", p.atMs, text, { subject: p.id });
  },
  addPhoto(ctx: WriteCtx, p: StoredPhoto): void {
    ctx.db.addPhoto(p);
  },
  /** DATASET_COLLECT=1 시험 자료 한 장: 파일(사진·크기 정보)과 보관 표 줄. */
  dataset(ctx: WriteCtx, dir: string, frame: EngineFrame): void {
    datasetWriter(dir, ctx.db)(frame);
  },
  interventionPreference(ctx: WriteCtx, p: InterventionPreference): boolean {
    return ctx.db.recordInterventionPreference(p);
  },
  rememberCup(ctx: WriteCtx, home: string, resident: string, discard: boolean): void {
    ctx.db.cupAnswers.remember(home, resident, discard);
  },
  forgetOtherBoots(ctx: WriteCtx, boot: string): void {
    ctx.db.forgetOtherBoots(boot);
  },
  /** 그날 판본을 고정한다(없으면 seed 저장, src/brain/history/reflect.ts memoryForDay). 고정한 판본 번호. */
  dayMemory(ctx: WriteCtx, day: string): number {
    return memoryForDay(ctx.db, day).version;
  },
  /** 밤 반성 저장 한 트랜잭션(src/brain/history/night.ts nightSave). */
  saveNight(ctx: WriteCtx, a: NightSave): { robot: number; candidates: number } {
    return nightSave(ctx.db, a);
  },
  /** 보관 기간이 지난 사진·시험 자료(파일과 표 줄)를 지운다. */
  sweep(ctx: WriteCtx, o: { photoDays: number; datasetDays: number; nowMs: number }): { photos: number; dataset: number } {
    return sweep(ctx.db, o);
  },
  /** 도움 습관(시나리오 2): 지난 30일 help 줄에서 찾은 습관 가운데 그날 기억에 화살표가 든 것. 읽기만 한다(고정하지 않는다). */
  routines(ctx: WriteCtx, now: number): HelpRoutine[] {
    const db = ctx.db;
    const day = db.dayOf(now);
    const memory = readDayMemory(db, day).memory;
    const helps = db.list({ since: now - 30 * DAY_MS, until: now, kinds: ["help"], limit: Number.MAX_SAFE_INTEGER });
    const has = (r: HelpRoutine) => "states" in memory && memory.states.some((st) => st.next.some((e) => e.action === r.action && e.on === routineEdge(r).on));
    return findRoutines(helps, db.offsetMinutes).filter(has);
  },
} satisfies Record<string, (ctx: WriteCtx, ...args: never[]) => unknown>;

export type WriteOps = typeof WRITE_OPS;
export type WriteOp = keyof WriteOps;
type Rest<F> = F extends (ctx: WriteCtx, ...args: infer A) => unknown ? A : never;
export type WriteArgs<K extends WriteOp> = Rest<WriteOps[K]>;
export type WriteResult<K extends WriteOp> = ReturnType<WriteOps[K]>;

/** 커밋 수(synchronous = FULL이라 커밋마다 WAL fsync 한 번)·묶음 수·일 수. */
export interface WriterStats { commits: number; batches: number; jobs: number }

/** 기록 DB 쓰기 창구: 일 표의 일마다 같은 이름의 함수(커밋이 끝나면 풀리는 Promise). */
export type HistoryWriter = { [K in WriteOp]: (...args: WriteArgs<K>) => Promise<WriteResult<K>> } & {
  /** 지금까지 보낸 쓰기가 모두 커밋(또는 실패)될 때까지 기다린다. */
  flush(): Promise<void>;
  stats(): Promise<WriterStats>;
  /** 기록 DB에 쓸 수 있는가(작업 스레드가 연속 3번 죽으면 false). */
  writable(): boolean;
  /** 남은 쓰기를 커밋하고 닫는다. */
  close(): Promise<void>;
};

/** 일 이름마다 call(op, args)를 부르는 창구 함수들. */
export function writerOps(call: <K extends WriteOp>(op: K, args: WriteArgs<K>) => Promise<WriteResult<K>>): { [K in WriteOp]: (...args: WriteArgs<K>) => Promise<WriteResult<K>> } {
  return Object.fromEntries((Object.keys(WRITE_OPS) as WriteOp[]).map((op) => [op, (...args: never[]) => call(op, args as never)])) as never;
}

/** 일 하나를 그 연결에서 돌린다(트랜잭션 하나, 안에서 던지면 그 일만 되돌린다). */
export function runOp<K extends WriteOp>(ctx: WriteCtx, op: K, args: WriteArgs<K>): WriteResult<K> {
  const fn = WRITE_OPS[op] as (ctx: WriteCtx, ...a: unknown[]) => WriteResult<K>;
  if (typeof fn !== "function") throw new Error(`없는 기록 일: ${String(op)}`);
  return ctx.db.tx(() => fn(ctx, ...args));
}

/** 같은 스레드 창구(시험·오프라인 도구): 부르는 즉시 그 연결에서 쓰고 결과를 Promise로 준다. */
export function directWriter(db: HistoryDb): HistoryWriter {
  const ctx: WriteCtx = { db, sessions: new Map() };
  const stats: WriterStats = { commits: 0, batches: 0, jobs: 0 };
  let closed = false;
  const call = <K extends WriteOp>(op: K, args: WriteArgs<K>): Promise<WriteResult<K>> => {
    if (closed) return Promise.reject(new Error("기록 DB 쓰기 창구를 닫았어요"));
    try {
      const value = runOp(ctx, op, args);
      stats.jobs++;
      stats.batches++;
      stats.commits++;
      return Promise.resolve(value);
    } catch (e) {
      return Promise.reject(e);
    }
  };
  return {
    ...writerOps(call),
    flush: async () => {},
    stats: async () => ({ ...stats }),
    writable: () => !closed,
    close: async () => { closed = true; },
  };
}
