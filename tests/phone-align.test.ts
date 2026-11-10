// AR 자세 → 트윈 눈 자세(src/phone/align.ts): 맞춤 변환(회전·이동·바닥 높이)으로 옮긴다. 변환은 위치 맞추기(src/sync)가 구한다.
import { describe, expect, it } from "vitest";
import { forwardOf, fromTwin, planOf, toTwin, type Alignment, type Quat } from "../src/phone/align.js";

const yawQ = (deg: number): Quat => {
  const h = (deg * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
};
const pitchQ = (deg: number): Quat => {
  const h = (deg * Math.PI) / 360;
  return [Math.sin(h), 0, 0, Math.cos(h)];
};
const SAME: Alignment = { theta: 0, tx: 0, ty: 0, floorY: 0 };

describe("forwardOf", () => {
  it("돌리지 않은 폰은 -Z를 보고, Y축 90° 회전이면 -X를 본다", () => {
    expect(forwardOf([0, 0, 0, 1])).toEqual([0, 0, -1]);
    const f = forwardOf(yawQ(90));
    expect(f[0]).toBeCloseTo(-1);
    expect(f[1]).toBeCloseTo(0);
    expect(f[2]).toBeCloseTo(0);
  });
});

describe("toTwin·planOf·fromTwin", () => {
  it("AR과 평면이 같으면 그대로 옮긴다", () => {
    expect(toTwin([1, 1.5, 2], [0, 0, 0, 1], SAME)).toEqual({ position: [1, 2], height_m: 1.5, yaw_deg: 270, pitch_deg: 0 });
  });

  it("30° 돌아가고 옮겨진 AR 공간: 자리·높이·방향", () => {
    const al: Alignment = { theta: Math.PI / 6, tx: 3.9, ty: 5.51, floorY: -1.4 };
    const eye = toTwin([0.5, 0, -1], [0, 0, 0, 1], al);
    expect(eye.position[0]).toBeCloseTo(4.833, 2);
    expect(eye.position[1]).toBeCloseTo(4.894, 2);
    expect(eye.height_m).toBeCloseTo(1.4);
    expect(eye.yaw_deg).toBeCloseTo(300, 0);
    // 평면 점 ↔ AR 점은 서로 거꾸로
    const back = fromTwin([eye.position[0], 0.3, eye.position[1]], al);
    expect(back[1]).toBeCloseTo(-1.1, 6);
    planOf(back, al).forEach((v, i) => expect(v).toBeCloseTo(eye.position[i]!, 3));
  });

  it("고개를 숙이면 pitch가 음수다", () => {
    expect(toTwin([0, 1.2, 0], pitchQ(-30), SAME).pitch_deg).toBeCloseTo(-30, 1);
  });
});
