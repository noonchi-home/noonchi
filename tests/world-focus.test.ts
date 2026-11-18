// 실행 추적이 지금 집기·내려놓기 하는 대상(World State focus): 그 단계 동안 대상은 사라짐으로 세지 않고, 맞는 물건이 없는 같은 종류 감지는 그 대상으로 잇는다.
// 가로 유리컵 실제 판 r5(2026-11-18): 집기 중 들린 컵이 새 cup_21·cup_22가 돼 집기가 23초 걸렸고, 내려놓기 중 손에 든 cup_21이 사라짐이 되고
// 싱크대 위에 새 cup_33·cup_36이 생겨 내려놓기가 끝나지 않았다.
import { describe, expect, it } from "vitest";
import type { Detection, SceneObservation } from "../src/contract/observe.js";
import { WorldState } from "../src/world/state/world.js";
import type { DetLabel } from "../src/world/vocab.js";
import { AWAY_VIEW, engineFrame, LOOK_VIEW } from "./helpers/camera.js";
import { det as mkDet } from "./helpers/detectors.js";
import { see } from "./helpers/vlm-scene.js";

const ws = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
const det = (label: DetLabel, box: [number, number, number, number], score = 0.8): Detection => mkDet(label, score, box, 0);
/** 식탁 자리 컵((1.5, 0, 0)). */
const cupIn = det("cup", [230, 170, 20, 10]);
/** 들린 컵: 상자 아랫변이 바닥 자리와 멀다. */
const lifted = det("cup", [60, 300, 40, 20]);
/** 목적지(싱크대 쪽) 자리 컵: 식탁 자리에서 1m 넘게 떨어진 바닥. */
const atSink = det("cup", [400, 150, 20, 10]);
/** 엔진 프레임 한 장과 그 사진의 장면 VLM 답(감지와 이은 물건). 폰 눈은 카메라 자리(eye로 바꾼다, null이면 모름). 물건은 장면 VLM 답으로만 생긴다. */
const full = (w: WorldState, id: string, atMs: number, dets: Detection[], eye?: [number, number] | null) => see(w, engineFrame(id, atMs, { view: LOOK_VIEW }), dets, eye !== undefined ? { eye } : {});
/** 식탁 자리 컵과 떨어진 둘째 컵(시야 안 같은 무리가 둘이면 VLM 물건을 어느 컵에 이을지 모호하다). */
const cupB = det("cup", [330, 250, 20, 10]);
const ids = (w: WorldState, at: number) => w.view(at).objects.map((o) => [o.id, o.status]);
const xz = (w: WorldState, d: Detection): [number, number] => {
  const t = ws();
  for (let i = 0; i <= 2000; i += 500) full(t, `t${i}`, i, [d]);
  const p = t.view(2000).objects[0]!.position!;
  return [p[0], p[2]];
};

describe("집기·내려놓기 대상(focus)", () => {
  // 가로 머그 실제 판 r4(2026-11-18): 싱크대로 가는 중 손에 든 머그가 새 cup_11이 됐고, 내려놓기 중 대상 cup_7이 사라졌다
  it("든 물건(carry) 동안 그 사진의 폰 눈 1.5m 안 같은 종류 새 감지는 대상으로 잇고, 사라짐으로 세지 않는다. 내려놓기 시작 때 목적지 가까이 이미 생긴 둘째 id는 대상으로 합친다", () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
    w.focus("cup_1", { step: "carry", spot: null });
    const eyeAt = xz(w, atSink);
    for (let t = 2500; t <= 9000; t += 500) full(w, `c${t}`, t, t < 5000 ? [] : [atSink], eyeAt);
    expect(ids(w, 9000)).toEqual([["cup_1", "present"]]);
    // 둘째 id가 이미 생긴 뒤 내려놓기: 그 둘째가 손에 있음으로 보인 적이 있어야(옮긴 컵이라는 근거) 합친다. Codex(4e682c8 1): 싱크대에 원래 있던 컵은 대상이 아니다
    const make = (held: boolean) => {
      const v = ws();
      for (let t = 0; t <= 2000; t += 500) full(v, `e${t}`, t, [cupIn]);
      v.focus("cup_1", { step: "carry", spot: null });
      for (let t = 2500; t <= 5000; t += 500) full(v, `e${t}`, t, [cupIn, atSink]);
      if (held) for (const at of [4000, 4500]) v.applyScene(`h${at}`, at, { scene: "k", summary: "s", observations: [{ object_id: "d1", state: "in_hand" }] }, new Map([["d1", "cup_2"]]));
      expect(v.view(5000).objects.map((o) => o.id)).toEqual(["cup_1", "cup_2"]);
      v.focus("cup_1", { step: "place", spot: eyeAt });
      return v.view(5000).objects.find((o) => o.id === "cup_2");
    };
    expect(make(true)).toMatchObject({ status: "gone", followed_by: "cup_1" });
    expect(make(false)).toMatchObject({ status: "present", followed_by: null });
  });

  // 가로 머그 r6(2026-11-18): 싱크대로 가는 중 폰 눈을 모르는 사진에서 손에 든 머그가 새 cup_10이 됐고, 대상 cup_8은 「손에 있음 · 시야 밖」으로 남았다
  it("든 물건(carry)이 손에 있고 자리를 잃었으면(시야 밖·자리 모름) 폰 눈을 모르는 사진의 같은 종류 새 감지도 대상으로 잇는다", () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
    for (const at of [2000, 2500]) w.applyScene(`h${at}`, at, { scene: "k", summary: "s", observations: [{ object_id: "d1", state: "in_hand" }] }, new Map([["d1", "cup_1"]]));
    w.focus("cup_1", { step: "carry", spot: null });
    see(w, engineFrame("n3000", 3000, { view: AWAY_VIEW }), []);
    expect(w.view(3000).objects[0]!.status).toBe("out_of_view");
    const r = full(w, "e3500", 3500, [atSink], null);
    expect(r.ids.get("d1")).toBe("cup_1");
  });

  // 가로 키 큰 컵 실제 판 r1(2026-11-18): 사람이 들고 있던 cup_4를 식탁에 내려놓고 나가자 같은 자리에 새 cup_6이 생겨 한 컵이 두 id였다
  it("손에 있던 물건이 다른 자리 1m 안에 다시 보이면(내려놓음) 그 물건이다: 새 id를 만들지 않는다", () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
    w.applyScene("s1", 2000, { scene: "k", summary: "s", observations: [{ object_id: "d1", state: "in_hand" }] }, new Map([["d1", "cup_1"]]));
    w.applyScene("s2", 2500, { scene: "k", summary: "s", observations: [{ object_id: "d1", state: "in_hand" }] }, new Map([["d1", "cup_1"]]));
    expect(w.view(2500).objects[0]!.facts.place?.value).toBe("in_hand");
    full(w, "e3000", 3000, []);
    const r = full(w, "e3500", 3500, [det("cup", [270, 170, 20, 10])]);   // 0.354m 옆
    expect(r.ids.get("d1")).toBe("cup_1");
  });

  // 가로 유리컵 실제 판 r7(2026-11-18): 폰을 잔에 바짝 댄 집기 장면에서 큰 상자의 아랫변 투영이 대상 자리에서 0.5m 넘게 떨어져 새 cup_17이 생겼고, 집기가 20.5초 걸렸다
  it("집기 단계: 상자 아랫변 투영이 대상 자리에서 멀어도, 그 사진에서 대상 자리가 감지 상자 안에 비치면 대상으로 잇는다. 대상 자리가 상자 밖이면 잇지 않는다", () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
    w.focus("cup_1", { step: "pick", spot: [1.5, 0] });
    const close = det("cup", [100, 100, 300, 250]);   // 바짝 댄 잔: 대상 자리 픽셀(240, 180)을 덮는다
    const r = full(w, "e2500", 2500, [close]);
    expect(r.ids.get("d1")).toBe("cup_1");
    // 시야 안에 다른 컵도 있으면(모호) 대상 자리가 상자 밖인 감지는 대상으로 잇지 않는다
    const other = ws();
    for (let t = 0; t <= 2000; t += 500) full(other, `e${t}`, t, [cupIn, cupB]);
    other.focus("cup_1", { step: "pick", spot: [1.5, 0] });
    const r2 = full(other, "e2500", 2500, [det("cup", [300, 120, 150, 150])]);
    expect(r2.ids.get("d1")).not.toBe("cup_1");
  });

  // Codex(02dda8c 1): 식별 근거가 모자라면 잇지 않는다. 집기는 대상 자리 0.5m 안이거나 들린 근거(VLM 손에 있음)가 있을 때만 잇는다
  it("집기 단계: 대상 자리 0.5m 안(0.35m) 감지는 대상으로 잇고, 먼 들린 감지는 근거 없이 잇지 않는다(시야 안에 다른 컵도 있어 모호). VLM이 그 감지를 손에 있음으로 답하면 대상으로 잇고 그 뒤 들린 감지도 대상이다", () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn, cupB]);
    w.focus("cup_1", { step: "pick", spot: [1.5, 0] });
    full(w, "e2500", 2500, [det("cup", [270, 170, 20, 10]), cupB]);   // 대상 자리에서 0.354m
    expect(w.view(2500).objects.map((o) => o.id)).toEqual(["cup_1", "cup_2"]);
    // 이 사진은 들린 상자 하나뿐이고 시야 안 컵은 둘(모호)
    const r = full(w, "e3000", 3000, [lifted]);
    expect(r.ids.get("d1")).not.toBe("cup_1");
    expect(r.ids.get("d1")).not.toBe("cup_1");
    // VLM이 들린 컵을 손에 있음으로 답한다(사진마다 한 답)
    const held = (at: number) => see(w, engineFrame(`h${at}`, at, { view: LOOK_VIEW }), [lifted, cupB], { facts: [["v1", "in_hand"]] });
    expect(held(3500).ids.get("d1")).toBe("cup_1");
    for (let t = 4000; t <= 9000; t += 500) held(t);
    expect(ids(w, 9000)).toEqual([["cup_1", "present"], ["cup_2", "present"]]);
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
    // 대상(식탁 컵)이 그대로 보이는 동안 목적지에서 먼 새 컵은 대상이 아니다
    const far = ws();
    for (let t = 0; t <= 2000; t += 500) full(far, `e${t}`, t, [cupIn]);
    far.focus("cup_1", { step: "place", spot: [sink[0] + 5, sink[1] + 5] });
    for (let t = 2500; t <= 6000; t += 500) full(far, `e${t}`, t, [cupIn, atSink]);
    expect(far.view(6000).objects.map((o) => o.id)).toEqual(["cup_1", "cup_2"]);
  });
});

// 가로 키 큰 컵 r3·가로 유리컵 r9(2026-11-18): 내려놓기 중 폰 눈 자리를 모르는 사진이 끼어 손에 든 대상 자리를 잃었고, 싱크대 위 새 컵(cup_35·cup_24)이
// 대상으로 이어지지 않아 내려놓기가 끝나지 않았다. 대상의 놓인 곳은 「식탁 위」로도 흔들렸다
describe("내려놓기 단계: 목적지에 새로 보인 컵은 대상", () => {
  it("내려놓기 시작 뒤 처음 보인 같은 종류 컵이 목적지 1.5m 안이면(손에 있음으로 보인 적 없어도, 대상 자리를 몰라도) 대상으로 잇는다. 시작 전부터 보이던 컵은 잇지 않는다", () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
    const sink = xz(w, atSink);
    const before = det("cup", [430, 150, 20, 10]);   // 목적지 옆에 원래 있던 컵
    for (let t = 2500; t <= 4500; t += 500) full(w, `e${t}`, t, [cupIn, before]);
    const kept = w.view(4500).objects.map((o) => o.id);
    expect(kept).toHaveLength(2);
    // 눈 자리를 모르는 YOLO 사진은 물건을 바꾸지 않는다
    w.applyDetections({ ...engineFrame("n5000", 5000, { view: null }), eye: null }, []);
    w.focus("cup_1", { step: "place", spot: sink });
    for (let t = 5500; t <= 9000; t += 500) full(w, `e${t}`, t, [before, atSink]);
    const v = w.view(9000).objects;
    expect(v.filter((o) => o.status !== "gone").map((o) => o.id).sort()).toEqual(kept.sort());
    const p = v.find((o) => o.id === "cup_1")!.position!;
    expect(Math.hypot(p[0] - sink[0], p[2] - sink[1])).toBeLessThan(0.3);
  });

  it("내려놓기 중 대상의 놓인 곳은 목적지에서 먼 면 위 값(식탁 위)으로 바뀌지 않는다(손에 있음 → 목적지 쪽만)", () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
    const hand = (at: number) => w.applyScene(`h${at}`, at, { scene: "k", summary: "s", observations: [{ object_id: "d1", state: "in_hand" }] }, new Map([["d1", "cup_1"]]));
    hand(2000);
    hand(2500);
    w.focus("cup_1", { step: "place", spot: [9, 9] });
    for (const at of [3000, 3500]) w.applyScene(`t${at}`, at, { scene: "k", summary: "s", observations: [{ object_id: "d1", state: "on_table" }] }, new Map([["d1", "cup_1"]]));
    expect(w.view(3500).objects[0]!.facts.place?.value).toBe("in_hand");
  });
});
