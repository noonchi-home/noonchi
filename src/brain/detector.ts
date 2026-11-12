// 물체 감지기와 사람 관절. 엔진 프레임마다 낱말 표(src/world/vocab.ts)의 사람·물건·가전 설비 종류·박스·신뢰도를 내고, 사람이 보이면 관절 17개를 더 낸다.
// 놓인 자리·쓰는 중·안 내용은 VLM이 본다. 가구 자리는 트윈 배치에서 읽으므로 가구 종류(식탁·의자…)는 거른다.
// 같은 출력에서 크고 바닥에 서는 가구·가전(냉장고·소파·식탁 등, src/sync/classes.ts) 상자는 World State와 따로 폰 위치 맞추기 기준점(landmarks)으로도 낸다.
//
// 모델은 YOLO26n-seg(감지 + 물체 모양)와 YOLO26n-pose(관절)다. Ultralytics 가중치를 이 저장소에서 ONNX로 내보내 models/에 커밋했다(AGPL-3.0,
// 출처·sha256·다시 내보내기는 THIRD_PARTY.md).
//
// YOLO26 ONNX 입출력(ultralytics 8.4, opset 17, imgsz 640): 입력 images [1,3,640,640] float32, RGB, 0~1, 가운데 레터박스(114 채움).
// 감지 출력 output0 [1,116,8400] 채널 우선 = (cx, cy, w, h, 클래스 80개 점수, 마스크 계수 32개). 물체 점수는 없고 클래스 점수는 시그모이드를 거쳤다.
// 프로토 출력 output1 [1,32,160,160]: 계수와 곱해 더한 값이 0보다 크면 그 칸은 물체다(src/brain/seg.ts).
// 관절 출력 output0 [1,56,8400] = (cx, cy, w, h, 사람 점수, 관절 17개 × (x, y, 신뢰도)). 좌표는 640 레터박스 픽셀이다.
// 이 내보내기는 한 물체에 겹친 상자를 여럿 낸다(컵 영상: 같은 컵 상위 상자끼리 IoU 0.99). 그래서 Ultralytics predict처럼
// 앵커마다 가장 높은 클래스 하나를 보고 IoU 0.5로 NMS 한다(ultralytics 8.4 predict 기본값 PREDICT_IOU).

import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { LANDMARK_IDS } from "../sync/classes.js";
import { CLASSES, type ClassKey, type DetLabel } from "../world/vocab.js";
import { COEFFS, PROTO, boxFoot, emptyMask, maskOf, type Box, type LetterboxPlace, type Mask } from "./seg.js";

export type { DetLabel, LetterboxPlace, Mask };

export interface Detection {
  label: DetLabel;
  score: number;
  /** 마스크 바깥 테두리(원본 사진 픽셀 [x, y, w, h]). 마스크가 비면 모델 상자. */
  box: [number, number, number, number];
  /** COCO 클래스 번호(0 person, 41 cup, 40 wine glass …). */
  cls: number;
  /** 물체 모양. 못 만들었으면 칸 수 0. */
  mask: Mask;
  /** 마스크 가장 아래 줄의 가운데(원본 픽셀 [x, y]). 마스크가 비면 상자 아랫변 가운데. */
  foot: [number, number];
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
  /** 감지 시간(ms): JPEG 풀기 + 레터박스 + 추론 + 풀기(마스크 포함). */
  ms: number;
  /** ms를 나눈 값(ms): JPEG 풀기 · 레터박스 · 추론 · 출력 풀기(NMS·마스크). 속도 재기(scripts/brain-yolo-bench.ts)가 쓴다. */
  steps?: { decode: number; letterbox: number; infer: number; masks: number };
  width: number;
  height: number;
  /** 관절. 관절 모델이 없거나, 이 프레임에 사람이 없거나, 관절을 건너뛰는 장(poseEvery)이라 돌리지 않았으면 없다. */
  poses?: Pose[];
  /** 관절 시간(ms): 추론 + 풀기(레터박스는 감지와 같이 쓴다). */
  poseMs?: number;
  /** 위치 맞추기 기준점 상자(같은 감지 출력에서 따로 고른 것). */
  landmarks?: LandmarkBox[];
}

export interface Detector {
  readonly name: string;
  /** 관절 모델 이름(없으면 null·없음). */
  readonly pose?: string | null;
  /** 실제로 붙은 실행 장치(dml·cpu). */
  readonly provider: string;
  /** JPEG을 푸는 것(sharp·jpeg-js). */
  readonly decoder?: string;
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
const COCO_CLASSES = 80;
const KEYPOINTS = 17;
/** YOLO26 입력 한 변(감지·관절 같은 레터박스). */
const INPUT_SIZE = 640;

/** 감지·관절 모델(저장소 models/에 커밋). sha256은 Dockerfile 확인 줄과 같다(scripts/brain-yolo-fetch.ts가 확인). */
export const DETECTOR_MODEL = { file: "yolo26n-seg.onnx", sha256: "2e8fc38ffb5df4eca1fb56784121db03222c32bbfc09beb3a310339e9129e170" } as const;
export const POSE_MODEL = { file: "yolo26n-pose.onnx", sha256: "dd0e47a03ea0f2b9e766b038559de14fb1dd5e51d8dfb331051740998628d91e" } as const;

/** 저장소에 커밋한 모델 폴더(models/). Docker 이미지에서는 /app/models/. */
export const MODELS_DIR = fileURLToPath(new URL("../../models/", import.meta.url));

const PAD = 114;
/** 푼 사진: 화소마다 channels 바이트(RGB 3 또는 RGBA 4, 없으면 4). 레터박스는 앞 세 바이트만 읽는다. */
export type Pixels = { data: Uint8Array; width: number; height: number; channels?: 3 | 4 };

/** JPEG 풀기: sharp(libjpeg-turbo)로 풀고, sharp를 못 불러오면 jpeg-js로 푼다. 결과는 RGB 3채널. */
export interface JpegDecoder { name: "sharp" | "jpeg-js"; decode(bytes: Buffer): Promise<Pixels & { channels: 3 }> }
interface SharpPipe {
  raw(): { toBuffer(o: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number; channels: number } }> };
  toColourspace(space: string): SharpPipe;
  removeAlpha(): SharpPipe;
}
type SharpFn = ((input: Buffer) => SharpPipe) & { concurrency(n: number): number };

export async function jpegDecoder(load: () => Promise<unknown> = () => import("sharp")): Promise<JpegDecoder> {
  let sharp: SharpFn;
  try {
    const mod = (await load()) as { default?: SharpFn };
    if (typeof mod.default !== "function") throw new Error("sharp 없음");
    sharp = mod.default;
  } catch {
    return {
      name: "jpeg-js",
      decode: async (bytes) => {
        const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: false });
        return { data: img.data, width: img.width, height: img.height, channels: 3 };
      },
    };
  }
  // 작은 사진 한 장은 libvips 스레드 하나가 더 빠르다(이 PC 360×640: 16스레드 5.7ms, 1스레드 4.2ms). 이 프로세스의 sharp 전체에 걸린다
  sharp.concurrency(1);
  return {
    name: "sharp",
    async decode(bytes) {
      let { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
      // 회색·CMYK·알파가 있는 사진은 sRGB 3채널로 바꿔 다시 푼다
      if (info.channels !== 3) ({ data, info } = await sharp(bytes).toColourspace("srgb").removeAlpha().raw().toBuffer({ resolveWithObject: true }));
      if (info.channels !== 3) throw new Error(`JPEG을 RGB로 풀지 못했습니다(채널 ${info.channels})`);
      return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height, channels: 3 };
    },
  };
}

/** 바이트 0~255 → 0~1. */
const BYTE_TO_UNIT = Float32Array.from({ length: 256 }, (_, v) => v / 255);

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

/** YOLO26 입력(Ultralytics LetterBox): RGB·RGBA → [3, size, size] RGB(0~1). 긴 변을 size에 맞추고(쌍선형) 가운데에 두고 나머지를 114/255로 채운다. */
export function letterboxYolo26(img: Pixels, size: number): LetterboxPlace & { tensor: Float32Array } {
  const ratio = Math.min(size / img.width, size / img.height);
  const nw = Math.min(size, Math.round(img.width * ratio));
  const nh = Math.min(size, Math.round(img.height * ratio));
  const padX = Math.max(0, Math.round((size - nw) / 2 - 0.1));
  const padY = Math.max(0, Math.round((size - nh) / 2 - 0.1));
  const plane = size * size;
  const tensor = new Float32Array(3 * plane).fill(PAD / 255);
  const src = img.data;
  const ch = img.channels ?? 4;
  const rowLen = img.width * ch;
  const R = tensor.subarray(0, plane), G = tensor.subarray(plane, 2 * plane), B = tensor.subarray(2 * plane);
  if (nw === img.width && nh === img.height) {
    // 크기가 그대로면(폰 엔진 프레임 360×640) 섞지 않고 옮기기만 한다
    for (let y = 0; y < nh; y++) {
      let s = y * rowLen;
      let o = (y + padY) * size + padX;
      for (let x = 0; x < nw; x++, s += ch, o++) {
        R[o] = BYTE_TO_UNIT[src[s]!]!;
        G[o] = BYTE_TO_UNIT[src[s + 1]!]!;
        B[o] = BYTE_TO_UNIT[src[s + 2]!]!;
      }
    }
    return { tensor, ratio, padX, padY };
  }
  const xs = linearTaps(nw, img.width);
  const ys = linearTaps(nh, img.height);
  // 열마다 원본 두 칸의 바이트 자리를 미리 구해 둔다
  const x0 = new Int32Array(nw), x1 = new Int32Array(nw);
  for (let x = 0; x < nw; x++) { x0[x] = xs.i0[x]! * ch; x1[x] = xs.i1[x]! * ch; }
  const wxs = xs.w;
  for (let y = 0; y < nh; y++) {
    const r0 = ys.i0[y]! * rowLen, r1 = ys.i1[y]! * rowLen, wy = ys.w[y]!;
    let o = (y + padY) * size + padX;
    for (let x = 0; x < nw; x++, o++) {
      const wx = wxs[x]!;
      const a = r0 + x0[x]!, b = r0 + x1[x]!, c = r1 + x0[x]!, d = r1 + x1[x]!;
      let top = src[a]! + (src[b]! - src[a]!) * wx;
      let bottom = src[c]! + (src[d]! - src[c]!) * wx;
      R[o] = (top + (bottom - top) * wy) / 255;
      top = src[a + 1]! + (src[b + 1]! - src[a + 1]!) * wx;
      bottom = src[c + 1]! + (src[d + 1]! - src[c + 1]!) * wx;
      G[o] = (top + (bottom - top) * wy) / 255;
      top = src[a + 2]! + (src[b + 2]! - src[a + 2]!) * wx;
      bottom = src[c + 2]! + (src[d + 2]! - src[c + 2]!) * wx;
      B[o] = (top + (bottom - top) * wy) / 255;
    }
  }
  return { tensor, ratio, padX, padY };
}

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

/** 프로토 출력 [1, 32, 160, 160]. */
export interface Protos { data: Float32Array; dims: readonly number[] }

/** YOLO26-seg 감지 출력 [1, 116, N]을 풀어 보는 클래스만, minScore 이상, 원본 픽셀 상자·마스크로. 앵커마다 가장 높은 클래스 하나, 같은 종류끼리 NMS(IoU 0.5). */
export function decodeYolo26(out: Float32Array, dims: readonly number[], lb: LetterboxPlace, image: { width: number; height: number }, opts: { minScore: number }, protos?: Protos): Detection[] {
  return decodeYolo26All(out, dims, lb, image, opts, protos).detections;
}

const LANDMARK_SET = new Set(LANDMARK_IDS);

/** decodeYolo26과 같고, 위치 맞추기 기준점 종류(src/sync/classes.ts) 상자도 따로 낸다(같은 종류끼리 NMS, 점수 순, 마스크 없음).
 *  마스크는 NMS 뒤 남은 감지에만 만든다. protos가 없거나 1인 칸이 4칸 미만이면 모델 상자와 빈 마스크다. */
export function decodeYolo26All(out: Float32Array, dims: readonly number[], lb: LetterboxPlace, image: { width: number; height: number }, opts: { minScore: number }, protos?: Protos): { detections: Detection[]; landmarks: LandmarkBox[] } {
  const n = checkShape(out, dims, 4 + COCO_CLASSES + COEFFS);
  if (protos && (protos.dims.length !== 4 || protos.dims[1] !== COEFFS || protos.dims[2] !== PROTO || protos.dims[3] !== PROTO || protos.data.length !== COEFFS * PROTO * PROTO)) {
    throw new Error(`YOLO26 프로토 모양이 맞지 않습니다([${protos.dims.join(", ")}], 기대 [1, ${COEFFS}, ${PROTO}, ${PROTO}])`);
  }
  // 클래스 줄을 차례로 읽어 앵커마다 가장 높은 클래스를 찾는다(같은 점수면 앞 번호)
  // minScore 아래 점수는 어차피 버리므로 견주지 않는다
  const best = new Float32Array(n).fill(-1);
  const bestCls = new Int16Array(n);
  const min = opts.minScore;
  for (let c = 0; c < COCO_CLASSES; c++) {
    const row = out.subarray((4 + c) * n, (5 + c) * n);
    for (let i = 0; i < n; i++) {
      const s = row[i]!;
      if (s >= min && s > best[i]!) { best[i] = s; bestCls[i] = c; }
    }
  }
  // NMS는 Ultralytics처럼 자르기 전 레터박스 상자로 한다
  const found: (Pick<Detection, "label" | "score" | "cls" | "box"> & { i: number })[] = [];
  const marks: LandmarkBox[] = [];
  for (let i = 0; i < n; i++) {
    const score = best[i]!, cls = bestCls[i]!;
    if (score < opts.minScore) continue;
    // 냉장고·싱크대처럼 World State 가전 설비이기도 한 종류는 두 곳 모두에 낸다
    const label = COCO_LABELS[cls];
    if (label) found.push({ label, score, cls, box: lbBox(out, n, i), i });
    if (LANDMARK_SET.has(cls)) marks.push({ cls, score, box: lbBox(out, n, i) });
  }
  return {
    detections: nms(found, YOLO26_IOU).map(({ i, ...d }) => {
      let shape: ReturnType<typeof maskOf> = null;
      if (protos) {
        const coeffs = new Float32Array(COEFFS);
        for (let k = 0; k < COEFFS; k++) coeffs[k] = out[(4 + COCO_CLASSES + k) * n + i]!;
        shape = maskOf(coeffs, protos.data, d.box, lb, image);
      }
      if (shape) return { ...d, ...shape };
      const box = unbox(d.box, lb, image);
      return { ...d, box, mask: emptyMask(box), foot: boxFoot(box) };
    }),
    landmarks: suppress(marks, YOLO26_IOU, (a, b) => a.cls === b.cls).map((d) => ({ ...d, box: unbox(d.box, lb, image) })),
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

function iou(a: Detection["box"], b: Detection["box"]): number {
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
export function nms<T extends Pick<Detection, "label" | "score" | "box">>(dets: T[], iouMax: number): T[] {
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
/** onnxruntime-node에서 쓰는 부분(시험은 가짜를 넣는다). */
export interface OrtModule {
  InferenceSession: { create(path: string, options: Record<string, unknown>): Promise<unknown> };
  Tensor: unknown;
}
export type Provider = "auto" | "dml" | "cpu";
export const PROVIDERS: readonly Provider[] = ["auto", "dml", "cpu"];

/** 세션을 만들어 볼 장치 차례: auto는 Windows에서 DirectML 먼저, 그 밖에는 CPU만. */
export function providerOrder(provider: Provider, platform: NodeJS.Platform): ("dml" | "cpu")[] {
  if (provider !== "auto") return [provider];
  return platform === "win32" ? ["dml", "cpu"] : ["cpu"];
}

/** 감지기 만들기 값(워커에도 그대로 넘긴다). */
export interface DetectorSpec {
  /** YOLO26-seg 감지 파일. */
  modelPath: string;
  /** YOLO26-pose 파일. 없으면 관절을 보지 않는다. */
  posePath?: string | null;
  /** CPU 추론 스레드 수(기본 8). */
  threads?: number;
  /** 실행 장치(기본 auto: Windows는 DirectML, 안 되면 CPU). dml·cpu로 정하면 그 장치만 쓰고 못 만들면 오류다. */
  provider?: Provider;
  /** 사람이 이어서 보이는 동안 관절을 몇 장에 한 번 돌릴지(기본 3). 사람이 다시 보인 첫 장은 늘 돌린다. */
  poseEvery?: number;
  /** 감지·관절 최소 점수(기본 0.25). */
  minScore?: number;
  /** 이 점수 이상인 사람 감지가 있을 때만 관절을 돌린다(기본 minScore). World State 사람 기준(0.5)보다 낮게 둔다:
   *  손에 듦은 컵 사실이라, 사람이 흐리게 잡힌 프레임(0.46·0.49)에서도 손목을 본다. */
  poseMinPerson?: number;
}

const fileName = (p: string) => p.replace(/^.*[\\/]/, "").replace(/\.onnx$/, "");

/** onnxruntime-node로 감지기(와 관절 모델)를 돌린다. onnxruntime는 감지기를 만들 때만 불러온다(BRAIN을 안 쓰면 읽지 않게).
 *  YOLO26 감지와 관절은 같은 640 레터박스 한 장을 쓴다. */
export class OnnxDetector implements Detector {
  /** 사람이 이어서 보인 장 수(안 보이면 0으로). */
  private personRun = 0;

  private constructor(
    readonly name: string,
    readonly pose: string | null,
    readonly provider: string,
    private readonly jpeg: JpegDecoder,
    private readonly spec: Required<Pick<DetectorSpec, "minScore" | "poseMinPerson" | "poseEvery">>,
    private readonly session: OrtSession,
    private readonly poseSession: OrtSession | null,
    private readonly Tensor: TensorCtor,
  ) {}

  get decoder(): string { return this.jpeg.name; }

  /** 장치 차례대로 감지·관절 세션을 만들고 한 번 돌려 본다. 그 장치에서 하나라도 실패하면 다음 장치로 간다(마지막 장치의 오류는 그대로 낸다). */
  static async create(spec: DetectorSpec, deps: { ort?: OrtModule; platform?: NodeJS.Platform; jpeg?: JpegDecoder } = {}): Promise<OnnxDetector> {
    const ort = deps.ort ?? ((await import("onnxruntime-node")) as unknown as OrtModule);
    const Tensor = ort.Tensor as TensorCtor;
    const order = providerOrder(spec.provider ?? "auto", deps.platform ?? process.platform);
    const blank = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE).fill(PAD / 255);
    let made: { provider: string; session: OrtSession; poseSession: OrtSession | null } | null = null;
    let lastError: unknown;
    for (const provider of order) {
      // DirectML은 메모리 패턴 없이 차례대로만 돈다(onnxruntime DirectML 문서)
      const opts = provider === "dml"
        ? { executionProviders: [provider], enableMemPattern: false, executionMode: "sequential" }
        : { executionProviders: [provider], intraOpNumThreads: spec.threads ?? 8 };
      const open: OrtSession[] = [];
      try {
        for (const path of [spec.modelPath, spec.posePath]) {
          if (!path) continue;
          const s = (await ort.InferenceSession.create(path, opts)) as OrtSession;
          open.push(s);
          await s.run({ [s.inputNames[0]!]: new Tensor("float32", blank, [1, 3, INPUT_SIZE, INPUT_SIZE]) });
        }
        made = { provider, session: open[0]!, poseSession: open[1] ?? null };
        break;
      } catch (e) {
        lastError = e;
        for (const s of open) await s.release?.();
      }
    }
    if (!made) throw lastError;
    const minScore = spec.minScore ?? 0.25;
    return new OnnxDetector(
      fileName(spec.modelPath), spec.posePath ? fileName(spec.posePath) : null, made.provider, deps.jpeg ?? await jpegDecoder(),
      { minScore, poseMinPerson: spec.poseMinPerson ?? minScore, poseEvery: spec.poseEvery ?? 3 },
      made.session, made.poseSession, Tensor,
    );
  }

  /** 출력을 이름 순서대로(감지: output0·프로토 output1, 관절: output0). */
  private async run(session: OrtSession, tensor: Float32Array): Promise<OrtTensor[]> {
    const input = new this.Tensor("float32", tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const result = await session.run({ [session.inputNames[0]!]: input });
    return session.outputNames.map((name) => result[name]!);
  }

  async detect(jpegBytes: Buffer): Promise<DetectResult> {
    const t0 = performance.now();
    const img = await this.jpeg.decode(jpegBytes);
    const image = { width: img.width, height: img.height };
    const tDecode = performance.now();
    const lb = letterboxYolo26(img, INPUT_SIZE);
    const tLetterbox = performance.now();
    const [out, protos] = await this.run(this.session, lb.tensor);
    if (!out || !protos) throw new Error("YOLO26-seg 출력이 둘(감지·프로토)이 아닙니다");
    const tInfer = performance.now();
    const { detections, landmarks } = decodeYolo26All(out.data as Float32Array, out.dims, lb, image, { minScore: this.spec.minScore }, { data: protos.data as Float32Array, dims: protos.dims });
    const t1 = performance.now();
    const result: DetectResult = {
      detections, ms: t1 - t0, width: img.width, height: img.height, landmarks,
      steps: { decode: tDecode - t0, letterbox: tLetterbox - tDecode, infer: tInfer - tLetterbox, masks: t1 - tInfer },
    };
    // 관절은 사람이 이어서 보이는 동안 poseEvery장에 한 번(다시 보인 첫 장 포함)만 돌린다
    if (!detections.some((d) => d.label === "person" && d.score >= this.spec.poseMinPerson)) {
      this.personRun = 0;
      return result;
    }
    if (!this.poseSession || this.personRun++ % this.spec.poseEvery !== 0) return result;
    const [poseOut] = await this.run(this.poseSession, lb.tensor);
    if (!poseOut) throw new Error("YOLO26-pose 출력이 없습니다");
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

  private constructor(
    readonly name: string, readonly pose: string | null, readonly provider: string, readonly decoder: string,
    private readonly worker: import("node:worker_threads").Worker,
  ) {
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
    // sharp는 워커보다 먼저 이 스레드에서 불러 둔다(sharp 문서: 공유 라이브러리가 워커가 끝날 때까지 남아 있게)
    await import("sharp").catch(() => null);
    const worker = new Worker(new URL("./detector-worker.mjs", import.meta.url), {
      workerData: { entry: new URL("./detector-thread.ts", import.meta.url).href, spec },
    });
    try {
      const ready = await new Promise<{ name: string; pose: string | null; provider: string; decoder: string }>((resolve, reject) => {
        const onMsg = (m: { ready?: string; pose?: string | null; provider?: string; decoder?: string; failed?: string }) => {
          if (m.ready) resolve({ name: m.ready, pose: m.pose ?? null, provider: m.provider ?? "cpu", decoder: m.decoder ?? "jpeg-js" });
          else if (m.failed) reject(new Error(m.failed));
        };
        worker.on("message", onMsg);
        worker.once("error", reject);
        worker.once("exit", (code) => reject(new Error(`YOLO 워커가 시작 중에 끝났습니다(${code})`)));
      });
      return new WorkerDetector(ready.name, ready.pose, ready.provider, ready.decoder, worker);
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
