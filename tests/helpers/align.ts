// 시험용 위치 맞춤: 폰이 시작 위치에 서서 「여기서 시작」을 하고, 그 자리에서 보이는 벽 점·바닥 점을 한 번에 보내면(앱의 surface 메시지)
// 위치 맞춤 모듈이 바로 맞춤이 된다. 실제 폰이 보내는 메시지와 같은 길로 간다(src/phone/session.ts).
import type { Vec3 } from "../../src/phone/align.js";
import { readScenePlan, type HomePlan } from "../../src/phone/home-plan.js";
import { applyRigid, IDENTITY, invertRigid, rotateVec, type P2, type Rigid } from "../../src/sync/rigid.js";
import type { StartPose } from "../../src/sync/start.js";
import { wallSegments, type WallSeg } from "../../src/sync/walls.js";
import { look } from "./sync-sim.js";

/** 6×5 네모 방 하나(벽 두께 0.2, 중심선이 방 다각형 변). */
export const BOX_PLAN: HomePlan = {
  rooms: [{ id: "r", label: "거실", polygon: [[0, 0], [6, 0], [6, 5], [0, 5]] }],
  walls: [
    { id: "s", thickness: 0.2, a: [0, 0], b: [6, 0], faces: [{ room: "r", normal: [0, 1] }] },
    { id: "e", thickness: 0.2, a: [6, 0], b: [6, 5], faces: [{ room: "r", normal: [-1, 0] }] },
    { id: "n", thickness: 0.2, a: [6, 5], b: [0, 5], faces: [{ room: "r", normal: [0, -1] }] },
    { id: "w", thickness: 0.2, a: [0, 5], b: [0, 0], faces: [{ room: "r", normal: [1, 0] }] },
  ],
};
export const BOX_WALLS = wallSegments(BOX_PLAN);
export const BOX_START: StartPose = { position: [3, 2.5], yawDeg: 0, label: "거실 시작 위치", facingLabel: "" };

export interface AlignOptions {
  /** AR → 트윈 정답 변환(기본 그대로: AR [x, z] = 평면 [x, y]). */
  truth?: Rigid;
  /** 트윈 높이 0의 AR y(기본 0). */
  floorY?: number;
  /** 폰 높이(바닥 위 m, 기본 1.45). */
  eyeM?: number;
  epoch?: string;
}

/** 「여기서 시작」 순간의 폰 자세(AR): 시작 자리에서 시작 방향을 수평으로 본다. */
export function startPoseAr(start: StartPose, o: AlignOptions = {}): { position: Vec3; orientation: [number, number, number, number] } {
  const T = o.truth ?? IDENTITY;
  const at = applyRigid(invertRigid(T), start.position);
  return { position: [at[0], (o.floorY ?? 0) + (o.eyeM ?? 1.45), at[1]], orientation: look((start.yawDeg * Math.PI) / 180 - T.theta, 0) };
}

/** start 메시지와, 시작 자리에서 4.5m 안에 보이는 벽 면 점(15cm마다)·둘레 바닥 점을 담은 surface 메시지들(256점씩). */
export function alignMessages(walls: readonly WallSeg[], start: StartPose, o: AlignOptions = {}): Record<string, unknown>[] {
  const T = o.truth ?? IDENTITY;
  const back = invertRigid(T);
  const floorY = o.floorY ?? 0;
  const pose = startPoseAr(start, o);
  const cam = start.position;
  const wallPts: number[][] = [];
  for (const s of walls) {
    if ((cam[0] - s.a[0]) * s.n[0] + (cam[1] - s.a[1]) * s.n[1] <= 0) continue;
    const n = rotateVec(-T.theta, s.n);
    for (let d = 0.05; d < s.len; d += 0.15) {
      const p: P2 = [s.a[0] + s.t[0] * d, s.a[1] + s.t[1] * d];
      if (Math.hypot(p[0] - cam[0], p[1] - cam[1]) > 4.5) continue;
      const ar = applyRigid(back, p);
      wallPts.push([ar[0], floorY + 1, ar[1], n[0], 0, n[1]]);
    }
  }
  const floorPts = Array.from({ length: 12 }, (_, k) => {
    const a = (k / 12) * 2 * Math.PI;
    const ar = applyRigid(back, [cam[0] + Math.cos(a), cam[1] + Math.sin(a)]);
    return [ar[0], floorY, ar[1], 0, 1, 0];
  });
  const all = [...wallPts, ...floorPts];
  const epoch = o.epoch ? { epoch: o.epoch } : {};
  const out: Record<string, unknown>[] = [{ type: "start", ...pose, ...epoch }];
  for (let i = 0; i < all.length; i += 256) out.push({ type: "surface", camera: pose.position, points: all.slice(i, i + 256), ...epoch });
  return out;
}

/** 실행 중인 서버(startServer)에서: 시작 위치를 설정 REST로 저장하고, 폰 소켓으로 「여기서 시작」과 그 자리의 벽·바닥 점을 보낸다.
 *  정답 변환은 그대로(AR [x, z] = 평면 [x, y]), 바닥 높이 0. 폰 상태가 맞춤(aligned)이 될 때까지는 부른 쪽이 기다린다. */
export async function alignOnServer(base: string, send: (text: string) => void, scenePath: string, position: P2, yawDeg = 0): Promise<void> {
  const res = await fetch(`${base}/api/phone/start-pose`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ position, yaw_deg: yawDeg }),
  });
  if (!res.ok) throw new Error(`시작 위치를 저장하지 못했습니다: ${res.status} ${await res.text()}`);
  const walls = wallSegments(readScenePlan(scenePath));
  for (const m of alignMessages(walls, { position, yawDeg, label: "", facingLabel: "" })) send(JSON.stringify(m));
}
