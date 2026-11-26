// night-host.ts — reflectInThread: 밤 반성(runReflection)을 반성 작업 스레드(night-thread.ts)에서 돌리고 결과를 받는 메인 스레드 함수.
// 메인 스레드는 작업 스레드가 묻는 것만 한다: 저장(store.add·store.saveNight, 서버는 기록 작업 스레드로 보낸다), 시각(now), LLM HTTP 요청(fetch).
// 작업 스레드는 프로세스에 하나이고 처음 반성할 때 띄운다(모듈을 불러오는 데 2초쯤 걸린다). 도는 반성이 없으면 프로세스 끝을 막지 않는다(unref).
// 작업 스레드가 끝나면 도는 반성은 실패로 돌아오고 진행 중인 LLM 요청은 끊는다. 다음 반성 때 다시 띄운다(세대가 바뀌어 옛 세대에 보낼 답은 버린다).
// LLM 요청이 실패하면 오류의 cause(code·syscall)까지 보내 작업 스레드의 fetchRetry가 EFAULT를 알아보고 다시 시도한다.
import { Worker } from "node:worker_threads";
import type { BrainLog } from "../../contract/events.js";
import type { NightStore, NightSave } from "./night.js";
import type { FetchReply, FetchRequest, NightIn, NightJob, NightOut } from "./night-thread.js";
import type { ReflectResult } from "./reflect.js";

export type { NightJob } from "./night-thread.js";

/** 반성 하나가 메인 스레드에서 쓰는 것. */
export interface NightHooks {
  store: NightStore;
  now: () => number;
  emit?: (l: BrainLog) => void;
  log?: (line: string) => void;
  /** 끊으면(서버를 끌 때) 작업 스레드의 반성과 진행 중인 LLM 요청을 끊는다. */
  signal?: AbortSignal;
  /** LLM HTTP 요청에 쓸 fetch(기본: 부를 때의 globalThis.fetch). */
  fetch?: typeof fetch;
  /** 시험: 이 반성을 돌리는 작업 스레드. */
  onWorker?: (w: Worker) => void;
}

type Run = { hooks: NightHooks; resolve: (r: ReflectResult) => void; reject: (e: Error) => void; fetches: Map<number, AbortController> };

let worker: Worker | null = null;
let ready = false;
/** 작업 스레드 세대(띄울 때마다 1 늘어난다). 답은 물을 때의 세대에만 보낸다. */
let generation = 0;
/** 지금 작업 스레드가 모듈을 다 불러와 준비되면 풀린다. */
let readyWait: Promise<void> = Promise.resolve();
const outbox: NightIn[] = [];
const runs = new Map<number, Run>();
let ids = 0;

function post(m: NightIn): void {
  if (worker && ready) worker.postMessage(m);
  else outbox.push(m);
}

function spawn(): Worker {
  const w = new Worker(new URL("./night-worker.mjs", import.meta.url), { workerData: { entry: new URL("./night-thread.ts", import.meta.url).href } });
  worker = w;
  ready = false;
  const gen = ++generation;
  let markReady!: () => void;
  readyWait = new Promise<void>((r) => { markReady = r; });
  w.on("message", (m: NightOut) => {
    if ("ready" in m) {
      ready = true;
      markReady();
      for (const out of outbox.splice(0)) w.postMessage(out);
      return;
    }
    if ("fetchAbort" in m) {
      for (const r of runs.values()) r.fetches.get(m.fetchAbort)?.abort();
      return;
    }
    const id = "call" in m ? m.run : "emit" in m ? m.emit : "log" in m ? m.log : "done" in m ? m.done : m.failed;
    const r = runs.get(id);
    if (!r) return;
    if ("call" in m) void answer(r, gen, m.call, m.kind, m.args);
    else if ("emit" in m) r.hooks.emit?.(m.event as BrainLog);
    else if ("log" in m) r.hooks.log?.(m.line);
    else {
      runs.delete(id);
      if (!runs.size) w.unref();
      if ("done" in m) r.resolve(m.result as ReflectResult);
      else if ("failed" in m) r.reject(new Error(m.error));
    }
  });
  w.on("error", (e: unknown) => { for (const r of runs.values()) r.hooks.log?.(`[반성] 작업 스레드 오류: ${(e as Error).message}`); });
  w.on("exit", (code) => {
    if (worker !== w) return;
    worker = null;
    ready = false;
    outbox.length = 0;
    markReady();
    const failed = [...runs.values()];
    runs.clear();
    // 끝난 스레드가 기다리던 LLM 요청은 끊는다(늦은 답이 다음 스레드로 가지 않게)
    for (const r of failed) for (const ac of r.fetches.values()) ac.abort(new Error("반성 작업 스레드가 끝났어요"));
    for (const r of failed) r.reject(new Error(`반성 작업 스레드가 끝났어요(끝 코드 ${code})`));
  });
  return w;
}

/** 작업 스레드가 물은 것에 답한다(실패도 답으로 보낸다). 물은 스레드(세대 gen)가 끝났으면 버린다. */
async function answer(r: Run, gen: number, reply: number, kind: string, args: unknown[]): Promise<void> {
  const send = (m: NightIn) => { if (gen === generation && worker) post(m); };
  try {
    let value: unknown;
    if (kind === "now") value = r.hooks.now();
    else if (kind === "add") {
      const [k, atMs, text, o] = args as Parameters<NightStore["add"]>;
      value = await r.hooks.store.add(k, atMs, text, o);
    } else if (kind === "saveNight") value = await r.hooks.store.saveNight(args[0] as NightSave);
    else value = await proxied(r, reply, args[0] as FetchRequest);
    send({ reply, value });
  } catch (e) {
    // fetchRetry가 다시 시도할지 보는 code·syscall(EFAULT 등)은 오류나 그 cause에 있다
    const err = e as Error & { code?: unknown; syscall?: unknown; cause?: { code?: unknown; syscall?: unknown } };
    const code = err.cause?.code ?? err.code;
    const syscall = err.cause?.syscall ?? err.syscall;
    send({ reply, error: err.message, name: err.name, ...(typeof code === "string" ? { code } : {}), ...(typeof syscall === "string" ? { syscall } : {}) });
  }
}

/** 작업 스레드의 LLM HTTP 요청을 메인의 fetch로 보내고 답을 글로 돌려준다. */
async function proxied(r: Run, id: number, req: FetchRequest): Promise<FetchReply> {
  const ac = new AbortController();
  r.fetches.set(id, ac);
  try {
    const res = await (r.hooks.fetch ?? globalThis.fetch)(req.url, { method: req.method, headers: req.headers, body: req.body, redirect: req.redirect, signal: ac.signal });
    return { status: res.status, statusText: res.statusText, headers: [...res.headers.entries()], body: await res.text() };
  } finally {
    r.fetches.delete(id);
  }
}

/** 반성 작업 스레드를 미리 띄워 모듈을 불러 둔다(처음 반성이 2초쯤 늦지 않게). 도는 반성이 없으면 프로세스 끝을 막지 않는다. */
export async function prepareReflectionThread(): Promise<void> {
  const w = worker ?? spawn();
  if (!runs.size) w.unref();
  await readyWait;
}

/** 그날 반성을 반성 작업 스레드에서 돌린다. runReflection과 같은 결과를 준다(같은 기록이면 같은 기억 판본). */
export function reflectInThread(job: NightJob, hooks: NightHooks): Promise<ReflectResult> {
  const id = ++ids;
  const w = worker ?? spawn();
  w.ref();
  hooks.onWorker?.(w);
  return new Promise<ReflectResult>((resolve, reject) => {
    runs.set(id, { hooks, resolve, reject, fetches: new Map() });
    // 이미 끊긴 신호면 run에 실어 보낸다(abort를 따로 먼저 보내면 run보다 앞서 버려진다)
    post({ run: id, job: { ...job, env: { ...job.env } }, ...(hooks.signal?.aborted ? { aborted: true } : {}) });
    hooks.signal?.addEventListener("abort", () => post({ abort: id }), { once: true });
  });
}
