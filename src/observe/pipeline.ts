// 관찰 흐름(BRAIN=1): 엔진 프레임 → 고리(중복 버림) → YOLO 감지·관절(워커, 상한 있는 대기열에서 하나씩, 관절은 사람이 보일 때만) → VLM(동시 요청) → World State → /events.
// VLM은 엔진 프레임마다 한 번, 그 프레임과 앞선 프레임을 창 크기(VLM_WINDOW_FRAMES, 기본 5장 = 2초 간격이면 10초)까지 오래된 것부터 받는다.
// 프레임마다 observe 기록이 반드시 남는다: 대기열이 차면 YOLO·VLM 분석 없음, 감지 실패면 YOLO 분석 없음(VLM은 그대로 분석),
// 고리 범위(keepMs)보다 앞서 찍힌 늦은 프레임은 분석하지 않고 YOLO·VLM 분석 없음(stale). 늦은 프레임은 World State·눈 자세에 넣지 않는다.
// 감지 번호(d1…)와 물체 id의 짝은 그 프레임의 VLM 답(또는 분석 없음)이 올 때까지 둔다.
// 분석한 사진은 메모리 고리에만 있다. 디스크에 쓰지 않는다. DATASET_COLLECT=1이면 dataset(시험 자료 저장, src/history/retention.ts)이 고리에 넣은 프레임을 받는다.
import { existsSync } from "node:fs";
import type { BrainLog } from "../contract/events.js";
import type { WorldChange, WorldView, YoloMissing } from "../contract/world.js";
import type { DeviceState } from "../hub/types.js";
import {
  DETECTOR_MODELS, POSE_MODELS, WorkerDetector, modelPath, type Detection, type Detector, type DetectorModel, type DetectorSpec, type Pose, type PoseModel,
} from "../brain/detector.js";
import { vlmTimeoutMs } from "../infer/endpoints.js";
import { createInference } from "../infer/inference.js";
import type { VlmClient } from "../infer/vlm.js";
import type { FrameHeader } from "../phone/packet.js";
import type { CameraView, EyeEvent } from "../phone/session.js";
import { OBJECT_NAME, YOLO_TEXT } from "../world/labels.js";
import type { WorldState } from "../world/state.js";
import { captureTime, FrameRing, sha256, type EngineFrame } from "./ring.js";
import { analyzeScene, type SceneDetection } from "./scene.js";
import { VlmPool } from "./vlm-pool.js";

type Env = Record<string, string | undefined>;

export interface ObserveConfig {
  /** 엔진 프레임 간격(ms). 폰 서버가 상태 메시지로 폰에 알린다. */
  engineMs: number;
  vlmMaxInflight: number;
  vlmTimeoutMs: number;
  /** YOLO 대기열 상한. 차면 그 프레임은 YOLO·VLM 분석 없음. */
  detectQueueMax: number;
  /** 메모리 고리 길이(ms). */
  keepMs: number;
  /** VLM 한 번에 보내는 최근 엔진 프레임 수(그 프레임 포함, 없으면 VLM_WINDOW_DEFAULT). 창 시간은 이 수 × engineMs. */
  vlmWindowFrames?: number;
}

/** VLM 창 기본 크기: PAM 원래 입력처럼 2초 간격 5장. */
export const VLM_WINDOW_DEFAULT = 5;
const VLM_WINDOW_MAX = 10;

const int = (env: Env, key: string, d: number, min: number) => {
  const raw = env[key]?.trim();
  if (!raw) return d;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < min) throw new Error(`${key}=${raw}: ${min} 이상의 숫자여야 합니다`);
  return Math.floor(v);
};

/** ENGINE_FRAME_MS(기본 2000, 200 이상), VLM_MAX_INFLIGHT(4), VLM_TIMEOUT_MS(20000), DETECT_QUEUE_MAX(8), VLM_WINDOW_FRAMES(5, 1~10).
 *  고리는 20초, 창 시간이 더 길면 창 시간. 틀린 값이면 시작을 막는다. */
export function loadObserveConfig(env: Env): ObserveConfig {
  const engineMs = int(env, "ENGINE_FRAME_MS", 2000, 200);
  const vlmWindowFrames = int(env, "VLM_WINDOW_FRAMES", VLM_WINDOW_DEFAULT, 1);
  if (vlmWindowFrames > VLM_WINDOW_MAX) throw new Error(`VLM_WINDOW_FRAMES=${env.VLM_WINDOW_FRAMES}: 1~${VLM_WINDOW_MAX}이어야 합니다`);
  return {
    engineMs, vlmMaxInflight: int(env, "VLM_MAX_INFLIGHT", 4, 1), vlmTimeoutMs: vlmTimeoutMs(env),
    detectQueueMax: int(env, "DETECT_QUEUE_MAX", 8, 1), keepMs: Math.max(20_000, vlmWindowFrames * engineMs), vlmWindowFrames,
  };
}

/** 프레임마다 생기는 분석 없음은 observe 기록으로 남기므로 world_change로 다시 보내지 않는다. */
const PER_FRAME = new Set(["vlm_missing", "yolo_missing"]);

const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

const yoloText =(dets: Detection[]) => (dets.length ? dets.map((d) => `${OBJECT_NAME[d.label] ?? d.label} ${d.score.toFixed(2)}`).join(" · ") : YOLO_TEXT.none);

export interface PipelineOptions {
  config: ObserveConfig;
  /** null이면 감지기 없이 VLM만(모델 파일이 없을 때). */
  detector: Detector | null;
  vlm: VlmClient;
  world: WorldState;
  emit: (log: BrainLog) => void;
  broadcastWorld: (w: WorldView) => void;
  /** World State 변화(분석 없음 포함). 판단 호출 시점이 받는다. */
  onChanges?: (c: WorldChange[]) => void;
  /** 엔진 프레임이 올 때마다(같은 사진·늦은 프레임 포함). 판단 호출 시점이 관찰이 살아 있는지 본다. */
  onFrame?: () => void;
  /** 시험 자료 저장(DATASET_COLLECT=1일 때만). 고리에 넣은 프레임마다 부른다. */
  dataset?: (f: EngineFrame) => void;
  clock?: { now(): number };
}

export interface PipelineStatus {
  frames: number;
  duplicates: number;
  detector: string | null;
  /** 관절 모델 이름(없으면 null). */
  pose: string | null;
  vlm_model: string;
  detected: number;
  detect_ms: number | null;
  /** 관절을 돌린 프레임 수와 평균 시간(ms). 사람이 보인 프레임만 돌린다. */
  posed: number;
  pose_ms: number | null;
  queued: number;
  yolo_missing: Record<YoloMissing, number>;
  vlm: ReturnType<VlmPool["stats"]>;
  time_source: "phone" | "received" | null;
  time_err_ms: number | null;
  /** 시험 자료로 쓴 프레임 수와 쓰지 못한 수(DATASET_COLLECT=1이 아니면 null). */
  dataset: { saved: number; failed: number } | null;
}

export class ObservationPipeline {
  private readonly ring: FrameRing;
  private readonly pool: VlmPool;
  private readonly clock: { now(): number };
  private readonly idsOf = new Map<string, Map<string, string>>();
  private readonly queue: EngineFrame[] = [];
  private detecting: Promise<void> | null = null;
  private seq = 0;
  private frames = 0;
  private detected = 0;
  private readonly yoloMissing: Record<YoloMissing, number> = { cap: 0, error: 0, stale: 0 };
  private detectMs: number[] = [];
  private poseMs: number[] = [];
  private posed = 0;
  private timeSource: "phone" | "received" | null = null;
  private timeErr: number | null = null;
  private readonly datasetCount = { saved: 0, failed: 0 };
  private closed = false;

  constructor(private readonly o: PipelineOptions) {
    this.clock = o.clock ?? { now: () => Date.now() };
    this.ring = new FrameRing(o.config.keepMs);
    const windowFrames = o.config.vlmWindowFrames ?? VLM_WINDOW_DEFAULT;
    this.pool = new VlmPool({
      maxInflight: o.config.vlmMaxInflight, timeoutMs: o.config.vlmTimeoutMs,
      analyze: (f, d, signal) => analyzeScene(o.vlm, this.ring.window(f, windowFrames, windowFrames * o.config.engineMs), d, signal),
      onResult: (r) => {
        if (this.closed) return;
        const ids = this.idsOf.get(r.frameId) ?? new Map<string, string>();
        this.idsOf.delete(r.frameId);
        const changes = r.scene ? o.world.applyScene(r.frameId, r.capturedAtMs, r.scene, ids) : o.world.applyMissing(r.frameId, r.capturedAtMs, { vlm: r.missing! });
        o.emit({ type: "observe", at_ms: this.clock.now(), frame_id: r.frameId, captured_at_ms: r.capturedAtMs, yolo: null, vlm: r.scene?.summary ?? null, ...(r.missing ? { vlm_missing: r.missing } : {}) });
        this.publish(changes);
      },
    });
  }

  get config(): ObserveConfig {
    return this.o.config;
  }

  private publish(changes: WorldChange[]): void {
    if (this.closed || !changes.length) return;
    for (const c of changes) if (!PER_FRAME.has(c.kind)) this.o.emit({ type: "world_change", at_ms: this.clock.now(), kind: c.kind, text: c.text });
    this.o.onChanges?.(changes);
    this.o.broadcastWorld(this.o.world.view(this.clock.now()));
  }

  onEngine(jpeg: Buffer, header: FrameHeader, eye: EyeEvent | null, view: CameraView | null, receivedAtMs: number): void {
    if (this.closed) return;
    this.o.onFrame?.();
    const t = captureTime({ receivedAtMs, capturedAt: header.captured_at, timeErrMs: header.time_err_ms });
    this.timeSource = t.source;
    this.timeErr = t.source === "phone" ? header.time_err_ms ?? null : null;
    const frame: EngineFrame = { id: `e${++this.seq}`, capturedAtMs: t.atMs, latestAtMs: t.latestMs, jpeg, sha256: sha256(jpeg), width: header.width, height: header.height, eye, view };
    const pushed = this.ring.push(frame);
    if (pushed === "duplicate") return;
    this.frames++;
    if (pushed === "stale") {
      this.missBoth(frame, "stale");
      return;
    }
    if (this.o.dataset) {
      try {
        this.o.dataset(frame);
        this.datasetCount.saved++;
      } catch {
        this.datasetCount.failed++;
      }
    }
    this.o.world.setEye(eye, t.atMs);
    if (!this.o.detector) {
      this.analyze(frame, undefined);
      return;
    }
    if (this.queue.length >= this.o.config.detectQueueMax) {
      this.missBoth(frame, "cap");
      return;
    }
    this.queue.push(frame);
    if (!this.detecting) this.detecting = this.drain().finally(() => { this.detecting = null; });
  }

  /** 대기열이 찬 프레임(cap)·늦게 온 프레임(stale): YOLO·VLM 둘 다 분석하지 못한 것으로 남긴다. */
  private missBoth(frame: EngineFrame, why: "cap" | "stale"): void {
    this.yoloMissing[why]++;
    this.o.emit({ type: "observe", at_ms: this.clock.now(), frame_id: frame.id, captured_at_ms: frame.capturedAtMs, yolo: null, yolo_missing: why, vlm: null, vlm_missing: why });
    this.publish(this.o.world.applyMissing(frame.id, frame.capturedAtMs, { yolo: why, vlm: why }));
  }

  /** YOLO 결과(실패면 null, 감지기가 없으면 undefined)를 World State에 넣고 같은 프레임을 VLM에 보낸다.
   *  YOLO 결과 observe에만 상자(엔진 프레임 픽셀)와 프레임 크기를 싣는다(대시보드 폰 칸).
   *  World State가 받지 않는 낮은 신뢰도 감지는 상자·YOLO 글·VLM 감지 목록에서 뺀다: 화면·VLM·World State가 같은 감지를 본다.
   *  관절(poses)은 World State만 받는다(자세·손에 듦 사실). */
  private analyze(frame: EngineFrame, raw: Detection[] | null | undefined, poses?: Pose[]): void {
    const dets = raw && raw.filter((d) => this.o.world.accepts(d));
    const base = { type: "observe" as const, frame_id: frame.id, captured_at_ms: frame.capturedAtMs, vlm: null };
    if (dets === undefined) {
      this.idsOf.set(frame.id, new Map());
      this.o.emit({ ...base, at_ms: this.clock.now(), yolo: YOLO_TEXT.noDetector });
    } else if (dets) {
      const { changes, ids } = this.o.world.applyDetections(frame, dets, poses);
      this.idsOf.set(frame.id, ids);
      this.o.emit({
        ...base, at_ms: this.clock.now(), yolo: yoloText(dets),
        boxes: dets.map(({ label, score, box }) => ({ label, score, box })), frame: { width: frame.width, height: frame.height },
      });
      this.publish(changes);
    } else {
      this.yoloMissing.error++;
      this.idsOf.set(frame.id, new Map());
      this.o.emit({ ...base, at_ms: this.clock.now(), yolo: null, yolo_missing: "error" });
      this.publish(this.o.world.applyMissing(frame.id, frame.capturedAtMs, { yolo: "error" }));
    }
    const sceneDets: SceneDetection[] = (dets ?? []).map((d, i) => ({ id: `d${i + 1}`, class: d.label, box: d.box, score: d.score }));
    this.pool.submit(frame, sceneDets); // 상한을 넘으면 풀이 VLM 분석 없음(cap)을 onResult로 낸다
  }

  private async drain(): Promise<void> {
    while (this.queue.length && !this.closed) {
      const frame = this.queue.shift()!;
      let dets: Detection[] | null;
      let poses: Pose[] | undefined;
      try {
        const r = await this.o.detector!.detect(frame.jpeg);
        this.detected++;
        this.detectMs = [...this.detectMs.slice(-49), r.ms];
        if (r.poseMs !== undefined) {
          this.posed++;
          this.poseMs = [...this.poseMs.slice(-49), r.poseMs];
        }
        dets = r.detections;
        poses = r.poses;
      } catch {
        dets = null;
      }
      if (!this.closed) this.analyze(frame, dets, poses);
    }
  }

  onDevice(s: DeviceState): void {
    if (!this.closed) this.publish(this.o.world.applyDevice(s, this.clock.now()));
  }

  status(): PipelineStatus {
    return {
      frames: this.frames, duplicates: this.ring.dropped, detector: this.o.detector?.name ?? null, pose: this.o.detector?.pose ?? null, vlm_model: this.o.vlm.model,
      detected: this.detected, detect_ms: mean(this.detectMs), posed: this.posed, pose_ms: mean(this.poseMs),
      queued: this.queue.length, yolo_missing: { ...this.yoloMissing }, vlm: this.pool.stats(), time_source: this.timeSource, time_err_ms: this.timeErr,
      dataset: this.o.dataset ? { ...this.datasetCount } : null,
    };
  }

  /** 진행 중인 감지·VLM 요청이 끝날 때까지 기다린다(시험용). */
  async idle(): Promise<void> {
    while (this.detecting) await this.detecting;
    await this.pool.idle();
  }

  /** 닫기: 나가 있는 VLM 요청을 끊고 감지기를 닫는다. 닫은 뒤 끝난 결과는 내지 않는다. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.pool.stop();
    this.queue.length = 0;
    await this.o.detector?.close?.();
    await this.detecting?.catch(() => {});
  }
}

/** 시험용 주입. detector는 null이면 감지기 없이(VLM만). */
export interface PipelineInject { detector?: Detector | null; vlm?: VlmClient; clock?: { now(): number } }

/** 감지기 고르기: BRAIN_DETECTOR(yolo26n 기본·yolox_tiny·yolox_nano·off), BRAIN_POSE(yolo26n-pose 기본·off), BRAIN_YOLO_PATH·BRAIN_POSE_PATH(파일 직접),
 *  BRAIN_YOLO_THREADS(4). 모르는 이름이면 그 모델 없이(감지기는 VLM만, 관절은 감지만) 경고를 낸다. */
export function chooseDetector(env: Env, runtimeDir: string): { spec: DetectorSpec | null; warn?: string } {
  const want = env.BRAIN_DETECTOR?.trim() || "yolo26n";
  if (want === "off") return { spec: null };
  const model = (DETECTOR_MODELS as Record<string, (typeof DETECTOR_MODELS)[DetectorModel] | undefined>)[want];
  if (!model) return { spec: null, warn: `[경고] BRAIN_DETECTOR=${want}: ${Object.keys(DETECTOR_MODELS).join("·")}·off 중 하나여야 합니다. VLM만 씁니다.` };
  const poseWant = env.BRAIN_POSE?.trim() || "yolo26n-pose";
  const pose = (POSE_MODELS as Record<string, (typeof POSE_MODELS)[PoseModel] | undefined>)[poseWant];
  const warn = poseWant !== "off" && !pose ? `[경고] BRAIN_POSE=${poseWant}: ${Object.keys(POSE_MODELS).join("·")}·off 중 하나여야 합니다. 관절 없이 감지만 씁니다.` : undefined;
  const spec: DetectorSpec = {
    modelPath: env.BRAIN_YOLO_PATH?.trim() || modelPath(model, runtimeDir), kind: model.kind,
    posePath: pose ? env.BRAIN_POSE_PATH?.trim() || modelPath(pose, runtimeDir) : null, threads: Number(env.BRAIN_YOLO_THREADS) || 4,
  };
  return warn ? { spec, warn } : { spec };
}

/** 감지기를 워커로 띄운다. 감지 모델 파일이 없으면 VLM만, 관절 모델 파일이 없으면 감지만(경고). */
async function createDetector(env: Env, runtimeDir: string, log: (line: string) => void): Promise<Detector | null> {
  const { spec, warn } = chooseDetector(env, runtimeDir);
  if (warn) log(warn);
  if (!spec) return null;
  if (!existsSync(spec.modelPath)) {
    log(`[경고] YOLO 모델 파일이 없습니다(${spec.modelPath}). VLM만 씁니다. 확인·받기: npx tsx scripts/brain-yolo-fetch.ts ${env.BRAIN_DETECTOR?.trim() ?? ""}`.trimEnd());
    return null;
  }
  if (spec.posePath && !existsSync(spec.posePath)) {
    log(`[경고] 관절 모델 파일이 없습니다(${spec.posePath}). 관절 없이 감지만 씁니다.`);
    spec.posePath = null;
  }
  try {
    return await WorkerDetector.create(spec);
  } catch (e) {
    log(`[경고] YOLO를 불러오지 못했습니다(${(e as Error).message}). VLM만 씁니다.`);
    return null;
  }
}

/** 환경 변수로 관찰 흐름을 만든다. VLM은 추론 모드가 고른 OpenAI 호환 주소(src/infer)다. */
export async function createPipeline(o: {
  env: Env; runtimeDir: string; world: WorldState; emit: (log: BrainLog) => void; broadcastWorld: (w: WorldView) => void;
  onChanges?: (c: WorldChange[]) => void; onFrame?: () => void; log: (line: string) => void; inject?: PipelineInject; dataset?: (f: EngineFrame) => void;
}): Promise<ObservationPipeline> {
  const config = loadObserveConfig(o.env);
  const detector = o.inject && "detector" in o.inject ? o.inject.detector ?? null : await createDetector(o.env, o.runtimeDir, o.log);
  const vlm = o.inject?.vlm ?? createInference(o.env).vlm;
  o.log(`관찰 흐름: 엔진 프레임 ${config.engineMs}ms · 감지 ${detector?.name ?? "없음(VLM만)"} · VLM ${vlm.model} 최근 ${config.vlmWindowFrames}장 동시 ${config.vlmMaxInflight}개 · 감지 대기열 ${config.detectQueueMax}`);
  if (o.dataset) o.log("[경고] 시험 자료 모으기가 켜져 있습니다. 엔진 프레임을 디스크에 씁니다.");
  return new ObservationPipeline({
    config, detector, vlm, world: o.world, emit: o.emit, broadcastWorld: o.broadcastWorld, onChanges: o.onChanges, onFrame: o.onFrame, dataset: o.dataset, clock: o.inject?.clock,
  });
}
