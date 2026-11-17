// 보기 담당: 관찰 모드(src/agent/observer.ts)를 부르고 고른 도구를 실행한다. 한 번에 하나만 돈다.
// A 멈춘 단계(실행 추적 stalled, src/act/track/steps.ts Stall): 집기·놓기 단계가 안 끝남 → look_closer·wait. 계획이 도는 동안 폰은 그 단계 명령의 것이라
//   사람에게 폰으로 부탁하지 않는다(사진만 쓰는 가까이 보기는 한다).
//   관찰 모드 호출과 가까이 보기는 그 단계 신호(Stall.signal)로 끊긴다. 끊겨서 그쳤으면(관찰 모드 답 전, 감지를 합치기 전에 끊긴 가까이 보기 aborted)
//   기록도 settle도 하지 않는다. 가까이 본 결과가 World State에 들어가 그 단계를 끝냈으면(그래서 신호가 끊김, 감지만 합치고 VLM 답은 넣지 않은
//   vlm aborted 포함) 실행한 관찰로 기록한다(지난 단계 세대의 settle은 아무것도 하지 않는다).
//   가까이 보기가 자원 사정(CloserWait: 새 사진 모자람·VLM 자리 없음)으로 못 보거나, 감지는 합쳤지만 VLM 답이 왔을 때 사진이 끊겨 넣지 않았으면(vlm no_fresh_frames)
//   Stall.settle(false)로 시도에서 빼고, 그 밖(wait 포함)은 settle(true).
// B 판단 전 보기(판단 타이머 tick): 행동 대상 종류 물건이 사진 안에 있는데 볼 면(TaskSpec.look)이 확인되지 않음(없음·짐작·모름 값) → look_closer·wait.
//   불투명이 확인된 컵의 내용물은 옆에서 가까이 봐도 모르므로 보지 않는다(실행 추적이 가까이 가서 위에서 본다). PAM 판단을 막지 않는다.
//   물건마다 objectGapMs, B 전체로 gapMs에 한 번. 이미 싱크대 안·시야 밖 물건, frameFreshMs 넘게 낡은 프레임, 카메라 없는 프레임은 보지 않는다.
// C 코치 계획의 다른 행동(실행 추적 strayed, src/act/track/coach.ts Stray): 사람이 지금 단계와 다른 일을 하는 것 같다 → tell_person·wait.
//   다른 일(A·B·C)이 도는 중이면 받지 않는다. 그 단계 신호로 끊긴다(끊기면 기록 없음). tell_person이면 실행 추적의 tell을 부른다.
// E 내용물 보류(실행 추적 src/act/track/contents.ts contents): 실행 전 검사가 컵 안을 몰라 붙잡은 계획의 그 컵을 관찰 모드 없이 바로 가까이 본다.
//   다른 일이 돌면 받지 않는다(실행 추적이 다음 tick에 다시 부른다). objectGapMs 안에 본 컵은 보지 않고 done만(찾기의 다시 보기 force는 그래도 본다).
//   끝나면 done 한 번(look 기록, 계기 unknown_fact). done에는 가까이 보기 결과(끊겼으면 null)를 싣는다(찾기가 「분명히 없음」과 「확인 실패」를 가른다).
//   위에서 보기(top, 사람이 폰을 컵 위에 든 뒤)는 objectGapMs를 보지 않고 topLook을 부른다. B가 관찰 모드를 부르는 중이면 A처럼 끊고 먼저 돈다.
//   topLook이 없으면 done만.
// D 코치 계획 중 들은 말(heard): 명령의 답이 아닌 말 → tell_person(told)·pass_on(passed, 말 요청 에이전트로 넘김)·wait(waited).
//   보기 담당이 바쁘거나 한 시간 상한을 넘었거나 관찰 모드가 실패하면 passed다. 들은 말은 관찰 모드 입력에만 넣고 기록(글·까닭)에는 남기지 않는다.
// A가 먼저다: B가 관찰 모드를 부르는 중이면 끊고(B 기록 없음) A를 돌린다. B가 잘라 보는 중이거나 다른 A가 도는 중이면 A를 받지 않는다(실행 추적이 다음 tick에 다시 부른다).
// 관찰 모드는 한 시간(주입 시계)에 hourMax번(A·B 합)까지만 부른다. 넘으면 부르지 않고 기다리기 기록을 남긴다(A면 settle(true)).
// 고를 때마다 look 기록 하나. look_closer 결과는 관찰 흐름이 World State에 넣는다(다음 PAM 판단과 단계 조건이 그것을 본다).
import type { BrainLog, CloserMiss, CloserResult, CloserVlm, CloserWait, LookResult, LookTool, LookTrigger } from "../contract/events.js";
import type { Facet, ObjClass, WorldView } from "../contract/world.js";
import { describeError } from "../agent/index.js";
import type { ObserveChoice, ObserveSituation, Observer, ObserverStatus } from "../agent/index.js";
import { LOOK_MARGIN, type LookSpot } from "../observe/index.js";
import type { LatestFrame } from "../observe/index.js";
import { LOOK_TEXT, type TellMode } from "./labels.js";
import { OBJECT_NAME, redactSaid } from "../world/labels.js";
import { inView } from "../world/index.js";
import { CLASSES, type ClassKey } from "../world/vocab.js";
import { opaqueBody, putAway, sureValue, type Placed } from "./tasks.js";
import type { ContentsLook, Stall, Stray } from "./track/tracker.js";
import { headWithin } from "../shared/cut.js";

/** 들은 말에 관찰 모드가 고른 것: told 지금 할 일을 다시 알림, passed 말 요청 에이전트로 넘김, waited 답하지 않음. */
export type HeardOutcome = "told" | "passed" | "waited";

/** 기본값: B 물건마다 30초·전체 10초에 한 번, 10초 넘게 낡은 프레임은 보지 않음, 앞서 한 일 5개, 관찰 모드 한 시간 60번. */
export const LOOK_DEFAULTS = { objectGapMs: 30_000, gapMs: 10_000, frameFreshMs: 10_000, keep: 5, hourMax: 60, hourMs: 3_600_000 } as const;

/** 시도로 세지 않는 가까이 보기 결과: 못 본 까닭(why)과 감지를 합친 뒤 VLM 답을 넣지 않은 까닭(vlm)의 CloserWait(src/contract/events.ts). */
const WAITS: ReadonlySet<CloserMiss | CloserVlm> = new Set<CloserWait>(["no_fresh_frames", "vlm_busy"]);
/** 앞서 한 일을 기억하는 열쇠(단계·물건) 수 상한. */
const KEYS_MAX = 50;

export interface LookerOptions {
  observer: Pick<Observer, "decide" | "status">;
  /** 가까이 보기(src/observe/pipeline.ts closer). 감지를 합치기 전에 signal이 끊기면 넣지 않고 aborted, 합친 뒤에 끊기면 ok(vlm aborted),
   *  VLM 답이 왔을 때 사진이 끊겼으면 ok(vlm no_fresh_frames). */
  closer: (spot: LookSpot, signal?: AbortSignal) => Promise<CloserResult>;
  /** 판단 전 보기 B가 잘라 보기를 마쳤다(자원 사정으로 못 본 것은 빼고): 그 물건 id. 실행 추적이 계획 밖으로 가까이 가서 볼지 본다(src/act/track/contents.ts). */
  looked?: (objectId: string) => void;
  /** 위에서 보기(src/observe/pipeline.ts topLook): sinceMs 뒤 찍힌 컵 안을 내려다본 사진 쌍. 없으면 위에서 보기 부탁은 done만 한다. */
  topLook?: (spot: LookSpot, sinceMs: number, signal?: AbortSignal) => Promise<CloserResult>;
  /** 고리 가장 새 프레임(src/observe/pipeline.ts latest). */
  frame: () => LatestFrame | null;
  world: () => WorldView;
  /** 지금 할 일 다시 알리기(src/act/track/coach.ts tell): 방식으로 서버가 글을 만든다. 보낸 글, 못 보냈으면 null. 없으면 보내지 못한 것으로 본다. */
  tell?: (planId: string, stepId: string, mode: TellMode) => string | null;
  emit: (l: BrainLog) => void;
  /** 판단 전에 더 잘 볼 종류와 면(src/act/tasks.ts lookTargets). */
  targets: () => readonly { cls: ObjClass; facets: readonly Facet[] }[];
  /** 실행 추적이 놓기 단계를 끝낸 물건(이미 치운 것, src/act/track/steps.ts placed). 판단 전 보기(B)에서 뺀다. */
  placed?: () => Placed;
  /** 가까이 보기를 시작할 때(대시보드 말풍선 카드). */
  onLook?: (spot: LookSpot) => void;
  clock?: { now(): number };
  objectGapMs?: number;
  gapMs?: number;
  /** 관찰 모드를 한 시간에 부르는 상한(A·B 합). */
  hourMax?: number;
}

/** 관찰 모드 호출 수·비용(모르면 null)과 고른 도구 수(가까이 보기·사람 부탁·기다리기, 상한으로 부르지 않은 기다리기 포함). */
export interface LookerStatus { calls: number; costUsd: number | null; looks: number; waits: number; tells: number }

interface Job {
  trigger: LookTrigger; key: string; goal: string; stuckMs: number | null; spots: LookSpot[]; tools: LookTool[];
  planId?: string; stepId?: string; settle?: (counted: boolean) => void;
  /** 코치 계획(off_track·heard): 단계 목록과 지금 단계, 방금 본 변화, 들은 말, 끝났을 때 알릴 곳(heard). */
  plan?: ObserveSituation["plan"]; changes?: string[]; said?: string; outcome?: (o: HeardOutcome) => void;
  abort: AbortController; signal: AbortSignal; phase: "observer" | "act";
}
type JobSpec = Omit<Job, "abort" | "signal" | "phase">;
type Earlier = ObserveSituation["earlier"][number];

export class Looker {
  private job: Job | null = null;
  private readonly running = new Set<Promise<void>>();
  private readonly lookedAt = new Map<string, number>();
  private readonly earlier = new Map<string, Earlier[]>();
  private readonly count = { looks: 0, waits: 0, tells: 0 };
  /** 관찰 모드를 부른 시각(지난 한 시간). */
  private calledAt: number[] = [];
  private lastB = Number.NEGATIVE_INFINITY;
  private stopped = false;
  private readonly clock: { now(): number };
  private readonly cfg: { objectGapMs: number; gapMs: number; hourMax: number };

  constructor(private readonly o: LookerOptions) {
    this.clock = o.clock ?? { now: () => Date.now() };
    this.cfg = { objectGapMs: o.objectGapMs ?? LOOK_DEFAULTS.objectGapMs, gapMs: o.gapMs ?? LOOK_DEFAULTS.gapMs, hourMax: o.hourMax ?? LOOK_DEFAULTS.hourMax };
  }

  /** 멈춘 단계(A). 받았으면 true: 끝날 때 s.settle을 부른다(끊기면 부르지 않는다). */
  stalled(s: Stall): boolean {
    if (this.stopped || s.signal.aborted) return false;
    if (this.job) {
      if (this.job.trigger === "stalled" || this.job.phase !== "observer") return false;
      // B가 관찰 모드를 부르는 중이면 끊고 A를 돌린다(B 기록 없음)
      this.job.abort.abort();
      this.job = null;
    }
    this.start({
      trigger: "stalled", key: `${s.planId}:${s.stepId}`, goal: `${s.label} 단계 · 지금 명령 「${s.command}」 · 끝난 조건 ${JSON.stringify(s.until)}`,
      stuckMs: s.stuckMs, spots: s.spots, tools: ["look_closer", "wait"], planId: s.planId, stepId: s.stepId, settle: (c) => s.settle(c),
    }, s.signal);
    return true;
  }

  /** 내용물 보류의 가까이 보기(E). 받았으면 true(끝나면 h.done 한 번). 다른 일이 돌면 false. */
  contents(h: ContentsLook): boolean {
    if (this.stopped || h.signal.aborted) return false;
    if (h.top) return this.above(h, h.top.sinceMs);
    if (this.job) return false;
    const now = this.clock.now();
    // 찾기의 다시 보기(force)는 같은 물건 건너뛰기를 보지 않는다
    if (!h.force && now - (this.lookedAt.get(h.objectId) ?? Number.NEGATIVE_INFINITY) < this.cfg.objectGapMs) {
      h.done();
      return true;
    }
    this.lookedAt.set(h.objectId, now);
    const abort = new AbortController();
    const job: Job = {
      trigger: "unknown_fact", key: `${h.planId}:contents`, goal: h.force ? LOOK_TEXT.find(h.spot.label) : LOOK_TEXT.held(h.spot.label), stuckMs: null, spots: [h.spot], tools: ["look_closer"],
      planId: h.planId, abort, signal: AbortSignal.any([abort.signal, h.signal]), phase: "act",
    };
    this.job = job;
    let result: CloserResult | null = null;
    const p: Promise<void> = this.closerOnly(job, h.spot).then((r) => { result = r; }, () => {}).finally(() => {
      if (this.job === job) this.job = null;
      this.running.delete(p);
      h.done(result);
    });
    this.running.add(p);
    return true;
  }

  /** 위에서 보기(E top): B가 관찰 모드를 부르는 중이면 끊고(B 기록 없음) 받는다. 다른 일이 돌면 false. topLook이 없으면 done만. */
  private above(h: ContentsLook, sinceMs: number): boolean {
    if (this.job) {
      if (this.job.trigger !== "unknown_fact" || this.job.phase !== "observer" || this.job.planId) return false;
      this.job.abort.abort();
      this.job = null;
    }
    const topLook = this.o.topLook;
    if (!topLook) {
      h.done();
      return true;
    }
    this.lookedAt.set(h.objectId, this.clock.now());
    const abort = new AbortController();
    const job: Job = {
      trigger: "unknown_fact", key: `${h.planId}:contents`, goal: LOOK_TEXT.above(h.spot.label), stuckMs: null, spots: [h.spot], tools: ["look_closer"],
      planId: h.planId, abort, signal: AbortSignal.any([abort.signal, h.signal]), phase: "act",
    };
    this.job = job;
    const p: Promise<void> = this.topOnly(job, h.spot, sinceMs, topLook).catch(() => {}).finally(() => {
      if (this.job === job) this.job = null;
      this.running.delete(p);
      h.done();
    });
    this.running.add(p);
    return true;
  }

  /** 위에서 보고 look 기록 하나(첫 장 VLM 전에 끊기면 기록 없음). 넣지 않은 장의 까닭을 덧붙인다. */
  private async topOnly(job: Job, spot: LookSpot, sinceMs: number, topLook: NonNullable<LookerOptions["topLook"]>): Promise<void> {
    this.o.onLook?.(spot);
    const r = await topLook(spot, sinceMs, job.signal).catch((): CloserResult => ({ ok: false, why: "error" }));
    if (this.stopped || (!r.ok && r.why === "aborted")) return;
    this.count.looks++;
    const drops = r.ok ? (r.top ?? []).flatMap((t) => (t.why ? [LOOK_TEXT.topDrop[t.why]] : [])) : [];
    const detail = r.ok ? r.found.map((f) => `${f.id ?? f.cls} ${f.score} ${f.facts.join(" ")}`.trim()).join(", ") : "";
    const text = [LOOK_TEXT.closer(spot.label, closerText(r)), ...new Set(drops)].join(" · ");
    this.record(job, { tool: "look_closer", reason: job.goal }, spot, text, r, detail);
  }

  /** 관찰 모드 없이 가까이 보고 look 기록 하나(감지를 합치기 전에 끊기면 기록 없음). */
  /** 가까이 본 결과(끊겼거나 멈췄으면 null). */
  private async closerOnly(job: Job, spot: LookSpot): Promise<CloserResult | null> {
    this.o.onLook?.(spot);
    const r = await this.o.closer(spot, job.signal).catch((): CloserResult => ({ ok: false, why: "error" }));
    if (this.stopped || (!r.ok && r.why === "aborted")) return null;
    this.count.looks++;
    const detail = r.ok ? r.found.map((f) => `${f.id ?? f.cls} ${f.score} ${f.facts.join(" ")}`.trim()).join(", ") : "";
    this.record(job, { tool: "look_closer", reason: job.goal }, spot, LOOK_TEXT.closer(spot.label, closerText(r)), r, detail);
    return r;
  }

  /** 코치 계획의 다른 행동(C). 받았으면 true. 다른 일이 도는 중이면 받지 않는다(실행 추적이 다음 계기에 다시 부른다). */
  strayed(s: Stray): boolean {
    if (this.stopped || s.signal.aborted || this.job) return false;
    this.start({
      trigger: "off_track", key: `${s.planId}:${s.stepId}:stray`, goal: `${s.label} 단계 · 지금 명령 「${s.command}」`, stuckMs: null, spots: [], tools: ["tell_person", "wait"],
      planId: s.planId, stepId: s.stepId, plan: { steps: s.steps, at: s.at }, changes: s.changes,
    }, s.signal);
    return true;
  }

  /** 코치 계획 중 들은 말(D): 관찰 모드가 고른 것. 바쁘거나 상한을 넘었거나 실패하면 passed. */
  heard(planId: string, stepId: string, said: string, s: Omit<Stray, "changes">): Promise<HeardOutcome> {
    if (this.stopped || s.signal.aborted || this.job) return Promise.resolve("passed");
    // 부르지 못했거나(상한) 끊겨서 답 없이 끝났으면 넘긴다. 그 일이 다 끝난 뒤(다음 일을 받을 수 있을 때) 알린다
    let got: HeardOutcome = "passed";
    const started = this.start({
      trigger: "heard", key: `${planId}:${stepId}:heard`, goal: `${s.label} 단계 · 지금 명령 「${s.command}」`, stuckMs: null, spots: [], tools: ["tell_person", "pass_on", "wait"],
      planId, stepId, plan: { steps: s.steps, at: s.at }, said, outcome: (o) => { got = o; },
    }, s.signal);
    return started ? started.then(() => got) : Promise.resolve("passed");
  }

  /** 판단 타이머(250ms)가 부른다: 판단 전 보기(B)를 부를 물건이 있으면 하나 부른다. */
  tick(): void {
    if (this.stopped || this.job) return;
    const now = this.clock.now();
    if (now - this.lastB < this.cfg.gapMs) return;
    const latest = this.o.frame();
    if (!latest?.view || now - latest.capturedAtMs > LOOK_DEFAULTS.frameFreshMs) return;
    const wants = this.o.targets();
    if (!wants.length) return;
    for (const [id, at] of this.lookedAt) if (now - at >= this.cfg.objectGapMs) this.lookedAt.delete(id);
    const placed = this.o.placed?.();
    for (const o of this.o.world().objects) {
      const want = wants.find((t) => t.cls === o.cls);
      if (!want || o.status !== "present" || !o.position || putAway(o, placed)) continue;
      if (now - (this.lookedAt.get(o.id) ?? Number.NEGATIVE_INFINITY) < this.cfg.objectGapMs) continue;
      const facet = want.facets.find((f) => sureValue(o, f) === null && !(f === "contents" && opaqueBody(o)));
      if (!facet) continue;
      const spot: LookSpot = { id: o.id, label: OBJECT_NAME[o.cls] ?? o.cls, position: o.position };
      if (!inView(latest.view, spot.position, LOOK_MARGIN)) continue;
      this.lastB = now;
      this.start({ trigger: "unknown_fact", key: o.id, goal: `${spot.label} ${o.id}의 ${facet}을 모름 · 판단 전에 더 잘 보기`, stuckMs: null, spots: [spot], tools: ["look_closer", "wait"] });
      return;
    }
  }

  status(): LookerStatus {
    const s: ObserverStatus = this.o.observer.status();
    return { calls: s.calls, costUsd: s.costUsd, ...this.count };
  }

  /** 멈추면 도는 것을 끊고 더 부르지 않는다. */
  stop(): void {
    this.stopped = true;
    this.job?.abort.abort();
  }

  /** 도는 일이 끝날 때까지 기다린다(시험용). */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.all([...this.running]);
  }

  /** 한 시간 상한 안이면 이번 호출을 세고 true. */
  private allow(now: number): boolean {
    this.calledAt = this.calledAt.filter((t) => now - t < LOOK_DEFAULTS.hourMs);
    if (this.calledAt.length >= this.cfg.hourMax) return false;
    this.calledAt.push(now);
    return true;
  }

  /** 일 하나를 시작한다. 도는 일(끝나면 풀리는 약속)을 돌려주고, 한 시간 상한으로 부르지 않았으면 null. */
  private start(spec: JobSpec, external?: AbortSignal): Promise<void> | null {
    const abort = new AbortController();
    const job: Job = { ...spec, abort, signal: external ? AbortSignal.any([abort.signal, external]) : abort.signal, phase: "observer" };
    const now = this.clock.now();
    for (const p of job.spots) this.lookedAt.set(p.id, now);
    if (!this.allow(now)) {
      this.count.waits++;
      this.record(job, { tool: "wait", reason: LOOK_TEXT.capped }, job.spots[0] ?? null, LOOK_TEXT.waited(job.spots[0]?.label ?? null), null, "");
      job.settle?.(true);
      return null;
    }
    this.job = job;
    const p: Promise<void> = this.run(job).catch(() => {}).finally(() => {
      if (this.job === job) this.job = null;
      this.running.delete(p);
    });
    this.running.add(p);
    return p;
  }

  private async run(job: Job): Promise<void> {
    const latest = this.o.frame();
    const spots = job.spots.map((p) => ({ id: p.id, label: p.label, position: p.position, inView: !!latest?.view && inView(latest.view, p.position, LOOK_MARGIN) }));
    const situation: ObserveSituation = {
      trigger: job.trigger, goal: job.goal, stuckMs: job.stuckMs, spots, world: this.o.world(), earlier: this.earlier.get(job.key) ?? [], tools: job.tools, nowMs: this.clock.now(),
      ...(job.plan ? { plan: job.plan } : {}), ...(job.changes ? { changes: job.changes } : {}), ...(job.said !== undefined ? { said: job.said } : {}),
    };
    let choice: ObserveChoice;
    try {
      choice = await this.o.observer.decide(situation, job.signal);
    } catch (e) {
      if (job.signal.aborted || this.stopped) return;
      choice = { tool: "wait", reason: headWithin(LOOK_TEXT.failed(describeError(e)), 200), invalid: "error" };
      // 들은 말에 관찰 모드가 답하지 못했으면 말 요청 에이전트로 넘긴다
      job.outcome?.("passed");
      job.outcome = undefined;
    }
    if (job.signal.aborted || this.stopped) return;
    job.phase = "act";
    const want = choice.tool === "look_closer" ? choice.target : null;
    const picked = want === null ? undefined : spots.find((p) => p.id === want);
    if (choice.tool === "look_closer" && !picked) choice = { tool: "wait", reason: choice.reason, invalid: "target" };
    const spot = picked ?? spots[0] ?? null;
    let text: string;
    let detail = "";
    let result: LookResult | null = null;
    let counted = true;
    if (choice.tool === "look_closer" && spot) {
      const at: LookSpot = { id: spot.id, label: spot.label, position: spot.position };
      this.o.onLook?.(at);
      const r = await this.o.closer(at, job.signal).catch((): CloserResult => ({ ok: false, why: "error" }));
      // 감지를 합치기 전에 끊겨 넣지 않았으면(aborted) 기록하지 않는다. 합친 결과가 그 단계를 끝내 신호가 끊긴 것(VLM 답만 못 넣은 vlm aborted 포함)은 기록한다
      if (this.stopped || (!r.ok && r.why === "aborted")) return;
      result = r;
      this.count.looks++;
      counted = !WAITS.has(r.ok ? r.vlm : r.why);
      // 판단 전 보기 B(계획 없음)가 잘라 보기를 마쳤다: 실행 추적이 그 컵을 계획 밖으로 가까이 가서 볼지 본다
      if (job.trigger === "unknown_fact" && !job.planId && counted) this.o.looked?.(spot.id);
      text = LOOK_TEXT.closer(spot.label, closerText(r));
      if (r.ok) detail = r.found.map((f) => `${f.id ?? f.cls} ${f.score} ${f.facts.join(" ")}`.trim()).join(", ");
    } else if (choice.tool === "tell_person") {
      const sent = job.planId && job.stepId ? this.o.tell?.(job.planId, job.stepId, choice.mode) ?? null : null;
      result = { sent: sent !== null };
      this.count.tells++;
      text = sent !== null ? LOOK_TEXT.told(sent) : LOOK_TEXT.notSent;
      job.outcome?.(sent !== null ? "told" : "waited");
    } else if (choice.tool === "pass_on") {
      text = LOOK_TEXT.passed;
      job.outcome?.("passed");
    } else {
      this.count.waits++;
      text = LOOK_TEXT.waited(spot?.label ?? null);
      job.outcome?.("waited");
    }
    // 들은 말은 기록하지 않는다: 관찰 모드가 까닭이나 다시 알리는 글에 그 말을 그대로 옮겼으면 기록·방송하는 글에서 뺀다(실제 폰에 읽는 글은 그대로 보냈다)
    if (job.said) {
      choice = { ...choice, reason: redactSaid(choice.reason, [job.said]) };
      text = redactSaid(text, [job.said]);
    }
    this.record(job, choice, spot, text, result, detail);
    job.settle?.(counted);
  }

  /** look 기록 하나를 내고 앞서 한 일에 넣는다. */
  private record(job: Job, choice: Pick<ObserveChoice, "tool" | "reason">, spot: { id: string } | null, text: string, result: LookResult | null, detail: string): void {
    if (this.stopped) return;
    const at = this.clock.now();
    const target = spot?.id ?? null;
    const list = [...(this.earlier.get(job.key) ?? []), { atMs: at, tool: choice.tool, target, text: detail ? `${text} · ${detail}` : text }];
    this.earlier.delete(job.key);
    this.earlier.set(job.key, list.slice(-LOOK_DEFAULTS.keep));
    if (this.earlier.size > KEYS_MAX) this.earlier.delete(this.earlier.keys().next().value!);
    this.o.emit({
      type: "look", at_ms: at, trigger: job.trigger, target, tool: choice.tool, reason: choice.reason, text, result,
      ...(job.planId ? { plan_id: job.planId, ...(job.stepId ? { step_id: job.stepId } : {}) } : {}),
    });
  }
}

/** 가까이 본 결과 한 마디: 찾은 물건 이름(사람·가전 설비는 빼고), 못 봤으면 까닭, VLM 답이 없으면 덧붙인다. */
function closerText(r: CloserResult): string {
  if (!r.ok) return LOOK_TEXT.miss[r.why];
  const seen = LOOK_TEXT.seen(r.found.filter((f) => CLASSES[f.cls as ClassKey]?.role === "object").map((f) => OBJECT_NAME[f.cls] ?? f.cls));
  if (r.vlm === "ok") return seen;
  return `${seen} · ${r.vlm === "aborted" ? LOOK_TEXT.vlmAborted : r.vlm === "no_fresh_frames" ? LOOK_TEXT.vlmStale : LOOK_TEXT.vlmMissing}`;
}
