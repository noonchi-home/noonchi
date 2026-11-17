// 실행 추적이 지금 집기·내려놓기 하는 대상(World State focus): 그 단계 동안 대상은 사라짐으로 세지 않고, 맞는 물건이 없는 같은 종류 감지는 그 대상으로 잇는다.
// 가로 유리컵 실제 판 r5(2026-11-18): 집기 중 들린 컵이 새 cup_21·cup_22가 돼 집기가 23초 걸렸고, 내려놓기 중 손에 든 cup_21이 사라짐이 되고
// 싱크대 위에 새 cup_33·cup_36이 생겨 내려놓기가 끝나지 않았다.
import { describe, expect, it } from "vitest";
import type { Detection } from "../src/contract/observe.js";
import { WorldState } from "../src/world/state/world.js";
import type { DetLabel } from "../src/world/vocab.js";
import { engineFrame, LOOK_VIEW } from "./helpers/camera.js";
import { det as mkDet } from "./helpers/detectors.js";

const ws = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
const det = (label: DetLabel, box: [number, number, number, number], score = 0.8): Detection => mkDet(label, score, box, 0);
/** 식탁 자리 컵((1.5, 0, 0)). */
const cupIn = det("cup", [230, 170, 20, 10]);
/** 들린 컵: 상자 아랫변이 바닥 자리와 멀다. */
const lifted = det("cup", [60, 300, 40, 20]);
/** 목적지(싱크대 쪽) 자리 컵: 식탁 자리에서 1m 넘게 떨어진 바닥. */
const atSink = det("cup", [400, 150, 20, 10]);
const full = (w: WorldState, id: string, atMs: number, dets: Detection[]) => w.applyDetections(engineFrame(id, atMs, { view: LOOK_VIEW }), dets);
const ids = (w: WorldState, at: number) => w.view(at).objects.map((o) => [o.id, o.status]);
const xz = (w: WorldState, d: Detection): [number, number] => {
  const t = ws();
  for (let i = 0; i <= 2000; i += 500) full(t, `t${i}`, i, [d]);
  const p = t.view(2000).objects[0]!.position!;
  return [p[0], p[2]];
};

describe("집기·내려놓기 대상(focus)", () => {
  it("집기 단계 동안 들린 컵 감지(맞는 물건 없음)는 대상 cup_1로 잇고 새 id를 만들지 않는다. focus가 없으면 지금처럼 새 컵이 생긴다", () => {
    const run = (focus: boolean) => {
      const w = ws();
      for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
      if (focus) w.focus("cup_1", { step: "pick", spot: [1.5, 0] });
      for (let t = 2500; t <= 9000; t += 500) full(w, `e${t}`, t, [lifted]);
      return ids(w, 9000);
    };
    expect(run(true)).toEqual([["cup_1", "present"]]);
    expect(run(false)).toEqual([["cup_1", "gone"], ["cup_2", "present"]]);
  });

  it("내려놓기 단계 동안 손에 든 대상은 안 보여도 사라짐으로 세지 않고, 목적지 가까이(1.5m 안)에 새로 보인 같은 종류 컵을 대상으로 잇는다. 목적지에서 먼 새 컵은 잇지 않는다", () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
    const sink = xz(w, atSink);
    w.focus("cup_1", { step: "place", spot: sink });
    for (let t = 2500; t <= 12_000; t += 500) full(w, `e${t}`, t, []);
    expect(ids(w, 12_000)).toEqual([["cup_1", "present"]]);
    for (let t = 12_500; t <= 15_000; t += 500) full(w, `e${t}`, t, [atSink]);
    expect(ids(w, 15_000)).toEqual([["cup_1", "present"]]);
    const p = w.view(15_000).objects[0]!.position!;
    expect(Math.hypot(p[0] - sink[0], p[2] - sink[1])).toBeLessThan(0.3);
    // 대상을 풀면 지금처럼 센다
    w.focus(null);
    const far = ws();
    for (let t = 0; t <= 2000; t += 500) full(far, `e${t}`, t, [cupIn]);
    far.focus("cup_1", { step: "place", spot: [sink[0] + 5, sink[1] + 5] });
    for (let t = 2500; t <= 6000; t += 500) full(far, `e${t}`, t, [atSink]);
    expect(far.view(6000).objects.map((o) => o.id)).toEqual(["cup_1", "cup_2"]);
  });
});
