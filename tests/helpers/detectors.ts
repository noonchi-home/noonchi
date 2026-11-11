// 시험용 감지기: 함수가 감지(와 관절)를 정한다. 실제 감지기는 src/brain/detector.ts의 OnnxDetector·WorkerDetector.
import type { DetectResult, Detection, Detector, Pose } from "../../src/brain/detector.js";
import { sha256 } from "../../src/observe/ring.js";

/** 엔진 사진(sha256이 engine 안)은 full 감지(기본 없음), 그 밖의 사진(가까이 보기로 잘라 키운 사진)은 crop 감지. engine은 시험이 사진을 만들 때마다 채운다. */
export function cropAware(engine: ReadonlySet<string>, o: { full?: Detection[]; crop: Detection[] }): ScriptedDetector {
  return new ScriptedDetector((jpeg) => (engine.has(sha256(jpeg)) ? o.full ?? [] : o.crop));
}

export class ScriptedDetector implements Detector {
  readonly name = "scripted";
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
