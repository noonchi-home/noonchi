// @vitest-environment node
// 원뿔 그릴 자리 보정: 방 밖·벽 속 점은 방 안으로, 벽 가까운 점은 벽 반 두께 + 표시 반지름(원뿔 꼭짓점 공 0.11 m) 밖으로 옮긴다. 방 한가운데 점은 그대로다.
// 두 자리 사이 길은 문·트인 경계를 지나고 길 위 모든 점이 방 안이다(벽을 지나는 직선이 아니다). 로봇이 못 가는 방(욕실)도 사람은 간다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Plan2 } from "../../../src/contract/events.ts";
import { floorPlanFrom, roomAt } from "../../../src/layout/route.ts";
import { CONE } from "../../src/twin/3d/eye";
import { walkGuide } from "../../src/twin/3d/walk";

const SCENE = JSON.parse(readFileSync(fileURLToPath(new URL("../../../twin/apartment/scene.json", import.meta.url)), "utf8")) as {
  plan: { walls: { a: Plan2 | null; b: Plan2 | null; thickness: number | null }[] };
};
/** 선분 벽(기둥 같은 덩어리 solid는 a·b가 없다). */
const WALLS = SCENE.plan.walls.filter((w): w is { a: Plan2; b: Plan2; thickness: number } => !!w.a && !!w.b);
const FP = floorPlanFrom(SCENE);
const guide = walkGuide(SCENE, CONE.apex);
const KEEP = (w: { thickness: number }) => w.thickness / 2 + CONE.apex;
const toWall = (p: Plan2, w: { a: Plan2; b: Plan2 }) => {
  const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
  const t = Math.min(1, Math.max(0, ((p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (w.a[0] + dx * t), p[1] - (w.a[1] + dy * t));
};
const clear = (p: Plan2) => WALLS.every((w) => toWall(p, w) >= KEEP(w) - 1e-6);
/** 꺾은선을 5 cm마다 찍은 점. */
const samples = (pts: Plan2[]) => pts.slice(1).flatMap((b, i) => {
  const a = pts[i]!;
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
  return Array.from({ length: n - 1 }, (_, k): Plan2 => [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n]);
});

describe("원뿔 그릴 자리 보정", () => {
  it("방 한가운데 점은 그대로다", () => {
    expect(guide.stand([5, 9])).toEqual([5, 9]);
    expect(guide.stand([7, 2.5])).toEqual([7, 2.5]);
  });

  it("벽 속·집 밖 점은 방 안, 벽에서 떨어진 자리로 옮긴다", () => {
    // 거실·침실 사이 벽 위, 거실·작은방 사이 벽 속, 집 밖, 집 모서리 밖
    for (const p of [[7.2, 9], [3.25, 8], [5, 12.5], [-1, 12]] as Plan2[]) {
      const q = guide.stand(p);
      expect(roomAt(FP, q), `${p}`).not.toBeNull();
      expect(clear(q), `${p} → ${q}`).toBe(true);
      expect(Math.hypot(q[0] - p[0], q[1] - p[1]), `${p}`).toBeLessThan(2.5);
    }
  });

  it("벽에 붙은 점은 벽 반 두께 + 꼭짓점 공 반지름(0.11 m)만큼 떨어뜨리고 같은 방에 둔다", () => {
    const q = guide.stand([7.15, 9]);
    expect(roomAt(FP, q)).toBe("living_room");
    expect(CONE.apex).toBe(0.11);
    expect(q[0]).toBeCloseTo(7.2 - 0.06 - 0.11, 6);
    expect(q[1]).toBeCloseTo(9, 6);
  });

  it("트인 경계(복도·거실) 위 점은 벽이 없어 밀지 않는다", () => {
    const q = guide.stand([5.2, 6.85]);
    expect(q).toEqual([5.2, 6.85]);
  });

  it("거실에서 침실로: 곧은 선은 벽을 지나지만 길은 문을 지나고 모든 점이 방 안이다", () => {
    const from: Plan2 = [6.5, 9], to: Plan2 = [8.5, 9];
    expect(samples([from, to]).some((p) => WALLS.some((w) => toWall(p, w) < 0.03))).toBe(true);
    const path = guide.path(from, to)!;
    expect(path[0]).toEqual(from);
    expect(path.at(-1)).toEqual(to);
    expect(path.some((p) => p[0] === 7.78 && p[1] === 6.8)).toBe(true);
    for (const p of samples(path)) {
      // 문 자리(방 테두리 위)는 어느 쪽 방으로도 본다
      const near = path.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.06);
      expect(near || roomAt(FP, p) !== null, `${p}`).toBe(true);
      const wall = WALLS.find((w) => toWall(p, w) < 0.03);
      const atDoor = path.slice(1, -1).some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.5);
      expect(!wall || atDoor, `${p} 벽 ${JSON.stringify(wall)}`).toBe(true);
    }
  });

  it("로봇이 못 가는 욕실도 길이 있다", () => {
    const path = guide.path([5, 6], [1, 6]);
    expect(path).not.toBeNull();
    expect(path!.some((p) => p[0] === 1.8 && p[1] === 6.2)).toBe(true);
  });

  it("방이 없는 장면이면 자리를 바꾸지 않고 길도 없다", () => {
    const g = walkGuide({ plan: {}, objects: [] }, CONE.apex);
    expect(g.stand([3, 4])).toEqual([3, 4]);
    expect(g.path([0, 0], [1, 1])).toBeNull();
  });
});
