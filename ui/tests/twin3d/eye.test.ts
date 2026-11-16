// @vitest-environment node
// 맞춘 눈 표시(보는 방향 원뿔만): 맞춘 눈일 때만 보이고, null·추정 눈이면 숨는다.
// 원뿔 꼭짓점은 height_m(트윈 높이 0 기준), 축은 yaw·pitch 방향. 원뿔은 예전 뷰어 것(열린 원뿔 0.32 × 0.9 m + 꼭짓점 공, 한 재질, 벽에 가리지 않음).
// limited면 원뿔이 viz.cone.limited 색. 색은 토큰만. 구운 보기 그림 위 원뿔 자리는 conePixelBox 안이다(꼭짓점 공 ~ 넓은 끝, 보는 방향에 따라 달라진다).
// 그리는 자리 보정: 벽 속 눈은 방 안에 서고, 벽 너머 새 자리로는 문을 지나 걸어간다(벽을 지나는 직선이 아니다).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { EyeEvent, Plan2 } from "../../../src/contract/events.ts";
import { viz } from "../../../src/design/tokens.ts";
import { floorPlanFrom, roomAt } from "../../../src/layout/route.ts";
import { CONE, conePixelBox, createEyeCone, type EyeCone } from "../../src/twin3d/eye";
import { MOKRYEON_MAP_CAMERA as CAM, planToPixel } from "../../src/twin3d/projection";
import { walkGuide } from "../../src/twin3d/walk";

const EYE: EyeEvent = { position: [3, 4], height_m: 1.4, yaw_deg: 30, pitch_deg: -25, tracking: "ok", at: "t" };
const file = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const SCENE = JSON.parse(readFileSync(file("../../../twin/apartment/scene.json"), "utf8")) as { plan: { walls: { a: Plan2 | null; b: Plan2 | null }[] } };
const FP = floorPlanFrom(SCENE);

const part = (d: EyeCone, name: string) => {
  d.group.updateMatrixWorld(true);
  const o = d.group.getObjectByName(name);
  if (!o) throw new Error(`${name} 없음`);
  return o;
};
const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
const meshes = (o: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  o.traverse((n) => { if (n instanceof THREE.Mesh) out.push(n); });
  return out;
};
const colorOf = (m: THREE.Mesh) => `#${(m.material as THREE.MeshBasicMaterial).color.getHexString()}`;
const dirOf = (yaw: number, pitch: number) => {
  const a = (yaw * Math.PI) / 180, b = (pitch * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b));
};

describe("맞춘 눈 표시(원뿔만)", () => {
  it("처음과 null·추정 눈이면 숨고, 맞춘 눈이면 보인다", () => {
    const d = createEyeCone();
    expect(d.group.visible).toBe(false);
    d.setEye(null);
    expect(d.group.visible).toBe(false);
    d.setEye({ ...EYE, estimated: true });
    expect(d.group.visible).toBe(false);
    d.setEye(EYE);
    expect(d.group.visible).toBe(true);
    d.setEye({ ...EYE, estimated: true });
    expect(d.group.visible).toBe(false);
    d.setEye(EYE);
    d.setEye(null);
    expect(d.group.visible).toBe(false);
  });

  it("눈 층에는 원뿔만 있다: 그리는 것은 열린 원뿔과 꼭짓점 공 둘뿐이고 빛을 받는 재질·다른 모델이 없다", () => {
    const d = createEyeCone();
    d.setEye(EYE);
    expect(d.group.children.map((c) => c.name)).toEqual(["eye_cone"]);
    expect(meshes(d.group).map((m) => m.name).sort()).toEqual(["eye_cone_apex", "eye_cone_face"]);
    for (const m of meshes(d.group)) expect(m.material).toBeInstanceOf(THREE.MeshBasicMaterial);
  });

  it("원뿔 꼭짓점 높이는 height_m(서버 카메라 원점 [x, height_m, y]와 같다), 축은 yaw·pitch 방향이다", () => {
    const d = createEyeCone();
    for (const [pos, yaw, pitch, h] of [[[3, 4], 30, -25, 1.4], [[6, 1], -120, 10, 1.2], [[1, 1], 180, -60, 0.9]] as const) {
      d.setEye({ ...EYE, position: [pos[0], pos[1]], yaw_deg: yaw, pitch_deg: pitch, height_m: h });
      const apex = world(part(d, "eye_cone"));
      expect(apex.x).toBeCloseTo(pos[0], 6);
      expect(apex.y).toBeCloseTo(h, 6);
      expect(apex.z).toBeCloseTo(pos[1], 6);
      expect(world(part(d, "eye_cone_apex")).distanceTo(apex)).toBeCloseTo(0, 6);
      // 열린 원뿔은 꼭짓점에서 축 쪽으로 길이만큼 뻗는다
      const face = part(d, "eye_cone_face") as THREE.Mesh;
      face.geometry.computeBoundingBox();
      expect(face.geometry.boundingBox!.min.x).toBeCloseTo(0, 6);
      expect(face.geometry.boundingBox!.max.x).toBeCloseTo(CONE.length, 6);
      const axis = face.localToWorld(new THREE.Vector3(CONE.length, 0, 0)).sub(apex);
      expect(axis.length()).toBeCloseTo(CONE.length, 6);
      expect(axis.normalize().dot(dirOf(yaw, pitch))).toBeCloseTo(1, 4);
    }
  });

  it("원뿔은 예전 뷰어 것이다: 열린 원뿔(반지름 0.32·길이 0.9 m, 24칸)과 꼭짓점 공(0.11 m)이 한 재질(불투명도 0.8, 양면, 차례 10)이고 깊이를 보지도 쓰지도 않는다(벽에 가리지 않는다)", () => {
    const d = createEyeCone();
    const parts = meshes(part(d, "eye_cone"));
    const face = part(d, "eye_cone_face") as THREE.Mesh;
    expect((face.geometry as THREE.ConeGeometry).parameters).toMatchObject({ radius: 0.32, height: 0.9, radialSegments: 24, openEnded: true });
    expect(((part(d, "eye_cone_apex") as THREE.Mesh).geometry as THREE.SphereGeometry).parameters.radius).toBe(0.11);
    expect(new Set(parts.map((m) => m.material)).size).toBe(1);
    for (const m of parts) {
      const mat = m.material as THREE.MeshBasicMaterial;
      expect([mat.opacity, mat.transparent, mat.depthTest, mat.depthWrite, mat.side, m.renderOrder]).toEqual([0.8, true, false, false, THREE.DoubleSide, 10]);
    }
  });

  it("tracking limited면 원뿔 색이 viz.cone.limited, ok면 viz.cone.ok다(색은 이 두 토큰뿐)", () => {
    const d = createEyeCone();
    const face = part(d, "eye_cone_face") as THREE.Mesh;
    d.setEye(EYE);
    expect(meshes(d.group).map(colorOf)).toEqual([viz.cone.ok, viz.cone.ok]);
    d.setEye({ ...EYE, tracking: "limited" });
    expect(colorOf(face)).toBe(viz.cone.limited);
    expect(colorOf(part(d, "eye_cone_apex") as THREE.Mesh)).toBe(viz.cone.limited);
    d.setEye(EYE);
    expect(colorOf(face)).toBe(viz.cone.ok);
  });

  it("비킬 상자(conePixelBox)가 원뿔을 다 담는다: 구운 보기 그림 위 원뿔·꼭짓점 공 꼭짓점이 모두 상자 안이고, 상자는 그보다 3 px 넘게 크지 않다. 보는 방향에 따라 달라진다", () => {
    const d = createEyeCone();
    for (const [x, y, h, yaw, pitch] of [[3, 4, 1.4, 0, 0], [6, 1, 1.1, 90, -10], [3, 4, 1.4, -135, -60], [6, 1, 0.9, 200, 35], [10.6, 8.6, 1.1, 262.2, -10], [5, 5, 1.3, 45, -89]] as const) {
      const eye = { ...EYE, position: [x, y] as Plan2, height_m: h, yaw_deg: yaw, pitch_deg: pitch };
      d.setEye(eye);
      d.group.updateMatrixWorld(true);
      const box = conePixelBox(CAM, eye);
      const seen = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const m of meshes(d.group)) {
        const pos = m.geometry.getAttribute("position");
        for (let i = 0; i < pos.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          const [u, w] = planToPixel(CAM, [v.x, v.z], v.y);
          seen.x0 = Math.min(seen.x0, u); seen.x1 = Math.max(seen.x1, u); seen.y0 = Math.min(seen.y0, w); seen.y1 = Math.max(seen.y1, w);
        }
      }
      const where = `${[x, y, h, yaw, pitch]}`;
      expect(seen.x0, where).toBeGreaterThanOrEqual(box.x0 - 1e-6);
      expect(seen.y0, where).toBeGreaterThanOrEqual(box.y0 - 1e-6);
      expect(seen.x1, where).toBeLessThanOrEqual(box.x1 + 1e-6);
      expect(seen.y1, where).toBeLessThanOrEqual(box.y1 + 1e-6);
      for (const gap of [seen.x0 - box.x0, seen.y0 - box.y0, box.x1 - seen.x1, box.y1 - seen.y1]) expect(gap, where).toBeLessThan(3);
    }
    // 같은 자리·높이여도 보는 방향이 다르면 상자가 다르다
    const [a, b] = [conePixelBox(CAM, { ...EYE, yaw_deg: 0 }), conePixelBox(CAM, { ...EYE, yaw_deg: 180 })];
    expect(Math.abs(a.x0 - b.x0) + Math.abs(a.x1 - b.x1)).toBeGreaterThan(20);
  });

  it("거의 같은 눈(2 cm·1° 안)이면 다시 그리지 않고, 움직이거나 상태가 바뀌면 다시 그린다", () => {
    const d = createEyeCone();
    expect(d.setEye(null)).toBe(false);
    expect(d.setEye(EYE)).toBe(true);
    expect(d.setEye({ ...EYE, at: "t2" })).toBe(false);
    expect(d.setEye({ ...EYE, position: [3.01, 4.01] })).toBe(false);
    expect(d.setEye({ ...EYE, yaw_deg: 30.5, pitch_deg: -25.5, height_m: 1.41 })).toBe(false);
    expect(d.setEye({ ...EYE, position: [3.1, 4] })).toBe(true);
    expect(d.setEye({ ...EYE, position: [3.1, 4], yaw_deg: 33 })).toBe(true);
    expect(d.setEye({ ...EYE, position: [3.1, 4], yaw_deg: 33, tracking: "limited" })).toBe(true);
    expect(d.setEye({ ...EYE, position: [3.1, 4], yaw_deg: 33, tracking: "limited" })).toBe(false);
    expect(d.setEye({ ...EYE, estimated: true })).toBe(true);
    expect(d.setEye(null)).toBe(false);
  });

  it("yaw는 360° 둘레로 견준다(179°와 −179°는 2° 차이)", () => {
    const d = createEyeCone();
    d.setEye({ ...EYE, yaw_deg: 179.8 });
    expect(d.setEye({ ...EYE, yaw_deg: -179.8 })).toBe(false);
  });

  it("쓸 수 없는 값(NaN)이면 숨긴다", () => {
    const d = createEyeCone();
    d.setEye(EYE);
    d.setEye({ ...EYE, height_m: Number.NaN });
    expect(d.group.visible).toBe(false);
  });
});

describe("그리는 자리 보정(벽 뚫지 않기)", () => {
  const guide = walkGuide(SCENE, CONE.apex);
  const feet = (d: EyeCone): Plan2 => { const p = world(part(d, "eye_cone")); return [p.x, p.z]; };
  const toWalls = (p: Plan2) => Math.min(...SCENE.plan.walls.flatMap((w) => {
    if (!w.a || !w.b) return [];
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
    const t = Math.min(1, Math.max(0, ((p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dy) / (dx * dx + dy * dy)));
    return [Math.hypot(p[0] - (w.a[0] + dx * t), p[1] - (w.a[1] + dy * t))];
  }));

  it("벽 속 눈이 와도 원뿔은 방 안, 벽에서 벽 반 두께 + 꼭짓점 공 반지름만큼 떨어진 자리에 서고, 원뿔 높이·방향은 눈 그대로다", () => {
    const d = createEyeCone({ guide });
    d.setEye({ ...EYE, position: [7.2, 9], yaw_deg: 40 });
    const at = feet(d);
    expect(roomAt(FP, at)).not.toBeNull();
    expect(toWalls(at)).toBeGreaterThanOrEqual(0.06 + CONE.apex - 1e-9);
    const apex = world(part(d, "eye_cone"));
    expect([apex.x, apex.z]).toEqual(at);
    expect(apex.y).toBe(1.4);
    expect(d.at()).toEqual(at);
  });

  it("처음 보이는 눈은 그 자리에 바로 선다(걷지 않는다)", () => {
    const d = createEyeCone({ guide });
    d.setEye({ ...EYE, position: [6.5, 9] });
    expect(feet(d)).toEqual([6.5, 9]);
    expect(d.tick(0)).toBe(false);
  });

  it("거실에서 벽 너머 침실로 눈이 옮겨 가면 원뿔은 문을 지나 걸어가고, 가는 동안 벽에서 떨어져 있다", () => {
    const d = createEyeCone({ guide });
    d.setEye({ ...EYE, position: [6.5, 9] });
    expect(d.setEye({ ...EYE, position: [8.5, 9] })).toBe(true);
    // 받자마자는 그대로 있고, 그림마다 조금씩 간다
    expect(feet(d)).toEqual([6.5, 9]);
    const seen: Plan2[] = [];
    let now = 1000, moving = true;
    for (let i = 0; i < 2000 && moving; i++) {
      moving = d.tick(now);
      now += 16;
      seen.push(feet(d));
    }
    expect(moving).toBe(false);
    expect(feet(d)).toEqual([8.5, 9]);
    // 한 그림에 멀리 뛰지 않는다
    for (let i = 1; i < seen.length; i++) expect(Math.hypot(seen[i]![0] - seen[i - 1]![0], seen[i]![1] - seen[i - 1]![1])).toBeLessThan(0.4);
    // 안방 문(7.78, 6.8)을 지난다
    expect(seen.some((p) => Math.hypot(p[0] - 7.78, p[1] - 6.8) < 0.15)).toBe(true);
    // 문 자리 말고는 벽 선에서 떨어져 있다(벽을 지나는 직선이면 거실·침실 사이 벽 x 7.2, y 9를 밟는다)
    for (const p of seen) expect(toWalls(p) > 0.15 || Math.hypot(p[0] - 7.78, p[1] - 6.8) < 0.45, `${p}`).toBe(true);
    expect(seen.some((p) => Math.abs(p[0] - 7.2) < 0.1 && p[1] > 7.3)).toBe(false);
  });

  it("같은 방 안 작은 움직임은 몇 그림 안에 따라간다", () => {
    const d = createEyeCone({ guide });
    d.setEye({ ...EYE, position: [5, 9] });
    d.setEye({ ...EYE, position: [5.08, 9] });
    d.tick(0);
    d.tick(16);
    d.tick(32);
    d.tick(48);
    d.tick(64);
    expect(feet(d)[0]).toBeCloseTo(5.08, 6);
    expect(d.tick(80)).toBe(false);
  });

  it("아주 먼 새 자리(다시 맞춤)는 걷지 않고 바로 옮긴다", () => {
    const d = createEyeCone({ guide });
    d.setEye({ ...EYE, position: [1.5, 10.5] });
    d.setEye({ ...EYE, position: [9.3, 0.9] });
    expect(feet(d)).toEqual([9.3, 0.9]);
    expect(d.tick(0)).toBe(false);
  });

  it("숨었다 다시 보이면 걷던 길을 버리고 새 자리에 바로 선다", () => {
    const d = createEyeCone({ guide });
    d.setEye({ ...EYE, position: [6.5, 9] });
    d.setEye({ ...EYE, position: [8.5, 9] });
    d.setEye(null);
    expect(d.at()).toBeNull();
    expect(d.tick(0)).toBe(false);
    d.setEye({ ...EYE, position: [5, 6] });
    expect(feet(d)).toEqual([5, 6]);
  });
});
