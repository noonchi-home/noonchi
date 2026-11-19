import { randomUUID } from "node:crypto";
import { Outbox, type Body, type BusNode, type Clock } from "../bus/index.js";
import type { CloserResult } from "../contract/events.js";
import type { LookSpot } from "./crop.js";
import type { LatestFrame, ObservationPipeline } from "./pipeline.js";

type Request = Body<"/perception/look_request">;
type Probe = Extract<Request, { kind: "ready_top" | "ready_spot" }>;
type Look = Extract<Request, { kind: "closer" | "top" }>;
type Result = Body<"/perception/look_result">["result"];
const WINDOW_MS = 30_000;

/** 실행 쪽에는 사진이 없다. 인식이 보낸 자세와 해당 요청의 준비·확인 결과만 쓴다. */
export class LookClient {
  private frame: LatestFrame | null = null;
  private readonly replies = new Map<string, (result: Result) => void>();
  private readonly probes = new Map<string, { req: string; ready: boolean; since: number; stop: () => void }>();
  private closed = false;

  constructor(private readonly out: Outbox, private readonly clock: Clock) {}

  routes(node: BusNode): void {
    node.on("/perception/view", (f) => { this.frame = f; });
    node.on("/perception/look_result", (b) => this.replies.get(b.req)?.(b.result));
  }

  latest(): LatestFrame | null { return this.frame; }
  topReady(id: string, since: number): boolean {
    return this.ready("top:" + id, since, (req, until) => ({ req, until, kind: "ready_top", object_id: id, since }));
  }
  spotReady(position: [number, number, number], since: number): boolean {
    return this.ready("spot:" + position.join(","), since, (req, until) => ({ req, until, kind: "ready_spot", position, since }));
  }
  closer(spot: LookSpot, signal?: AbortSignal, since?: number): Promise<CloserResult> {
    return this.look({ req: randomUUID(), kind: "closer", spot, since, until: this.clock.now() + WINDOW_MS }, signal);
  }
  topLook(spot: LookSpot, since: number, signal?: AbortSignal): Promise<CloserResult> {
    return this.look({ req: randomUUID(), kind: "top", spot, since, until: this.clock.now() + WINDOW_MS }, signal);
  }

  private ready(key: string, since: number, make: (req: string, until: number) => Probe): boolean {
    if (this.closed) return false;
    const old = this.probes.get(key);
    if (old?.since === since) return old.ready;
    if (old) { old.stop(); this.cancel(old.req); }
    const req = randomUUID();
    const probe = { req, ready: false, since, stop: () => {} };
    this.probes.set(key, probe);
    const timeout = this.clock.after(WINDOW_MS, () => {
      if (this.probes.get(key) === probe) this.probes.delete(key);
      this.cancel(req);
    });
    probe.stop = timeout;
    this.replies.set(req, (result) => {
      this.replies.delete(req);
      if (result === true) probe.ready = true;
      else {
        timeout();
        if (this.probes.get(key) === probe) this.probes.delete(key);
      }
    });
    if (!this.out.push("/perception/look_request", make(req, this.clock.now() + WINDOW_MS))) this.cancel(req);
    return false;
  }

  private look(b: Look, signal?: AbortSignal): Promise<CloserResult> {
    if (this.closed || signal?.aborted) return Promise.resolve({ ok: false, why: this.closed ? "closed" : "aborted" });
    return new Promise((resolve) => {
      const abort = () => this.cancel(b.req);
      const timeout = this.clock.after(WINDOW_MS, abort);
      this.replies.set(b.req, (result) => {
        timeout();
        signal?.removeEventListener("abort", abort);
        this.replies.delete(b.req);
        resolve(typeof result === "boolean" ? { ok: false, why: "error" } : result);
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (!this.out.push("/perception/look_request", b)) abort();
    });
  }

  private cancel(req: string): void {
    if (!this.replies.has(req)) return;
    this.out.push("/perception/look_request", { req, kind: "cancel" });
    this.replies.get(req)?.({ ok: false, why: this.closed ? "closed" : "aborted" });
  }

  close(): void {
    this.closed = true;
    for (const req of this.replies.keys()) this.cancel(req);
    for (const probe of this.probes.values()) probe.stop();
    this.probes.clear();
    this.frame = null;
  }
}

type Pipeline = Pick<ObservationPipeline, "topReady" | "spotReady" | "closer" | "topLook">;

/** 긴 확인은 받는 줄 밖에서 돌린다. 취소·집 닫기는 이미 시작한 VLM에도 전해진다. */
export function lookRoutes(node: BusNode, pipeline: () => Pipeline | null, clock: Clock): void {
  const probes = new Map<string, Probe>();
  const running = new Map<string, AbortController>();
  const out = new Outbox(node, { clock, log: (s) => console.warn(s) });
  const send = (req: string, result: Result) => out.push("/perception/look_result", { req, observed_ms: clock.now(), result });
  const check = (p: Probe) => {
    const pipe = pipeline();
    const ready = p.kind === "ready_top" ? pipe?.topReady(p.object_id, p.since) : pipe?.spotReady(p.position, p.since);
    if (ready || clock.now() >= p.until) {
      send(p.req, !!ready && clock.now() < p.until);
      probes.delete(p.req);
    }
  };
  node.every(100, () => { for (const p of probes.values()) check(p); });
  node.on("/perception/look_request", (p) => {
    if (p.kind === "cancel") {
      probes.delete(p.req);
      running.get(p.req)?.abort();
      return;
    }
    if (p.kind === "ready_top" || p.kind === "ready_spot") {
      probes.set(p.req, p);
      check(p);
      return;
    }
    if (running.has(p.req)) return;
    const pipe = pipeline();
    if (!pipe || clock.now() >= p.until) { send(p.req, { ok: false, why: "no_fresh_frames" }); return; }
    const end = new AbortController();
    running.set(p.req, end);
    void node.spawn(async (life) => {
      const signal = AbortSignal.any([life, end.signal]);
      const timeout = clock.after(Math.max(0, p.until - clock.now()), () => end.abort());
      try {
        const r = p.kind === "top" ? await pipe.topLook(p.spot, p.since, signal) : await pipe.closer(p.spot, signal, p.since);
        if (!life.aborted) send(p.req, r);
      } catch {
        if (!life.aborted) send(p.req, { ok: false, why: signal.aborted ? "aborted" : "error" });
      } finally { timeout(); running.delete(p.req); }
    });
  });
}
