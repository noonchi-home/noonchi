// @vitest-environment node
// 맞춘 눈 표시(클로이드 인형 + 보는 방향 원뿔): 맞춘 눈일 때만 보이고, null·추정 눈이면 숨는다.
// 인형은 Blender로 만든 GLB(ui/public/models/cloid-doll.glb)다: 키 DOLL_HEIGHT(사람만 한 1.43 m), 발 높이 0, 코가 앞(+x), 재질은 털·배·숯색·브랜드 넷.
// 인형 발은 그 방 바닥, 원뿔 꼭짓점은 height_m(트윈 높이 0 기준), 축은 yaw·pitch 방향. 원뿔은 예전 뷰어 것(열린 원뿔 0.32 × 0.9 m + 꼭짓점 공, 한 재질).
// limited면 원뿔이 viz.cone.limited 색. 색은 토큰만. 인형은 발 둘레 DOLL_REACH·키 DOLL_HEIGHT 안이고, 구운 보기 그림 위 자리는 dollPixelBox 안이다.
// 그리는 자리 보정: 벽 속 눈은 방 안에 서고, 벽 너머 새 자리로는 문을 지나 걸어간다(벽을 지나는 직선이 아니다).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { EyeEvent, Plan2 } from "../../../src/contract/events.ts";
import { color, twin, viz } from "../../../src/design/tokens.ts";
import { floorPlanFrom, roomAt } from "../../../src/plan/route.ts";
import { CONE, DOLL_HEIGHT, DOLL_REACH, DOLL_URL, createEyeDoll, dollPixelBox, floorOf, type EyeDoll } from "../../src/twin3d/eye";
import { MOKRYEON_MAP_CAMERA as CAM, planToPixel } from "../../src/twin3d/projection";
import { walkGuide } from "../../src/twin3d/walk";

const EYE: EyeEvent = { position: [3, 4], height_m: 1.4, yaw_deg: 30, pitch_deg: -25, tracking: "ok", at: "t" };
/** 바닥 0인 방과 바닥 −0.1인 방(욕실처럼). */
const ROOMS = [
  { polygon: [[0, 0], [5, 0], [5, 5], [0, 5]] as [number, number][], floor_z: 0 },
  { polygon: [[5, 0], [8, 0], [8, 3], [5, 3]] as [number, number][], floor_z: -0.1 },
];
const file = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const SCENE = JSON.parse(readFileSync(file("../../../twin/apartment/scene.json"), "utf8")) as { plan: { walls: { a: Plan2 | null; b: Plan2 | null }[] } };
const FP = floorPlanFrom(SCENE);

let glb: ArrayBuffer;
/** 인형 GLB를 새로 읽는다(시험마다 따로). */
const model = () => new Promise<THREE.Group>((resolve, reject) => new GLTFLoader().parse(glb.slice(0), "", (g) => resolve(g.scene), reject));
beforeAll(() => {
  const buf = readFileSync(file(`../../public${DOLL_URL}`));
  glb = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
});

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
/** 메시 꼭짓점 가운데(세계 좌표). */
const centerOf = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o, true).getCenter(new THREE.Vector3());

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

  it("인형 발은 그 방 바닥 높이, 평면 자리는 (x, y)이고 키는 사람만 한 1.43 m다", async () => {
    expect(DOLL_HEIGHT).toBe(1.43);
    const d = createEyeDoll({ floorAt: floorOf(ROOMS), model: await model() });
    for (const [x, y, floor] of [[3, 4, 0], [6, 1, -0.1]] as const) {
      d.setEye({ ...EYE, position: [x, y] });
      const doll = part(d, "eye_doll");
      const at = world(doll);
      expect([at.x, at.y, at.z]).toEqual([x, floor, y]);
      const box = new THREE.Box3().setFromObject(doll, true);
      expect(box.min.y).toBeCloseTo(floor, 3);
      expect(box.max.y - box.min.y).toBeCloseTo(DOLL_HEIGHT, 2);
    }
  });

  it("인형은 yaw 쪽을 본다(코가 그 방향)", async () => {
    const d = createEyeDoll({ model: await model() });
    for (const yaw of [0, 90, -135]) {
      d.setEye({ ...EYE, yaw_deg: yaw });
      const v = centerOf(part(d, "doll_nose")).sub(world(part(d, "eye_doll")));
      const a = (yaw * Math.PI) / 180;
      const flat = new THREE.Vector2(v.x, v.z).normalize();
      expect(flat.x).toBeCloseTo(Math.cos(a), 3);
      expect(flat.y).toBeCloseTo(Math.sin(a), 3);
    }
  });

  it("원뿔 꼭짓점 높이는 height_m(서버 카메라 원점 [x, height_m, y]와 같다, 방 바닥 −0.1이어도), 축은 yaw·pitch 방향이다", () => {
    const d = createEyeDoll({ floorAt: floorOf(ROOMS) });
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

  it("원뿔은 예전 뷰어 것이다: 열린 원뿔(반지름 0.32·길이 0.9 m, 24칸)과 꼭짓점 공(0.11 m)이 한 재질(불투명도 0.8, 양면, 차례 10)이고, 깊이는 쓰지 않고 인형과만 견준다", () => {
    const d = createEyeDoll();
    const parts = meshes(part(d, "eye_cone"));
    expect(parts.map((m) => m.name).sort()).toEqual(["eye_cone_apex", "eye_cone_face"]);
    const face = part(d, "eye_cone_face") as THREE.Mesh;
    expect((face.geometry as THREE.ConeGeometry).parameters).toMatchObject({ radius: 0.32, height: 0.9, radialSegments: 24, openEnded: true });
    expect(((part(d, "eye_cone_apex") as THREE.Mesh).geometry as THREE.SphereGeometry).parameters.radius).toBe(0.11);
    expect(new Set(parts.map((m) => m.material)).size).toBe(1);
    for (const m of parts) {
      const mat = m.material as THREE.MeshBasicMaterial;
      expect(mat).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect([mat.opacity, mat.transparent, mat.depthTest, mat.depthWrite, mat.side, m.renderOrder]).toEqual([0.8, true, true, false, THREE.DoubleSide, 10]);
    }
  });

  it("tracking limited면 원뿔 색이 viz.cone.limited, ok면 viz.cone.ok다", () => {
    const d = createEyeDoll();
    const face = part(d, "eye_cone_face") as THREE.Mesh;
    d.setEye(EYE);
    expect(colorOf(face)).toBe(viz.cone.ok);
    d.setEye({ ...EYE, tracking: "limited" });
    expect(colorOf(face)).toBe(viz.cone.limited);
    expect(colorOf(part(d, "eye_cone_apex") as THREE.Mesh)).toBe(viz.cone.limited);
    d.setEye(EYE);
    expect(colorOf(face)).toBe(viz.cone.ok);
  });

  it("인형은 발 둘레 DOLL_REACH, 키 DOLL_HEIGHT 안이고, 구운 보기 그림 위 꼭짓점이 모두 dollPixelBox 안이다", async () => {
    const d = createEyeDoll({ floorAt: floorOf(ROOMS), model: await model() });
    for (const [x, y, floor, yaw] of [[3, 4, 0, 0], [6, 1, -0.1, 90], [3, 4, 0, -135], [6, 1, -0.1, 200]] as const) {
      d.setEye({ ...EYE, position: [x, y], yaw_deg: yaw });
      const doll = part(d, "eye_doll");
      const box = dollPixelBox(CAM, [x, y], floor);
      let reach = 0, top = 0, out = 0;
      for (const m of meshes(doll)) {
        const pos = m.geometry.getAttribute("position");
        for (let i = 0; i < pos.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          reach = Math.max(reach, Math.hypot(v.x - x, v.z - y));
          top = Math.max(top, v.y - floor);
          const [u, w] = planToPixel(CAM, [v.x, v.z], v.y);
          if (!(u >= box.x0 && u <= box.x1 && w >= box.y0 && w <= box.y1)) out++;
        }
      }
      expect(reach).toBeLessThanOrEqual(DOLL_REACH);
      expect(reach).toBeGreaterThan(DOLL_REACH - 0.1);
      expect(top).toBeLessThanOrEqual(DOLL_HEIGHT + 1e-3);
      expect(out).toBe(0);
    }
  });

  it("인형·원뿔 색은 토큰(인형 털·배·숯색, 브랜드, 원뿔)만 쓴다", async () => {
    const d = createEyeDoll({ model: await model() });
    d.setEye(EYE);
    const allowed = new Set<string>([twin.cloid.doll.fur, twin.cloid.doll.belly, twin.cloid.doll.dark, color.brand, viz.cone.ok, viz.cone.limited]);
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

describe("그리는 자리 보정(벽 뚫지 않기)", () => {
  const guide = walkGuide(SCENE);
  const feet = (d: EyeDoll): Plan2 => { const p = world(part(d, "eye_doll")); return [p.x, p.z]; };
  const toWalls = (p: Plan2) => Math.min(...SCENE.plan.walls.flatMap((w) => {
    if (!w.a || !w.b) return [];
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
    const t = Math.min(1, Math.max(0, ((p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dy) / (dx * dx + dy * dy)));
    return [Math.hypot(p[0] - (w.a[0] + dx * t), p[1] - (w.a[1] + dy * t))];
  }));

  it("벽 속 눈이 와도 인형·원뿔은 방 안 벽에서 떨어진 자리에 서고, 원뿔 높이·방향은 눈 그대로다", () => {
    const d = createEyeDoll({ guide });
    d.setEye({ ...EYE, position: [7.2, 9], yaw_deg: 40 });
    const at = feet(d);
    expect(roomAt(FP, at)).not.toBeNull();
    expect(toWalls(at)).toBeGreaterThan(0.25);
    const apex = world(part(d, "eye_cone"));
    expect([apex.x, apex.z]).toEqual(at);
    expect(apex.y).toBe(1.4);
    expect(d.at()).toEqual(at);
  });

  it("처음 보이는 눈은 그 자리에 바로 선다(걷지 않는다)", () => {
    const d = createEyeDoll({ guide });
    d.setEye({ ...EYE, position: [6.5, 9] });
    expect(feet(d)).toEqual([6.5, 9]);
    expect(d.tick(0)).toBe(false);
  });

  it("거실에서 벽 너머 침실로 눈이 옮겨 가면 인형은 문을 지나 걸어가고, 가는 동안 벽에서 떨어져 있다", () => {
    const d = createEyeDoll({ guide });
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
    for (const p of seen) expect(toWalls(p) > 0.2 || Math.hypot(p[0] - 7.78, p[1] - 6.8) < 0.45, `${p}`).toBe(true);
    expect(seen.some((p) => Math.abs(p[0] - 7.2) < 0.1 && p[1] > 7.3)).toBe(false);
  });

  it("같은 방 안 작은 움직임은 몇 그림 안에 따라간다", () => {
    const d = createEyeDoll({ guide });
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
    const d = createEyeDoll({ guide });
    d.setEye({ ...EYE, position: [1.5, 10.5] });
    d.setEye({ ...EYE, position: [9.3, 0.9] });
    expect(feet(d)).toEqual([9.3, 0.9]);
    expect(d.tick(0)).toBe(false);
  });

  it("숨었다 다시 보이면 걷던 길을 버리고 새 자리에 바로 선다", () => {
    const d = createEyeDoll({ guide });
    d.setEye({ ...EYE, position: [6.5, 9] });
    d.setEye({ ...EYE, position: [8.5, 9] });
    d.setEye(null);
    expect(d.at()).toBeNull();
    expect(d.tick(0)).toBe(false);
    d.setEye({ ...EYE, position: [5, 6] });
    expect(feet(d)).toEqual([5, 6]);
  });
});
