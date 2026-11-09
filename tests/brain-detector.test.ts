// 감지기: YOLO26n(기본)과 YOLOX(받아서 고를 때만). 레터박스·출력 풀기·NMS는 합성 값으로,
// 실제 모델은 저장소 models/의 YOLO26n으로(늘), 컵 영상 한 장과 YOLOX는 파일이 있을 때만 본다.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import {
  DETECTOR_MODELS, MODELS_DIR, OnnxDetector, POSE_MODELS, WorkerDetector, YOLO26_IOU, decodeYolo26, decodeYolox, letterboxYolo26, letterboxYolox, nms,
  type Detection,
} from "../src/brain/detector.js";
import { chooseDetector } from "../src/observe/pipeline.js";
import { ScriptedDetector } from "./helpers/detectors.js";

const S = 416;
const ANCHORS = (S / 8) ** 2 + (S / 16) ** 2 + (S / 32) ** 2; // 3549

function rgba(width: number, height: number, fill: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = fill(x, y);
    data.set([r, g, b, 255], (y * width + x) * 4);
  }
  return { data, width, height };
}

describe("letterboxYolox", () => {
  it("긴 변을 416에 맞추고 왼쪽 위에 붙인 뒤 나머지를 114로 채운다. 채널은 BGR, 0~255 그대로", () => {
    const img = rgba(832, 416, () => [10, 20, 30]);
    const { tensor, ratio } = letterboxYolox(img, S);
    expect(ratio).toBe(0.5);
    expect(tensor.length).toBe(3 * S * S);
    const at = (c: number, x: number, y: number) => tensor[c * S * S + y * S + x];
    expect([at(0, 0, 0), at(1, 0, 0), at(2, 0, 0)]).toEqual([30, 20, 10]); // B, G, R
    expect(at(0, 415, 207)).toBe(30); // 그림 안(높이 208줄)
    expect(at(0, 0, 208)).toBe(114); // 그 아래는 채움
    expect(at(2, 415, 415)).toBe(114);
  });
});

describe("letterboxYolo26", () => {
  const Y = 640;
  it("480×270은 640×360으로 키워 위아래 140줄을 114/255로 채운다. 채널은 RGB, 0~1", () => {
    const img = rgba(480, 270, () => [255, 0, 51]);
    const lb = letterboxYolo26(img, Y);
    expect(lb.ratio).toBeCloseTo(4 / 3, 6);
    expect([lb.padX, lb.padY]).toEqual([0, 140]);
    const at = (c: number, x: number, y: number) => lb.tensor[c * Y * Y + y * Y + x]!;
    expect(at(0, 0, 139)).toBeCloseTo(114 / 255, 6);
    expect([at(0, 0, 140), at(1, 0, 140), at(2, 639, 499)].map((v) => +v.toFixed(4))).toEqual([1, 0, 0.2]);
    expect(at(2, 639, 500)).toBeCloseTo(114 / 255, 6);
  });

  it("세로 360×780은 295×640으로 줄여 가운데에 둔다(왼쪽 172열 채움). 줄일 때는 쌍선형으로 섞는다", () => {
    const img = rgba(360, 780, (x) => (x < 180 ? [0, 0, 0] : [200, 200, 200]));
    const lb = letterboxYolo26(img, Y);
    expect([lb.padX, lb.padY]).toEqual([172, 0]);
    const row = (x: number) => +(lb.tensor[320 * Y + x]! * 255).toFixed(1);
    expect(row(171)).toBeCloseTo(114, 1);
    expect(row(172)).toBe(0);
    expect(row(172 + 294)).toBe(200);
    const edge = row(172 + 147); // 경계 열(147.5 → 원본 179.7 근처)은 두 값 사이
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(200);
    expect(row(172 + 295)).toBeCloseTo(114, 1);
  });
});

describe("decodeYolo26", () => {
  const N = 10;
  const lb = { ratio: 2, padX: 0, padY: 140 };
  const image = { width: 320, height: 180 };
  /** 채널 우선 [84, N]: 0~3 cx·cy·w·h(640 레터박스 픽셀), 4~83 클래스 80개 점수(시그모이드 뒤). */
  const out = () => new Float32Array(84 * N);
  const put = (o: Float32Array, i: number, box: [number, number, number, number], scores: Record<number, number>) => {
    box.forEach((v, c) => { o[c * N + i] = v; });
    for (const [cls, s] of Object.entries(scores)) o[(4 + Number(cls)) * N + i] = s;
  };

  it("레터박스를 되돌려 원본 픽셀 [x, y, w, h]로 내고, 같은 종류로 겹친 상자는 NMS로 하나만 남긴다", () => {
    const o = out();
    put(o, 3, [320, 320, 64, 32], { 0: 0.9 });
    put(o, 5, [321, 320, 64, 32], { 0: 0.8 }); // 같은 사람의 겹친 상자(이 내보내기는 NMS 전 출력이다)
    put(o, 8, [100, 300, 20, 40], { 40: 0.5 }); // 유리컵도 컵
    const dets = decodeYolo26(o, [1, 84, N], lb, image, { minScore: 0.25 });
    expect(dets.map((d) => [d.label, d.cls, +d.score.toFixed(2), d.box.map((v) => +v.toFixed(1))])).toEqual([
      ["person", 0, 0.9, [144, 82, 32, 16]],
      ["cup", 40, 0.5, [45, 70, 10, 20]],
    ]);
  });

  it("앵커마다 80종 가운데 가장 높은 종류 하나만 본다: 식탁이 더 높으면 그 앵커의 컵은 버린다. 보지 않는 종류·최소 점수 아래도 버린다", () => {
    const o = out();
    put(o, 1, [100, 300, 20, 20], { 41: 0.6, 60: 0.7 }); // dining table이 가장 높음
    put(o, 2, [200, 300, 20, 20], { 2: 0.99 }); // car
    put(o, 4, [300, 300, 20, 20], { 39: 0.2 }); // 병 0.2 < 0.25
    put(o, 6, [400, 300, 20, 20], { 45: 0.7, 41: 0.69 }); // 그릇
    expect(decodeYolo26(o, [1, 84, N], lb, image, { minScore: 0.25 }).map((d) => [d.label, d.cls])).toEqual([["bowl", 45]]);
  });

  it("그림 밖으로 나간 상자는 그림 끝에서 자른다", () => {
    const o = out();
    put(o, 0, [10, 150, 40, 40], { 0: 0.9 }); // 레터박스 왼쪽 끝을 넘고, 위쪽 채움 줄에 걸침
    const [d] = decodeYolo26(o, [1, 84, N], lb, image, { minScore: 0.25 });
    expect(d!.box.map((v) => +v.toFixed(1))).toEqual([0, 0, 15, 15]);
  });

  it("출력 모양이 [1, 84, N]이 아니면 오류", () => {
    expect(() => decodeYolo26(new Float32Array(85 * N), [1, 85, N], lb, image, { minScore: 0.25 })).toThrow(/출력 모양/);
    expect(() => decodeYolo26(new Float32Array(84 * N), [1, 84, N + 1], lb, image, { minScore: 0.25 })).toThrow(/출력 모양/);
  });
});

describe("decodeYolox", () => {
  it("격자 위치·보폭으로 상자를 풀고 원본 크기로 되돌린다. 점수 = 물체 × 클래스", () => {
    const out = new Float32Array(ANCHORS * 85);
    const idx = 5 * 52 + 10; // 보폭 8, 격자 (10, 5)
    out.set([0.5, 0.5, Math.log(4), Math.log(2), 0.9], idx * 85);
    out[idx * 85 + 5 + 0] = 0.9; // person
    const cup = (52 * 52) + 3 * 26 + 7; // 보폭 16, 격자 (7, 3)
    out.set([0, 0, 0, 0, 0.8], cup * 85);
    out[cup * 85 + 5 + 41] = 0.6; // cup
    const ignored = 100;
    out.set([0, 0, 0, 0, 0.99], ignored * 85);
    out[ignored * 85 + 5 + 2] = 0.99; // car: 보지 않는 클래스
    const dets = decodeYolox(out, ANCHORS, S, 0.5, { minScore: 0.25 });
    const person = dets.find((d) => d.label === "person")!;
    expect(person.score).toBeCloseTo(0.81, 5);
    expect(person.box.map((v) => Math.round(v))).toEqual([136, 72, 64, 32]);
    const c = dets.find((d) => d.label === "cup")!;
    expect(c.score).toBeCloseTo(0.48, 5);
    expect(c.cls).toBe(41);
    expect(dets).toHaveLength(2);
  });

  it("wine glass(40)도 컵으로 본다. 최소 점수 아래는 버린다", () => {
    const out = new Float32Array(ANCHORS * 85);
    out.set([0, 0, 0, 0, 0.5], 0);
    out[5 + 40] = 0.9;
    out.set([0, 0, 0, 0, 0.5], 85);
    out[85 + 5 + 0] = 0.3; // 0.15 < 0.25
    const dets = decodeYolox(out, ANCHORS, S, 1, { minScore: 0.25 });
    expect(dets.map((d) => [d.label, d.cls])).toEqual([["cup", 40]]);
  });

  it("병(39)·그릇(45)도 찾고, 종류 순서는 사람·컵·병·그릇", () => {
    const out = new Float32Array(ANCHORS * 85);
    out.set([0, 0, 0, 0, 0.9], 0);
    out[5 + 45] = 0.8; // bowl
    out.set([0, 0, 0, 0, 0.9], 85);
    out[85 + 5 + 39] = 0.7; // bottle
    out.set([0, 0, 0, 0, 0.9], 2 * 85);
    out[2 * 85 + 5 + 41] = 0.5; // cup
    out.set([0, 0, 0, 0, 0.9], 3 * 85);
    out[3 * 85 + 5 + 0] = 0.4; // person
    const dets = decodeYolox(out, ANCHORS, S, 1, { minScore: 0.25 });
    expect(dets.map((d) => [d.label, d.cls])).toEqual([["person", 0], ["cup", 41], ["bottle", 39], ["bowl", 45]]);
  });

  it("출력 길이가 격자 수와 다르면 오류", () => {
    expect(() => decodeYolox(new Float32Array(10 * 85), 10, S, 1, { minScore: 0.25 })).toThrow(/격자/);
  });
});

describe("nms", () => {
  const d = (label: Detection["label"], score: number, box: Detection["box"]): Detection => ({ label, score, box, cls: label === "person" ? 0 : 41 });
  it("같은 종류의 많이 겹친 상자는 점수 높은 것만 남기고, 다른 종류는 따로 본다", () => {
    const kept = nms([d("person", 0.6, [0, 0, 100, 100]), d("person", 0.9, [5, 5, 100, 100]), d("person", 0.7, [300, 300, 50, 50]), d("cup", 0.5, [5, 5, 100, 100])], 0.45);
    expect(kept.map((k) => [k.label, k.score])).toEqual([["person", 0.9], ["person", 0.7], ["cup", 0.5]]);
  });

  it("YOLO26 기준 IoU 0.5(YOLO26_IOU): 많이 겹친 컵 둘(IoU 0.6)은 하나, 조금 겹친 컵 둘(IoU 0.33)은 둘 다 남긴다", () => {
    expect(YOLO26_IOU).toBe(0.5);
    expect(nms([d("cup", 0.8, [0, 0, 100, 100]), d("cup", 0.7, [0, 25, 100, 100])], YOLO26_IOU)).toHaveLength(1);
    expect(nms([d("cup", 0.8, [0, 0, 100, 100]), d("cup", 0.7, [0, 50, 100, 100])], YOLO26_IOU)).toHaveLength(2);
  });
});

describe("모델 표와 고르기", () => {
  it("기본 감지기는 저장소 models/의 yolo26n, 자세는 yolo26n-pose다. YOLOX는 runtime/models/에 받아서 고른다", () => {
    expect(chooseDetector({}, "rt")).toEqual({
      spec: { modelPath: join(MODELS_DIR, "yolo26n.onnx"), kind: "yolo26", posePath: join(MODELS_DIR, "yolo26n-pose.onnx"), threads: 4 },
    });
    expect(chooseDetector({ BRAIN_DETECTOR: "yolox_tiny", BRAIN_POSE: "off", BRAIN_YOLO_THREADS: "2" }, "rt")).toEqual({
      spec: { modelPath: join("rt", "models", "yolox_tiny.onnx"), kind: "yolox", posePath: null, threads: 2 },
    });
    expect(chooseDetector({ BRAIN_YOLO_PATH: "a.onnx", BRAIN_POSE_PATH: "b.onnx" }, "rt").spec).toMatchObject({ modelPath: "a.onnx", kind: "yolo26", posePath: "b.onnx" });
    expect(chooseDetector({ BRAIN_DETECTOR: "off" }, "rt")).toEqual({ spec: null });
    expect(chooseDetector({ BRAIN_DETECTOR: "yolov8" }, "rt")).toMatchObject({ spec: null, warn: expect.stringContaining("yolo26n") });
    expect(chooseDetector({ BRAIN_POSE: "yolov8-pose" }, "rt")).toMatchObject({ spec: { posePath: null }, warn: expect.stringContaining("yolo26n-pose") });
  });

  it("저장소 models/의 YOLO26 파일 sha256이 표와 같다", () => {
    const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
    expect(sha(join(MODELS_DIR, DETECTOR_MODELS.yolo26n.file))).toBe(DETECTOR_MODELS.yolo26n.sha256);
    expect(sha(join(MODELS_DIR, POSE_MODELS["yolo26n-pose"].file))).toBe(POSE_MODELS["yolo26n-pose"].sha256);
  });
});

describe("ScriptedDetector", () => {
  it("함수가 정한 감지를 돌려준다(시험용)", async () => {
    const det = new ScriptedDetector(() => [{ label: "cup", score: 0.8, box: [0, 0, 1, 1], cls: 41 }]);
    const r = await det.detect(Buffer.from([0xff, 0xd8]));
    expect(r.detections).toHaveLength(1);
    expect(r.ms).toBe(0);
  });
});

const y26 = join(MODELS_DIR, DETECTOR_MODELS.yolo26n.file);
const gray = Buffer.from(jpeg.encode(rgba(360, 780, () => [128, 128, 128]), 80).data);

describe("YOLO26n 실제 모델(저장소 models/)", () => {
  it("회색 세로 그림 한 장: 출력 [1, 84, 8400]을 풀어 감지가 없다", async () => {
    const det = await OnnxDetector.create({ modelPath: y26, kind: "yolo26" });
    try {
      expect(det.name).toBe("yolo26n");
      const r = await det.detect(gray);
      expect(r.detections).toEqual([]);
      expect([r.width, r.height]).toEqual([360, 780]);
    } finally {
      await det.close();
    }
  }, 30_000);

  it("워커 스레드에서도 돌고, 닫으면 기다리던 감지는 실패로 끝난다", async () => {
    const det = await WorkerDetector.create({ modelPath: y26, kind: "yolo26" });
    try {
      expect(det.name).toBe("yolo26n");
      expect((await det.detect(gray)).detections).toEqual([]);
      // 거절 검사를 닫기 전에 걸어 둔다(닫는 순간 거절되면 처리되지 않은 거절이 된다)
      const late = expect(det.detect(gray)).rejects.toThrow();
      await det.close();
      await late;
      await expect(det.detect(gray)).rejects.toThrow(/닫았습니다/); // 닫은 뒤 요청은 기다리지 않고 바로 실패
    } finally {
      await det.close();
    }
  }, 30_000);

  it("모델 파일이 없으면 워커 만들기가 실패한다", async () => {
    await expect(WorkerDetector.create({ modelPath: join(MODELS_DIR, "없는모델.onnx"), kind: "yolo26" })).rejects.toThrow();
  }, 30_000);
});

// 컵 영상 한 장(480×270): 오른쪽에서 손이 컵을 잡고 있고, 그릇·유리 주전자가 있다. 저장소에 커밋하지 않은 runtime/ 파일이라 있을 때만 본다.
// Ultralytics 8.4 기준(같은 ONNX, conf 0.25, imgsz 640): 사람 0.880 [302.3, 62.6, 177.3, 121.3], 그릇 0.833, 컵 0.817 [282.2, 141.5, 51.2, 62.0].
const frame = join("runtime", "vlm-events", "cup", "frames", "frame-000025.jpg");
describe.skipIf(!existsSync(frame))("YOLO26n 컵 영상 한 장(파일이 있을 때만)", () => {
  it("사람·컵·그릇을 World State 기준(사람 0.5·물건 0.4) 넘게 찾고, Ultralytics 기준과 점수 0.03·상자 3px 안이다", async () => {
    const det = await OnnxDetector.create({ modelPath: y26, kind: "yolo26" });
    try {
      const r = await det.detect(readFileSync(frame));
      const best = (label: string) => r.detections.filter((d) => d.label === label).sort((a, b) => b.score - a.score)[0];
      expect(best("person")!.score).toBeGreaterThan(0.5);
      expect(best("cup")!.score).toBeGreaterThan(0.4);
      expect(best("bowl")!.score).toBeGreaterThan(0.4);
      expect(Math.abs(best("person")!.score - 0.88)).toBeLessThan(0.03);
      expect(Math.abs(best("cup")!.score - 0.817)).toBeLessThan(0.03);
      best("cup")!.box.forEach((v, i) => expect(Math.abs(v - [282.2, 141.5, 51.2, 62.0][i]!)).toBeLessThan(3));
      expect(r.detections.filter((d) => d.label === "cup")).toHaveLength(1); // 겹친 상자는 NMS로 하나
      expect(r.width).toBe(480);
    } finally {
      await det.close();
    }
  }, 30_000);
});

const tiny = join("runtime", "models", DETECTOR_MODELS.yolox_tiny.file);
describe.skipIf(!existsSync(tiny) || !existsSync(frame))("YOLOX-Tiny 실제 모델(받았을 때만)", () => {
  it("컵 영상에서 손(사람)과 컵을 찾는다", async () => {
    const det = await OnnxDetector.create({ modelPath: tiny, kind: "yolox" });
    try {
      const r = await det.detect(readFileSync(frame));
      const best = (label: string) => Math.max(0, ...r.detections.filter((d) => d.label === label).map((d) => d.score));
      expect(det.name).toBe("yolox_tiny");
      expect(best("person")).toBeGreaterThan(0.5);
      expect(best("cup")).toBeGreaterThan(0.5);
    } finally {
      await det.close();
    }
  }, 30_000);
});
