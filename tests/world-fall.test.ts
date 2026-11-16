// 쓰러짐 의심(11-16 회의 안전 계층 「자세 변화로 낙상 의심」): 관절 자세가 서 있음에서 짧은 시간(FALL_DROP_MS) 안에 바닥에 누운 자세(몸통·허벅지 모두 누움)가 되고
// 그대로 FALL_HOLD_MS 이어지면 World State에 사람 자세 「쓰러짐 의심」 사실과 변화 줄을 남긴다. 천천히 눕기·소파에 앉기·허리 숙이기는 신호가 나지 않는다.
import { describe, expect, it } from "vitest";
import type { Detection, EngineFrame, Pose } from "../src/contract/observe.js";
import type { WorldChange } from "../src/contract/world.js";
import { sayLine } from "../src/act/say.js";
import { SAY_TEXT } from "../src/act/labels.js";
import { sha256 } from "../src/observe/ring.js";
import { SCENE_JSON_SCHEMA, SCENE_PROMPT } from "../src/observe/scene.js";
import { FALL_DEFAULTS, loadFallConfig, type FallConfig } from "../src/world/fall.js";
import { describePose } from "../src/world/pose.js";
import { WorldState } from "../src/world/state.js";
import { textFromWorld } from "../src/world/text.js";
import { SCENE_STATES } from "../src/world/vocab.js";
import { det } from "./helpers/detectors.js";
import { poseOf, standing } from "./helpers/poses.js";

const person: Detection = det("person", 0.9, [40, 60, 280, 300], 0);
/** 앉은 사람: 몸통은 서고 허벅지가 수평(엉덩이 y200 → 무릎 y205). */
const sitting = (): Pose => poseOf({ 5: [110, 100, 0.9], 6: [150, 100, 0.9], 11: [115, 200, 0.9], 12: [145, 200, 0.9], 13: [195, 205, 0.9], 14: [225, 205, 0.9] });
/** 바닥에 누운 사람: 어깨·엉덩이·무릎이 한 줄로 가로(몸통·허벅지 모두 수평), 상자도 가로로 길다. */
const flat = (): Pose => poseOf({ 5: [100, 250, 0.9], 6: [100, 280, 0.9], 11: [200, 255, 0.9], 12: [200, 285, 0.9], 13: [280, 258, 0.9], 14: [280, 288, 0.9] }, [80, 230, 220, 80]);
/** 허리 숙이기: 몸통은 수평이지만 허벅지는 서 있다(엉덩이 y205 → 무릎 y285). */
const bending = (): Pose => poseOf({ 5: [60, 190, 0.9], 6: [60, 210, 0.9], 11: [150, 195, 0.9], 12: [150, 215, 0.9], 13: [150, 285, 0.9], 14: [152, 285, 0.9] }, [40, 150, 130, 220]);

const ws = (fall?: FallConfig) => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "living", label: "거실" }), devices: () => [], ...(fall ? { fall } : {}) });
const frame = (t: number): EngineFrame => ({ id: `e${t}`, capturedAtMs: t, latestAtMs: t, jpeg: Buffer.from(`${t}`), sha256: sha256(Buffer.from(`${t}`)), width: 480, height: 360, eye: null, view: null });
/** 관절은 0.3초마다(엔진 프레임 0.1초 × BRAIN_POSE_EVERY 3). from부터 to까지 그 자세로 보고 나온 변화를 모은다. */
const run = (w: WorldState, from: number, to: number, pose: () => Pose, out: WorldChange[] = []) => {
  for (let t = from; t <= to; t += 300) out.push(...w.applyDetections(frame(t), [person], [pose()]).changes);
  return out;
};
const posture = (w: WorldState, t: number) => w.view(t).person.facts.posture?.value;
const FALL_LINE = "사람 쓰러짐 의심";

describe("쓰러짐 의심: 관절 자세 변화", () => {
  it("바닥에 누운 자세는 몸통과 허벅지가 다 누운 것이다(허리 숙이기는 허벅지가 서 있어 아니다)", () => {
    expect(describePose(flat())).toMatchObject({ posture: "lying", flat: true });
    expect(describePose(bending())).toMatchObject({ posture: "lying", flat: false });
    expect(describePose(standing())).toMatchObject({ posture: "standing", flat: false });
    // 무릎이 안 보이면 상자가 가로로 더 길 때만 바닥에 누운 자세다
    const noKnee = (box: Pose["box"]) => poseOf({ 5: [100, 250, 0.9], 6: [100, 280, 0.9], 11: [200, 255, 0.9], 12: [200, 285, 0.9] }, box);
    expect(describePose(noKnee([80, 230, 220, 80])).flat).toBe(true);
    expect(describePose(noKnee([80, 150, 130, 220])).flat).toBe(false);
  });

  it("서 있다가 2초 안에 바닥에 누운 자세가 되고 3초 이어지면 자세 「쓰러짐 의심」 사실과 의미 있는 변화 줄을 한 번 남긴다", () => {
    const w = ws();
    run(w, 0, 3000, standing);
    const early = run(w, 3300, 6000, flat);
    expect(posture(w, 6000)).toBe("lying");
    expect(early.some((c) => c.text === FALL_LINE)).toBe(false);
    const changes = run(w, 6300, 6300, flat);
    expect(posture(w, 6300)).toBe("fall_suspected");
    expect(changes).toContainEqual({ kind: "person_state", at_ms: 6300, subject: "person", meaningful: true, text: FALL_LINE });
    // 누운 채 이어져도 사실은 그대로이고 줄은 다시 내지 않는다
    const later = run(w, 6600, 9000, flat);
    expect(posture(w, 9000)).toBe("fall_suspected");
    expect(later.some((c) => c.text === FALL_LINE)).toBe(false);
  });

  it("관찰 텍스트에 「사람 쓰러짐 의심」 줄이 들어가고, 대시보드 말풍선 카드는 쓰러짐 의심을 먼저 알린다", () => {
    const w = ws();
    run(w, 0, 3000, standing);
    const changes = run(w, 3300, 6300, flat);
    const view = w.view(6300);
    const text = textFromWorld(view, changes, { nowMs: 6300, offsetMinutes: 540 });
    expect(text.split("\n").filter((l) => l.endsWith(FALL_LINE))).toHaveLength(1);
    expect(text).toContain("쓰러짐 의심");
    expect(sayLine({ plan: null, command: null, world: view, nowMs: 6300 })).toBe(SAY_TEXT.fall);
  });

  it("일어나면(서 있음·앉아 있음) 쓰러짐 의심을 풀고 자세를 그대로 둔다", () => {
    const w = ws();
    run(w, 0, 3000, standing);
    run(w, 3300, 6300, flat);
    expect(posture(w, 6300)).toBe("fall_suspected");
    run(w, 6600, 7200, sitting);
    expect(posture(w, 7200)).toBe("sitting");
    expect(sayLine({ plan: null, command: null, world: w.view(7200), nowMs: 7200 })).not.toBe(SAY_TEXT.fall);
  });

  describe("오탐 시험: 신호가 나지 않는다", () => {
    const quiet = (steps: [number, number, () => Pose][]) => {
      const w = ws();
      const out: WorldChange[] = [];
      for (const [from, to, pose] of steps) run(w, from, to, pose, out);
      const end = steps.at(-1)![1];
      expect(out.some((c) => c.text === FALL_LINE)).toBe(false);
      expect(posture(w, end)).not.toBe("fall_suspected");
      return w;
    };
    it("천천히 눕기: 서 있다가 3초 앉은 뒤 누워 10초 있다", () => {
      quiet([[0, 3000, standing], [3300, 6300, sitting], [6600, 16_600, flat]]);
    });
    it("소파에 앉기: 서 있다가 앉아 10초 있다", () => {
      quiet([[0, 3000, standing], [3300, 13_300, sitting]]);
    });
    it("허리 숙이기: 서 있다가 몸통만 수평으로 10초 숙인다", () => {
      quiet([[0, 3000, standing], [3300, 13_300, bending]]);
    });
    it("잠깐 바닥에 누웠다가(2.4초) 바로 일어선다", () => {
      quiet([[0, 3000, standing], [3300, 5700, flat], [6000, 9000, standing]]);
    });
  });

  it("시간은 설정으로 바꾼다(FALL_DROP_MS·FALL_HOLD_MS·FALL_TORSO_DEG·FALL_THIGH_DEG). 틀린 값이면 시작하지 않는다", () => {
    expect(loadFallConfig({})).toEqual(FALL_DEFAULTS);
    expect(FALL_DEFAULTS).toEqual({ dropMs: 2000, holdMs: 3000, torsoDeg: 60, thighDeg: 45 });
    expect(loadFallConfig({ FALL_DROP_MS: "1500", FALL_HOLD_MS: "5000", FALL_TORSO_DEG: "70", FALL_THIGH_DEG: "50" })).toEqual({ dropMs: 1500, holdMs: 5000, torsoDeg: 70, thighDeg: 50 });
    for (const bad of [{ FALL_DROP_MS: "0" }, { FALL_HOLD_MS: "x" }, { FALL_TORSO_DEG: "95" }, { FALL_THIGH_DEG: "-1" }]) expect(() => loadFallConfig(bad)).toThrow();
    // 이어짐을 5초로 늘리면 3초 누워서는 신호가 없다
    const w = ws({ ...FALL_DEFAULTS, holdMs: 5000 });
    run(w, 0, 3000, standing);
    run(w, 3300, 6300, flat);
    expect(posture(w, 6300)).toBe("lying");
    run(w, 6600, 8400, flat);
    expect(posture(w, 8400)).toBe("fall_suspected");
  });

  it("쓰러짐 의심은 관절만 정한다: VLM 스키마 enum·프롬프트에 없다", () => {
    expect(SCENE_STATES as readonly string[]).not.toContain("fall_suspected");
    expect(JSON.stringify(SCENE_JSON_SCHEMA)).not.toContain("fall_suspected");
    expect(SCENE_PROMPT).not.toContain("fall_suspected");
  });
});
