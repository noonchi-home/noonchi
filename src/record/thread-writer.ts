// thread-writer.ts — ThreadWriter: 서버의 noonchi.db 쓰기 요청을 모아 작업 스레드(writer-thread.ts)로 보내고 커밋 결과를 받는 객체.
// 메인 스레드는 FULL 커밋(fsync)을 기다리지 않는다. 한 차례(이벤트 루프 한 바퀴)에 부른 쓰기를 모아 한 번에 보내고(최대 maxBatch건),
// 작업 스레드는 그 묶음과 커밋하는 동안 쌓인 묶음을 한 트랜잭션으로 쓴 뒤 일마다 결과를 돌려준다(Promise는 커밋 뒤에 풀린다).
// 작업 스레드는 프로세스에 하나다: 모듈을 불러오는 데 2초쯤 걸려, 한 프로세스가 서버를 여러 번 띄우면(시험) 띄워 둔 스레드에 연결만 새로 연다.
// 작업 스레드가 죽으면 기다리던 쓰기를 모두 실패로 돌리고(기록 노드는 ack하지 않아 버스가 다시 준다) 다시 띄워 연결을 다시 연다.
// ThreadWriter마다 연속 maxDeaths번(기본 3) 죽으면 다시 열지 않고 writable()이 false다(/api/health db). 커밋이 한 번 되면 센 수를 지운다.
import { Worker } from "node:worker_threads";
import { writerOps, type HistoryWriter, type WriteArgs, type WriteOp, type WriteResult, type WriterResult, type WriterStats } from "./writer.js";
import type { WriterIn, WriterOut, WriterRequest } from "./writer-thread.js";

export interface ThreadWriterOptions {
  offsetMinutes: number;
  log?: (line: string) => void;
  /** 한 묶음 최대 건수(기본 64). */
  maxBatch?: number;
  /** 작업 스레드가 묶음이 maxBatch보다 작을 때 첫 요청부터 더 기다리는 ms(기본 0: 커밋하는 동안 쌓인 것만 묶는다).
   *  0인 까닭: RELIABLE은 토픽마다 ack 전에는 다음 메시지를 주지 않아 기다리면 차례마다 그만큼 늦어진다(Windows 타이머는 5ms를 15ms쯤으로 잰다).
   *  부하 시험(tests/history-writer-load.test.ts)에서 5ms는 2,000건 6.4~6.6초, 0은 1.4~2.1초였고 커밋 수는 둘 다 400번이었다. */
  windowMs?: number;
  /** 연속으로 죽으면 다시 열지 않는 수(기본 3). */
  maxDeaths?: number;
  /** 시험: 이 ThreadWriter가 작업 스레드에 연결을 둔 동안 새로 띄운 작업 스레드. */
  onWorker?: (w: Worker) => void;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
const DEAD = "기록 DB 작업 스레드가 끝나 쓰지 못했어요";
const CLOSED = "기록 DB 쓰기를 닫았어요";

/** 프로세스에 하나인 작업 스레드: ThreadWriter(DB 연결 id)마다 메시지를 나눠 준다. 연결을 둔 ThreadWriter가 없으면 프로세스 끝을 막지 않는다(unref). */
const thread = new (class SharedThread {
  #worker: Worker | null = null;
  #ready = false;
  #outbox: WriterIn[] = [];
  readonly #clients = new Map<number, ThreadWriter>();
  #ids = 0;

  attach(w: ThreadWriter): number {
    const id = ++this.#ids;
    this.#clients.set(id, w);
    if (this.#worker) {
      this.#worker.ref();
      w.spawned(this.#worker);
    } else this.#spawn();
    return id;
  }

  detach(id: number): void {
    this.#clients.delete(id);
    if (!this.#clients.size) this.#worker?.unref();
  }

  post(m: WriterIn): void {
    if (this.#ready && this.#worker) this.#worker.postMessage(m);
    else this.#outbox.push(m);
  }

  #spawn(): void {
    const worker = new Worker(new URL("./writer-worker.mjs", import.meta.url), { workerData: { entry: new URL("./writer-thread.ts", import.meta.url).href } });
    this.#worker = worker;
    this.#ready = false;
    for (const c of this.#clients.values()) c.spawned(worker);
    worker.on("message", (m: WriterOut) => {
      if ("ready" in m) {
        this.#ready = true;
        for (const out of this.#outbox.splice(0)) worker.postMessage(out);
        return;
      }
      const id = "opened" in m ? m.opened : "failed" in m ? m.failed : "closed" in m ? m.closed : m.db;
      this.#clients.get(id)?.receive(m);
    });
    worker.on("error", (e: unknown) => { for (const c of this.#clients.values()) c.log(`[기록 DB] 작업 스레드 오류: ${(e as Error).message}`); });
    worker.on("exit", (code) => {
      if (this.#worker !== worker) return;
      this.#worker = null;
      this.#ready = false;
      this.#outbox.length = 0;
      // 기다리던 쓰기는 ThreadWriter마다 실패로 돌리고, 아직 쓰는 ThreadWriter가 있으면 다시 띄워 연결을 다시 연다
      for (const c of [...this.#clients.values()]) c.died(code);
      if ([...this.#clients.values()].some((c) => c.wantsThread())) this.#spawn();
    });
    if (!this.#clients.size) worker.unref();
  }
})();

export class ThreadWriter {
  readonly #path: string;
  readonly #o: Required<Pick<ThreadWriterOptions, "maxBatch" | "windowMs" | "maxDeaths">> & ThreadWriterOptions;
  readonly #id: number;
  /** 작업 스레드에 이 ThreadWriter의 쓰기 연결이 열려 있다. */
  #opened = false;
  /** 처음 연결을 열면 풀린다(못 열면 거절). */
  readonly #first: Promise<void>;
  #firstDone: { resolve: () => void; reject: (e: Error) => void } | null = null;
  #seq = 0;
  /** 아직 보내지 않은 요청(이번 차례에 모은 것, 또는 연결을 여는 동안). */
  #queue: WriterRequest[] = [];
  #scheduled = false;
  readonly #pending = new Map<number, Pending>();
  #deaths = 0;
  #dead = false;
  #closing: Promise<void> | null = null;
  #onClosed: (() => void) | null = null;
  #onDeath: (() => void) | null = null;
  /** 연결이 열리거나 더 열 수 없게 되면 부른다(닫기가 기다린다). */
  #wake: (() => void) | null = null;
  readonly #stats: WriterStats = { commits: 0, batches: 0, jobs: 0 };

  private constructor(path: string, o: ThreadWriterOptions) {
    this.#path = path;
    this.#o = { maxBatch: 64, windowMs: 0, maxDeaths: 3, ...o };
    this.#first = new Promise<void>((resolve, reject) => { this.#firstDone = { resolve, reject }; });
    this.#first.catch(() => {});
    this.#id = thread.attach(this);
    this.#open();
  }

  /** 작업 스레드(없으면 띄운다)에 연결을 열고 바로 돌려준다. 연결을 여는 동안 부른 쓰기는 모아 두었다가 열리면 보낸다.
   *  준비는 ready()로 기다린다. 서버는 집을 여는 동안 열어 두고 듣기 전에 기다린다. */
  static start(path: string, o: ThreadWriterOptions): ThreadWriter {
    return new ThreadWriter(path, o);
  }

  /** 연결을 열 때까지 기다린다(표가 없으면 만든다). 열지 못하면 던진다. */
  static async open(path: string, o: ThreadWriterOptions): Promise<ThreadWriter> {
    const w = ThreadWriter.start(path, o);
    await w.ready();
    return w;
  }

  /** 처음 연결을 열 때까지 기다린다. 못 열었으면 던진다. */
  ready(): Promise<void> { return this.#first; }

  /** HistoryWriter(쓰기 일 이름마다 함수 + flush·stats·writable·close)로 내보낸다. */
  api(): HistoryWriter {
    return {
      ...writerOps((op, args) => this.call(op, args)),
      flush: () => this.flush(),
      stats: async () => ({ ...this.#stats }),
      writable: () => this.writable(),
      close: () => this.close(),
    };
  }

  writable(): boolean { return !this.#dead && !this.#closing; }

  call<K extends WriteOp>(op: K, args: WriteArgs<K>): Promise<WriteResult<K>> {
    if (this.#closing) return Promise.reject(new Error(CLOSED));
    if (this.#dead) return Promise.reject(new Error(DEAD));
    const id = ++this.#seq;
    return new Promise<WriteResult<K>>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.#queue.push({ id, op, args: args as unknown[] });
      if (this.#queue.length >= this.#o.maxBatch) this.#send();
      else if (!this.#scheduled) {
        this.#scheduled = true;
        setImmediate(() => this.#send());
      }
    });
  }

  /** 지금까지 부른 쓰기가 모두 끝날(커밋 또는 실패) 때까지 기다린다. 기다린 쓰기 수를 준다. */
  async flush(): Promise<number> {
    const waiting = [...this.#pending.keys()];
    await Promise.all(waiting.map((id) => new Promise<void>((r) => {
      const p = this.#pending.get(id);
      if (!p) return r();
      const { resolve, reject } = p;
      this.#pending.set(id, { resolve: (v) => { resolve(v); r(); }, reject: (e) => { reject(e); r(); } });
    })));
    return waiting.length;
  }

  /** 남은 쓰기를 커밋하고 연결을 닫는다(연결을 여는 중이면 열린 뒤에 커밋한다). */
  close(): Promise<void> {
    this.#closing ??= (async () => {
      // 연결을 여는 중(처음이거나 다시 띄운 뒤)이면 열린 뒤에 남은 쓰기를 커밋한다
      while (!this.#opened && !this.#dead) await new Promise<void>((r) => { this.#wake = r; });
      if (this.#opened) {
        this.#send();
        const done = new Promise<void>((r) => { this.#onClosed = r; this.#onDeath = r; });
        thread.post({ db: this.#id, close: true });
        await done;
      }
      thread.detach(this.#id);
      this.#failAll(new Error(CLOSED));
    })();
    return this.#closing;
  }

  // 아래는 공유 작업 스레드가 부른다

  log(line: string): void { this.#o.log?.(line); }

  spawned(w: Worker): void { this.#o.onWorker?.(w); }

  /** 작업 스레드를 다시 띄울 까닭이 있다(닫지도 죽지도 않았다). */
  wantsThread(): boolean { return !this.#dead && !this.#closing; }

  receive(m: WriterOut): void {
    if ("opened" in m) {
      this.#opened = true;
      this.#firstDone?.resolve();
      this.#awake();
      this.#send();
    } else if ("failed" in m) {
      const e = new Error(`기록 DB를 열지 못했어요: ${m.error}`);
      this.#firstDone?.reject(e);
      this.#dead = true;
      this.#failAll(e);
      this.#awake();
      this.log(`[오류] ${e.message}`);
    } else if ("results" in m) {
      this.#settle(m.results, m.committed);
    } else if ("closed" in m) {
      this.#opened = false;
      this.#onClosed?.();
    }
  }

  died(code: number): void {
    this.#opened = false;
    this.#onDeath?.();
    if (this.#dead) return;
    if (this.#closing) {
      // 닫는 중이면 다시 열지 않는다: 남은 쓰기는 실패로 돌리고, 닫기와 처음 열기를 기다리던 곳을 깨운다
      this.#dead = true;
      this.#failAll(new Error(CLOSED));
      this.#firstDone?.reject(new Error(DEAD));
      this.#awake();
      return;
    }
    // 기다리던 쓰기는 실패로 돌린다(기록 노드는 ack하지 않아 버스가 다시 준다)
    this.#failAll(new Error(DEAD));
    this.#deaths++;
    if (this.#deaths >= this.#o.maxDeaths) {
      this.#dead = true;
      this.#firstDone?.reject(new Error(DEAD));
      this.#awake();
      this.log(`[오류] 기록 DB 작업 스레드가 연속 ${this.#deaths}번 끝났어요. 기록 DB에 쓰지 않아요.`);
      return;
    }
    this.log(`[경고] 기록 DB 작업 스레드가 끝나 다시 띄워요(끝 코드 ${code}, 연속 ${this.#deaths}번).`);
    this.#open();
  }

  #awake(): void {
    const wake = this.#wake;
    this.#wake = null;
    wake?.();
  }

  #open(): void {
    thread.post({ open: this.#id, path: this.#path, offsetMinutes: this.#o.offsetMinutes, windowMs: this.#o.windowMs, maxBatch: this.#o.maxBatch });
  }

  #settle(results: WriterResult[], committed: boolean): void {
    if (committed) this.#stats.commits++;
    this.#stats.batches++;
    this.#stats.jobs += results.length;
    if (results.some((r) => r.error === undefined)) this.#deaths = 0;
    for (const r of results) {
      const p = this.#pending.get(r.id);
      if (!p) continue;
      this.#pending.delete(r.id);
      if (r.error !== undefined) p.reject(new Error(r.error));
      else p.resolve(r.value);
    }
  }

  #send(): void {
    this.#scheduled = false;
    if (!this.#opened || !this.#queue.length) return;
    while (this.#queue.length) thread.post({ db: this.#id, reqs: this.#queue.splice(0, this.#o.maxBatch) });
  }

  #failAll(e: Error): void {
    this.#queue.length = 0;
    const waiting = [...this.#pending.values()];
    this.#pending.clear();
    for (const p of waiting) p.reject(e);
  }
}
