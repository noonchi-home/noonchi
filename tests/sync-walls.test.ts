// 벽 모양: hit-test 점을 벽·바닥으로 가르고, 10cm 칸으로 줄이고, 평면도 방 쪽 벽 면과 짝지어(거리·법선·보이는 쪽) 점-선 항을 만든다.
import { describe, expect, it } from "vitest";
import { readScenePlan, roomFaces, type HomePlan } from "../src/layout/home-plan.js";
import { IDENTITY, type P2 } from "../src/phone/sync/rigid.js";
import { SurfacePoints, classifyHit, wallQuality, wallSegments, wallTerms, type WallPoint } from "../src/phone/sync/walls.js";

/** 4×3 네모 방 하나, 벽 두께 0.2(중심선이 방 다각형 변). 방 쪽 면은 0.1 안쪽. */
const BOX: HomePlan = {
  rooms: [{ id: "r", label: "방", polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
  walls: [
    { id: "s", thickness: 0.2, a: [0, 0], b: [4, 0], faces: [{ room: "r", normal: [0, 1] }] },
    { id: "e", thickness: 0.2, a: [4, 0], b: [4, 3], faces: [{ room: "r", normal: [-1, 0] }] },
    { id: "n", thickness: 0.2, a: [4, 3], b: [0, 3], faces: [{ room: "r", normal: [0, -1] }] },
    { id: "w", thickness: 0.2, a: [0, 3], b: [0, 0], faces: [{ room: "r", normal: [1, 0] }] },
  ],
};

describe("hit 점 가르기", () => {
  it("법선이 수평이면 벽, 위를 보고 폰보다 0.9m 이상 아래면 바닥, 탁자 윗면·비스듬한 면은 버린다", () => {
    expect(classifyHit([1, 1, 2], [0.99, 0.05, 0], 1.4)).toEqual({ kind: "wall", point: [1, 2], normal: [1, 0] });
    expect(classifyHit([1, 0.02, 2], [0, 1, 0], 1.45)).toEqual({ kind: "floor", y: 0.02 });
    expect(classifyHit([1, 0.75, 2], [0, 1, 0], 1.45)).toBeNull();
    expect(classifyHit([1, 1, 2], [0.7, 0.7, 0], 1.4)).toBeNull();
  });
});

describe("모은 점", () => {
  it("벽 점은 10cm 칸마다 마지막 하나, 너무 많으면 오래된 칸부터 버린다", () => {
    const s = new SurfacePoints({ maxWall: 3 });
    for (let i = 0; i < 20; i++) s.addWall([1.01 + i * 0.001, 2.02], [1, 0], [0, 0], i);
    expect(s.walls()).toHaveLength(1);
    expect(s.walls()[0]!.at).toBe(19);
    s.addWall([2, 2], [1, 0], [0, 0], 30);
    s.addWall([3, 2], [1, 0], [0, 0], 31);
    s.addWall([4, 2], [1, 0], [0, 0], 32);
    expect(s.walls().map((p) => p.point[0])).toEqual([2, 3, 4]);
  });

  it("바닥 높이는 최근 바닥 점의 중앙값, 없으면 null", () => {
    const s = new SurfacePoints();
    expect(s.floorY()).toBeNull();
    for (const y of [0.01, 0.02, 0.5, 0.015, 0.012]) s.addFloor(y, 0);
    expect(s.floorY()).toBeCloseTo(0.015, 6);
    s.clear();
    expect(s.floorY()).toBeNull();
    expect(s.walls()).toEqual([]);
  });
});

describe("평면도 벽 면", () => {
  it("방 쪽 면: 중심선에서 두께 절반 안쪽, 법선은 방 안쪽", () => {
    const segs = wallSegments(BOX);
    expect(segs).toHaveLength(4);
    const west = segs.find((s) => s.n[0] === 1)!;
    expect(west.a[0]).toBeCloseTo(0.1, 9);
    expect(west.len).toBeCloseTo(3, 9);
  });

  it("목련 트윈: 방마다 면이 있고 법선은 길이 1", () => {
    const plan = readScenePlan("twin/homes/mokryeon_180b/scene.json");
    const faces = roomFaces(plan);
    expect(new Set(faces.map((f) => f.room)).size).toBeGreaterThanOrEqual(14);
    for (const f of faces) expect(Math.hypot(...f.n)).toBeCloseTo(1, 9);
  });
});

describe("벽 짝", () => {
  const segs = wallSegments(BOX);
  const pt = (point: P2, normal: P2, camera: P2 = [2, 1.5]): WallPoint => ({ point, normal, camera, at: 0 });

  it("가장 가까운 면, 법선이 맞고 면이 카메라 쪽을 볼 때만", () => {
    const { matched } = wallTerms(IDENTITY, [pt([0.12, 1], [1, 0])], segs, { gateM: 0.3 });
    expect(matched).toHaveLength(1);
    expect(matched[0]!.d).toBeCloseTo(0.02, 9);
    // 법선이 다르면(벽 점인데 수직 벽과 90°) 짝 없음
    expect(wallTerms(IDENTITY, [pt([0.12, 1], [0, 1])], segs, { gateM: 0.3 }).matched).toHaveLength(0);
    // 카메라가 벽 밖이면 그 면은 보이지 않는다
    expect(wallTerms(IDENTITY, [pt([0.12, 1], [1, 0], [-2, 1])], segs, { gateM: 0.3 }).matched).toHaveLength(0);
  });

  it("문턱보다 먼 점(가구 앞면)은 짝이 없고, 남은 짝 중 먼 15%는 잘라낸다", () => {
    const pts = [pt([0.7, 1], [1, 0]), ...Array.from({ length: 20 }, (_, i) => pt([0.1 + (i % 10) * 0.01, 0.2 + i * 0.12], [1, 0]))];
    const { matched, terms } = wallTerms(IDENTITY, pts, segs, { gateM: 0.3 });
    expect(matched.every((m) => Math.abs(m.d) <= 0.3)).toBe(true);
    expect(matched).toHaveLength(17);
    expect(terms).toHaveLength(17);
  });

  it("품질: 맞는 점 수·RMS와 방향 퍼짐(복도는 한 방향)", () => {
    const corridor = Array.from({ length: 30 }, (_, i) => pt([0.5 + i * 0.1, i % 2 ? 2.9 : 0.1], [0, 1]));
    const q1 = wallQuality(IDENTITY, corridor, segs, { inlierM: 0.1 });
    expect(q1.inliers).toBe(30);
    expect(q1.rmsM).toBeLessThan(0.001);
    expect(q1.twoD).toBe(false);
    const room = [...corridor, ...Array.from({ length: 20 }, (_, i) => pt([i % 2 ? 3.9 : 0.1, 0.3 + i * 0.12], [1, 0]))];
    expect(wallQuality(IDENTITY, room, segs, { inlierM: 0.1 }).twoD).toBe(true);
  });
});
