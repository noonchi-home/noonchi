// 관찰 흐름(BRAIN=1): 엔진 프레임 → 고리(중복 버림) → YOLO 감지·관절(워커, 상한 있는 대기열에서 하나씩, 관절은 사람이 보일 때만) → VLM(동시 요청) → World State → /events.
// VLM은 엔진 프레임마다 한 번, 그 프레임과 앞선 프레임을 창 크기(VLM_WINDOW_FRAMES, 기본 5장 = 2초 간격이면 10초)까지 오래된 것부터 받는다.
// 프레임마다 observe 기록이 반드시 남는다: 대기열이 차면 YOLO·VLM 분석 없음, 감지 실패면 YOLO 분석 없음(VLM은 그대로 분석),
// 고리 범위(keepMs)보다 앞서 찍힌 늦은 프레임은 분석하지 않고 YOLO·VLM 분석 없음(stale). 늦은 프레임은 World State·눈 자세에 넣지 않는다.
// 감지 번호(d1…)와 물체 id의 짝은 그 프레임의 VLM 답(또는 분석 없음)이 올 때까지 둔다.
// 분석한 사진은 메모리 고리에만 있다. 디스크에 쓰지 않는다. DATASET_COLLECT=1이면 dataset(시험 자료 저장, src/history/retention.ts)이 고리에 넣은 프레임을 받는다.
// 가까이 보기(closer): 고리의 새 프레임 최대 5장마다 대상 자리를 그 프레임 카메라로 찍어 절반 크기로 잘라 2배로 키우고 같은 감지기로 본다.
// 잘라 본 결과는 보통 프레임처럼 넣지 않고 World State applyCloser로 한 번에 합친다. 물건 감지가 있는 가장 새 장(없으면 가장 새 장) 하나만
// VLM 풀의 가까이 보기 자리로 혼자 보내고 그 답은 applyCloserScene으로 넣는다(그때도 사진이 끊김 범위 안일 때만). 3장이 안 된 새 물건 후보는 그 답이 사실을 답할 때만 만든다.
// 가까이 보기 VLM은 closerVlm(VLM_CLOSER_MODEL, 같은 주소에 모델 이름만 다름, 없으면 보통 프레임과 같은 VLM)이다.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BrainLog, CloserMiss, CloserResult, CloserVlm, SeenEvent } from "../contract/events.js";
import type { WorldChange, WorldView, YoloMissing } from "../contract/world.js";
import type { DeviceState } from "../hub/types.js";
import { DETECTOR_MODEL, MODELS_DIR, POSE_MODEL, PROVIDERS, WorkerDetector, type DetectResult, type Detector, type DetectorSpec, type Provider } from "../brain/detector.js";
import type { Detection, Pose, CameraView, EngineFrame } from "../contract/observe.js";
import { hasPrice } from "../infer/cost.js";
import { vlmTimeoutMs } from "../infer/endpoints.js";
import { createInference } from "../infer/inference.js";
import type { VlmClient } from "../infer/vlm.js";
import type { FrameHeader } from "../phone/packet.js";
import type { EyeEvent } from "../phone/session.js";
import { OBJECT_NAME, YOLO_TEXT } from "../world/labels.js";
import { inView, pixelOf } from "../world/place.js";
import { CLOSER_NEW_FRAMES, type CloserPass, type WorldState } from "../world/state.js";
import { cropBox, cropJpeg, LOOK_MARGIN, onCropEdge, toFrameDetection, type Box, type LookSpot } from "./crop.js";
import { captureTime, FrameRing, sha256 } from "./ring.js";
import { analyzeScene, CLOSER_NOTE, type SceneDetection } from "./scene.js";
import { VlmPool, type VlmResult } from "./vlm-pool.js";

type Env = Record<string, string | undefined>;

export interface ObserveConfig {
  /** 엔진 프레임 간격(ms). 폰 서버가 상태 메시지로 폰에 알린다. 모든 엔진 프레임에 YOLO를 돌린다. */
  engineMs: number;
  /** VLM 프레임 간격(ms): 앞 VLM 프레임보다 이만큼 뒤에 찍힌 엔진 프레임만 VLM·기록·가까이 보기에 쓴다. 없으면 모든 엔진 프레임이 VLM 프레임이다. */
  vlmMs?: number;
  vlmMaxInflight: number;
  vlmTimeoutMs: number;
  /** YOLO 대기열 상한. 차면 그 프레임은 YOLO·VLM 분석 없음. */
  detectQueueMax: number;
  /** 메모리 고리 길이(ms). */
  keepMs: number;
  /** VLM 한 번에 보내는 최근 VLM 프레임 수(그 프레임 포함, 없으면 VLM_WINDOW_DEFAULT). 창 시간은 이 수 × VLM 프레임 간격. */
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

/** ENGINE_FRAME_MS(기본 100, 50 이상), VLM_FRAME_MS(기본 2000, ENGINE_FRAME_MS 이상. ENGINE_FRAME_MS가 더 크면 그 값),
 *  VLM_MAX_INFLIGHT(4), VLM_TIMEOUT_MS(20000), DETECT_QUEUE_MAX(8), VLM_WINDOW_FRAMES(5, 1~10).
 *  고리는 20초, 창 시간(창 크기 × VLM 프레임 간격)이 더 길면 창 시간. 틀린 값이면 시작을 막는다. */
export function loadObserveConfig(env: Env): ObserveConfig {
  const engineMs = int(env, "ENGINE_FRAME_MS", 100, 50);
  // VLM_FRAME_MS를 안 주고 엔진 간격만 2초보다 길게 주면 VLM도 그 간격을 따른다
  const vlmMs = env.VLM_FRAME_MS?.trim() ? int(env, "VLM_FRAME_MS", 2000, engineMs) : Math.max(2000, engineMs);
  const vlmWindowFrames = int(env, "VLM_WINDOW_FRAMES", VLM_WINDOW_DEFAULT, 1);
  if (vlmWindowFrames > VLM_WINDOW_MAX) throw new Error(`VLM_WINDOW_FRAMES=${env.VLM_WINDOW_FRAMES}: 1~${VLM_WINDOW_MAX}이어야 합니다`);
  return {
    engineMs, vlmMs, vlmMaxInflight: int(env, "VLM_MAX_INFLIGHT", 4, 1), vlmTimeoutMs: vlmTimeoutMs(env),
    detectQueueMax: int(env, "DETECT_QUEUE_MAX", 8, 1), keepMs: Math.max(20_000, vlmWindowFrames * vlmMs), vlmWindowFrames,
  };
}

/** VLM 프레임 간격(없으면 엔진 프레임 간격): VLM 창·가까이 보기 범위가 쓴다. */
export const vlmStepMs = (c: Pick<ObserveConfig, "engineMs" | "vlmMs">): number => c.vlmMs ?? c.engineMs;
/** 감지 대기열에 둘 수 있는 빠른 프레임(VLM 프레임 아님) 수. 넘으면 오래된 빠른 프레임부터 조용히 버린다(최신 우선). */
export const FAST_QUEUE_MAX = 2;

/** 가까이 보기로 잘라 볼 최대 장 수. 최소는 World State가 VLM 확인 없이 새 물건을 만드는 서로 다른 원본 프레임 수(CLOSER_NEW_FRAMES, 3장)다.
 *  잘라 본 사진의 YOLO가 싱크대 안 유리컵을 장마다 절반쯤만 잡으므로 최근 5장 중 3장에서 보이면 새 물건이 된다.
 *  그보다 적게 보여도 VLM에 보낸 장의 그 감지에 VLM이 사실을 답하면 새 물건이 된다(World State CloserPending). */
export const CLOSER_FRAMES = 5;
/** 가까이 보기 촬영 범위와 끊김 검사의 가장 짧은 값(ms). */
export const CLOSER_FRESH_MS = 3000;
/** VLM 풀에 따로 둔 가까이 보기 자리 수. */
export const CLOSER_VLM_SLOTS = 1;

/** 연달은 VLM 프레임 n장이 드는 촬영 시각 폭: (장 수 − 1) × 간격 + 간격 절반, CLOSER_FRESH_MS보다 짧지 않게. 간격은 VLM 프레임 간격이다. */
const spanOf = (frames: number, stepMs: number): number => Math.max(CLOSER_FRESH_MS, (frames - 1) * stepMs + stepMs / 2);
/** 가까이 보기에 쓸 VLM 프레임의 촬영 시각 범위(가장 새 VLM 프레임 기준, ms): 연달은 CLOSER_FRAMES장이 드는 만큼(기본 2초 간격이면 9초). */
export const closerSpanMs = (stepMs: number): number => spanOf(CLOSER_FRAMES, stepMs);
/** 폰 끊김 검사(ms): 가장 새 프레임이 지금보다 이만큼 넘게 앞서 찍혔으면 새 프레임이 안 오는 것으로 본다. 연달은 CLOSER_NEW_FRAMES장 기준(기본 2초 간격이면 5초).
 *  촬영 범위(closerSpanMs)와 따로 둔다: 범위처럼 9초로 늘리면 끊긴 지 9초 된 사진과 그보다 9초 앞선 사진까지 「새 사진」으로 쓴다. */
export const closerStaleMs = (stepMs: number): number => spanOf(CLOSER_NEW_FRAMES, stepMs);

/** 고리 가장 새 프레임의 카메라·촬영 시각·크기(관찰 모드가 대상이 사진 안인지 본다). */
export interface LatestFrame { view: CameraView | null; capturedAtMs: number; width: number; height: number }

/** 프레임마다 생기는 분석 없음은 observe 기록으로 남기므로 world_change로 다시 보내지 않는다. */
const PER_FRAME = new Set(["vlm_missing", "yolo_missing"]);

const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

const yoloText =(dets: Detection[]) => (dets.length ? dets.map((d) => `${OBJECT_NAME[d.label] ?? d.label} ${d.score.toFixed(2)}`).join(" · ") : YOLO_TEXT.none);

export interface PipelineOptions {
  config: ObserveConfig;
  /** null이면 감지기 없이 VLM만(모델 파일이 없을 때). */
  detector: Detector | null;
  vlm: VlmClient;
  /** 가까이 보기 VLM(없으면 vlm). 같은 주소에 모델 이름만 다르다(VLM_CLOSER_MODEL, src/infer/inference.ts). */
  closerVlm?: VlmClient;
  world: WorldState;
  emit: (log: BrainLog) => void;
  broadcastWorld: (w: WorldView) => void;
  /** 감지가 끝난 프레임마다(빠른 프레임 포함) 물체 모양. 대시보드로만 보내고 기록하지 않는다(src/server/home.ts). */
  onSeen?: (e: SeenEvent) => void;
  /** World State 변화(분석 없음 포함). 판단 호출 시점이 받는다. */
  onChanges?: (c: WorldChange[]) => void;
  /** 엔진 프레임이 올 때마다(같은 사진·늦은 프레임 포함). 판단 호출 시점이 관찰이 살아 있는지 본다. */
  onFrame?: () => void;
  /** 시험 자료 저장(DATASET_COLLECT=1일 때만). 고리에 넣은 프레임마다 부른다. */
  dataset?: (f: EngineFrame) => void;
  /** 감지가 끝난 프레임(받은 JPEG 그대로)과 감지 결과. 폰 위치 맞추기가 기준점 상자(landmarks)를 쓴다(src/server/home.ts). */
  onDetected?: (jpeg: Buffer, result: DetectResult) => void;
  clock?: { now(): number };
}

export interface PipelineStatus {
  frames: number;
  duplicates: number;
  detector: string | null;
  /** 관절 모델 이름(없으면 null). */
  pose: string | null;
  /** 감지기가 실제로 붙은 실행 장치(dml·cpu, 감지기 없으면 null). */
  provider: string | null;
  vlm_model: string;
  detected: number;
  detect_ms: number | null;
  /** 관절을 돌린 프레임 수와 평균 시간(ms). 사람이 보인 프레임만 돌린다. */
  posed: number;
  pose_ms: number | null;
  queued: number;
  /** 감지가 밀려 버린 빠른 프레임 수(기록 없음). */
  skipped: number;
  yolo_missing: Record<YoloMissing, number>;
  vlm: ReturnType<VlmPool["stats"]>;
  time_source: "phone" | "received" | null;
  time_err_ms: number | null;
  /** 시험 자료로 쓴 프레임 수와 쓰지 못한 수(DATASET_COLLECT=1이 아니면 null). */
  dataset: { saved: number; failed: number } | null;
  /** 가까이 보기: 해낸 수, 못 한 수(까닭 무엇이든), 그 VLM 비용(달러, vlm.costUsd에도 들어 있다. 가격표에 없는 모델이 답했으면 모름 null), 그 VLM 모델 이름. */
  closer: { looks: number; failed: number; costUsd: number | null; model: string };
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
  private skipped = 0;
  /** 마지막 VLM 프레임의 촬영 시각. */
  private lastVlmAt: number | null = null;
  private readonly yoloMissing: Record<YoloMissing, number> = { cap: 0, error: 0, stale: 0 };
  private detectMs: number[] = [];
  private poseMs: number[] = [];
  private posed = 0;
  private timeSource: "phone" | "received" | null = null;
  private timeErr: number | null = null;
  private readonly datasetCount = { saved: 0, failed: 0 };
  private closed = false;
  /** 가까이 보기가 도는 중(한 번에 하나: 자르기부터 VLM 답까지). */
  private closing = false;
  private closerSeq = 0;
  private readonly closerCount = { looks: 0, failed: 0, costUsd: 0 };
  /** 가까이 보기 VLM 답을 가격표에 없는 모델이 냈다(그 비용은 모름). */
  private closerUnpriced = false;
  private readonly closerVlm: VlmClient;

  constructor(private readonly o: PipelineOptions) {
    this.clock = o.clock ?? { now: () => Date.now() };
    this.ring = new FrameRing(o.config.keepMs);
    this.closerVlm = o.closerVlm ?? o.vlm;
    const windowFrames = o.config.vlmWindowFrames ?? VLM_WINDOW_DEFAULT;
    this.pool = new VlmPool({
      maxInflight: o.config.vlmMaxInflight, timeoutMs: o.config.vlmTimeoutMs, closerSlots: CLOSER_VLM_SLOTS,
      // 잘라 키운 사진은 가까이 보기 VLM에 혼자, 그 사진이 장면 일부라는 한 줄과 보낸다
      analyze: (f, d, signal) => f.crop
        ? this.analyzeCloser(f, d, signal)
        : analyzeScene(o.vlm, this.ring.window(f, windowFrames, windowFrames * vlmStepMs(o.config)), d, signal),
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

  private async analyzeCloser(f: EngineFrame, d: SceneDetection[], signal: AbortSignal) {
    const r = await analyzeScene(this.closerVlm, [f], d, signal, CLOSER_NOTE);
    if (!hasPrice(r.model)) this.closerUnpriced = true;
    return r;
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
    const frame: EngineFrame = { id: `e${++this.seq}`, capturedAtMs: t.atMs, latestAtMs: t.latestMs, jpeg, sha256: sha256(jpeg), width: header.width, height: header.height, eye, view, vlm: false };
    // 붙잡은 장면(held)은 같은 사진이어도 VLM 간격마다 새 관찰로 넣는다: 붙잡는 동안 VLM은 영상이 돌 때와 같은 간격으로 부른다
    // 영상 모드: held
    const pushed = this.ring.push(frame, header.held ? { resendAfterMs: vlmStepMs(this.o.config) } : {});
    if (pushed === "duplicate") return;
    this.frames++;
    if (pushed === "stale") {
      this.missBoth(frame, "stale");
      return;
    }
    // VLM 프레임: 앞 VLM 프레임보다 VLM 간격 이상 뒤에 찍힌 프레임(간격이 없으면 모든 프레임). 그 사이는 빠른 프레임이다
    const vlmMs = this.o.config.vlmMs;
    frame.vlm = vlmMs === undefined || this.lastVlmAt === null || t.atMs - this.lastVlmAt >= vlmMs;
    if (frame.vlm) this.lastVlmAt = t.atMs;
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
      if (frame.vlm) this.analyze(frame, undefined);
      return;
    }
    if (!this.enqueue(frame)) return;
    if (!this.detecting) this.detecting = this.drain().finally(() => { this.detecting = null; });
  }

  /** 감지 대기열에 넣는다(최신 우선). 빠른 프레임은 FAST_QUEUE_MAX장까지만 두고 넘치면 오래된 빠른 프레임을 기록 없이 버린다.
   *  VLM 프레임은 버리지 않는다: 대기열이 찼으면 기다리는 빠른 프레임 하나를 버려 자리를 내고, 그런 프레임도 없으면 YOLO·VLM 분석 없음(cap)으로 남기고 false. */
  private enqueue(frame: EngineFrame): boolean {
    const dropFast = (): boolean => {
      const i = this.queue.findIndex((f) => !f.vlm);
      if (i < 0) return false;
      this.queue.splice(i, 1);
      this.skipped++;
      return true;
    };
    if (frame.vlm) {
      if (this.queue.length >= this.o.config.detectQueueMax && !dropFast()) {
        this.missBoth(frame, "cap");
        return false;
      }
      this.queue.push(frame);
      return true;
    }
    this.queue.push(frame);
    while (this.queue.filter((f) => !f.vlm).length > FAST_QUEUE_MAX) dropFast();
    return true;
  }

  /** 대기열이 찬 프레임(cap)·늦게 온 프레임(stale): YOLO·VLM 둘 다 분석하지 못한 것으로 남긴다. */
  private missBoth(frame: EngineFrame, why: "cap" | "stale"): void {
    this.yoloMissing[why]++;
    this.o.emit({ type: "observe", at_ms: this.clock.now(), frame_id: frame.id, captured_at_ms: frame.capturedAtMs, yolo: null, yolo_missing: why, vlm: null, vlm_missing: why });
    this.publish(this.o.world.applyMissing(frame.id, frame.capturedAtMs, { yolo: why, vlm: why }));
  }

  /** YOLO 결과(실패면 null, 감지기가 없으면 undefined)를 World State에 넣는다. 감지가 된 프레임마다 물체 모양(seen)을 대시보드로 보낸다.
   *  VLM 프레임이면 observe 기록을 남기고 같은 프레임을 VLM에 보낸다. 빠른 프레임은 World State의 자리·보임만 고치고 기록·VLM 없이 끝난다(감지 실패는 셈만).
   *  World State가 받지 않는 낮은 신뢰도 감지는 모양·YOLO 글·VLM 감지 목록에서 뺀다: 화면·VLM·World State가 같은 감지를 본다.
   *  관절(poses)은 World State만 받는다(자세·손에 듦 사실). */
  private analyze(frame: EngineFrame, raw: Detection[] | null | undefined, poses?: Pose[]): void {
    const dets = raw && raw.filter((d) => this.o.world.accepts(d));
    if (dets) {
      this.o.onSeen?.({
        type: "seen", at_ms: this.clock.now(), frame_id: frame.id, captured_at_ms: frame.capturedAtMs, frame: { width: frame.width, height: frame.height },
        shapes: dets.map(({ label, score, mask }) => ({ label, score, mask })),
      });
    }
    if (!frame.vlm) {
      if (dets) this.publish(this.o.world.applyDetections(frame, dets, poses).changes);
      else if (dets === null) this.yoloMissing.error++;
      return;
    }
    const base = { type: "observe" as const, frame_id: frame.id, captured_at_ms: frame.capturedAtMs, vlm: null };
    if (dets === undefined) {
      this.idsOf.set(frame.id, new Map());
      this.o.emit({ ...base, at_ms: this.clock.now(), yolo: YOLO_TEXT.noDetector });
    } else if (dets) {
      const { changes, ids } = this.o.world.applyDetections(frame, dets, poses);
      this.idsOf.set(frame.id, ids);
      this.o.emit({ ...base, at_ms: this.clock.now(), yolo: yoloText(dets) });
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
        try {
          this.o.onDetected?.(frame.jpeg, r);
        } catch {
          // 위치 맞추기가 실패해도 관찰 흐름은 그대로 간다
        }
      } catch {
        dets = null;
      }
      if (!this.closed) this.analyze(frame, dets, poses);
    }
  }

  onDevice(s: DeviceState): void {
    if (!this.closed) this.publish(this.o.world.applyDevice(s, this.clock.now()));
  }

  /** 판단 타이머가 부른다: 시간이 지나야 나는 World State 사건(냉장고 문이 1분 넘게 열림)을 낸다. */
  tick(): void {
    if (!this.closed) this.publish(this.o.world.tick(this.clock.now()));
  }

  status(): PipelineStatus {
    return {
      frames: this.frames, duplicates: this.ring.dropped, detector: this.o.detector?.name ?? null, pose: this.o.detector?.pose ?? null, provider: this.o.detector?.provider ?? null, vlm_model: this.o.vlm.model,
      detected: this.detected, detect_ms: mean(this.detectMs), posed: this.posed, pose_ms: mean(this.poseMs),
      queued: this.queue.length, skipped: this.skipped, yolo_missing: { ...this.yoloMissing }, vlm: this.pool.stats(), time_source: this.timeSource, time_err_ms: this.timeErr,
      dataset: this.o.dataset ? { ...this.datasetCount } : null,
      closer: { ...this.closerCount, costUsd: this.closerUnpriced ? null : Math.round(this.closerCount.costUsd * 1e5) / 1e5, model: this.closerVlm.model },
    };
  }

  /** 고리 가장 새 프레임(없으면 null). */
  latest(): LatestFrame | null {
    const f = this.ring.frames().at(-1);
    return f ? { view: f.view, capturedAtMs: f.capturedAtMs, width: f.width, height: f.height } : null;
  }

  /** 가까이 보기 한 번. 한 번에 하나만 돈다(다른 가까이 보기가 돌거나 VLM 가까이 보기 자리가 차 있으면 vlm_busy).
   *  고리의 VLM 프레임 가운데 가장 새 VLM 프레임으로부터 closerSpanMs 안에 찍혀 카메라가 있고 spot이 사진 안(LOOK_MARGIN)인 프레임을 최근 것부터 CLOSER_FRAMES장까지 쓴다
   *  (엔진 프레임이 100ms마다 와도 VLM 프레임 간격으로 고른 5장, 9초 폭이다).
   *  서로 다른 프레임이 CLOSER_NEW_FRAMES장보다 적거나, 가장 새 프레임이 지금(clock)보다 closerStaleMs 넘게 앞서 찍혔으면(폰이 끊겨 새 프레임이 안 옴)
   *  자르지 않고 no_fresh_frames.
   *  장마다 spot을 그 프레임 카메라로 찍은 자리를 절반 크기로 잘라 2배로 키워 같은 감지기로 보고, 상자를 엔진 프레임 픽셀로 옮겨 World State에 한 번에 합친다(변화 발행도 한 번).
   *  감지가 끝나면 쓴 가장 새 프레임이 아직 closerStaleMs 안인지 다시 보고, 낡았으면 합치지 않고 no_fresh_frames.
   *  signal은 자르기 전(장마다)·합치기 바로 전에 보고, 끊겼으면 넣지 않고 aborted(ok 아님). 감지를 합친 뒤에 끊기면(합친 변화로 그 단계가 끝남 등)
   *  VLM을 보내지 않거나 기다리던 HTTP 요청을 끊고 답을 넣지 않으며, 실행한 가까이 보기(ok, vlm aborted)로 돌려준다.
   *  물건 감지(World State closerObject)가 있는 가장 새 장(없으면 가장 새 장) 하나만 VLM 가까이 보기 자리로 보내고 그 답(그 장에서 잡은 물건 사실만)을 넣은 뒤 끝난다.
   *  VLM 답이 왔을 때 쓴 가장 새 프레임이 지금보다 closerStaleMs 넘게 앞서 찍혔으면(VLM을 기다리는 사이 폰 끊김) 답을 넣지 않고 ok, vlm no_fresh_frames로 돌려준다.
   *  3장이 안 된 새 물건 후보는 그 답이 그 감지에 사실을 하나 이상 답하고 가림은 답하지 않을 때 만들고 그 사실을 넣는다. VLM 답이 없거나 넣지 않으면 만들지 않는다.
   *  결과의 frame_id·captured_at_ms·crop·found는 그 장 기준이고 frames는 잘라 본 장 수다. */
  async closer(spot: LookSpot, signal?: AbortSignal): Promise<CloserResult> {
    if (this.closed) return this.closerMiss("closed");
    if (signal?.aborted) return this.closerMiss("aborted");
    const detector = this.o.detector;
    if (!detector) return this.closerMiss("no_detector");
    if (this.closing || !this.pool.closerFree()) return this.closerMiss("vlm_busy");
    const ring = this.ring.frames();
    const newest = ring.at(-1);
    const step = vlmStepMs(this.o.config);
    if (!newest || this.clock.now() - newest.capturedAtMs > closerStaleMs(step)) return this.closerMiss("no_fresh_frames");
    if (!newest.view) return this.closerMiss("no_view");
    if (!inView(newest.view, spot.position, LOOK_MARGIN)) return this.closerMiss("out_of_view");
    const span = closerSpanMs(step);
    const slow = ring.filter((f) => f.vlm !== false);
    const newestSlow = slow.at(-1)?.capturedAtMs ?? newest.capturedAtMs;
    const picked = slow.filter((f) => f.view && newestSlow - f.capturedAtMs <= span && inView(f.view, spot.position, LOOK_MARGIN)).slice(-CLOSER_FRAMES);
    if (new Set(picked.map((f) => f.id)).size < CLOSER_NEW_FRAMES) return this.closerMiss("no_fresh_frames");
    this.closing = true;
    try {
      return await this.look(spot, picked, detector, signal);
    } finally {
      this.closing = false;
    }
  }

  private async look(spot: LookSpot, picked: readonly EngineFrame[], detector: Detector, signal: AbortSignal | undefined): Promise<CloserResult> {
    const passes: { frame: EngineFrame; view: CameraView; crop: Box; jpeg: Buffer; dets: Detection[] }[] = [];
    try {
      for (const frame of picked) {
        if (signal?.aborted) return this.closerMiss("aborted");
        if (this.closed) return this.closerMiss("closed");
        const view = frame.view!;
        const crop = cropBox(pixelOf(view, spot.position, frame)!, frame);
        const jpeg = cropJpeg(frame.jpeg, crop, frame);
        const r = await detector.detect(jpeg);
        passes.push({ frame, view, crop, jpeg, dets: r.detections.filter((d) => this.o.world.accepts(d)) });
      }
    } catch {
      return this.closerMiss(this.closed ? "closed" : "error");
    }
    if (this.closed) return this.closerMiss("closed");
    if (signal?.aborted) return this.closerMiss("aborted");
    // 감지하는 사이 새 프레임이 끊겼으면(쓴 가장 새 프레임이 지금보다 너무 앞섬) 합치지 않는다
    if (this.clock.now() - picked.at(-1)!.capturedAtMs > closerStaleMs(vlmStepMs(this.o.config))) return this.closerMiss("no_fresh_frames");
    const looks: CloserPass[] = passes.map((p) => ({
      frameId: p.frame.id, capturedAtMs: p.frame.capturedAtMs, view: p.view, width: p.frame.width, height: p.frame.height,
      dets: p.dets.map((d) => {
        const moved = toFrameDetection(d, p.crop, p.frame);
        return { ...moved, edge: onCropEdge(moved.box, p.crop) };
      }),
    }));
    // VLM은 물건 감지가 있는 가장 새 장(없으면 가장 새 장)을 본다: 결과·기록·VLM 답의 감지 번호가 모두 그 장 기준이다
    const objectAt = looks.findLastIndex((l) => l.dets.some((d) => this.o.world.closerObject(d)));
    const sentAt = objectAt < 0 ? looks.length - 1 : objectAt;
    const last = passes[sentAt]!;
    // 잘라 본 몇 장은 await 없이 한 번에 합치고 변화도 한 번만 낸다
    const { changes, ids, pending } = this.o.world.applyCloser(looks, last.frame.id);
    this.publish(changes);
    const id = `${last.frame.id}.c${++this.closerSeq}`;
    this.o.emit({
      type: "observe", at_ms: this.clock.now(), frame_id: id, captured_at_ms: last.frame.capturedAtMs, yolo: yoloText(last.dets), vlm: null, closer: last.crop,
    });
    // 감지는 합쳤다: 여기서부터 끊기면(합친 변화로 그 단계가 끝남 등) VLM 답만 넣지 않고 실행한 가까이 보기로 돌려준다
    let r: VlmResult | null = null;
    if (!signal?.aborted) {
      // VLM은 잘라 키운 사진 한 장이고 감지 상자는 그 사진 픽셀이다
      const answer = this.pool.submitCloser(
        { ...last.frame, id, jpeg: last.jpeg, sha256: sha256(last.jpeg), crop: last.crop },
        last.dets.map((d, i) => ({ id: `d${i + 1}`, class: d.label, box: d.box, score: d.score })),
        signal,
      );
      r = answer ? await answer : { frameId: id, capturedAtMs: last.frame.capturedAtMs, scene: null, missing: "cap", costUsd: 0 };
      this.closerCount.costUsd += r.costUsd;
    }
    if (this.closed) return this.closerMiss("closed");
    // VLM 답을 넣기 바로 전에 다시 본다: 끊겼으면 aborted, 그사이 새 프레임이 끊겼으면(쓴 가장 새 프레임이 지금보다 너무 앞섬, 폰 끊김) no_fresh_frames로 넣지 않는다
    const stale = this.clock.now() - picked.at(-1)!.capturedAtMs > closerStaleMs(vlmStepMs(this.o.config));
    const vlm: CloserVlm = !r || signal?.aborted ? "aborted" : r.scene && stale ? "no_fresh_frames" : r.missing ?? "ok";
    if (vlm === "aborted" || vlm === "no_fresh_frames") r = null;
    if (r) {
      this.o.emit({
        type: "observe", at_ms: this.clock.now(), frame_id: id, captured_at_ms: last.frame.capturedAtMs, yolo: null, vlm: r.scene?.summary ?? null,
        ...(r.missing ? { vlm_missing: r.missing } : {}), closer: last.crop,
      });
    }
    // 3장이 안 된 새 물건 후보는 이 답이 그 감지에 사실을 답할 때만 만든다(답이 없거나 넣지 않으면 버린다)
    if (r?.scene) this.publish(this.o.world.applyCloserScene(last.frame.id, last.frame.capturedAtMs, r.scene, ids, pending));
    else if (pending) this.o.world.endCloser(pending);
    this.closerCount.looks++;
    const said = new Map<string, string[]>();
    for (const ob of r?.scene?.observations ?? []) said.set(ob.object_id, [...(said.get(ob.object_id) ?? []), ob.state]);
    return {
      ok: true, frame_id: id, captured_at_ms: last.frame.capturedAtMs, crop: last.crop, frames: passes.length,
      found: last.dets.map((d, i) => ({ id: ids.get(`d${i + 1}`) ?? null, cls: d.label, score: Math.round(d.score * 100) / 100, facts: said.get(`d${i + 1}`) ?? [] })),
      summary: r?.scene?.summary ?? null, vlm,
    };
  }

  private closerMiss(why: CloserMiss): CloserResult {
    this.closerCount.failed++;
    return { ok: false, why };
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

/** 감지기 값: YOLO26n-seg(저장소 models/, BRAIN_YOLO_PATH로 파일 직접)와 관절 YOLO26n-pose(BRAIN_POSE_PATH), CPU 추론 스레드 수 BRAIN_YOLO_THREADS(8),
 *  실행 장치 BRAIN_YOLO_PROVIDER(auto·dml·cpu, 기본 auto), 관절 간격 BRAIN_POSE_EVERY(1 이상 정수, 기본 3). 틀린 장치·간격이면 오류. */
export function detectorSpec(env: Env): DetectorSpec {
  const provider = (env.BRAIN_YOLO_PROVIDER?.trim().toLowerCase() || "auto") as Provider;
  if (!PROVIDERS.includes(provider)) throw new Error(`BRAIN_YOLO_PROVIDER는 auto·dml·cpu 중 하나여야 합니다(${env.BRAIN_YOLO_PROVIDER})`);
  const every = env.BRAIN_POSE_EVERY?.trim();
  const poseEvery = every ? Number(every) : 3;
  if (!Number.isInteger(poseEvery) || poseEvery < 1) throw new Error(`BRAIN_POSE_EVERY는 1 이상 정수여야 합니다(${env.BRAIN_POSE_EVERY})`);
  return {
    modelPath: env.BRAIN_YOLO_PATH?.trim() || join(MODELS_DIR, DETECTOR_MODEL.file), posePath: env.BRAIN_POSE_PATH?.trim() || join(MODELS_DIR, POSE_MODEL.file),
    threads: Number(env.BRAIN_YOLO_THREADS) || 8, provider, poseEvery,
  };
}

/** 감지기를 워커로 띄운다. 감지 모델 파일이 없으면 VLM만, 관절 모델 파일이 없으면 감지만(경고). */
async function createDetector(env: Env, log: (line: string) => void): Promise<Detector | null> {
  const spec = detectorSpec(env);
  if (!existsSync(spec.modelPath)) {
    log(`[경고] YOLO 모델 파일이 없습니다(${spec.modelPath}). VLM만 씁니다. 확인: npx tsx scripts/brain-yolo-fetch.ts`);
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

/** 환경 변수로 관찰 흐름을 만든다. VLM은 추론 모드가 고른 OpenAI 호환 주소(src/infer)이고, 가까이 보기는 같은 주소에 VLM_CLOSER_MODEL 모델로 보낸다. */
export async function createPipeline(o: {
  env: Env; world: WorldState; emit: (log: BrainLog) => void; broadcastWorld: (w: WorldView) => void;
  onChanges?: (c: WorldChange[]) => void; onFrame?: () => void; log: (line: string) => void; inject?: PipelineInject; dataset?: (f: EngineFrame) => void;
  onSeen?: (e: SeenEvent) => void;
  onDetected?: (jpeg: Buffer, result: DetectResult) => void;
}): Promise<ObservationPipeline> {
  const config = loadObserveConfig(o.env);
  const detector = o.inject && "detector" in o.inject ? o.inject.detector ?? null : await createDetector(o.env, o.log);
  const made = o.inject?.vlm ? null : createInference(o.env);
  const vlm = o.inject?.vlm ?? made!.vlm;
  const closerVlm = made?.closerVlm ?? vlm;
  const closerNote = closerVlm.model !== vlm.model ? ` · 가까이 보기 VLM ${closerVlm.model}` : "";
  o.log(`관찰 흐름: 엔진 프레임 ${config.engineMs}ms · VLM 프레임 ${vlmStepMs(config)}ms · 감지 ${detector ? `${detector.name}(${detector.provider})` : "없음(VLM만)"} · VLM ${vlm.model} 최근 ${config.vlmWindowFrames}장 동시 ${config.vlmMaxInflight}개${closerNote} · 감지 대기열 ${config.detectQueueMax}`);
  if (detector?.decoder === "jpeg-js") o.log("[경고] sharp를 불러오지 못했습니다. JPEG을 jpeg-js로 풉니다(한 장에 약 30ms 더 걸립니다).");
  if (o.dataset) o.log("[경고] 시험 자료 모으기가 켜져 있습니다. 엔진 프레임을 디스크에 씁니다.");
  return new ObservationPipeline({
    config, detector, vlm, closerVlm, world: o.world, emit: o.emit, broadcastWorld: o.broadcastWorld, onChanges: o.onChanges, onFrame: o.onFrame, onSeen: o.onSeen, dataset: o.dataset, onDetected: o.onDetected, clock: o.inject?.clock,
  });
}
