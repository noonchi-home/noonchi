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

// 2026-11-18 7541d94 합침: 그릇의 순간 값 drank·poured(caf638f·2a9e8c1)는 같은 장면 사실 넣는 곳을 지난다. 사람 사실만 사람에게 옮기고 순간 값은 그 컵 사건으로 남는다
describe("VLM이 물건에 붙인 사람 사실과 그릇 사건", () => {
  const answer = (w: WorldState, at: number, states: string[], from = at - 8000) => w.applyScene(`v${at}`, at, scene(states), new Map(), look, from);
  const again = (changes: { text: string }[]) => changes.filter((c) => c.text.includes("내용물 다시 확인")).map((c) => c.text);

  it("한 답에서 컵에 붙은 「마시는 중」·「물건을 들고 있음」은 사람 사실로 옮기고, 「마심」(drank)은 그 컵 사건으로 남아 내용물을 다시 연다", () => {
    const w = ws();
    answer(w, 1000, [], 1000);
    answer(w, 2000, [], 1000);
    for (const t of [3000, 5000, 8000]) answer(w, t, ["has_contents"]);
    expect(w.view(8000).objects[0]?.facts.contents).toMatchObject({ value: "has_contents", certainty: "confirmed" });
    for (let t = 8100; t <= 10000; t += 100) w.applyDetections(frame(`e${t}`, t), [PERSON]);
    expect(w.view(10000).person.visible).toBe(true);
    expect(again(answer(w, 10050, ["drinking", "holding_object", "drank"]))).toEqual(["컵 cup_1 마심 · 내용물 다시 확인"]);
    const v = w.view(10050);
    expect(v.person.facts.activity?.value).toBe("drinking");
    expect(v.person.facts.holding?.value).toBe("holding_object");
    expect(v.person.facts).not.toHaveProperty("moment");
    expect(v.objects[0]?.facts.contents?.certainty).not.toBe("confirmed");
    expect(v.objects[0]?.facts.activity).toBeUndefined();
  });

  it("따름(poured)도 사람이 보여도 사람에게 가지 않고 컵 사건이다", () => {
    const w = ws();
    answer(w, 1000, [], 1000);
    answer(w, 2000, [], 1000);
    for (const t of [3000, 5000, 8000]) answer(w, t, ["has_contents"]);
    for (let t = 8100; t <= 10000; t += 100) w.applyDetections(frame(`e${t}`, t), [PERSON]);
    expect(again(answer(w, 10050, ["holding_object", "poured"]))).toEqual(["컵 cup_1 따름 · 내용물 다시 확인"]);
    expect(w.view(10050).person.facts.holding?.value).toBe("holding_object");
    expect(w.view(10050).person.facts).not.toHaveProperty("moment");
  });
});
