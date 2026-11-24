// 기록 DB 쓰기 작업 스레드 본체(writer-worker.mjs가 불러온다). 기록 DB마다 쓰기 연결을 혼자 갖는다(서버 하나면 noonchi.db 하나).
// 모듈을 불러오면 {ready}를 보내고, {open}으로 연결을 연다. 한 프로세스가 서버를 여러 번 띄워도(시험) 스레드는 하나다.
// 연결마다 받은 쓰기 묶음과, 커밋(synchronous = FULL이라 fsync)하는 동안 쌓인 묶음을 최대 maxBatch건 한 트랜잭션(BEGIN IMMEDIATE … COMMIT)으로 쓴다.
// 일마다 SAVEPOINT로 나눠 한 건이 던지면 그 건만 되돌리고 실패로 돌려준다. 결과는 커밋이 끝난 뒤 묶음마다 한 번에 보낸다.
// windowMs가 0보다 크면 묶음이 maxBatch보다 작을 때 첫 요청부터 windowMs까지 더 기다린다.
// 연결 닫기는 {close}로 받는다: 남은 묶음을 커밋하고 연결을 닫은 뒤 {closed}를 보낸다.
import { parentPort, receiveMessageOnPort } from "node:worker_threads";
import { HistoryDb } from "../brain/index.js";
import { runOp, type WriteCtx, type WriteOp } from "./writer.js";

export type WriterRequest = { id: number; op: WriteOp; args: unknown[] };
export type WriterIn =
  | { open: number; path: string; offsetMinutes: number; windowMs: number; maxBatch: number }
  | { db: number; reqs: WriterRequest[] }
  | { db: number; close: true };
export type WriterResult = { id: number; value?: unknown; error?: string };
export type WriterOut =
  | { ready: true }
  | { opened: number } | { failed: number; error: string }
  | { db: number; results: WriterResult[]; committed: boolean }
  | { closed: number };

type Conn = { db: HistoryDb; ctx: WriteCtx; total: () => number; batch: WriterRequest[]; windowMs: number; maxBatch: number; timer?: ReturnType<typeof setTimeout>; closing: boolean };

const port = parentPort!;
const conns = new Map<number, Conn>();
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 받은 메시지 하나를 연결 상태에 넣는다(쓰기는 commit이 한다). */
function take(m: WriterIn): Conn | undefined {
  if ("open" in m) {
    try {
      const db = HistoryDb.open(m.path, m.offsetMinutes);
      const changes = db.db.prepare("SELECT total_changes() AS n");
      conns.set(m.open, { db, ctx: { db, sessions: new Map() }, total: () => Number((changes.get() as { n: number }).n), batch: [], windowMs: m.windowMs, maxBatch: m.maxBatch, closing: false });
      port.postMessage({ opened: m.open } satisfies WriterOut);
    } catch (e) {
      port.postMessage({ failed: m.open, error: message(e) } satisfies WriterOut);
    }
    return undefined;
  }
  const c = conns.get(m.db);
  if (!c) return undefined;
  if ("reqs" in m) c.batch.push(...m.reqs);
  else c.closing = true;
  return c;
}

/** 묶음 하나를 한 트랜잭션으로 쓴다. 바깥 커밋이 실패하면 묶음 전부 실패다. */
function write(id: number, c: Conn, jobs: WriterRequest[]): void {
  const results: WriterResult[] = [];
  const before = c.total();
  let committed = false;
  try {
    c.db.tx(() => {
      for (const r of jobs) {
        try {
          results.push({ id: r.id, value: runOp(c.ctx, r.op, r.args as never) });
        } catch (e) {
          results.push({ id: r.id, error: message(e) });
        }
      }
    });
    committed = c.total() > before;
  } catch (e) {
    results.length = 0;
    for (const r of jobs) results.push({ id: r.id, error: message(e) });
  }
  port.postMessage({ db: id, results, committed } satisfies WriterOut);
}

/** 커밋하는 동안 쌓인 메시지까지 받은 뒤, 쓸 것이 있는 연결마다 쓴다(닫는 연결은 쓰고 닫는다). */
function commit(): void {
  for (let m = receiveMessageOnPort(port); m; m = receiveMessageOnPort(port)) take(m.message as WriterIn);
  for (const [id, c] of conns) {
    clearTimeout(c.timer);
    c.timer = undefined;
    while (c.batch.length) write(id, c, c.batch.splice(0, c.maxBatch));
    if (c.closing) {
      c.db.close();
      conns.delete(id);
      port.postMessage({ closed: id } satisfies WriterOut);
    }
  }
}

port.on("message", (m: WriterIn) => {
  const c = take(m);
  if (!c) return;
  if (c.closing || c.batch.length >= c.maxBatch || c.windowMs <= 0) commit();
  else c.timer ??= setTimeout(commit, c.windowMs);
});
port.postMessage({ ready: true } satisfies WriterOut);
