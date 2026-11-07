// 빠른 존재 감지기(YOLO). 매 장면 사람·컵이 "있는지"만 본다. 마심·들고 있음·컵 안은 VLM(perception.ts)이 본다.
// 기본 모델은 YOLOX(Megvii 공식 ONNX, Apache-2.0)다. Ultralytics YOLO는 AGPL-3.0이라 쓰지 않았다.
// 이 PC(4스레드) 측정: Tiny 추론 54ms + 전처리 16ms, Nano 16ms + 14ms(480×270 JPEG).
//
// YOLOX ONNX 입출력(0.1.1rc0 공식 내보내기): 입력 images [1,3,416,416] float32, BGR, 0~255 그대로(정규화 없음),
// 레터박스는 왼쪽 위에 붙이고 나머지를 114로 채운다. 출력 [1,3549,85] = 보폭 8·16·32 격자마다
// (dx, dy, log w, log h, 물체, 클래스 80개). 물체·클래스는 이미 시그모이드를 거쳤다.

import jpeg from "jpeg-js";

export type DetLabel = "person" | "cup";

export interface Detection {
  label: DetLabel;
  score: number;
  /** 원본 사진 픽셀 [x, y, w, h]. */
  box: [number, number, number, number];
  /** COCO 클래스 번호(0 person, 41 cup, 40 wine glass). */
  cls: number;
}

export interface DetectResult {
  detections: Detection[];
  /** 전처리 + 추론 시간(ms). */
  ms: number;
  width: number;
  height: number;
}

export interface Detector {
  readonly name: string;
  detect(jpegBytes: Buffer): Promise<DetectResult>;
  close?(): Promise<void>;
}

/** 보는 COCO 클래스. 유리컵(wine glass)도 마시는 컵으로 본다. */
const LABELS: Record<number, DetLabel> = { 0: "person", 41: "cup", 40: "cup" };

export const YOLOX_MODELS = {
  yolox_tiny: {
    file: "yolox_tiny.onnx", size: 416,
    url: "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx",
    sha256: "427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7",
  },
  yolox_nano: {
    file: "yolox_nano.onnx", size: 416,
    url: "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx",
    sha256: "c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d",
  },
} as const;
export type YoloxModel = keyof typeof YOLOX_MODELS;

const PAD = 114;

/** RGBA → [3, size, size] BGR(0~255). 긴 변을 size에 맞추고(가까운 픽셀) 왼쪽 위에 붙인다. */
export function letterbox(img: { data: Uint8Array; width: number; height: number }, size: number): { tensor: Float32Array; ratio: number } {
  const ratio = Math.min(size / img.width, size / img.height);
  const nw = Math.min(size, Math.round(img.width * ratio));
  const nh = Math.min(size, Math.round(img.height * ratio));
  const plane = size * size;
  const tensor = new Float32Array(3 * plane).fill(PAD);
  const src = img.data;
  for (let y = 0; y < nh; y++) {
    const row = Math.min(img.height - 1, Math.floor(y / ratio)) * img.width;
    const o = y * size;
    for (let x = 0; x < nw; x++) {
      const i = (row + Math.min(img.width - 1, Math.floor(x / ratio))) * 4;
      tensor[o + x] = src[i + 2]!; // B
      tensor[plane + o + x] = src[i + 1]!; // G
      tensor[2 * plane + o + x] = src[i]!; // R
    }
  }
  return { tensor, ratio };
}

/** 출력을 풀어 보는 클래스만, minScore 이상, 원본 픽셀 상자로. 같은 종류끼리 NMS. */
export function decodeYolox(out: Float32Array, anchors: number, size: number, ratio: number, opts: { minScore: number }): Detection[] {
  const k = 85;
  const strides = [8, 16, 32];
  const expected = strides.reduce((a, s) => a + (size / s) ** 2, 0);
  if (anchors !== expected || out.length !== anchors * k) throw new Error(`YOLOX 출력 격자 수가 맞지 않습니다(${anchors}, 기대 ${expected})`);
  const found: Detection[] = [];
  let idx = 0;
  for (const s of strides) {
    const g = size / s;
    for (let gy = 0; gy < g; gy++) {
      for (let gx = 0; gx < g; gx++, idx++) {
        const o = idx * k;
        const obj = out[o + 4]!;
        if (obj < opts.minScore) continue;
        for (const cls of [0, 41, 40]) {
          const score = obj * out[o + 5 + cls]!;
          if (score < opts.minScore) continue;
          const cx = (out[o]! + gx) * s;
          const cy = (out[o + 1]! + gy) * s;
          const w = Math.exp(out[o + 2]!) * s;
          const h = Math.exp(out[o + 3]!) * s;
          found.push({ label: LABELS[cls]!, score, cls, box: [(cx - w / 2) / ratio, (cy - h / 2) / ratio, w / ratio, h / ratio] });
        }
      }
    }
  }
  return nms(found, 0.45);
}

function iou(a: Detection["box"], b: Detection["box"]): number {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

/** 같은 종류(label)끼리 점수 순으로, iouMax보다 겹치는 뒤쪽 상자를 버린다. */
export function nms(dets: Detection[], iouMax: number): Detection[] {
  const kept: Detection[] = [];
  for (const d of [...dets].sort((a, b) => b.score - a.score)) {
    if (kept.some((k) => k.label === d.label && iou(k.box, d.box) > iouMax)) continue;
    kept.push(d);
  }
  return kept.sort((a, b) => (a.label === b.label ? b.score - a.score : a.label === "person" ? -1 : 1));
}

interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown; dims: readonly number[] }>>;
  release?(): Promise<void>;
}

export interface YoloxOptions {
  size?: number;
  threads?: number;
  minScore?: number;
}

/** onnxruntime-node로 YOLOX를 돌린다. onnxruntime는 감지기를 만들 때만 불러온다(BRAIN을 안 쓰면 읽지 않게). */
export class YoloxDetector implements Detector {
  private constructor(
    readonly name: string,
    private readonly session: OrtSession,
    private readonly Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown,
    private readonly size: number,
    private readonly minScore: number,
  ) {}

  static async create(modelPath: string, opts: YoloxOptions = {}): Promise<YoloxDetector> {
    const ort = await import("onnxruntime-node");
    const session = await ort.InferenceSession.create(modelPath, { intraOpNumThreads: opts.threads ?? 4 });
    const name = modelPath.replace(/^.*[\\/]/, "").replace(/\.onnx$/, "");
    return new YoloxDetector(name, session as unknown as OrtSession, ort.Tensor as never, opts.size ?? 416, opts.minScore ?? 0.25);
  }

  async detect(jpegBytes: Buffer): Promise<DetectResult> {
    const t0 = performance.now();
    const img = jpeg.decode(jpegBytes, { useTArray: true, formatAsRGBA: true });
    const { tensor, ratio } = letterbox(img, this.size);
    const input = new this.Tensor("float32", tensor, [1, 3, this.size, this.size]);
    const result = await this.session.run({ [this.session.inputNames[0]!]: input });
    const out = result[this.session.outputNames[0]!]!;
    const detections = decodeYolox(out.data as Float32Array, out.dims[1]!, this.size, ratio, { minScore: this.minScore });
    return { detections, ms: performance.now() - t0, width: img.width, height: img.height };
  }

  async close(): Promise<void> {
    await this.session.release?.();
  }
}

/** YoloxDetector를 워커 스레드에서 돌린다(detector-thread.ts). 실시간 두뇌는 이것을 쓴다: 추론이 부른 스레드를 막기 때문. */
export class WorkerDetector implements Detector {
  private seq = 0;
  private readonly waiting = new Map<number, { resolve: (r: DetectResult) => void; reject: (e: Error) => void }>();
  /** 워커가 끝났거나 오류로 멈춤(그 뒤 detect는 바로 실패). */
  private dead: Error | null = null;

  private readonly exited: Promise<void>;

  private constructor(readonly name: string, private readonly worker: import("node:worker_threads").Worker) {
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

  static async create(modelPath: string, opts: { threads?: number } = {}): Promise<WorkerDetector> {
    const { Worker } = await import("node:worker_threads");
    const worker = new Worker(new URL("./detector-worker.mjs", import.meta.url), {
      workerData: { entry: new URL("./detector-thread.ts", import.meta.url).href, modelPath, threads: opts.threads ?? 4 },
    });
    try {
      const name = await new Promise<string>((resolve, reject) => {
        const onMsg = (m: { ready?: string; failed?: string }) => {
          if (m.ready) resolve(m.ready);
          else if (m.failed) reject(new Error(m.failed));
        };
        worker.on("message", onMsg);
        worker.once("error", reject);
        worker.once("exit", (code) => reject(new Error(`YOLO 워커가 시작 중에 끝났습니다(${code})`)));
      });
      return new WorkerDetector(name, worker);
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
