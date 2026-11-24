// 떠남 → 「사람 안 보임」 빠르게(2026-11-25 사용자 결정 D).
// 실제 영상 측정(worker1, 컵 영상 6판): 떠남 표시 → 사람 안 보임 5.5~6.3초 = YOLO가 마지막으로 사람을 본 때까지 1.5~2.3초 + 사라짐 확정 기다림 4.0초.
// - 사람이 있던 자리(발 자리)가 지금 화면 안이면 YOLO(0.1초마다)가 그 사람을 0.5초 이어 못 볼 때 사람 안 보임이다.
// - 그 자리가 화면 밖이거나 자리를 모르면 지금처럼 4초를 기다린다.
// - VLM 답은 기다리는 데 쓰지 않는다. 빠르게 안 보임이 된 뒤 찍힌 사진의 답에 사람이 있으면 그때 되돌린다.
import { describe, expect, it } from "vitest";
import type { SceneObservation } from "../src/contract/observe.js";
import { WorldState } from "../src/world/state/world.js";
import { AWAY_VIEW, LOOK_SIZE, LOOK_VIEW, engineFrame } from "./helpers/camera.js";
import { det } from "./helpers/detectors.js";

const ws = () => new WorldState({ surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "living", label: "거실" }), devices: () => [] });
/** 발이 화면 안인 사람(아랫변 350 < 360 × 0.98): 발 자리로 사람 자리를 안다. */
const PERSON = det("person", 0.9, [150, 20, 120, 330], 0);
const frame = (t: number, view = LOOK_VIEW) => engineFrame(`e${t}`, t, { view, jpeg: Buffer.from(String(t)) });

/** 0.1초마다 사람을 본다(보임 확정까지). */
function seen(w: WorldState, from: number, to: number) {
  for (let t = from; t <= to; t += 100) w.applyDetections(frame(t), [PERSON]);
}
/** 0.1초마다 아무도 못 본다. 처음 안 보임이 된 촬영 시각. */
function goneAt(w: WorldState, from: number, to: number, view = LOOK_VIEW): number | null {
  for (let t = from; t <= to; t += 100) {
    w.applyDetections(frame(t, view), []);
    if (!w.view(t).person.visible) return t;
  }
  return null;
}
const household = (people: number): SceneObservation => ({
  scene: "living", summary: "", objects: [], observations: [],
  household: { seats: "clear", dining_food: "unknown", people: Array.from({ length: people }, (_, i) => ({ id: `p${i + 1}`, attention: "elsewhere" as const })) },
});
const look = { view: LOOK_VIEW, ...LOOK_SIZE, eye: [0, 0] as [number, number], fresh: true, person_ids: [], dets: [] };

describe("떠남 → 사람 안 보임", () => {
  it("사람이 있던 자리가 화면 안이면 YOLO가 0.5초 이어 못 볼 때 사람 안 보임이 된다", () => {
    const w = ws();
    seen(w, 0, 3000);
    expect(w.view(3000).person).toMatchObject({ visible: true });
    expect(w.view(3000).person.position).not.toBeNull();
    expect(goneAt(w, 3100, 9000)).toBe(3600);
    expect(w.view(3600).person).toMatchObject({ visible: false, count: 0, since_ms: 3600 });
  });

  it("그 자리가 화면 밖이면(폰이 반대쪽을 봄) 지금처럼 4초를 기다린다", () => {
    const w = ws();
    seen(w, 0, 3000);
    expect(goneAt(w, 3100, 9000, AWAY_VIEW)).toBe(7000);
  });

  it("YOLO가 0.4초 놓쳤다가 다시 보면 사람 안 보임이 되지 않는다", () => {
    const w = ws();
    seen(w, 0, 3000);
    for (let t = 3100; t <= 3400; t += 100) w.applyDetections(frame(t), []);
    seen(w, 3500, 4500);
    for (let t = 3100; t <= 4500; t += 100) expect(w.view(t).person.visible).toBe(true);
  });

  it("빠르게 안 보임이 된 뒤 찍힌 사진의 VLM 답에 사람이 있으면 바로 되돌린다", () => {
    const w = ws();
    seen(w, 0, 3000);
    expect(goneAt(w, 3100, 9000)).toBe(3600);
    const changes = w.applyScene("v3700", 3700, household(1), new Map(), look, 3700, 5300);
    expect(changes.filter((c) => c.kind === "person_appeared")).toHaveLength(1);
    expect(w.view(5300).person.visible).toBe(true);
  });

  it("VLM 답으로 되돌린 뒤에는 YOLO가 계속 못 봐도 0.5초 만에 다시 안 보임이 되지 않는다(YOLO가 다시 볼 때까지 확정 규칙만)", () => {
    const w = ws();
    seen(w, 0, 3000);
    expect(goneAt(w, 3100, 9000)).toBe(3600);
    w.applyScene("v3700", 3700, household(1), new Map(), look, 3700, 3800);
    for (let t = 3800; t <= 4800; t += 100) {
      w.applyDetections(frame(t), []);
      expect(w.view(t).person.visible).toBe(true);
    }
  });

  it("안 보임이 되기 전에 찍혀 늦게 온 VLM 답이나 사람이 없는 답은 되돌리지 않는다", () => {
    const w = ws();
    seen(w, 0, 3000);
    expect(goneAt(w, 3100, 9000)).toBe(3600);
    w.applyScene("v3500", 3500, household(1), new Map(), look, 3500, 5000);
    expect(w.view(5000).person.visible).toBe(false);
    w.applyScene("v3800", 3800, household(0), new Map(), look, 3800, 5500);
    expect(w.view(5500).person.visible).toBe(false);
  });
});
