// 폰 세션 + 위치 맞춤 모듈: 「여기서 시작」이면 어림(estimated) 눈, 벽·물건이 기준을 넘으면 맞춤. 앱도 같은 메시지(start·pose·surface·landmarks)를 보낸다.
import { describe, expect, it } from "vitest";
import type { HomePlan } from "../src/phone/home-plan.js";
import { PhoneSession, type PhoneStatus } from "../src/phone/session.js";
import type { TwinLandmark } from "../src/phone/sync/landmarks.js";
import { applyRigid, invertRigid, rigidGap, type P2, type Rigid } from "../src/phone/sync/rigid.js";
import type { StartPose } from "../src/phone/sync/start.js";
import { wallSegments } from "../src/phone/sync/walls.js";
import { SimHome } from "./helpers/sync-sim.js";

const deg = (d: number) => (d * Math.PI) / 180;
const PLAN: HomePlan = {
  rooms: [{ id: "r", label: "거실", polygon: [[0, 0], [6, 0], [6, 5], [0, 5]] }],
  walls: [
    { id: "s", thickness: 0.2, a: [0, 0], b: [6, 0], faces: [{ room: "r", normal: [0, 1] }] },
    { id: "e", thickness: 0.2, a: [6, 0], b: [6, 5], faces: [{ room: "r", normal: [-1, 0] }] },
    { id: "n", thickness: 0.2, a: [6, 5], b: [0, 5], faces: [{ room: "r", normal: [0, -1] }] },
    { id: "w", thickness: 0.2, a: [0, 5], b: [0, 0], faces: [{ room: "r", normal: [1, 0] }] },
  ],
};
const WALLS = wallSegments(PLAN);
const MARKS: TwinLandmark[] = [
  { cls: "refrigerator", id: "fridge", label: "냉장고", center: [0.6, 4.4], footprint: [0.9, 0.75], facingDeg: 0, baseM: 0, unique: true },
  { cls: "couch", id: "sofa", label: "소파", center: [3, 0.6], footprint: [2, 0.9], facingDeg: 90, baseM: 0, unique: true },
  { cls: "dining_table", id: "table", label: "식탁", center: [4.6, 3.4], footprint: [1.4, 0.8], facingDeg: 0, baseM: 0, unique: true },
];
const TRUTH: Rigid = { theta: deg(40), tx: 2, ty: 1 };
const START: StartPose = { position: [2.5, 2.5], yawDeg: 0, label: "거실 가운데", facingLabel: "식탁" };
const FALLBACK = { position: [1, 1] as P2, yawDeg: 90, heightM: 1.3 };

function setup(start: StartPose | null = START) {
  let t = 0;
  const s = new PhoneSession({
    now: () => new Date(Date.UTC(2026, 10, 10) + t), fallback: FALLBACK, sync: { landmarks: MARKS, walls: WALLS, start },
  });
  const sim = new SimHome({ truth: TRUTH, floorY: -1.4, walls: WALLS, landmarks: MARKS, seed: 3 });
  return { s, sim, tick: (ms: number) => { t += ms; } };
}
const syncOf = (r: { reply?: PhoneStatus }) => r.reply?.sync;

/** 방을 돌며 자세(+실제 hit 점·법선)를 보낸다. changed가 한 번이라도 오면 true. */
function walkRoom(env: ReturnType<typeof setup>, steps = 500, epoch = "e1"): boolean {
  let changed = false;
  const path: P2[] = [[2.5, 2.5], [4.5, 1.8], [4.8, 3.8], [1.5, 3.8], [1.2, 1.5], [2.5, 2.5]];
  for (let i = 0; i < steps; i++) {
    const u = (i / steps) * (path.length - 1);
    const k = Math.min(path.length - 2, Math.floor(u)), f = u - k;
    const a = path[k]!, b = path[k + 1]!;
    const pose = env.sim.pose([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.sin(i / 9) * 1.3, deg(-25));
    env.tick(100);
    const hit = env.sim.centerHit(pose);
    const out = env.s.handle({ type: "pose", position: pose.position, orientation: pose.orientation, hit: hit?.hit ?? null, hit_normal: hit?.normal, hit_estimated: false, epoch });
    changed ||= out.changed === true;
  }
  return changed;
}

describe("폰 세션 위치 맞춤", () => {
  it("상태에 맞춤 상태·시작 위치 이름이 실린다. 맞추기 전에는 창가 추정 눈", () => {
    const env = setup();
    expect(env.s.status().sync).toEqual({ state: "none", source: null, start: { label: "거실 가운데", facing: "식탁" }, started: false, anchors: 0, wall_points: 0, residual_m: null });
    const p = env.sim.pose([2.5, 2.5], 0, deg(-10));
    const out = env.s.handle({ type: "pose", position: p.position, orientation: p.orientation, epoch: "e1" });
    expect(out.eye).toMatchObject({ position: [1, 1], estimated: true });
  });

  it("「여기서 시작」: 그 자세로 바로 어림 변환. 눈은 시작 자리에 estimated, 사진·카메라·고리·「여기」에는 쓰지 않는다", () => {
    const env = setup();
    const p = env.sim.pose(START.position, 0, deg(-10));
    const out = env.s.handle({ type: "start", position: p.position, orientation: p.orientation, epoch: "e1" });
    expect(syncOf(out)).toMatchObject({ state: "estimated", source: "start", started: true });
    expect(out.reply!.aligned).toBe(false);
    const eye = env.s.handle({ type: "pose", position: p.position, orientation: p.orientation, epoch: "e1" }).eye!;
    expect(eye.estimated).toBe(true);
    expect(eye.position[0]).toBeCloseTo(2.5, 3);
    expect(eye.position[1]).toBeCloseTo(2.5, 3);
    expect(eye.yaw_deg).toBeCloseTo(0, 0);
    expect(env.s.eyeAt(p.position, p.orientation, "ok", "e1")).toBeNull();
    expect(env.s.viewAt(p.position, p.orientation, new Array(16).fill(1), "e1")).toBeNull();
    expect(env.s.toAr([1, 0, 1])).toBeNull();
    expect(env.s.here()).toMatchObject({ error: expect.stringContaining("맞추는 중") });
  });

  it("걸으며 벽 hit을 보내면 맞춤이 되고(바뀜 알림), 눈·사진 위치가 실제 자리다", () => {
    const env = setup();
    const p = env.sim.pose([START.position[0] + 0.3, START.position[1] - 0.2], deg(8), deg(-10));
    env.s.handle({ type: "start", position: p.position, orientation: p.orientation, epoch: "e1" });
    expect(walkRoom(env)).toBe(true);
    const st = env.s.status();
    expect(st.aligned).toBe(true);
    expect(st.sync).toMatchObject({ state: "aligned", source: "walls" });
    expect(st.sync!.wall_points).toBeGreaterThanOrEqual(40);
    expect(st.sync!.residual_m).toBeLessThan(0.06);
    const q = env.sim.pose([3, 2], 0, deg(-10));
    const eye = env.s.eyeAt(q.position, q.orientation, "ok", "e1")!;
    expect(eye.estimated).toBeUndefined();
    expect(Math.hypot(eye.position[0] - 3, eye.position[1] - 2)).toBeLessThan(0.05);
    // 사람 눈높이: 실제 바닥 hit으로 잰 바닥 위 1.45m
    expect(eye.height_m).toBeCloseTo(1.45, 1);
    expect(env.s.toAr([3, 0, 2])).not.toBeNull();
  });

  it("앱이 보내는 surface·landmarks 메시지도 같은 모듈로 간다", () => {
    const env = setup();
    const p = env.sim.pose(START.position, 0, deg(-10));
    env.s.handle({ type: "start", position: p.position, orientation: p.orientation, epoch: "e1" });
    for (let i = 0; i < 40; i++) {
      env.tick(600);
      const pose = env.sim.pose([1 + (i % 8) * 0.6, 1.5 + (i % 3)], deg(i * 37), deg(-20));
      const pts = Array.from({ length: 8 }, (_, k) => env.sim.centerHit(env.sim.pose([1 + (i % 8) * 0.6, 1.5 + (i % 3)], deg(i * 37 + k * 45), deg(-15))))
        .flatMap((h) => (h ? [[...h.hit, ...h.normal]] : []));
      env.s.handle({ type: "surface", epoch: "e1", camera: pose.position, points: pts });
      const d = env.sim.detections(pose);
      env.s.handle({ type: "landmarks", epoch: "e1", position: pose.position, orientation: pose.orientation, projection: d.projection, width: d.width, height: d.height, boxes: d.boxes });
    }
    expect(env.s.status().sync!.state).toBe("aligned");
    expect(rigidGap(env.s.syncState()!.rigid!, TRUTH, [applyRigid(invertRigid(TRUTH), [3, 2.5])]).shiftM).toBeLessThan(0.05);
  });

  it("엔진 프레임 YOLO 기준점 상자(COCO 번호)는 그 프레임의 원점이 지금 원점일 때만 받는다", () => {
    const env = setup();
    const p = env.sim.pose(START.position, 0, deg(-10));
    env.s.handle({ type: "start", position: p.position, orientation: p.orientation, epoch: "e1" });
    const cam = env.sim.pose([2.5, 2.5], deg(20), deg(-25));
    const d = env.sim.detections(cam);
    expect(d.boxes.length).toBeGreaterThan(0);
    const boxes = d.boxes.map((b) => ({ cls: b.label === "couch" ? 57 : b.label === "refrigerator" ? 72 : 60, score: b.score, box: b.box }));
    const header = { kind: "engine" as const, width: d.width, height: d.height, position: cam.position, orientation: cam.orientation, projection: d.projection };
    env.s.landmarks({ ...header, epoch: "old" }, boxes);
    expect(env.s.syncState()!.observed.landmarks).toBe(0);
    expect(env.s.landmarks({ ...header, epoch: "e1" }, boxes)).toBe(false); // 관찰 하나로는 바뀌지 않는다
    expect(env.s.syncState()!.observed.landmarks).toBe(boxes.length);
  });

  it("시작 위치가 없으면 「여기서 시작」은 오류, 설정에서 저장하면 상태에 이름이 생긴다", () => {
    const env = setup(null);
    const p = env.sim.pose(START.position, 0, deg(-10));
    const out = env.s.handle({ type: "start", position: p.position, orientation: p.orientation, epoch: "e1" });
    expect(out.reply!.error).toContain("시작 위치");
    expect(syncOf(out)!.state).toBe("none");
    env.s.setStart(START);
    expect(env.s.status().sync!.start).toEqual({ label: "거실 가운데", facing: "식탁" });
  });

  it("맞춘 뒤 새 AR 원점이면 모두 지운다(시작부터 다시)", () => {
    const env = setup();
    const p = env.sim.pose(START.position, 0, deg(-10));
    env.s.handle({ type: "start", position: p.position, orientation: p.orientation, epoch: "e1" });
    walkRoom(env);
    expect(env.s.status().sync.state).toBe("aligned");
    const reset = env.s.handle({ type: "pose", position: p.position, orientation: p.orientation, epoch: "e2" });
    expect(reset.reply).toMatchObject({ aligned: false, sync: { state: "none", started: false } });
  });
});
