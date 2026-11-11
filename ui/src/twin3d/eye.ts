// 대시보드 트윈의 맞춘 눈 표시: 마스코트(미어캣) 인형 + 열린 시야 원뿔. three.js 기본 도형만 쓰고 그림 파일은 쓰지 않는다.
// 평면 (x, y)·바닥 높이 f → three (x, f, y). 인형 발은 그 방 바닥, 원뿔 꼭짓점은 height_m(서버 카메라 원점 [x, height_m, y]처럼 트윈 높이 0 기준),
// 원뿔 축은 yaw(0 = +x, 90 = +y)·pitch(아래가 음수) 방향이다. 맞춘 눈만 보이고 null·추정 눈이면 숨긴다.
// 거의 같은 눈(2 cm·1° 안)이면 그대로 둬서 집을 다시 그리지 않는다.
// 색은 토큰만: 인형 twin.cloid.doll·brand, 원뿔 viz.cone(ok·limited, 면 불투명도, 길이, 둘레 심 굵기), 원뿔 둘레·꼭짓점은 세 겹(overlayLine).
import * as THREE from "three";
import type { EyeEvent, Plan2 } from "../../../src/contract/events.ts";
import { color, overlayLine, twin, viz } from "../../../src/design/tokens.ts";
import { planToPixel, type OrthoCamera } from "./projection";

/** 인형 키(m). */
export const DOLL_HEIGHT = 0.55;
/** 인형이 발 자리에서 옆으로 차지하는 반지름(m, 꼬리 끝까지). */
export const DOLL_REACH = 0.32;
/** 원뿔 반각(도). */
const CONE_HALF_DEG = 20;
/** 이만큼보다 덜 움직이면 그대로 둔다(m, 도). */
const STILL_M = 0.02;
const STILL_DEG = 1;
/** 원뿔 그리는 차례(인형 다음). */
const ORDER = 10;
/** 세 겹 선의 심 굵기(m)와 흰 테·숯색이 더하는 굵기. */
const LINE = { core: viz.cone.lineCore, casingAdd: overlayLine.m3d.casingAdd, edgeAdd: overlayLine.m3d.edgeAdd };
/** 원뿔 꼭짓점 점 반지름(m). */
const APEX_R = 0.035;

/** 방 바닥 높이를 찾는 데 쓰는 서버 장면(/api/scene) 방. */
export interface FloorRoom { polygon?: Plan2[]; floor_z?: number }

/** 평면 점이 든 방의 바닥 높이(floor_z, 짝수 교차 규칙). 어느 방에도 없으면 0. */
export function floorOf(rooms: FloorRoom[]): (p: Plan2) => number {
  const list = rooms.filter((r) => (r.polygon?.length ?? 0) >= 3);
  return ([x, z]) => {
    for (const r of list) {
      const poly = r.polygon!;
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i]!;
        const [xj, zj] = poly[j]!;
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) return typeof r.floor_z === "number" && Number.isFinite(r.floor_z) ? r.floor_z : 0;
    }
    return 0;
  };
}

/** 인형이 구운 보기 그림에서 차지하는 상자(그림 px): 발(floor)·머리(floor + DOLL_HEIGHT) 자리 둘레에 DOLL_REACH. */
export function dollPixelBox(cam: OrthoCamera, position: Plan2, floor: number): { x0: number; y0: number; x1: number; y1: number } {
  const [feet, head] = [planToPixel(cam, position, floor), planToPixel(cam, position, floor + DOLL_HEIGHT)];
  const r = DOLL_REACH * (cam.width / cam.orthoScale);
  return { x0: Math.min(feet[0], head[0]) - r, y0: Math.min(feet[1], head[1]) - r, x1: Math.max(feet[0], head[0]) + r, y1: Math.max(feet[1], head[1]) + r };
}

export interface EyeDoll {
  /** 인형(eye_doll)과 원뿔(eye_cone). 처음에는 숨어 있다. */
  readonly group: THREE.Group;
  /** 맞춘 눈이면 그 자리에 보이고, null·추정 눈이면 숨긴다. 보이는 모양이 바뀌었으면 true. */
  setEye(eye: EyeEvent | null): boolean;
}

interface Pose { x: number; y: number; floor: number; h: number; yaw: number; pitch: number; limited: boolean }

/** 두 방향(도)의 차이, 360° 둘레로. */
const turn = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const still = (a: Pose, b: Pose) =>
  a.limited === b.limited && Math.hypot(a.x - b.x, a.y - b.y) < STILL_M && Math.abs(a.h - b.h) < STILL_M
  && Math.abs(a.floor - b.floor) < STILL_M && turn(a.yaw, b.yaw) < STILL_DEG && Math.abs(a.pitch - b.pitch) < STILL_DEG;

const rad = (deg: number) => (deg * Math.PI) / 180;
const DOWN = new THREE.Vector3(0, -1, 0);

/** 미어캣 인형(앞 +x, 발 y 0). */
function meerkat(): THREE.Group {
  const doll = new THREE.Group();
  doll.name = "eye_doll";
  const lambert = (name: string, c: string) => new THREE.MeshLambertMaterial({ name, color: c });
  const fur = lambert("doll_fur", twin.cloid.doll.fur);
  const belly = lambert("doll_belly", twin.cloid.doll.belly);
  const dark = lambert("doll_dark", twin.cloid.doll.dark);
  const chest = lambert("doll_chest", color.brand);
  const add = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, [x, y, z]: [number, number, number], scale?: [number, number, number]) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.position.set(x, y, z);
    if (scale) m.scale.set(...scale);
    doll.add(m);
    return m;
  };
  const ball = (r: number) => new THREE.SphereGeometry(r, 16, 12);
  for (const s of [1, -1]) {
    const side = s > 0 ? "l" : "r";
    add(`eye_doll_foot_${side}`, ball(0.035), dark, [0.02, 0.0175, 0.045 * s], [1.3, 0.5, 1]);
    add(`eye_doll_eye_${side}`, ball(0.012), dark, [0.075, 0.48, 0.035 * s]);
    add(`eye_doll_ear_${side}`, ball(0.026), dark, [-0.005, 0.51, 0.058 * s], [0.5, 1, 1]);
  }
  // 꼬리: 몸 뒤 아래에서 뒤로 늘어진다
  const root = new THREE.Vector3(-0.07, 0.08, 0), tip = new THREE.Vector3(-0.3, 0.015, 0);
  const along = tip.clone().sub(root);
  const tail = add("eye_doll_tail", new THREE.CylinderGeometry(0.01, 0.028, along.length(), 10), fur, [(root.x + tip.x) / 2, (root.y + tip.y) / 2, 0]);
  tail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.normalize());
  add("eye_doll_tail_tip", ball(0.012), dark, [tip.x, tip.y, tip.z]);
  add("eye_doll_body", new THREE.CapsuleGeometry(0.085, 0.2, 6, 16), fur, [0, 0.215, 0]);
  add("eye_doll_belly", ball(1), belly, [0.045, 0.2, 0], [0.05, 0.13, 0.068]);
  add("eye_doll_chest", ball(0.018), chest, [0.083, 0.3, 0]);
  add("eye_doll_head", new THREE.SphereGeometry(0.075, 20, 14), fur, [0.015, 0.455, 0]);
  add("eye_doll_snout", new THREE.ConeGeometry(0.036, 0.09, 14).rotateZ(-Math.PI / 2), belly, [0.105, 0.44, 0]);
  add("eye_doll_nose", ball(0.014), dark, [0.148, 0.44, 0]);
  return doll;
}

/** 깊이 검사 없이 차례대로 그리는 원뿔 재질. */
const flat = (name: string, c: string, opacity = 1, side: THREE.Side = THREE.FrontSide) =>
  new THREE.MeshBasicMaterial({ name, color: c, transparent: true, opacity, side, depthTest: false, depthWrite: false, toneMapped: false });

/** 세 겹(숯색·흰 테·심) 메시 묶음. make(add)는 심보다 add(m)만큼 굵은 모양이다. */
function layered(name: string, make: (add: number) => THREE.BufferGeometry, core: THREE.Material, order: number): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const edge = flat(`${name}_edge`, overlayLine.edge);
  const casing = flat(`${name}_casing`, overlayLine.casing.color, overlayLine.casing.opacity);
  ([["edge", LINE.edgeAdd, edge], ["casing", LINE.casingAdd, casing], ["core", 0, core]] as const).forEach(([k, add, mat], i) => {
    const m = new THREE.Mesh(make(add), mat);
    m.name = `${name}_${k}`;
    m.renderOrder = order + i;
    g.add(m);
  });
  return g;
}

/** 열린 시야 원뿔: 꼭짓점이 원점, 축은 아래(−y), 길이 viz.cone.length. 둘레와 꼭짓점은 세 겹. */
function viewCone(): { cone: THREE.Group; face: THREE.MeshBasicMaterial; core: THREE.MeshBasicMaterial } {
  const L = viz.cone.length;
  const R = L * Math.tan(rad(CONE_HALF_DEG));
  const cone = new THREE.Group();
  cone.name = "eye_cone";
  const face = flat("cone_face", viz.cone.ok, viz.cone.faceOpacity, THREE.DoubleSide);
  const core = flat("cone_core", viz.cone.ok);
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(R, L, 48, 1, true).translate(0, -L / 2, 0), face);
  mesh.name = "eye_cone_face";
  mesh.renderOrder = ORDER;
  const rim = layered("eye_cone_rim", (add) => new THREE.TorusGeometry(R, (LINE.core + add) / 2, 8, 64).rotateX(Math.PI / 2), core, ORDER + 1);
  rim.position.y = -L;
  const apex = layered("eye_cone_apex", (add) => new THREE.SphereGeometry(APEX_R + add / 2, 16, 12), core, ORDER + 4);
  cone.add(mesh, rim, apex);
  return { cone, face, core };
}

/** 맞춘 눈 표시를 만든다. floorAt: 평면 점의 방 바닥 높이(없으면 0). */
export function createEyeDoll(o: { floorAt?: (p: Plan2) => number } = {}): EyeDoll {
  const floorAt = o.floorAt ?? (() => 0);
  const group = new THREE.Group();
  group.name = "cloid_eye";
  group.visible = false;
  const doll = meerkat();
  const { cone, face, core } = viewCone();
  group.add(doll, cone);
  let shown: Pose | null = null;

  const poseOf = (eye: EyeEvent | null): Pose | null => {
    if (!eye || eye.estimated || !Array.isArray(eye.position)) return null;
    const [x, y] = eye.position;
    const { height_m: h, yaw_deg: yaw, pitch_deg: pitch } = eye;
    if (![x, y, h, yaw, pitch].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
    return { x, y, floor: floorAt([x, y]), h, yaw, pitch, limited: eye.tracking === "limited" };
  };

  return {
    group,
    setEye(eye) {
      const p = poseOf(eye);
      if (!p) {
        if (!group.visible) return false;
        group.visible = false;
        shown = null;
        return true;
      }
      if (shown && still(shown, p)) return false;
      const a = rad(p.yaw), b = rad(p.pitch);
      doll.position.set(p.x, p.floor, p.y);
      doll.rotation.set(0, -a, 0);
      cone.position.set(p.x, p.h, p.y);
      cone.quaternion.setFromUnitVectors(DOWN, new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)));
      const c = p.limited ? viz.cone.limited : viz.cone.ok;
      face.color.set(c);
      core.color.set(c);
      group.visible = true;
      shown = p;
      return true;
    },
  };
}
