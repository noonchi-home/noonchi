// 밤 반성 작업 스레드 본체(night-worker.mjs가 불러온다): 기록 DB를 읽기 전용으로 열어 runReflection(읽기·덩어리·검사·LLM 요청 만들기)을 이 스레드에서 돈다.
// 메인 스레드에는 메시지로 묻는다: 저장(add·saveNight → 기록 작업 스레드), 시각(now), LLM HTTP 요청(fetch, 메인의 fetch로 보낸다).
// 대시보드 사건(emit)과 로그는 메인으로 보낸다. 메인이 {abort}를 보내면 그 반성의 신호를 끊는다(진행 중인 LLM 요청도 끊긴다).
import { parentPort } from "node:worker_threads";
import { PamClient, pamSettings } from "../pam/index.js";
import { HistoryDb } from "./db.js";
import { runReflection } from "./reflect.js";

/** 반성 하나: 기록 DB 경로·시간대·날·PAM 설정 환경·사본 폴더. */
export interface NightJob { path: string; offsetMinutes: number; day: string; env: Record<string, string | undefined>; dir?: string }
export type NightCall = "add" | "saveNight" | "now" | "fetch";
/** 메인의 fetch로 보낼 요청(본문은 글). */
export interface FetchRequest { url: string; method?: string; headers: [string, string][]; body?: string; redirect?: "follow" | "error" | "manual" }
/** 메인 fetch의 답. */
export interface FetchReply { status: number; statusText: string; headers: [string, string][]; body: string }

export type NightIn =
  | { run: number; job: NightJob }
  | { abort: number }
  | { reply: number; value?: unknown; error?: string; name?: string };
export type NightOut =
  | { ready: true }
  | { call: number; run: number; kind: NightCall; args: unknown[] }
  | { fetchAbort: number }
  | { emit: number; event: unknown }
  | { log: number; line: string }
  | { done: number; result: unknown }
  | { failed: number; error: string };

const port = parentPort!;
const post = (m: NightOut) => port.postMessage(m);
const runs = new Map<number, AbortController>();
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let seq = 0;

/** 메인 스레드에 묻고 답을 기다린다. */
function ask(run: number, kind: NightCall, args: unknown[], id = ++seq): Promise<unknown> {
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    post({ call: id, run, kind, args });
  });
}

/** PamClient의 fetch: 요청을 메인으로 보내 메인의 fetch로 부르고 답을 Response로 되살린다. 신호가 끊기면 메인의 요청도 끊는다. */
function proxyFetch(run: number): typeof fetch {
  return async (input, init) => {
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw signal.reason ?? new DOMException("요청을 끊었어요", "AbortError");
    const id = ++seq;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const req: FetchRequest = { url, method: init?.method, headers: [...new Headers(init?.headers).entries()], redirect: init?.redirect,
      ...(init?.body == null ? {} : { body: typeof init.body === "string" ? init.body : String(init.body) }) };
    const reply = ask(run, "fetch", [req], id) as Promise<FetchReply>;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        waiting.delete(id);
        post({ fetchAbort: id });
        reject(signal?.reason ?? new DOMException("요청을 끊었어요", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    aborted.catch(() => {});
    let r: FetchReply;
    try {
      r = await Promise.race([reply, aborted]);
    } finally {
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
    const empty = r.status === 101 || r.status === 204 || r.status === 205 || r.status === 304;
    return new Response(empty ? null : r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
  };
}

async function run(id: number, job: NightJob): Promise<void> {
  const ac = new AbortController();
  runs.set(id, ac);
  let db: HistoryDb | null = null;
  try {
    db = HistoryDb.open(job.path, job.offsetMinutes, { readOnly: true });
    const pam = new PamClient({ settings: pamSettings(job.env), fetchImpl: proxyFetch(id) });
    const result = await runReflection(db, pam, job.day, {
      signal: ac.signal,
      ...(job.dir ? { dir: job.dir } : {}),
      now: () => ask(id, "now", []) as Promise<number>,
      emit: (event) => post({ emit: id, event }),
      log: (line) => post({ log: id, line }),
      store: {
        add: (kind, atMs, text, o) => ask(id, "add", [kind, atMs, text, o]),
        saveNight: (a) => ask(id, "saveNight", [a]) as Promise<{ robot: number; candidates: number }>,
      },
    });
    post({ done: id, result });
  } catch (e) {
    post({ failed: id, error: (e as Error).message });
  } finally {
    db?.close();
    runs.delete(id);
  }
}

port.on("message", (m: NightIn) => {
  if ("run" in m) void run(m.run, m.job);
  else if ("abort" in m) runs.get(m.abort)?.abort(new Error("반성을 끊었어요"));
  else {
    const w = waiting.get(m.reply);
    if (!w) return;
    waiting.delete(m.reply);
    if (m.error !== undefined) w.reject(Object.assign(new Error(m.error), { name: m.name ?? "Error" }));
    else w.resolve(m.value);
  }
});
post({ ready: true });
