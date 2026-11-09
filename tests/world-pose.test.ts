// 사람 관절 규칙(src/world/pose.ts, 출처 docs/provenance.md)과 YOLO26-pose 출력 풀기, 실제 관절 모델.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DETECTOR_MODELS, MODELS_DIR, OnnxDetector, POSE_MODELS, decodeYolo26Pose, type Keypoint } from "../src/brain/detector.js";
import { describePose, heldBy, mainPerson } from "../src/world/pose.js";
import { poseOf } from "./helpers/poses.js";

const pose = poseOf;
// COCO: 5·6 어깨, 9·10 손목, 11·12 엉덩이, 13·14 무릎
const SHOULDERS = { 5: [110, 100, 0.9], 6: [150, 100, 0.9] } as Record<number, Keypoint>;
const HIPS = { 11: [115, 200, 0.9], 12: [145, 200, 0.9] } as Record<number, Keypoint>;

describe("describePose: 관절 → 자세", () => {
  it("몸통이 서 있고 허벅지가 수직에 가까우면 서 있음, 관절이 모두 0.5 이상이면 확실(high)", () => {
    const p = describePose(pose({ ...SHOULDERS, ...HIPS, 13: [115, 280, 0.9], 14: [145, 280, 0.9] }));
    expect([p.posture, p.level]).toEqual(["standing", "high"]);
  });

  it("허벅지가 수직에서 45° 넘게 누우면 앉아 있음", () => {
    expect(describePose(pose({ ...SHOULDERS, ...HIPS, 13: [190, 215, 0.9], 14: [210, 215, 0.9] })).posture).toBe("sitting");
  });

  it("몸통이 수직에서 60° 넘게 기울면 누워 있음", () => {
    expect(describePose(pose({ 5: [100, 100, 0.9], 6: [100, 120, 0.9], 11: [200, 115, 0.9], 12: [200, 135, 0.9] })).posture).toBe("lying");
  });

  it("무릎이 안 보이면(0.3 아래) 다리 가림(upright), 어깨·엉덩이가 없고 상자가 가로로 길면 누움이지만 쓴 관절이 없으면 불확실(low)", () => {
    expect(describePose(pose({ ...SHOULDERS, ...HIPS, 13: [115, 280, 0.2] })).posture).toBe("upright");
    const wide = describePose(pose({}, [0, 0, 300, 100]));
    expect([wide.posture, wide.level]).toEqual(["lying", "low"]);
    expect(describePose(pose({})).posture).toBe("unknown");
  });

  it("손목은 0.3 이상만 쓰고, 크기 기준(scale)은 어깨 너비·몸통 길이×0.6·상자 짧은 변×0.25 중 큰 값", () => {
    const p = describePose(pose({ ...SHOULDERS, ...HIPS, 9: [120, 210, 0.2], 10: [160, 150, 0.8] }));
    expect(p.wrists).toEqual({ right: [160, 150] });
    expect(p.scale).toBe(60); // 몸통 100 × 0.6
  });
});

describe("mainPerson: 한 사람 고르기", () => {
  it("자세가 불확실하지 않은 사람을 먼저, 그 안에서 점수 × 상자 넓이가 큰 사람", () => {
    const big = pose({}, [0, 0, 400, 400], 0.9); // 관절 없음 → low
    const clear = pose({ ...SHOULDERS, ...HIPS, 13: [115, 280, 0.9], 14: [145, 280, 0.9] }, [80, 60, 100, 300], 0.6);
    expect(mainPerson([big, clear])!.posture).toBe("standing");
    expect(mainPerson([])).toBeNull();
  });
});

describe("heldBy: 손에 듦", () => {
  const person = describePose(pose({ ...SHOULDERS, ...HIPS, 10: [230, 170, 0.9] })); // scale 60 → 작은 물건은 21px 안
  it("작은 물건(사람 상자의 25% 이하)은 손목이 상자에서 scale×0.35 안이면 든 것", () => {
    expect(heldBy(person, [220, 160, 40, 20])).toBe("right"); // 손목이 상자 안
    expect(heldBy(person, [240, 160, 40, 20])).toBe("right"); // 상자 왼쪽 끝에서 10px
    expect(heldBy(person, [260, 160, 40, 20])).toBeNull(); // 30px
  });

  it("큰 물건(사람 상자의 25%를 넘음)은 손목이 상자 안이어야 든 것", () => {
    expect(heldBy(person, [235, 100, 100, 100])).toBeNull(); // 5px 밖
    expect(heldBy(person, [220, 100, 100, 100])).toBe("right");
  });

  it("손목이 안 보이면 들지 않은 것", () => {
    expect(heldBy(describePose(pose({ ...SHOULDERS, ...HIPS })), [0, 0, 1000, 1000])).toBeNull();
  });
});

describe("decodeYolo26Pose", () => {
  const N = 6;
  const lb = { ratio: 2, padX: 0, padY: 140 };
  const image = { width: 320, height: 180 };
  const put = (o: Float32Array, i: number, box: [number, number, number, number], score: number, kp: Record<number, Keypoint> = {}) => {
    box.forEach((v, c) => { o[c * N + i] = v; });
    o[4 * N + i] = score;
    for (const [k, [x, y, c]] of Object.entries(kp)) {
      const row = 5 + Number(k) * 3;
      o[row * N + i] = x; o[(row + 1) * N + i] = y; o[(row + 2) * N + i] = c;
    }
  };
  it("점수 0.25 이상인 사람을 상자·관절 17개(원본 픽셀)로 풀고, 겹친 사람은 NMS로 하나", () => {
    const o = new Float32Array(56 * N);
    put(o, 1, [320, 320, 64, 128], 0.8, { 10: [330, 300, 0.9] });
    put(o, 2, [322, 320, 64, 128], 0.7);
    put(o, 4, [100, 300, 40, 80], 0.2);
    const poses = decodeYolo26Pose(o, [1, 56, N], lb, image, { minScore: 0.25 });
    expect(poses).toHaveLength(1);
    expect(poses[0]!.box).toEqual([144, 58, 32, 64]);
    expect(poses[0]!.keypoints).toHaveLength(17);
    expect(poses[0]!.keypoints[10]!.map((v) => +v.toFixed(2))).toEqual([165, 80, 0.9]);
  });

  it("출력 모양이 [1, 56, N]이 아니면 오류", () => {
    expect(() => decodeYolo26Pose(new Float32Array(84 * N), [1, 84, N], lb, image, { minScore: 0.25 })).toThrow(/출력 모양/);
  });
});

// 컵 영상 한 장(480×270): 오른쪽에서 들어온 팔. Ultralytics 8.4 기준 오른 손목(10) (376, 153) 0.89, 어깨·엉덩이는 0.1 아래.
const frame = join("runtime", "vlm-events", "cup", "frames", "frame-000025.jpg");
describe.skipIf(!existsSync(frame))("YOLO26n-pose 실제 모델(컵 영상이 있을 때만)", () => {
  it("사람이 보이는 프레임에서 관절을 돌려 오른 손목을 찾는다. 몸통이 안 보여 자세는 모름, 손목이 컵 상자에서 43px라 든 것으로 보지 않는다", async () => {
    const det = await OnnxDetector.create({
      modelPath: join(MODELS_DIR, DETECTOR_MODELS.yolo26n.file), kind: "yolo26", posePath: join(MODELS_DIR, POSE_MODELS["yolo26n-pose"].file),
    });
    try {
      expect(det.pose).toBe("yolo26n-pose");
      const r = await det.detect(readFileSync(frame));
      expect(r.poses!.length).toBeGreaterThanOrEqual(1);
      expect(r.poseMs).toBeGreaterThan(0);
      const p = mainPerson(r.poses!)!;
      expect(Math.hypot(p.wrists.right![0] - 376, p.wrists.right![1] - 153)).toBeLessThan(5);
      expect(p.posture).toBe("unknown");
      const cup = r.detections.find((d) => d.label === "cup")!;
      expect(heldBy(p, cup.box)).toBeNull();
    } finally {
      await det.close();
    }
  }, 30_000);
});
