// 물건 기준점: COCO 종류 ↔ 트윈 물건 표, 상자 아래 가운데 광선이 AR 바닥과 만나는 점, 관찰 묶기·이상치 버리기, 앞 가장자리 점.
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/layout/catalog.js";
import { loadScene } from "../src/layout/scene.js";
import type { SceneObject } from "../src/contract/layout.js";
import { LANDMARK_IDS, LANDMARK_KEYS, landmarkClass } from "../src/phone/sync/classes.js";
import {
  LANDMARK_TYPES, LandmarkStore, edgePoint, floorPoint, twinLandmarks, type LandmarkObs, type TwinLandmark,
} from "../src/phone/sync/landmarks.js";
import { look, perspective, project } from "./helpers/sync-sim.js";

const scene = loadScene({ scenePath: "twin/homes/mokryeon_180b/scene.json", dataDir: "twin/data/homes/mokryeon_180b" })!;
const OBJECTS = scene.objects as SceneObject[];
const catalog = loadCatalog("twin/data/catalog");
const mokryeon = twinLandmarks(OBJECTS, catalog);
const ofClass = (cls: string) => mokryeon.filter((l) => l.cls === cls);

describe("종류 표", () => {
  it("COCO 번호: 소파·침대·식탁·변기·TV·전자레인지·오븐·싱크대·냉장고", () => {
    expect(LANDMARK_KEYS).toEqual(["couch", "bed", "dining_table", "toilet", "tv", "microwave", "oven", "sink", "refrigerator"]);
    expect(Object.fromEntries(LANDMARK_IDS.map((n) => [n, landmarkClass(n)]))).toEqual({ 57: "couch", 59: "bed", 60: "dining_table", 61: "toilet", 62: "tv", 68: "microwave", 69: "oven", 71: "sink", 72: "refrigerator" });
    expect(landmarkClass(72)).toBe("refrigerator");
    expect(landmarkClass(41)).toBeNull();
    // 표의 모든 기준점 종류에 트윈 종류가 있다
    expect(Object.keys(LANDMARK_TYPES).sort()).toEqual([...LANDMARK_KEYS].sort());
  });

  it("목련 트윈: 소파·식탁은 하나, 냉장고·변기·침대·싱크대·TV 자리는 여럿, 오븐·전자레인지는 없다(시연용으로 더한 전자레인지는 기준점이 아니다)", () => {
    const count = Object.fromEntries(LANDMARK_KEYS.map((c) => [c, ofClass(c).length]));
    expect(count).toEqual({ couch: 1, bed: 4, dining_table: 1, toilet: 3, tv: 3, microwave: 0, oven: 0, sink: 4, refrigerator: 3 });
    expect(ofClass("refrigerator").map((l) => l.id).sort()).toEqual(["freezer_0c022ae2", "fridge_bbc363a3", "kimchi_fridge_bce0bf96"]);
    expect(ofClass("couch")[0]).toMatchObject({ id: "sofa_a848b595", center: [7.3864, 9.8138], baseM: 0, unique: true });
    expect(ofClass("bed").every((l) => !l.unique)).toBe(true);
  });

  it("자리·크기·바닥 높이: 냉장고는 카탈로그 크기, 싱크대는 개수대 가운데·조리대 높이, TV는 TV수납장 윗면", () => {
    const fridge = mokryeon.find((l) => l.id === "fridge_bbc363a3")!;
    expect(fridge).toMatchObject({ cls: "refrigerator", center: [5.9191, 2.4596], footprint: [0.92, 0.75], facingDeg: 0, baseM: 0 });
    const sink = mokryeon.find((l) => l.id === "sink_counter_kitchen")!;
    expect(sink.center).toEqual([5.86, 1.38]);
    expect(sink.baseM).toBeCloseTo(0.9, 6);
    const tv = mokryeon.find((l) => l.id === "tv_stand_2fdbdf48")!;
    expect(tv.cls).toBe("tv");
    expect(tv.baseM).toBeGreaterThan(0.3);
  });

  it("TV 물건이 있으면 TV수납장 대신 TV를 쓴다", () => {
    const objects = [
      { id: "stand", name: "TV수납장", type: "tv_stand", plan: { position: [1, 1], facing_deg: 0, elevation: 0 } },
      { id: "tv1", name: "TV", type: "tv", plan: { position: [1, 1.1], facing_deg: 0, elevation: 0.5 } },
    ];
    const out = twinLandmarks(objects, catalog);
    expect(out.map((l) => [l.cls, l.id, l.baseM])).toEqual([["tv", "tv1", 0.5]]);
  });
});

describe("광선-바닥 점", () => {
  const size = { width: 360, height: 640 };
  const P = perspective((60 * Math.PI) / 180, size.width / size.height);
  const pos: [number, number, number] = [1, 1.4, 2];
  const q = look(0.3, -0.5);

  it("상자 아래 가운데 픽셀의 광선이 바닥 높이 면과 만나는 AR 점", () => {
    const floorY = -0.05;
    const target: [number, number, number] = [3.2, floorY, 2.7];
    const [u, v] = project(pos, q, P, size, target)!;
    const hit = floorPoint({ position: pos, orientation: q, projection: P }, [u - 40, v - 120, 80, 120], size, floorY)!;
    expect(hit.point[0]).toBeCloseTo(3.2, 3);
    expect(hit.point[1]).toBeCloseTo(2.7, 3);
    expect(hit.rangeM).toBeCloseTo(Math.hypot(3.2 - 1, 2.7 - 2), 3);
  });

  it("면이 카메라보다 위거나 광선이 수평 가까이면 null", () => {
    expect(floorPoint({ position: pos, orientation: q, projection: P }, [170, 0, 20, 10], size, 3)).toBeNull();
    const level = look(0.3, 0);
    expect(floorPoint({ position: pos, orientation: level, projection: P }, [170, 300, 20, 20], size, 0)).toBeNull();
  });
});

describe("앞 가장자리 점", () => {
  const fridge: TwinLandmark = { cls: "refrigerator", id: "f", label: "냉장고", center: [0, 0], footprint: [0.92, 0.75], facingDeg: 0, baseM: 0, unique: true };
  it("카메라 → 물건 가운데 선이 바닥 사각형에 들어가는 점", () => {
    // facing 0: 앞(깊이 방향)이 +x. 앞에서 보면 앞면 가운데(깊이 0.75의 절반)
    expect(edgePoint(fridge, [3, 0])).toEqual([0.375, 0]);
    // 옆(+y)에서 보면 옆면(폭 0.92의 절반)
    const side = edgePoint(fridge, [0, 3]);
    expect(side[0]).toBeCloseTo(0, 9);
    expect(side[1]).toBeCloseTo(0.46, 9);
    // 카메라가 사각형 안이면 가운데
    expect(edgePoint(fridge, [0.1, 0.1])).toEqual([0, 0]);
  });
});

describe("관찰 묶기", () => {
  const obs = (cls: LandmarkObs["cls"], x: number, y: number, at: number): LandmarkObs => ({ cls, point: [x, y], camera: [x - 2, y], rangeM: 2, score: 0.8, at });

  it("같은 종류를 자리로 묶고, 묶음에서 먼 관찰은 버리고, 관찰이 3개 미만인 묶음은 쓰지 않는다", () => {
    const store = new LandmarkStore({ radiusM: () => 1, outlierM: () => 0.4 });
    for (let i = 0; i < 8; i++) store.add(obs("refrigerator", 1 + 0.03 * Math.sin(i), 2 + 0.03 * Math.cos(i), i));
    store.add(obs("refrigerator", 1.7, 2.5, 9)); // 같은 묶음 안 이상치
    store.add(obs("refrigerator", 6, 2, 10));
    store.add(obs("refrigerator", 6.05, 2, 11));
    store.add(obs("couch", 3, 3, 12));
    const clusters = store.clusters();
    expect(clusters.map((c) => [c.cls, c.obs.length])).toEqual([["refrigerator", 8]]);
    expect(clusters[0]!.center[0]).toBeCloseTo(1, 1);
    expect(store.size()).toBe(12);
  });

  it("종류마다 최근 관찰만 둔다", () => {
    const store = new LandmarkStore({ radiusM: () => 1, outlierM: () => 0.4, maxPerClass: 5 });
    for (let i = 0; i < 9; i++) store.add(obs("couch", 3, 3, i));
    expect(store.size()).toBe(5);
    store.clear();
    expect(store.size()).toBe(0);
  });
});
