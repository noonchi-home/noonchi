// 실시간 두뇌 연결(BRAIN=1): 폰 카메라 프레임·사진·답 → YOLO 감지(단일 진행·최신 우선) → 존재 판정 → CupBrain → 메시지.
// 대시보드 /events에는 {type:"brain", event} 하나로, 폰에는 요청(request)·행동 부탁(action)·상태 한 줄(brain_line)로 나눠 보낸다.
// 행동은 모두 모의다(actor.ts): 기기 명령·LG ThinQ 호출이 없다.
//
// 촬영 시각(계획서 2026-11-04-brain-live.md "촬영 시각"): 폰이 NTP식 clock 핑으로 서버 시계에 맞춘 captured_at과 오차
// time_err_ms를 보내면 captured_at − time_err_ms(가장 이른 가능 시각)를 쓴다. 근거 나이·"판단 뒤"·"요청 뒤" 검사가
// 모두 보수적이 된다. 없으면 받은 시각을 쓰고 time_source "received"로 표시한다.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInference } from "../infer/inference.js";
import type { EyePose } from "../phone/align.js";
import { CupBrain, type BrainOutput } from "./brain.js";
import { loadBrainConfig, type BrainConfig } from "./config.js";
import { CUP_FSM_MEMORY, CUP_TASKS, type DecisionModel } from "./decision.js";
import { WorkerDetector, YOLOX_MODELS, type Detector, type YoloxModel } from "./detector.js";
import { PamClient, PamDecision } from "./pam.js";
import { VlmPerceiver, type Perceiver } from "./perception.js";
import { DEFAULT_PRESENCE, PresenceTracker, tableInView, type Surface } from "./presence.js";
import type { Frame } from "./window.js";

type Env = Record<string, string | undefined>;

export interface FrameMeta {
  receivedAtMs: number;
  /** 폰이 서버 시계로 옮긴 촬영 시각(ms). */
  capturedAt?: number;
  /** 그 시각의 오차(ms, 동기 왕복의 절반). */
  timeErrMs?: number;
  /** 그 프레임 순간 트윈 좌표 눈 자세(맞추기 전 null). */
  eye: EyePose | null;
}

/** 촬영 시각 범위: 동기 정보가 있으면 [captured_at − 오차, captured_at + 오차], 없으면 받은 시각 하나. 받은 시각보다 늦을 수 없다.
 *  atMs(이른 쪽)는 근거 나이·"판단 뒤"·"요청 뒤" 검사에, latestMs(늦은 쪽)는 구간을 시작할 때 쓴다(machine.ts). */
export function captureTime(meta: FrameMeta): { atMs: number; latestMs: number; source: "phone" | "received" } {
  const { capturedAt, timeErrMs } = meta;
  if (typeof capturedAt === "number" && Number.isFinite(capturedAt) && typeof timeErrMs === "number" && Number.isFinite(timeErrMs) && timeErrMs >= 0) {
    const latestMs = Math.min(meta.receivedAtMs, Math.round(capturedAt + timeErrMs));
    return { atMs: Math.min(latestMs, Math.round(capturedAt - timeErrMs)), latestMs, source: "phone" };
  }
  return { atMs: meta.receivedAtMs, latestMs: meta.receivedAtMs, source: "received" };
}

export interface LiveBrainOptions {
  config: BrainConfig;
  perceiver: Perceiver;
  detector: Detector | null;
  decision: DecisionModel;
  /** 트윈의 식탁·책상(배치가 바뀌면 새로 준다). */
  surfaces: () => Surface[];
  toDashboard: (msg: unknown) => void;
  toPhone: (msg: unknown) => void;
  log?: (line: string) => void;
  clock?: { now(): number };
  tickMs?: number;
}

export interface LiveStatus {
  state: string;
  detector: string | null;
  decision: string;
  vlm_calls: number;
  vlm_cost_usd: number;
  capped: boolean;
  frames: number;
  detected: number;
  detect_ms: number | null;
  time_source: "phone" | "received" | null;
  time_err_ms: number | null;
}

export class LiveBrain {
  readonly brain: CupBrain;
  private readonly tracker: PresenceTracker;
  private readonly clock: { now(): number };
  private readonly timer: NodeJS.Timeout;
  private seq = 0;
  private job: { frame: Frame; table: "yes" | "no" | "unknown"; tableId?: string } | null = null;
  private detecting: Promise<void> | null = null;
  private frames = 0;
  private detected = 0;
  private detectMs: number[] = [];
  private lastTime: { source: "phone" | "received"; err: number | null } | null = null;
  private detectError = "";
  private closed = false;

  constructor(private readonly opts: LiveBrainOptions) {
    this.clock = opts.clock ?? { now: () => Date.now() };
    this.tracker = new PresenceTracker({ ...DEFAULT_PRESENCE, holdMs: opts.config.holdMs });
    this.brain = new CupBrain({
      perceiver: opts.perceiver, decision: opts.decision, config: opts.config, clock: this.clock,
      emit: (e) => this.route(e), tasks: [...CUP_TASKS], memory: CUP_FSM_MEMORY, memoryKind: "fsm",
      time: { offsetMinutes: -new Date().getTimezoneOffset(), epochMs: 0 }, presence: opts.detector !== null, acting: true,
    });
    this.timer = setInterval(() => this.brain.tick(), opts.tickMs ?? 250);
    this.timer.unref?.();
  }

  private route(e: BrainOutput): void {
    if (this.closed) return; // 닫은 뒤 늦게 끝난 판정·판단은 보내지 않는다
    this.opts.toDashboard({ type: "brain", event: e });
    if (e.type === "request") this.opts.toPhone({ type: "request", id: e.id, text: e.text, active: e.active });
    else if (e.type === "action") {
      this.opts.toPhone({
        type: "action", id: e.id, task: e.task, active: e.active, dry_run: true, would: e.plan.would,
        text: e.plan.prompt?.text ?? e.plan.dashboard, choices: e.plan.prompt?.choices ?? [],
      });
    } else if (e.type === "brain" && e.stage !== "stale") this.opts.toPhone({ type: "brain_line", stage: e.stage, text: e.text });
  }

  private frameOf(jpeg: Buffer, meta: FrameMeta, prefix: string): Frame {
    const t = captureTime(meta);
    this.lastTime = { source: t.source, err: meta.timeErrMs ?? null };
    return { id: `${prefix}${++this.seq}`, capturedAtMs: t.atMs, latestAtMs: t.latestMs, jpeg };
  }

  /** 화면 프레임(초당 12장 안팎). */
  onFrame(jpeg: Buffer, meta: FrameMeta): void {
    if (this.closed) return;
    this.frames++;
    const frame = this.frameOf(jpeg, meta, "f");
    this.brain.onFrame(frame);
    if (!this.opts.detector) return;
    // 감지는 하나씩: 진행 중이면 가장 새 프레임만 남긴다(줄 세우지 않음)
    const view = tableInView(meta.eye, this.opts.surfaces());
    this.job = { frame, table: view.table, ...(view.id ? { tableId: view.id } : {}) };
    if (!this.detecting) this.detecting = this.drain().finally(() => { this.detecting = null; });
  }

  private async drain(): Promise<void> {
    while (this.job && !this.closed) {
      const { frame, table, tableId } = this.job;
      this.job = null;
      try {
        const r = await this.opts.detector!.detect(frame.jpeg);
        this.detected++;
        this.detectMs.push(r.ms);
        if (this.detectMs.length > 50) this.detectMs.shift();
        const pr = this.tracker.push({ atMs: frame.capturedAtMs, latestMs: frame.latestAtMs, detections: r.detections, table, tableId });
        if (pr && !this.closed) this.brain.onPresence(pr);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg !== this.detectError) this.opts.log?.(`[두뇌] YOLO 감지 실패: ${msg}`);
        this.detectError = msg;
      }
    }
  }

  /** '사진 찍기' 사진. 요청이 떠 있고 요청 뒤 찍힌 사진이면 그 사진으로 컵 안을 본다. */
  onPhoto(jpeg: Buffer, meta: FrameMeta): "answer" | "no_request" {
    if (this.closed) return "no_request";
    return this.brain.answerPhoto(this.frameOf(jpeg, meta, "p")) ? "answer" : "no_request";
  }

  onReply(id: string, choice: string): void {
    if (!this.closed) this.brain.reply(id, choice);
  }

  /** 진행 중인 감지·판정·판단이 끝날 때까지 기다린다(시험용). */
  async idle(): Promise<void> {
    while (this.detecting) await this.detecting;
    await this.brain.idle();
  }

  status(): LiveStatus {
    const s = this.brain.stats();
    return {
      state: s.state, detector: this.opts.detector?.name ?? null, decision: this.opts.decision.name,
      vlm_calls: s.calls, vlm_cost_usd: Math.round(s.costUsd * 1e5) / 1e5, capped: s.capped, frames: this.frames, detected: this.detected,
      detect_ms: this.detectMs.length ? Math.round(this.detectMs.reduce((a, b) => a + b, 0) / this.detectMs.length) : null,
      time_source: this.lastTime?.source ?? null, time_err_ms: this.lastTime?.err ?? null,
    };
  }

  /** 닫기: 진행 중인 VLM·PAM 호출(최대 수십 초)은 기다리지 않는다. 늦게 끝난 결과는 route가 버린다. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.brain.stop(); // 판정 반복은 끝날 때마다 스스로 다시 부르므로 멈춰야 한다(안 멈추면 닫은 뒤에도 VLM 비용이 나간다)
    this.job = null;
    await this.opts.detector?.close?.();
    await this.detecting?.catch(() => {});
  }
}

export interface CreateLiveBrainOptions {
  env: Env;
  runtimeDir: string;
  surfaces: () => Surface[];
  toDashboard: (msg: unknown) => void;
  toPhone: (msg: unknown) => void;
  log: (line: string) => void;
  /** 시험용 주입. detector는 null이면 감지기 없이(VLM만). */
  inject?: { perceiver?: Perceiver; detector?: Detector | null; decision?: DecisionModel; clock?: { now(): number } };
}

/** 환경 변수로 두뇌를 만든다. VLM은 추론 모드가 고른 주소(src/infer)로 부른다. 감지기 모델이 없으면 VLM만으로 돈다(경고). */
export async function createLiveBrain(o: CreateLiveBrainOptions): Promise<LiveBrain> {
  const { env, log } = o;
  const config = loadBrainConfig(env);
  const inference = createInference(env);
  const perceiver = o.inject?.perceiver ?? new VlmPerceiver(inference.vlm);
  let detector: Detector | null;
  if (o.inject && "detector" in o.inject) {
    detector = o.inject.detector ?? null;
  } else {
    const want = (env.BRAIN_DETECTOR?.trim() || "yolox_tiny") as YoloxModel | "off";
    detector = null;
    if (want !== "off") {
      const model = YOLOX_MODELS[want];
      const path = env.BRAIN_YOLO_PATH?.trim() || (model ? join(o.runtimeDir, "models", model.file) : "");
      if (!model && !env.BRAIN_YOLO_PATH) log(`[경고] BRAIN_DETECTOR=${want}: yolox_tiny·yolox_nano·off 중 하나여야 합니다. VLM만 씁니다.`);
      else if (!existsSync(path)) log(`[경고] YOLO 모델 파일이 없습니다(${path}). VLM만 씁니다. 받기: npx tsx scripts/brain-yolo-fetch.ts ${want}`);
      else {
        try {
          detector = await WorkerDetector.create(path, { threads: Number(env.BRAIN_YOLO_THREADS) || 4 });
        } catch (e) {
          log(`[경고] YOLO를 불러오지 못했습니다(${(e as Error).message}). VLM만 씁니다.`);
        }
      }
    }
  }
  // 판단은 늘 PAM 서비스(PAM_URL)다. 서비스가 없으면 판단마다 실패로 기록된다
  const decision = o.inject?.decision
    ?? new PamDecision(new PamClient({ url: inference.endpoints.pamUrl, timeoutMs: Number(env.PAM_TIMEOUT_MS) || undefined }));
  log(`두뇌: 감지 ${detector?.name ?? "없음(VLM만)"} · VLM ${inference.vlm.model} · 판단 ${decision.name} · 행동 모의(기기 명령 없음)`);
  return new LiveBrain({
    config, perceiver, detector, decision, surfaces: o.surfaces, toDashboard: o.toDashboard, toPhone: o.toPhone, log, clock: o.inject?.clock,
  });
}
