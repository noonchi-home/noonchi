// 시연자 손을 사용자로 세지 않는다(2026-11-25 사용자 결정, 규칙은 control):
// 1. 관절에 머리(코·눈·귀)나 어깨가 확신 0.5 이상으로 있는 사람 상자만 사용자로 센다. 손·팔만 잡힌 상자는 사용자가 아니다.
// 2. 안 보임 → 보임은 그 조건을 0.6초 이어서 만족할 때다.
// 3. 로봇 실행 단계 중에는 화면 아래 가장자리에 닿고 머리 관절이 없는 사람 상자를 사용자 후보에서 뺀다.
// 장면 값은 2026-11-25 예시 녹화(cup-glass-empty-leave)의 단계 영상: 64.1초 시연자 손 person 0.92 (0,472,184,168), 69.3초 그 손의 컵에 drinking.
import { describe, expect, it } from "vitest";
import type { Detection, EngineFrame, Pose, SceneObservation } from "../src/contract/observe.js";
import { WorldState } from "../src/world/state/world.js";
import { LOOK_VIEW, engineFrame } from "./helpers/camera.js";
import { det } from "./helpers/detectors.js";
import { poseOf } from "./helpers/poses.js";

const SIZE = { width: 480, height: 640 };
const EYE = { position: [0, 0] as [number, number], height_m: 1.5, yaw_deg: 0, pitch_deg: 0 };
const look = { view: LOOK_VIEW, ...SIZE, eye: EYE.position };
const ws = () => new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "living", label: "거실" }), devices: () => [] });
const frame = (t: number): EngineFrame => ({ ...engineFrame(`e${t}`, t, { view: LOOK_VIEW, jpeg: Buffer.from(String(t)) }), ...SIZE, eye: EYE as never });

/** 시연자 손: 왼쪽 아래 모서리에 닿은 상자, 관절은 손목·팔꿈치만. */
const HAND = det("person", 0.92, [0, 472, 184, 168], 0);
const HAND_POSE = poseOf({ 9: [120, 560, 0.9], 7: [40, 630, 0.6] }, [0, 472, 184, 168], 0.6);
/** 돌아온 사용자: 얼굴·어깨·엉덩이가 보인다. */
const BODY = det("person", 0.9, [160, 120, 160, 420], 0);
const BODY_POSE = poseOf({ 0: [240, 150, 0.9], 1: [232, 142, 0.9], 2: [248, 142, 0.9], 5: [210, 200, 0.9], 6: [270, 200, 0.9], 11: [220, 330, 0.9], 12: [260, 330, 0.9] }, [160, 120, 160, 420]);
/** 아래 가장자리에 닿은 몸통(폰을 든 시연자를 위에서 봄): 어깨는 보이고 얼굴은 없다. */
const LOW = det("person", 0.9, [100, 300, 280, 340], 0);
const LOW_POSE = poseOf({ 5: [160, 360, 0.9], 6: [320, 360, 0.9], 11: [180, 560, 0.8], 12: [300, 560, 0.8] }, [100, 300, 280, 340]);

/** 엔진 프레임을 0.1초마다 넣는다. 관절은 사람이 이어서 보이는 동안 3장에 한 번(첫 장 포함, src/observe/detector.ts poseEvery)만 온다.
 *  pose가 null이면 관절 모델이 없다(관절을 한 번도 주지 않는다). 처음 보임이 된 시각을 돌려준다. */
function feed(w: WorldState, from: number, to: number, dets: Detection[], pose: Pose | null): number | null {
  let shown: number | null = null;
  for (let t = from, run = 0; t <= to; t += 100, run++) {
    w.applyDetections(frame(t), dets, pose && run % 3 === 0 ? [pose] : undefined);
    if (shown === null && w.view(t).person.visible) shown = t;
  }
  return shown;
}

const CUP = { x: 140 / 480, y: 368 / 640, w: 144 / 480, h: 232 / 640 };
const handCup = (states: string[]): SceneObservation => ({
  scene: "dining", summary: "A hand is holding a clear glass cup.", objects: [{ id: "v1", cls: "cup", box: CUP, det: null }],
  observations: states.map((state) => ({ object_id: "v1", state: state as never })),
});

describe("사용자로 세는 사람 상자", () => {
  it("시연자 손 상자(관절에 손목·팔꿈치만)는 3초 이어져도 사람 보임이 되지 않고, 그 손의 컵에 붙은 「마시는 중」도 사람 사실이 되지 않는다", () => {
    const w = ws();
    expect(feed(w, 0, 3000, [HAND], HAND_POSE)).toBeNull();
    expect(w.view(3000).person).toMatchObject({ visible: false, count: 0 });
    w.applyScene("v3100", 3100, handCup(["in_hand", "drinking"]), new Map(), look);
    const p = w.view(3100).person;
    expect(p.visible).toBe(false);
    expect(p.facts.activity).toBeUndefined();
  });

  it("관절 모델이 손을 사람으로 못 잡으면(관절 없음) 그 상자도 사용자가 아니다", () => {
    const w = ws();
    feed(w, 0, 300, [BODY], BODY_POSE);
    w.applyDetections(frame(400), [], undefined);
    let shown: number | null = null;
    for (let t = 500, run = 0; t <= 3500; t += 100, run++) {
      w.applyDetections(frame(t), [HAND], run % 3 === 0 ? [] : undefined);
      if (shown === null && w.view(t).person.visible) shown = t;
    }
    expect(shown).toBeNull();
  });

  it("머리·어깨가 보이는 사람이 돌아오면 0.6초 이어 본 뒤 사람 보임이 된다", () => {
    const w = ws();
    expect(feed(w, 0, 1500, [BODY], BODY_POSE)).toBe(600);
    expect(w.view(1500).person).toMatchObject({ visible: true, count: 1, since_ms: 600 });
  });

  it("사용자와 시연자 손이 함께 잡히면 사람 수는 사용자만 센다", () => {
    const w = ws();
    feed(w, 0, 1500, [BODY, HAND], { ...BODY_POSE });
    expect(w.view(1500).person).toMatchObject({ visible: true, count: 1 });
  });

  it("로봇 실행 단계 중에는 아래 가장자리에 닿고 얼굴 관절이 없는 사람 상자를 빼고, 실행 중이 아니면 그 상자도 사용자다", () => {
    const acting = ws();
    acting.robotActing(true);
    expect(feed(acting, 0, 3000, [LOW], LOW_POSE)).toBeNull();
    const idle = ws();
    expect(feed(idle, 0, 3000, [LOW], LOW_POSE)).toBe(600);
    // 실행 중이어도 얼굴이 보이면 사용자다
    const face = ws();
    face.robotActing(true);
    expect(feed(face, 0, 3000, [LOW], poseOf({ ...Object.fromEntries(LOW_POSE.keypoints.map((k, i) => [i, k])), 0: [190, 320, 0.9] }, LOW.box))).toBe(600);
  });

  it("관절 모델이 없으면(관절을 한 번도 받지 않음) 사람 감지를 사용자로 세고, 실행 중이면 아래 가장자리 상자는 뺀다", () => {
    expect(feed(ws(), 0, 3000, [HAND], null)).toBe(600);
    const acting = ws();
    acting.robotActing(true);
    expect(feed(acting, 0, 3000, [HAND], null)).toBeNull();
  });
});
