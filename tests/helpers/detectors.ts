// 시험용 감지기: 함수가 감지(와 관절)를 정한다. 실제 감지기는 src/observe/detector.ts의 OnnxDetector·WorkerDetector.
import type { DetectResult, Detector } from "../../src/observe/detector.js";
import type { Detection, Pose } from "../../src/contract/observe.js";
import { boxFoot, fullMask } from "../../src/shared/mask.js";
import { CLASSES } from "../../src/world/vocab.js";
import { sha256 } from "../../src/observe/ring.js";

/** 감지 하나: 상자를 꽉 채운 모양, 바닥 점은 상자 아랫변 가운데. cls를 안 주면 그 종류의 첫 COCO 번호(사람 0, 컵 41). */
export function det(label: Detection["label"], score: number, box: Detection["box"], cls?: number): Detection {
  const first = label === "cup" ? 41 : Number(Object.keys(CLASSES[label].coco)[0]);
  return { label, score, cls: cls ?? first, box, mask: fullMask(box), foot: boxFoot(box) };
}

/** 엔진 사진(sha256이 engine 안)은 full 감지(기본 없음), 그 밖의 사진(가까이 보기로 잘라 키운 사진)은 crop 감지. engine은 시험이 사진을 만들 때마다 채운다. */
export function cropAware(engine: ReadonlySet<string>, o: { full?: Detection[]; crop: Detection[] }): ScriptedDetector {
  return new ScriptedDetector((jpeg) => (engine.has(sha256(jpeg)) ? o.full ?? [] : o.crop));
}

/** 엔진 사진은 감지 없음, 그 밖의 사진(잘라 키운 사진)은 crops를 받은 차례대로 하나씩(다 쓰면 없음).
 *  가까이 보기는 고른 장을 오래된 것부터 자르므로 한 번 가까이 보면 crops[k]가 k번째 장의 감지다. */
export function cropTurns(engine: ReadonlySet<string>, crops: readonly Detection[][]): ScriptedDetector {
  let k = 0;
  return new ScriptedDetector((jpeg) => (engine.has(sha256(jpeg)) ? [] : crops[k++] ?? []));
}

/** 사진마다 정해 둔 감지(sha256 → 감지). 시험이 엔진 사진과 그 사진을 잘라 키운 사진을 만들 때 그 촬영 때의 감지를 넣는다. 모르는 사진은 감지 없음. */
export function seenDetector(seen: ReadonlyMap<string, Detection[]>): ScriptedDetector {
  return new ScriptedDetector((jpeg) => seen.get(sha256(jpeg)) ?? []);
}

export class ScriptedDetector implements Detector {
  readonly name = "scripted";
  readonly provider = "scripted";
  readonly pose: string | null;
  /** poses: 관절 대본. 없으면 관절을 내지 않고, undefined를 돌려주면 그 프레임은 관절을 돌리지 않은 것. */
  constructor(private readonly script: (jpegBytes: Buffer) => Detection[], private readonly poses?: (jpegBytes: Buffer) => Pose[] | undefined) {
    this.pose = poses ? "scripted-pose" : null;
  }

  async detect(jpegBytes: Buffer): Promise<DetectResult> {
    const r: DetectResult = { detections: this.script(jpegBytes), ms: 0, width: 0, height: 0 };
    const poses = this.poses?.(jpegBytes);
    return poses ? { ...r, poses, poseMs: 0 } : r;
  }
}
