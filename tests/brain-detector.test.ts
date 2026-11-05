// YOLOX 감지기: 레터박스·격자 풀기·NMS는 합성 값으로, 실제 모델은 파일이 있을 때만 컵 영상 한 장으로 본다.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import {
  ScriptedDetector, WorkerDetector, YOLOX_MODELS, YoloxDetector, decodeYolox, letterbox, nms, type Detection,
} from "../src/brain/detector.js";

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

describe("letterbox", () => {
  it("긴 변을 416에 맞추고 왼쪽 위에 붙인 뒤 나머지를 114로 채운다. 채널은 BGR, 0~255 그대로", () => {
    const img = rgba(832, 416, () => [10, 20, 30]);
    const { tensor, ratio } = letterbox(img, S);
    expect(ratio).toBe(0.5);
    expect(tensor.length).toBe(3 * S * S);
    const at = (c: number, x: number, y: number) => tensor[c * S * S + y * S + x];
    expect([at(0, 0, 0), at(1, 0, 0), at(2, 0, 0)]).toEqual([30, 20, 10]); // B, G, R
    expect(at(0, 415, 207)).toBe(30); // 그림 안(높이 208줄)
    expect(at(0, 0, 208)).toBe(114); // 그 아래는 채움
    expect(at(2, 415, 415)).toBe(114);
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

  it("출력 길이가 격자 수와 다르면 오류", () => {
    expect(() => decodeYolox(new Float32Array(10 * 85), 10, S, 1, { minScore: 0.25 })).toThrow(/격자/);
  });
});

describe("nms", () => {
  it("같은 종류의 많이 겹친 상자는 점수 높은 것만 남기고, 다른 종류는 따로 본다", () => {
    const d = (label: Detection["label"], score: number, box: Detection["box"]): Detection => ({ label, score, box, cls: label === "person" ? 0 : 41 });
    const kept = nms([d("person", 0.6, [0, 0, 100, 100]), d("person", 0.9, [5, 5, 100, 100]), d("person", 0.7, [300, 300, 50, 50]), d("cup", 0.5, [5, 5, 100, 100])], 0.45);
    expect(kept.map((k) => [k.label, k.score])).toEqual([["person", 0.9], ["person", 0.7], ["cup", 0.5]]);
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

const tiny = join("runtime", "models", YOLOX_MODELS.yolox_tiny.file);
const frame = join("runtime", "vlm-events", "cup", "frames", "frame-000025.jpg");
describe.skipIf(!existsSync(tiny) || !existsSync(frame))("YOLOX-Tiny 실제 모델(파일이 있을 때만)", () => {
  it("컵 영상에서 손(사람)과 컵을 찾는다", async () => {
    const det = await YoloxDetector.create(tiny);
    const r = await det.detect(readFileSync(frame));
    const best = (label: string) => Math.max(0, ...r.detections.filter((d) => d.label === label).map((d) => d.score));
    expect(best("person")).toBeGreaterThan(0.5);
    expect(best("cup")).toBeGreaterThan(0.5);
    expect(r.width).toBe(jpeg.decode(readFileSync(frame)).width);
  }, 30_000);

  it("워커 스레드에서도 같은 결과를 내고, 닫으면 기다리던 감지는 실패로 끝난다", async () => {
    const det = await WorkerDetector.create(tiny);
    try {
      const r = await det.detect(readFileSync(frame));
      expect(det.name).toBe("yolox_tiny");
      expect(Math.max(0, ...r.detections.filter((d) => d.label === "cup").map((d) => d.score))).toBeGreaterThan(0.5);
      // 거절 검사를 닫기 전에 걸어 둔다(닫는 순간 거절되면 처리되지 않은 거절이 된다)
      const late = expect(det.detect(readFileSync(frame))).rejects.toThrow();
      await det.close();
      await late;
      await expect(det.detect(readFileSync(frame))).rejects.toThrow(/닫았습니다/); // 닫은 뒤 요청은 기다리지 않고 바로 실패
    } finally {
      await det.close();
    }
  }, 30_000);

  it("모델 파일이 없으면 워커 만들기가 실패한다", async () => {
    await expect(WorkerDetector.create(join("runtime", "models", "없는모델.onnx"))).rejects.toThrow();
  }, 30_000);
});
