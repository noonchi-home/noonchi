// VLM이 사람 사실(마시는 중·물건을 들고 있음)을 그 사람이 쓰는 물건에 붙여 답할 때(2026-11-18 가로 영상 g1: 컵 v1에 drinking·holding_object):
// 물건에는 붙지 않는 사실이라 버리던 것을, 사람이 보이면 사람 사실로 넣는다(쓰는 중 지킴·미리 세운 목표가 「마시는 중」을 보게).
import { describe, expect, it } from "vitest";
import type { EngineFrame, SceneObservation } from "../src/contract/observe.js";
import { WorldState } from "../src/world/state/world.js";
import { LOOK_SIZE, LOOK_VIEW, engineFrame } from "./helpers/camera.js";
import { det } from "./helpers/detectors.js";

const ws = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
const EYE: [number, number] = [0, 0];
const look = { view: LOOK_VIEW, ...LOOK_SIZE, eye: EYE };
const frame = (id: string, at: number): EngineFrame => ({ ...engineFrame(id, at, { view: LOOK_VIEW, jpeg: Buffer.from(id) }), eye: { position: EYE, height_m: 1.5, yaw_deg: 0, pitch_deg: 0 } as never });
const PERSON = det("person", 0.9, [40, 40, 120, 280], 0);
const CUP: [number, number, number, number] = [230, 170, 20, 10];
const scene = (states: string[]): SceneObservation => ({
  scene: "k", summary: "사람이 컵으로 마신다", objects: [{ id: "v1", cls: "cup", box: { x: CUP[0] / 480, y: CUP[1] / 360, w: CUP[2] / 480, h: CUP[3] / 360 }, det: null }],
  observations: states.map((state) => ({ object_id: "v1", state: state as never })),
});
/** 사람이 보이게 YOLO 사람 감지를 3초 넣는다. */
function withPerson(): WorldState {
  const w = ws();
  for (let t = 0; t <= 3000; t += 100) w.applyDetections(frame(`e${t}`, t), [PERSON]);
  expect(w.view(3000).person.visible).toBe(true);
  return w;
}

describe("VLM이 물건에 붙인 사람 사실", () => {
  it("사람이 보이면 컵에 붙은 「마시는 중」·「물건을 들고 있음」을 사람 사실로 넣는다", () => {
    const w = withPerson();
    w.applyScene("e3100", 3100, scene(["drinking", "holding_object", "in_hand"]), new Map(), look);
    const p = w.view(3100).person;
    expect(p.facts.activity?.value).toBe("drinking");
    expect(p.facts.holding?.value).toBe("holding_object");
  });

  it("사람이 안 보이면 넣지 않는다(물건에도 붙이지 않는다)", () => {
    const w = ws();
    w.applyScene("e1", 1000, scene(["drinking", "holding_object"]), new Map(), look);
    const v = w.view(1000);
    expect(v.person.facts.activity).toBeUndefined();
    expect(v.objects.every((o) => o.facts.activity === undefined)).toBe(true);
  });
});
