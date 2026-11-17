// 장면 VLM 물건(scene.objects)으로 보임·되살림·확정·든 컵 잇기(VLM 무조건 우선, src/world/merge.ts). 물건 식별은 자리로 하고 종류는 따로 바꾼다(core.matchAt·voteClass).
// 가로 유리컵 실제 판 r2·r3(2026-11-18): 붙잡은 장면에서 YOLO가 컵을 놓쳐 VLM이 보는 컵이 사라짐이 됐고, 1인칭 집기에서 들린 컵이 새 id(cup_21)로 생겨 집기가 끝나지 않았다.
import { describe, expect, it } from "vitest";
import type { Detection, SceneObservation } from "../src/contract/observe.js";
import type { SceneState } from "../src/observe/scene.js";
import { WorldState } from "../src/world/state/world.js";
import type { DetLabel } from "../src/world/vocab.js";
import { engineFrame, LOOK_SIZE, LOOK_VIEW } from "./helpers/camera.js";
import { det as mkDet } from "./helpers/detectors.js";

// 바닥만 있는 집. 컵 [230, 170, 20, 10](엔진 프레임 픽셀)은 바닥 (1.5, 0, 0)이다
const ws = () => new WorldState({ evidenceStepMs: 1000, surfaces: () => [], floorAt: () => 0, roomAt: () => ({ id: "kitchen", label: "주방" }), devices: () => [] });
const det = (label: DetLabel, box: [number, number, number, number], score = 0.8): Detection => mkDet(label, score, box, 0);
const CUP: [number, number, number, number] = [230, 170, 20, 10];
const cupIn = det("cup", CUP);
/** 들린 컵: 상자 아랫변이 바닥 자리와 멀다. */
const lifted = det("cup", [60, 300, 40, 20]);
const frac = (b: [number, number, number, number]) => ({ x: b[0] / 480, y: b[1] / 360, w: b[2] / 480, h: b[3] / 360 });
const look = { view: LOOK_VIEW, ...LOOK_SIZE };
const full = (w: WorldState, id: string, atMs: number, dets: Detection[]) => w.applyDetections(engineFrame(id, atMs, { view: LOOK_VIEW }), dets);
/** 장면 VLM 답: 물건 하나(종류·상자·det)와 그 사실. */
const scene = (o: { cls?: string; box?: [number, number, number, number]; det?: string | null; facts?: SceneState[] } = {}): SceneObservation => ({
  scene: "k", summary: "s",
  objects: [{ id: "v1", cls: o.cls ?? "cup", box: frac(o.box ?? CUP), det: o.det ?? null }],
  observations: (o.facts ?? []).map((state) => ({ object_id: "v1", state })),
});
const none: SceneObservation = { scene: "k", summary: "s", objects: [], observations: [] };
const objs = (w: WorldState, at: number) => w.view(at).objects.map((o) => [o.id, o.cls, o.status]);

describe("장면 VLM 물건: VLM 무조건 우선", () => {
  it("YOLO가 놓쳐도 장면 VLM이 그 자리 컵을 답하는 동안은 사라지지 않는다(VLM 답이 없으면 지금처럼 사라진다)", () => {
    const run = (vlm: boolean) => {
      const w = ws();
      for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
      for (let t = 2500; t <= 12_000; t += 500) {
        full(w, `e${t}`, t, []);
        if (vlm && t % 2000 === 0) w.applyScene(`e${t}`, t, scene(), new Map(), look);
      }
      return w.view(12_000).objects[0]!.status;
    };
    expect(run(true)).toBe("present");
    expect(run(false)).toBe("gone");
  });

  it("사라진 컵을 장면 VLM이 그 자리에서 답하면(더 새 촬영) 되살린다", () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
    for (let t = 2500; t <= 9500; t += 500) full(w, `e${t}`, t, []);
    expect(objs(w, 9500)).toEqual([["cup_1", "cup", "gone"]]);
    const changes = w.applyScene("e10000", 10_000, scene(), new Map(), look);
    expect(changes).toContainEqual(expect.objectContaining({ kind: "appeared", subject: "cup_1" }));
    expect(objs(w, 10_000)).toEqual([["cup_1", "cup", "present"]]);
  });

  it("YOLO 감지 없이 장면 VLM 사진 2장(서로 다른 원본 프레임)이 같은 자리 컵을 답하면 확정한다. 1장·같은 프레임 두 답은 확정하지 않는다", () => {
    const w = ws();
    w.applyScene("e1000", 1000, scene(), new Map(), look);
    w.applyScene("e1000", 1000, scene(), new Map(), look);
    full(w, "e1500", 1500, []);
    expect(w.view(1500).objects).toEqual([]);
    w.applyScene("e3000", 3000, scene(), new Map(), look);
    expect(objs(w, 3000)).toEqual([["cup_1", "cup", "present"]]);
  });
});

describe("든 컵 잇기(1인칭 집기)", () => {
  it("식탁 컵 가까이(폰 눈 1.5m 안)에서 들린 컵을 YOLO가 다른 자리 새 후보로 잡아도, 장면 VLM이 손에 있음으로 답하면 그 컵(cup_1)으로 잇고 손에 있음을 넣는다. 새 id가 생기지 않는다", () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
    w.setEye({ position: [1, 0], height_m: 1.4, yaw_deg: 0, pitch_deg: 0 }, 2000);
    full(w, "e2500", 2500, [lifted]);
    const r = full(w, "e3000", 3000, [lifted]);
    w.applyScene("e3000", 3000, scene({ box: [60, 300, 40, 20], det: "d1", facts: ["in_hand"] }), r.ids, look);
    expect(r.ids.get("d1")).toBe("cup_1");
    expect(w.view(3000).objects.find((o) => o.id === "cup_1")!.facts.place?.value).toBe("in_hand");
    for (let t = 3500; t <= 8000; t += 500) full(w, `e${t}`, t, [lifted]);
    expect(objs(w, 8000)).toEqual([["cup_1", "cup", "present"]]);
  });
});

describe("물건 식별과 종류(Codex 75104d7·38b5c83)", () => {
  it("같은 종류를 먼저 잇는다: 컵 옆 0.15m의 진짜 병이 있으면 VLM 병은 병으로 잇는다. 무리 다른 종류가 둘 이상이면 모호해 잇지 않는다", () => {
    const w = ws();
    const bottle = det("bottle", [250, 170, 20, 10]);
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn, bottle]);
    const ids = new Map<string, string>();
    w.applyScene("e3000", 3000, scene({ cls: "bottle", box: [240, 170, 20, 10] }), ids, look);
    expect(ids.get("v1")).toBe("bottle_1");
    const two = ws();
    const cupB = det("cup", [255, 170, 20, 10]);
    for (let t = 0; t <= 2000; t += 500) full(two, `e${t}`, t, [cupIn, cupB]);
    const ids2 = new Map<string, string>();
    two.applyScene("e3000", 3000, scene({ cls: "bottle", box: [242, 170, 20, 10] }), ids2, look);
    expect(ids2.get("v1")).not.toMatch(/^cup_/);
  });

  it("종류 바꾸기는 서로 다른 원본 프레임의 더 새 촬영만 센다: 같은 사진 재시도·늦게 온 옛 답으로 바뀌지 않는다", () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
    w.applyScene("e3000", 3000, scene({ cls: "bottle" }), new Map(), look);
    w.applyScene("e3000", 3000, scene({ cls: "bottle" }), new Map(), look);
    w.applyScene("e2600", 2600, scene({ cls: "bottle" }), new Map(), look);
    expect(objs(w, 3000)).toEqual([["cup_1", "cup", "present"]]);
    w.applyScene("e5000", 5000, scene({ cls: "bottle" }), new Map(), look);
    expect(objs(w, 5000)).toEqual([["cup_1", "bottle", "present"]]);
  });

  it("종류가 병으로 바뀐 cup_1 자리의 전체 사진 YOLO 컵은 새 cup_2가 아니라 cup_1이다(전체 사진도 같은 식별 규칙)", () => {
    const w = ws();
    for (let t = 0; t <= 2000; t += 500) full(w, `e${t}`, t, [cupIn]);
    w.applyScene("e3000", 3000, scene({ cls: "bottle" }), new Map(), look);
    w.applyScene("e5000", 5000, scene({ cls: "bottle" }), new Map(), look);
    for (let t = 5500; t <= 9000; t += 500) full(w, `e${t}`, t, [cupIn]);
    expect(w.view(9000).objects.map((o) => o.id)).toEqual(["cup_1"]);
  });
});
