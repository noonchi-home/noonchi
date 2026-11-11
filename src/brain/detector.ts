// 물체 감지기와 사람 관절. 엔진 프레임마다 낱말 표(src/world/vocab.ts)의 사람·물건·가전 설비 종류·박스·신뢰도를 내고, 사람이 보이면 관절 17개를 더 낸다.
// 놓인 자리·쓰는 중·안 내용은 VLM이 본다. 가구 자리는 트윈 배치에서 읽으므로 가구 종류(식탁·의자…)는 거른다.
// 같은 출력에서 크고 바닥에 서는 가구·가전(냉장고·소파·식탁 등, src/sync/classes.ts) 상자는 World State와 따로 폰 위치 맞추기 기준점(landmarks)으로도 낸다.
// 관찰 흐름이 주면(weakMinScore) 최소 점수 아래 약한 감지를 weak로 따로 낸다. 다시 볼 후보로만 쓰고 detections·기준점·관절은 그대로다.
//
// 모델은 YOLO26n(감지)과 YOLO26n-pose(관절)다. Ultralytics 가중치를 이 저장소에서 ONNX로 내보내 models/에 커밋했다(AGPL-3.0,
// 출처·sha256·다시 내보내기는 THIRD_PARTY.md).
//
// YOLO26 ONNX 입출력(ultralytics 8.4, opset 17, imgsz 640): 입력 images [1,3,640,640] float32, RGB, 0~1, 가운데 레터박스(114 채움).
// 감지 출력 output0 [1,84,8400] 채널 우선 = (cx, cy, w, h, 클래스 80개 점수). 물체 점수는 없고 클래스 점수는 시그모이드를 거쳤다.
// 관절 출력 output0 [1,56,8400] = (cx, cy, w, h, 사람 점수, 관절 17개 × (x, y, 신뢰도)). 좌표는 640 레터박스 픽셀이다.
// 이 내보내기는 한 물체에 겹친 상자를 여럿 낸다(컵 영상: 같은 컵 상위 상자끼리 IoU 0.99). 그래서 Ultralytics predict처럼
// 앵커마다 가장 높은 클래스 하나를 보고 IoU 0.5로 NMS 한다(ultralytics 8.4 predict 기본값 PREDICT_IOU).

import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { LANDMARK_IDS } from "../sync/classes.js";
import { CLASSES, type ClassKey, type DetLabel } from "../world/vocab.js";

export type { DetLabel };

export interface Detection {
  label: DetLabel;
  score: number;
  /** 원본 사진 픽셀 [x, y, w, h]. */
  box: [number, number, number, number];
  /** COCO 클래스 번호(0 person, 41 cup, 40 wine glass …). */
  cls: number;
}

/** 위치 맞추기 기준점 상자(냉장고·소파 등 크고 바닥에 서는 물건, src/sync/classes.ts). World State는 받지 않는다. */
export interface LandmarkBox {
  /** COCO 클래스 번호. */
  cls: number;
  score: number;
  /** 원본 사진 픽셀 [x, y, w, h]. */
  box: [number, number, number, number];
}

/** COCO 관절 하나: 원본 사진 픽셀 x, y와 신뢰도(0~1). */
export type Keypoint = [number, number, number];

/** 사람 한 명의 관절(YOLO26-pose). keypoints는 COCO 순서 17개(0 코 … 9·10 왼·오른 손목 … 15·16 발목). */
export interface Pose {
  score: number;
  /** 원본 사진 픽셀 [x, y, w, h]. */
  box: [number, number, number, number];
  keypoints: Keypoint[];
}

export interface DetectResult {
  detections: Detection[];
  /** 감지 시간(ms): JPEG 풀기 + 레터박스 + 추론 + 풀기. */
  ms: number;
  width: number;
  height: number;
  /** 관절. 관절 모델이 없거나 이 프레임에 사람이 없어 돌리지 않았으면 없다. */
  poses?: Pose[];
  /** 관절 시간(ms): 추론 + 풀기(레터박스는 감지와 같이 쓴다). */
  poseMs?: number;
  /** 위치 맞추기 기준점 상자(같은 감지 출력에서 따로 고른 것). */
  landmarks?: LandmarkBox[];
  /** 약한 감지: weakMinScore 이상 minScore 미만(detections와 같은 NMS 뒤, 같은 순서). 관찰 흐름이 다시 볼 후보로만 쓴다(src/observe/pipeline.ts).
   *  detections·landmarks·관절에는 들어가지 않는다. weakMinScore를 주지 않은 감지기는 비어 있거나 없다. */
  weak?: Detection[];
}

export interface Detector {
  readonly name: string;
  /** 관절 모델 이름(없으면 null·없음). */
  readonly pose?: string | null;
  detect(jpegBytes: Buffer): Promise<DetectResult>;
  close?(): Promise<void>;
}

const DET_KEYS = (Object.keys(CLASSES) as ClassKey[]).filter((k): k is DetLabel => CLASSES[k].role !== "scene");
/** 보는 COCO 클래스 번호 → 종류(낱말 표에서 가구가 아닌 것). 유리컵(wine glass)도 마시는 컵으로 본다. */
export const COCO_LABELS: Readonly<Record<number, DetLabel>> = Object.fromEntries(DET_KEYS.flatMap((k) => Object.keys(CLASSES[k].coco).map((n) => [Number(n), k])));
/** 결과 순서(종류끼리 점수 순): 낱말 표 순서. */
const LABEL_ORDER: readonly DetLabel[] = DET_KEYS;
/** YOLO26 NMS IoU(ultralytics 8.4 predict 기본값 PREDICT_IOU, conf 0.25에서 COCO F1이 가장 높은 값). */
export const YOLO26_IOU = 0.5;
/** 감지·관절·기준점 최소 점수 기본값(ultralytics predict conf 0.25). */
export const DETECT_MIN_SCORE = 0.25;
const COCO_CLASSES = 80;
const KEYPOINTS = 17;
/** YOLO26 입력 한 변(감지·관절 같은 레터박스). */
const INPUT_SIZE = 640;

/** 감지·관절 모델(저장소 models/에 커밋). sha256은 Dockerfile 확인 줄과 같다(scripts/brain-yolo-fetch.ts가 확인). */
export const DETECTOR_MODEL = { file: "yolo26n.onnx", sha256: "b164246692cd533f5d2ea16426c1e81da686ad64d07740f35ab762715faaf4c3" } as const;
export const POSE_MODEL = { file: "yolo26n-pose.onnx", sha256: "dd0e47a03ea0f2b9e766b038559de14fb1dd5e51d8dfb331051740998628d91e" } as const;

/** 저장소에 커밋한 모델 폴더(models/). Docker 이미지에서는 /app/models/. */
export const MODELS_DIR = fileURLToPath(new URL("../../models/", import.meta.url));

const PAD = 114;
type Rgba = { data: Uint8Array; width: number; height: number };

/** 레터박스 자리: 원본 픽셀 = (레터박스 픽셀 − pad) / ratio. */
export interface LetterboxPlace { ratio: number; padX: number; padY: number }

/** 쌍선형 표본(OpenCV INTER_LINEAR처럼 픽셀 가운데 기준, 끝은 붙임): 출력 칸마다 원본 두 칸과 섞는 몫. */
function linearTaps(dst: number, src: number): { i0: Int32Array; i1: Int32Array; w: Float32Array } {
  const scale = src / dst;
  const i0 = new Int32Array(dst), i1 = new Int32Array(dst), w = new Float32Array(dst);
  for (let d = 0; d < dst; d++) {
    let f = (d + 0.5) * scale - 0.5;
    let s = Math.floor(f);
    f -= s;
    if (s < 0) { s = 0; f = 0; }
    if (s >= src - 1) { s = src - 1; f = 0; }
    i0[d] = s;
    i1[d] = Math.min(s + 1, src - 1);
    w[d] = f;
  }
  return { i0, i1, w };
}

/** YOLO26 입력(Ultralytics LetterBox): RGBA → [3, size, size] RGB(0~1). 긴 변을 size에 맞추고(쌍선형) 가운데에 두고 나머지를 114/255로 채운다. */
export function letterboxYolo26(img: Rgba, size: number): LetterboxPlace & { tensor: Float32Array } {
  const ratio = Math.min(size / img.width, size / img.height);
  const nw = Math.min(size, Math.round(img.width * ratio));
  const nh = Math.min(size, Math.round(img.height * ratio));
  const padX = Math.max(0, Math.round((size - nw) / 2 - 0.1));
  const padY = Math.max(0, Math.round((size - nh) / 2 - 0.1));
  const plane = size * size;
  const tensor = new Float32Array(3 * plane).fill(PAD / 255);
  const xs = linearTaps(nw, img.width);
  const ys = linearTaps(nh, img.height);
  const src = img.data;
  const rowLen = img.width * 4;
  for (let y = 0; y < nh; y++) {
    const r0 = ys.i0[y]! * rowLen, r1 = ys.i1[y]! * rowLen, wy = ys.w[y]!;
    const o = (y + padY) * size + padX;
    for (let x = 0; x < nw; x++) {
      const c0 = xs.i0[x]! * 4, c1 = xs.i1[x]! * 4, wx = xs.w[x]!;
      const a = r0 + c0, b = r0 + c1, c = r1 + c0, d = r1 + c1;
      for (let ch = 0; ch < 3; ch++) {
        const top = src[a + ch]! + (src[b + ch]! - src[a + ch]!) * wx;
        const bottom = src[c + ch]! + (src[d + ch]! - src[c + ch]!) * wx;
        tensor[ch * plane + o + x] = (top + (bottom - top) * wy) / 255;
      }
    }
  }
  return { tensor, ratio, padX, padY };
}

type Box = [number, number, number, number];

/** 출력 칸 cx·cy·w·h → 레터박스 픽셀 [x, y, w, h]. */
const lbBox = (out: Float32Array, n: number, i: number): Box => {
  const w = out[2 * n + i]!, h = out[3 * n + i]!;
  return [out[i]! - w / 2, out[n + i]! - h / 2, w, h];
};

/** 레터박스 픽셀 [x, y, w, h] → 원본 픽셀 [x, y, w, h](그림 끝에서 자름). */
function unbox(b: Box, lb: LetterboxPlace, image: { width: number; height: number }): Box {
  const clip = (v: number, max: number) => Math.min(max, Math.max(0, v));
  const x1 = clip((b[0] - lb.padX) / lb.ratio, image.width), x2 = clip((b[0] + b[2] - lb.padX) / lb.ratio, image.width);
  const y1 = clip((b[1] - lb.padY) / lb.ratio, image.height), y2 = clip((b[1] + b[3] - lb.padY) / lb.ratio, image.height);
  return [x1, y1, x2 - x1, y2 - y1];
}

function checkShape(out: Float32Array, dims: readonly number[], channels: number): number {
  const n = dims[2] ?? 0;
  if (dims.length !== 3 || dims[1] !== channels || out.length !== channels * n) throw new Error(`YOLO26 출력 모양이 맞지 않습니다([${dims.join(", ")}], 기대 [1, ${channels}, N])`);
  return n;
}

/** YOLO26 감지 출력 [1, 84, N]을 풀어 보는 클래스만, minScore 이상, 원본 픽셀 상자로. 앵커마다 가장 높은 클래스 하나, 같은 종류끼리 NMS(IoU 0.5). */
export function decodeYolo26(out: Float32Array, dims: readonly number[], lb: LetterboxPlace, image: { width: number; height: number }, opts: { minScore: number }): Detection[] {
  return decodeYolo26All(out, dims, lb, image, opts).detections;
}

const LANDMARK_SET = new Set(LANDMARK_IDS);

/** decodeYolo26과 같고, 위치 맞추기 기준점 종류(src/sync/classes.ts) 상자도 따로 낸다(같은 종류끼리 NMS, 점수 순).
 *  weakMinScore를 주면 그 이상 minScore 미만 감지를 weak로 따로 낸다. NMS는 둘을 같이 한다: 점수 순이라 minScore 이상 결과는 주지 않을 때와 같고,
 *  센 상자와 많이 겹친 같은 종류 약한 상자는 버린다. 기준점은 minScore 이상만이다. */
export function decodeYolo26All(
  out: Float32Array, dims: readonly number[], lb: LetterboxPlace, image: { width: number; height: number }, opts: { minScore: number; weakMinScore?: number },
): { detections: Detection[]; landmarks: LandmarkBox[]; weak: Detection[] } {
  const n = checkShape(out, dims, 4 + COCO_CLASSES);
  const floor = Math.min(opts.minScore, opts.weakMinScore ?? opts.minScore);
  // 클래스 줄을 차례로 읽어 앵커마다 가장 높은 클래스를 찾는다(같은 점수면 앞 번호)
  const best = new Float32Array(n).fill(-1);
  const bestCls = new Int16Array(n);
  for (let c = 0; c < COCO_CLASSES; c++) {
    const row = (4 + c) * n;
    for (let i = 0; i < n; i++) {
      const s = out[row + i]!;
      if (s > best[i]!) { best[i] = s; bestCls[i] = c; }
    }
  }
  // NMS는 Ultralytics처럼 자르기 전 레터박스 상자로 한다
  const found: Detection[] = [];
  const marks: LandmarkBox[] = [];
  for (let i = 0; i < n; i++) {
    const score = best[i]!, cls = bestCls[i]!;
    if (score < floor) continue;
    // 냉장고·싱크대처럼 World State 가전 설비이기도 한 종류는 두 곳 모두에 낸다
    const label = COCO_LABELS[cls];
    if (label) found.push({ label, score, cls, box: lbBox(out, n, i) });
    if (score >= opts.minScore && LANDMARK_SET.has(cls)) marks.push({ cls, score, box: lbBox(out, n, i) });
  }
  const kept = nms(found, YOLO26_IOU).map((d) => ({ ...d, box: unbox(d.box, lb, image) }));
  return {
    detections: kept.filter((d) => d.score >= opts.minScore),
    landmarks: suppress(marks, YOLO26_IOU, (a, b) => a.cls === b.cls).map((d) => ({ ...d, box: unbox(d.box, lb, image) })),
    weak: kept.filter((d) => d.score < opts.minScore),
  };
}

/** YOLO26-pose 출력 [1, 56, N]을 풀어 minScore 이상인 사람의 상자·관절 17개(원본 픽셀)로. 사람끼리 NMS(IoU 0.5), 점수 순. */
export function decodeYolo26Pose(out: Float32Array, dims: readonly number[], lb: LetterboxPlace, image: { width: number; height: number }, opts: { minScore: number }): Pose[] {
  const n = checkShape(out, dims, 5 + KEYPOINTS * 3);
  const found: { score: number; box: Box; i: number }[] = [];
  for (let i = 0; i < n; i++) {
    const score = out[4 * n + i]!;
    if (score >= opts.minScore) found.push({ score, box: lbBox(out, n, i), i });
  }
  return suppress(found, YOLO26_IOU, () => true).map(({ score, box, i }) => {
    const keypoints: Keypoint[] = [];
    for (let k = 0; k < KEYPOINTS; k++) {
      const row = 5 + k * 3;
      keypoints.push([(out[row * n + i]! - lb.padX) / lb.ratio, (out[(row + 1) * n + i]! - lb.padY) / lb.ratio, out[(row + 2) * n + i]!]);
    }
    return { score, box: unbox(box, lb, image), keypoints };
  });
}

/** 두 상자 [x, y, w, h]의 IoU(겹친 넓이 / 합친 넓이). */
export function iou(a: Detection["box"], b: Detection["box"]): number {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

/** 점수 순으로, 같은 무리(same)에서 iouMax보다 겹치는 뒤쪽 상자를 버린다. */
function suppress<T extends { score: number; box: Detection["box"] }>(items: T[], iouMax: number, same: (a: T, b: T) => boolean): T[] {
  const kept: T[] = [];
  for (const d of [...items].sort((a, b) => b.score - a.score)) {
    if (kept.some((k) => same(k, d) && iou(k.box, d.box) > iouMax)) continue;
    kept.push(d);
  }
  return kept;
}

/** 같은 종류(label)끼리 점수 순으로, iouMax보다 겹치는 뒤쪽 상자를 버린다. 결과는 낱말 표 종류 순(사람·컵·병·그릇…), 종류 안은 점수 순. */
export function nms(dets: Detection[], iouMax: number): Detection[] {
  return suppress(dets, iouMax, (a, b) => a.label === b.label)
    .sort((a, b) => (a.label === b.label ? b.score - a.score : LABEL_ORDER.indexOf(a.label) - LABEL_ORDER.indexOf(b.label)));
}

interface OrtTensor { data: unknown; dims: readonly number[] }
interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
  release?(): Promise<void>;
}
type TensorCtor = new (type: "float32", data: Float32Array, dims: number[]) => unknown;

/** 감지기 만들기 값(워커에도 그대로 넘긴다). */
export interface DetectorSpec {
  /** YOLO26 감지 파일. */
  modelPath: string;
  /** YOLO26-pose 파일. 없으면 관절을 보지 않는다. */
  posePath?: string | null;
  threads?: number;
  /** 감지·관절 최소 점수(기본 DETECT_MIN_SCORE 0.25). */
  minScore?: number;
  /** 이 점수 이상 minScore 미만 감지를 DetectResult.weak로 따로 낸다(기본: 내지 않음). 관찰 흐름은 다시 보기 후보 하한(RECHECK_MIN)을 준다. */
  weakMinScore?: number;
  /** 이 점수 이상인 사람 감지가 있을 때만 관절을 돌린다(기본 minScore). World State 사람 기준(0.5)보다 낮게 둔다:
   *  손에 듦은 컵 사실이라, 사람이 흐리게 잡힌 프레임(0.46·0.49)에서도 손목을 본다. */
  poseMinPerson?: number;
}

const fileName = (p: string) => p.replace(/^.*[\\/]/, "").replace(/\.onnx$/, "");

/** onnxruntime-node로 감지기(와 관절 모델)를 돌린다. onnxruntime는 감지기를 만들 때만 불러온다(BRAIN을 안 쓰면 읽지 않게).
 *  YOLO26 감지와 관절은 같은 640 레터박스 한 장을 쓴다. */
export class OnnxDetector implements Detector {
  private constructor(
    readonly name: string,
    readonly pose: string | null,
    private readonly spec: Required<Omit<DetectorSpec, "posePath" | "threads">>,
    private readonly session: OrtSession,
    private readonly poseSession: OrtSession | null,
    private readonly Tensor: TensorCtor,
  ) {}

  static async create(spec: DetectorSpec): Promise<OnnxDetector> {
    const ort = await import("onnxruntime-node");
    const opts = { intraOpNumThreads: spec.threads ?? 4 };
    const session = (await ort.InferenceSession.create(spec.modelPath, opts)) as unknown as OrtSession;
    let poseSession: OrtSession | null = null;
    try {
      poseSession = spec.posePath ? ((await ort.InferenceSession.create(spec.posePath, opts)) as unknown as OrtSession) : null;
    } catch (e) {
      await session.release?.();
      throw e;
    }
    return new OnnxDetector(
      fileName(spec.modelPath), spec.posePath ? fileName(spec.posePath) : null,
      {
        modelPath: spec.modelPath, minScore: spec.minScore ?? DETECT_MIN_SCORE, poseMinPerson: spec.poseMinPerson ?? spec.minScore ?? DETECT_MIN_SCORE,
        weakMinScore: spec.weakMinScore ?? spec.minScore ?? DETECT_MIN_SCORE,
      },
      session, poseSession, ort.Tensor as unknown as TensorCtor,
    );
  }

  private async run(session: OrtSession, tensor: Float32Array): Promise<OrtTensor> {
    const input = new this.Tensor("float32", tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const result = await session.run({ [session.inputNames[0]!]: input });
    return result[session.outputNames[0]!]!;
  }

  async detect(jpegBytes: Buffer): Promise<DetectResult> {
    const t0 = performance.now();
    const img = jpeg.decode(jpegBytes, { useTArray: true, formatAsRGBA: true });
    const image = { width: img.width, height: img.height };
    const lb = letterboxYolo26(img, INPUT_SIZE);
    const out = await this.run(this.session, lb.tensor);
    const { detections, landmarks, weak } = decodeYolo26All(out.data as Float32Array, out.dims, lb, image, { minScore: this.spec.minScore, weakMinScore: this.spec.weakMinScore });
    const t1 = performance.now();
    const result: DetectResult = { detections, ms: t1 - t0, width: img.width, height: img.height, landmarks, weak };
    if (!this.poseSession || !detections.some((d) => d.label === "person" && d.score >= this.spec.poseMinPerson)) return result;
    const poseOut = await this.run(this.poseSession, lb.tensor);
    result.poses = decodeYolo26Pose(poseOut.data as Float32Array, poseOut.dims, lb, image, { minScore: this.spec.minScore });
    result.poseMs = performance.now() - t1;
    return result;
  }

  async close(): Promise<void> {
    await this.session.release?.();
    await this.poseSession?.release?.();
  }
}

/** OnnxDetector를 워커 스레드에서 돌린다(detector-thread.ts). 관찰 흐름(src/observe/pipeline.ts)은 이것을 쓴다: 추론이 부른 스레드를 막기 때문. */
export class WorkerDetector implements Detector {
  private seq = 0;
  private readonly waiting = new Map<number, { resolve: (r: DetectResult) => void; reject: (e: Error) => void }>();
  /** 워커가 끝났거나 오류로 멈춤(그 뒤 detect는 바로 실패). */
  private dead: Error | null = null;

  private readonly exited: Promise<void>;

  private constructor(readonly name: string, readonly pose: string | null, private readonly worker: import("node:worker_threads").Worker) {
    this.exited = new Promise((resolve) => worker.once("exit", () => resolve()));
    worker.on("message", (m: { id?: number; result?: DetectResult; error?: string }) => {
      const w = m.id === undefined ? undefined : this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id!);
      if (m.result) w.resolve(m.result);
      else w.reject(new Error(m.error ?? "YOLO 워커 오류"));
    });
    worker.on("error", (e: unknown) => this.failAll(e instanceof Error ? e : new Error(String(e))));
    worker.on("exit", () => this.failAll(new Error("YOLO 워커가 끝났습니다")));
  }

  private failAll(e: Error): void {
    this.dead ??= e;
    for (const w of this.waiting.values()) w.reject(e);
    this.waiting.clear();
  }

  static async create(spec: DetectorSpec): Promise<WorkerDetector> {
    const { Worker } = await import("node:worker_threads");
    const worker = new Worker(new URL("./detector-worker.mjs", import.meta.url), {
      workerData: { entry: new URL("./detector-thread.ts", import.meta.url).href, spec },
    });
    try {
      const ready = await new Promise<{ name: string; pose: string | null }>((resolve, reject) => {
        const onMsg = (m: { ready?: string; pose?: string | null; failed?: string }) => {
          if (m.ready) resolve({ name: m.ready, pose: m.pose ?? null });
          else if (m.failed) reject(new Error(m.failed));
        };
        worker.on("message", onMsg);
        worker.once("error", reject);
        worker.once("exit", (code) => reject(new Error(`YOLO 워커가 시작 중에 끝났습니다(${code})`)));
      });
      return new WorkerDetector(ready.name, ready.pose, worker);
    } catch (e) {
      await worker.terminate();
      throw e;
    }
  }

  detect(jpegBytes: Buffer): Promise<DetectResult> {
    if (this.dead) return Promise.reject(this.dead);
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({ id, jpeg: new Uint8Array(jpegBytes) });
    });
  }

  /** 워커에게 닫기를 부탁하고(진행 중인 추론을 마치고 세션을 놓음) 끝나기를 기다린다. 3초 안에 안 끝나면 강제로 끝낸다. */
  async close(): Promise<void> {
    const wasDead = this.dead !== null;
    this.failAll(new Error("YOLO 워커를 닫았습니다"));
    if (wasDead) return;
    this.worker.postMessage({ close: true });
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      this.exited.then(() => false),
      new Promise<boolean>((r) => { timer = setTimeout(() => r(true), 3000); }),
    ]);
    clearTimeout(timer);
    if (timedOut) await this.worker.terminate();
    // 워커가 끝났다는 알림 직후 프로세스가 끝나면 onnxruntime 스레드 정리와 겹쳐 프로세스가 멈췄다(이 PC, 100ms 기다림은 멈춤,
    // 300ms는 통과). 그래서 조금 더 기다린다
    await new Promise((r) => setTimeout(r, 500));
  }
}
