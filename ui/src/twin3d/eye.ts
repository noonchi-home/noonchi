// 대시보드 트윈의 맞춘 눈 표시: 클로이드 인형(마스코트 미어캣, Blender로 만든 GLB) + 보는 방향 원뿔.
// 인형 모델은 scripts/twin3d/cloid-doll.py가 만든 ui/public/models/cloid-doll.glb다(앞 +x, 발 y 0, 키 DOLL_HEIGHT). 재질 이름마다 토큰 색을 입힌다.
// 평면 (x, y)·바닥 높이 f → three (x, f, y). 인형 발은 그 방 바닥, 원뿔 꼭짓점은 height_m(서버 카메라 원점 [x, height_m, y]처럼 트윈 높이 0 기준),
// 원뿔 축은 yaw(0 = +x, 90 = +y)·pitch(아래가 음수) 방향이다. 맞춘 눈만 보이고 null·추정 눈이면 숨긴다.
// 원뿔은 예전 뷰어(twin/apartment/viewer/main.mjs cloid_eye)의 것이다: 열린 원뿔(반지름 0.32·길이 0.9 m)과 꼭짓점 공(0.11 m), 한 재질.
// 눈 층은 집 깊이를 지운 뒤 그려서 원뿔이 벽에 가려지지 않는다(예전 뷰어의 깊이 검사 끄기와 같은 뜻). 층 안에서는 깊이를 견줘 인형 머리 뒤쪽 원뿔이 얼굴을 덮지 않는다.
// 그리는 자리만 보정한다(guide, walk.ts): 눈 자리를 방 안·벽에서 떨어진 자리로 옮기고, 새 자리까지는 문·트인 경계를 지나는 길로 걸어간다(tick).
// 눈 자세 값(World State·판정이 쓰는 것)은 바꾸지 않는다. 거의 같은 눈(2 cm·1° 안)이면 그대로 둬서 집을 다시 그리지 않는다.
// 색은 토큰만: 인형 twin.cloid.doll·brand, 원뿔 viz.cone(ok·limited).
import * as THREE from "three";
import type { EyeEvent, Plan2 } from "../../../src/contract/events.ts";
import { color, twin, viz } from "../../../src/design/tokens.ts";
import { planToPixel, type OrthoCamera } from "./projection";
import type { WalkGuide } from "./walk";

/** 인형 모델 주소(ui/public). */
export const DOLL_URL = "/models/cloid-doll.glb";
/** 인형 키(m). LG 클로이드 로봇이 몸을 다 폈을 때 키에 맞춘다. scripts/twin3d/cloid-doll.py HEIGHT_M과 같다. */
export const DOLL_HEIGHT = 1.43;
/** 인형이 발 자리에서 옆으로 차지하는 반지름(m, 꼬리 끝까지). */
export const DOLL_REACH = 0.56;
/** 원뿔(예전 뷰어 값): 넓은 쪽 반지름·길이·꼭짓점 공 반지름(m), 불투명도, 그리는 차례. */
export const CONE = { radius: 0.32, length: 0.9, apex: 0.11, opacity: 0.8, order: 10 } as const;
/** 이만큼보다 덜 움직이면 그대로 둔다(m, 도). */
const STILL_M = 0.02;
const STILL_DEG = 1;
/** 그릴 자리로 걸어가는 빠르기(m/s)와, 멀면 이 시간(s) 안에 닿게 더 빨리 간다. */
const WALK_MPS = 1.5;
const CATCH_UP_S = 0.5;
/** 길이 이보다 길면(다시 맞춤·다시 붙음) 걷지 않고 바로 옮긴다(m). */
const JUMP_M = 12;
/** 한 그림에 걷는 시간 위(s). 화면이 멈췄다 돌아와도 한 번에 건너뛰지 않는다. */
const STEP_MAX_S = 0.1;

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
  /** 맞춘 눈이면 보이고, null·추정 눈이면 숨긴다. 보이는 모양이 바뀌었거나 걸어갈 길이 생겼으면 true. */
  setEye(eye: EyeEvent | null): boolean;
  /** 그릴 자리로 걷는 한 칸(now: ms). 아직 걷는 중이면 true. */
  tick(now: number): boolean;
  /** 지금 그린 발 자리(평면). 숨었으면 null. */
  at(): Plan2 | null;
}

interface Pose { x: number; y: number; h: number; yaw: number; pitch: number; limited: boolean }

/** 두 방향(도)의 차이, 360° 둘레로. */
const turn = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const still = (a: Pose, b: Pose) =>
  a.limited === b.limited && Math.hypot(a.x - b.x, a.y - b.y) < STILL_M && Math.abs(a.h - b.h) < STILL_M
  && turn(a.yaw, b.yaw) < STILL_DEG && Math.abs(a.pitch - b.pitch) < STILL_DEG;

const rad = (deg: number) => (deg * Math.PI) / 180;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const DOLL_COLORS: Record<string, string> = {
  doll_fur: twin.cloid.doll.fur, doll_belly: twin.cloid.doll.belly, doll_dark: twin.cloid.doll.dark, doll_brand: color.brand,
};

/** 받은 GLB 장면을 인형(eye_doll)으로: 재질 이름마다 토큰 색 재질로 바꾼다(모르는 이름은 털색). 모델이 없으면 빈 묶음. */
export function dollFrom(model: THREE.Object3D | null): THREE.Group {
  const doll = new THREE.Group();
  doll.name = "eye_doll";
  if (!model) return doll;
  const made = new Map<string, THREE.MeshLambertMaterial>();
  model.traverse((n) => {
    if (!(n instanceof THREE.Mesh)) return;
    const olds = [n.material].flat() as THREE.Material[];
    const name = olds[0]?.name && DOLL_COLORS[olds[0].name] ? olds[0].name : "doll_fur";
    if (!made.has(name)) made.set(name, new THREE.MeshLambertMaterial({ name, color: DOLL_COLORS[name]! }));
    for (const m of olds) m.dispose();
    n.material = made.get(name)!;
  });
  doll.add(model);
  return doll;
}

/** 보는 방향 원뿔(예전 뷰어 cloid_eye): 꼭짓점이 원점이고 넓은 쪽이 +x인 열린 원뿔과 꼭짓점 공. 깊이는 인형과만 견준다(쓰지는 않는다). */
function viewCone(): { cone: THREE.Group; mat: THREE.MeshBasicMaterial } {
  const mat = new THREE.MeshBasicMaterial({ name: "cone", color: viz.cone.ok, transparent: true, opacity: CONE.opacity, depthTest: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const cone = new THREE.Group();
  cone.name = "eye_cone";
  const face = new THREE.Mesh(new THREE.ConeGeometry(CONE.radius, CONE.length, 24, 1, true).rotateZ(Math.PI / 2).translate(CONE.length / 2, 0, 0), mat);
  face.name = "eye_cone_face";
  const apex = new THREE.Mesh(new THREE.SphereGeometry(CONE.apex, 16, 12), mat);
  apex.name = "eye_cone_apex";
  for (const m of [face, apex]) m.renderOrder = CONE.order;
  cone.add(face, apex);
  return { cone, mat };
}

const gap = (a: Plan2, b: Plan2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 맞춘 눈 표시를 만든다. floorAt: 평면 점의 방 바닥 높이(없으면 0). model: 인형 GLB 장면. guide: 그릴 자리 보정(없으면 눈 자리 그대로, 바로 옮긴다). */
export function createEyeDoll(o: { floorAt?: (p: Plan2) => number; model?: THREE.Object3D | null; guide?: WalkGuide } = {}): EyeDoll {
  const floorAt = o.floorAt ?? (() => 0);
  const group = new THREE.Group();
  group.name = "cloid_eye";
  group.visible = false;
  const doll = dollFrom(o.model ?? null);
  const { cone, mat } = viewCone();
  group.add(doll, cone);
  /** 마지막으로 받은 눈. */
  let shown: Pose | null = null;
  /** 지금 그린 발 자리와 앞으로 걸을 길. */
  let feet: Plan2 | null = null;
  let trail: Plan2[] = [];
  let tickAt: number | null = null;

  const poseOf = (eye: EyeEvent | null): Pose | null => {
    if (!eye || eye.estimated || !Array.isArray(eye.position)) return null;
    const [x, y] = eye.position;
    const { height_m: h, yaw_deg: yaw, pitch_deg: pitch } = eye;
    if (![x, y, h, yaw, pitch].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
    return { x, y, h, yaw, pitch, limited: eye.tracking === "limited" };
  };
  const place = (p: Plan2) => {
    feet = p;
    doll.position.set(p[0], floorAt(p), p[1]);
    if (shown) cone.position.set(p[0], shown.h, p[1]);
  };

  return {
    group,
    at: () => (feet ? [feet[0], feet[1]] : null),
    setEye(eye) {
      const p = poseOf(eye);
      if (!p) {
        if (!group.visible) return false;
        group.visible = false;
        shown = null;
        feet = null;
        trail = [];
        tickAt = null;
        return true;
      }
      if (shown && still(shown, p)) return false;
      shown = p;
      const a = rad(p.yaw), b = rad(p.pitch);
      doll.rotation.set(0, -a, 0);
      cone.quaternion.setFromUnitVectors(X_AXIS, new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)));
      mat.color.set(p.limited ? viz.cone.limited : viz.cone.ok);
      const goal: Plan2 = o.guide ? o.guide.stand([p.x, p.y]) : [p.x, p.y];
      const way = feet && o.guide ? o.guide.path(feet, goal) : null;
      const far = way ? way.slice(1).reduce((sum, q, i) => sum + gap(way[i]!, q), 0) : Infinity;
      if (!feet || !way || far > JUMP_M) {
        trail = [];
        tickAt = null;
        place(goal);
      } else {
        trail = way.slice(1);
        place(feet);
      }
      group.visible = true;
      return true;
    },
    tick(now) {
      if (!feet || !trail.length) { tickAt = null; return false; }
      const dt = tickAt === null ? 0 : Math.min(STEP_MAX_S, Math.max(0, (now - tickAt) / 1000));
      tickAt = now;
      let at: Plan2 = feet;
      const left = trail.reduce((sum, q, i) => sum + gap(i ? trail[i - 1]! : at, q), 0);
      let go = Math.max(WALK_MPS, left / CATCH_UP_S) * dt;
      while (trail.length && go > 0) {
        const next = trail[0]!;
        const d = gap(at, next);
        if (d <= go) { at = next; go -= d; trail.shift(); continue; }
        at = [at[0] + ((next[0] - at[0]) / d) * go, at[1] + ((next[1] - at[1]) / d) * go];
        go = 0;
      }
      place(at);
      if (!trail.length) tickAt = null;
      return trail.length > 0;
    },
  };
}
