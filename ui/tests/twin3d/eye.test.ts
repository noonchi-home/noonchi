// @vitest-environment node
// 맞춘 눈 표시(마스코트 인형 + 시야 원뿔): 맞춘 눈일 때만 보이고, null·추정 눈이면 숨는다.
// 인형 발은 그 방 바닥, 평면 자리는 (x, y), 원뿔 꼭짓점은 height_m(트윈 높이 0 기준), 축은 yaw·pitch 방향. limited면 원뿔이 viz.cone.limited 색. 색은 토큰만.
// 인형은 발 둘레 DOLL_REACH·키 DOLL_HEIGHT 안이고, 구운 보기 그림 위 자리는 dollPixelBox 안이다.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { EyeEvent } from "../../../src/contract/events.ts";
import { color, overlayLine, twin, viz } from "../../../src/design/tokens.ts";
import { DOLL_HEIGHT, DOLL_REACH, createEyeDoll, dollPixelBox, floorOf, type EyeDoll } from "../../src/twin3d/eye";
import { MOKRYEON_MAP_CAMERA as CAM, planToPixel } from "../../src/twin3d/projection";

const EYE: EyeEvent = { position: [3, 4], height_m: 1.4, yaw_deg: 30, pitch_deg: -25, tracking: "ok", at: "t" };
/** 바닥 0인 방과 바닥 −0.1인 방(욕실처럼). */
const ROOMS = [
  { polygon: [[0, 0], [5, 0], [5, 5], [0, 5]] as [number, number][], floor_z: 0 },
  { polygon: [[5, 0], [8, 0], [8, 3], [5, 3]] as [number, number][], floor_z: -0.1 },
];

const part = (d: EyeDoll, name: string) => {
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

describe("맞춘 눈 표시(인형 + 원뿔)", () => {
  it("처음과 null·추정 눈이면 숨고, 맞춘 눈이면 보인다", () => {
    const d = createEyeDoll();
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

  it("인형 발은 그 방 바닥 높이, 평면 자리는 (x, y)이고 키는 약 0.55 m다", () => {
    const d = createEyeDoll({ floorAt: floorOf(ROOMS) });
    for (const [x, y, floor] of [[3, 4, 0], [6, 1, -0.1]] as const) {
      d.setEye({ ...EYE, position: [x, y] });
      const doll = part(d, "eye_doll");
      const at = world(doll);
      expect([at.x, at.y, at.z]).toEqual([x, floor, y]);
      const box = new THREE.Box3().setFromObject(doll, true);
      expect(box.min.y).toBeCloseTo(floor, 4);
      expect(box.max.y - box.min.y).toBeGreaterThan(DOLL_HEIGHT - 0.03);
      expect(box.max.y - box.min.y).toBeLessThan(DOLL_HEIGHT + 0.03);
      const c = box.getCenter(new THREE.Vector3());
      expect(Math.hypot(c.x - x, c.z - y)).toBeLessThan(0.15);
    }
  });

  it("인형은 yaw 쪽을 본다(주둥이가 그 방향)", () => {
    const d = createEyeDoll();
    for (const yaw of [0, 90, -135]) {
      d.setEye({ ...EYE, yaw_deg: yaw });
      const v = world(part(d, "eye_doll_snout")).sub(world(part(d, "eye_doll")));
      const a = (yaw * Math.PI) / 180;
      const flat = new THREE.Vector2(v.x, v.z).normalize();
      expect(flat.x).toBeCloseTo(Math.cos(a), 4);
      expect(flat.y).toBeCloseTo(Math.sin(a), 4);
    }
  });

  it("원뿔 꼭짓점 높이는 height_m(서버 카메라 원점 [x, height_m, y]와 같다, 방 바닥 −0.1이어도), 축은 yaw·pitch 방향, 길이는 viz.cone.length다", () => {
    const d = createEyeDoll({ floorAt: floorOf(ROOMS) });
    for (const [pos, yaw, pitch, h] of [[[3, 4], 30, -25, 1.4], [[6, 1], -120, 10, 1.2], [[1, 1], 180, -60, 0.9]] as const) {
      d.setEye({ ...EYE, position: [pos[0], pos[1]], yaw_deg: yaw, pitch_deg: pitch, height_m: h });
      const apex = world(part(d, "eye_cone"));
      expect(apex.x).toBeCloseTo(pos[0], 6);
      expect(apex.y).toBeCloseTo(h, 6);
      expect(apex.z).toBeCloseTo(pos[1], 6);
      const axis = world(part(d, "eye_cone_rim")).sub(apex);
      expect(axis.length()).toBeCloseTo(viz.cone.length, 6);
      const want = dirOf(yaw, pitch);
      expect(axis.normalize().dot(want)).toBeCloseTo(1, 6);
    }
  });

  it("tracking limited면 원뿔 색이 viz.cone.limited, ok면 viz.cone.ok다", () => {
    const d = createEyeDoll();
    const face = part(d, "eye_cone_face") as THREE.Mesh;
    d.setEye(EYE);
    expect(colorOf(face)).toBe(viz.cone.ok);
    expect((face.material as THREE.MeshBasicMaterial).opacity).toBe(viz.cone.faceOpacity);
    d.setEye({ ...EYE, tracking: "limited" });
    expect(colorOf(face)).toBe(viz.cone.limited);
    const cores = meshes(part(d, "eye_cone")).filter((m) => m.name.endsWith("_core"));
    expect(cores.length).toBeGreaterThan(0);
    for (const m of cores) expect(colorOf(m)).toBe(viz.cone.limited);
    d.setEye(EYE);
    expect(colorOf(face)).toBe(viz.cone.ok);
    for (const m of cores) expect(colorOf(m)).toBe(viz.cone.ok);
  });

  it("원뿔 둘레 세 겹 굵기: 심은 viz.cone.lineCore, 흰 테·숯색은 심 + overlayLine.m3d.casingAdd·edgeAdd", () => {
    const d = createEyeDoll();
    const tube = (name: string) => ((part(d, name) as THREE.Mesh).geometry as THREE.TorusGeometry).parameters.tube * 2;
    expect(tube("eye_cone_rim_core")).toBeCloseTo(viz.cone.lineCore, 9);
    expect(tube("eye_cone_rim_casing")).toBeCloseTo(viz.cone.lineCore + overlayLine.m3d.casingAdd, 9);
    expect(tube("eye_cone_rim_edge")).toBeCloseTo(viz.cone.lineCore + overlayLine.m3d.edgeAdd, 9);
  });

  it("인형은 발 둘레 DOLL_REACH, 키 DOLL_HEIGHT 안이고, 구운 보기 그림 위 꼭짓점이 모두 dollPixelBox 안이다", () => {
    const d = createEyeDoll({ floorAt: floorOf(ROOMS) });
    for (const [x, y, floor, yaw] of [[3, 4, 0, 0], [6, 1, -0.1, 90], [3, 4, 0, -135], [6, 1, -0.1, 200]] as const) {
      d.setEye({ ...EYE, position: [x, y], yaw_deg: yaw });
      const doll = part(d, "eye_doll");
      const box = dollPixelBox(CAM, [x, y], floor);
      for (const m of meshes(doll)) {
        const pos = m.geometry.getAttribute("position");
        for (let i = 0; i < pos.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          expect(Math.hypot(v.x - x, v.z - y), m.name).toBeLessThanOrEqual(DOLL_REACH);
          expect(v.y - floor, m.name).toBeLessThanOrEqual(DOLL_HEIGHT);
          const [u, w] = planToPixel(CAM, [v.x, v.z], v.y);
          expect(u >= box.x0 && u <= box.x1 && w >= box.y0 && w <= box.y1, `${m.name} ${u},${w}`).toBe(true);
        }
      }
    }
  });

  it("원뿔은 열린 원뿔이고 깊이 검사 없이 높은 순서로 그린다", () => {
    const d = createEyeDoll();
    const face = part(d, "eye_cone_face") as THREE.Mesh;
    expect((face.geometry as THREE.ConeGeometry).parameters.openEnded).toBe(true);
    const parts = meshes(part(d, "eye_cone"));
    expect(parts.length).toBeGreaterThan(1);
    for (const m of parts) {
      const mat = m.material as THREE.Material;
      expect([m.name, mat.depthTest, mat.depthWrite, mat.transparent]).toEqual([m.name, false, false, true]);
      expect(m.renderOrder, m.name).toBeGreaterThanOrEqual(10);
    }
  });

  it("인형·원뿔 색은 토큰(인형 털·배·숯색, 브랜드, 원뿔, 선 세 겹)만 쓴다", () => {
    const d = createEyeDoll();
    d.setEye(EYE);
    const allowed = new Set<string>([twin.cloid.doll.fur, twin.cloid.doll.belly, twin.cloid.doll.dark, color.brand, viz.cone.ok, viz.cone.limited, overlayLine.casing.color, overlayLine.edge]);
    const used = new Set(meshes(d.group).map(colorOf));
    expect([...used].filter((c) => !allowed.has(c))).toEqual([]);
    const doll = new Set(meshes(part(d, "eye_doll")).map(colorOf));
    expect([...doll].sort()).toEqual([twin.cloid.doll.fur, twin.cloid.doll.belly, twin.cloid.doll.dark, color.brand].sort());
  });

  it("거의 같은 눈(2 cm·1° 안)이면 다시 그리지 않고, 움직이거나 상태가 바뀌면 다시 그린다", () => {
    const d = createEyeDoll();
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
    const d = createEyeDoll();
    d.setEye({ ...EYE, yaw_deg: 179.8 });
    expect(d.setEye({ ...EYE, yaw_deg: -179.8 })).toBe(false);
  });

  it("쓸 수 없는 값(NaN)이면 숨긴다", () => {
    const d = createEyeDoll();
    d.setEye(EYE);
    d.setEye({ ...EYE, height_m: Number.NaN });
    expect(d.group.visible).toBe(false);
  });

  it("방 바닥 찾기: 방 안이면 그 방 floor_z, 어느 방에도 없으면 0", () => {
    const at = floorOf(ROOMS);
    expect(at([6, 1])).toBe(-0.1);
    expect(at([1, 1])).toBe(0);
    expect(at([20, 20])).toBe(0);
    expect(floorOf([])([1, 1])).toBe(0);
  });
});
