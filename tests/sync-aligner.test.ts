// 맞춤 모듈(src/sync/aligner.ts): 시작 위치(바로, 어림) → 물건 기준점·벽 모양(걸으면서 맞춤). 6×5 가짜 방 하나로 본다.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HomePlan } from "../src/phone/corners.js";
import { SyncAligner } from "../src/sync/aligner.js";
import type { TwinLandmark } from "../src/sync/landmarks.js";
import { applyRigid, invertRigid, rigidGap, type P2, type Rigid } from "../src/sync/rigid.js";
import {
  StartPoseError, StartStore, describeStart, parseStartPose, readStartPose, startPosePath, startRigid, type StartPose,
} from "../src/sync/start.js";
import { wallSegments } from "../src/sync/walls.js";
import { SimHome, type SimPose } from "./helpers/sync-sim.js";

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
const L = (cls: TwinLandmark["cls"], id: string, center: P2, footprint: [number, number], facingDeg: number, unique: boolean): TwinLandmark =>
  ({ cls, id, label: id, center, footprint, facingDeg, baseM: 0, unique });
const MARKS: TwinLandmark[] = [
  L("refrigerator", "fridge", [0.6, 4.4], [0.9, 0.75], 0, true),
  L("couch", "sofa", [3, 0.6], [2, 0.9], 90, true),
  L("dining table", "table", [4.6, 3.4], [1.4, 0.8], 0, true),
  L("bed", "bed1", [5.2, 1.2], [1.1, 2], 180, false),
];
const TRUTH: Rigid = { theta: deg(-63), tx: 1.7, ty: 2.9 };
const START: StartPose = { position: [2.5, 2.5], yawDeg: 0, label: "거실 가운데", facingLabel: "식탁" };
/** AR 쪽에서 잰 오차: 걸은 곳(방 안 점)들의 트윈 자리 차이. */
const errAt = (T: Rigid) => rigidGap(T, TRUTH, ([[1, 1], [5, 1], [5, 4], [1, 4], [3, 2.5]] as P2[]).map((p) => applyRigid(invertRigid(TRUTH), p)));

function clock() {
  let t = 0;
  return { now: () => t, tick: (ms: number) => { t += ms; } };
}

/** 방 안을 한 바퀴 돌며 둘러본다: 자세마다 hit 점, 2초마다 엔진 프레임 상자. */
function walk(sim: SimHome, al: SyncAligner, c: ReturnType<typeof clock>, opts: { walls?: boolean; objects?: boolean; steps?: number; after?: (pose: SimPose) => void } = {}) {
  const path: P2[] = [[2.5, 2.5], [4.5, 1.8], [4.8, 3.8], [1.5, 3.8], [1.2, 1.5], [2.5, 2.5]];
  const steps = opts.steps ?? 600;
  for (let i = 0; i < steps; i++) {
    const s = (i / steps) * (path.length - 1);
    const k = Math.min(path.length - 2, Math.floor(s)), f = s - k;
    const a = path[k]!, b = path[k + 1]!;
    const at: P2 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    const heading = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.sin(i / 9) * 1.3;
    const pose: SimPose = sim.pose(at, heading, deg(-25 + 12 * Math.sin(i / 13)));
    c.tick(100);
    const hit = opts.walls === false ? null : sim.centerHit(pose);
    al.addPose({ ...pose, hit: hit?.hit ?? null, hitNormal: hit?.normal ?? null, hitEstimated: false });
    if (opts.objects !== false && i % 20 === 0) {
      const d = sim.detections(pose);
      al.addLandmarks({ ...pose, projection: d.projection }, d, d.boxes);
    }
    opts.after?.(pose);
  }
}

/** 시작 자리에서 dx·dy·dθ만큼 틀리게 서서 「여기서 시작」. */
function startOff(sim: SimHome, al: SyncAligner, dx: number, dy: number, dDeg: number) {
  const p = sim.pose([START.position[0] + dx, START.position[1] + dy], deg(START.yawDeg + dDeg), deg(-10));
  al.confirmStart(START, p.position, p.orientation);
}

describe("시작 위치", () => {
  const dirs: string[] = [];
  afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

  it("그 자리에 그 방향으로 서서 누르면 변환이 바로 정해지고 어림이다", () => {
    const sim = new SimHome({ truth: TRUTH, floorY: -1.4, walls: WALLS });
    const al = new SyncAligner({ landmarks: MARKS, walls: WALLS });
    expect(al.state()).toMatchObject({ rigid: null, aligned: false, source: null, started: false });
    startOff(sim, al, 0, 0, 0);
    const s = al.state();
    expect(s).toMatchObject({ aligned: false, source: "start", started: true });
    expect(errAt(s.rigid!).shiftM).toBeLessThan(1e-6);
    // 바닥 점이 없으면 폰 높이 − 1.5m로 어림
    expect(s.floorY).toBeCloseTo(-1.4 + 1.45 - 1.5, 6);
  });

  it("폰이 바닥을 내려다봐도 폰 윗쪽을 앞으로 본다", () => {
    const sim = new SimHome({ truth: TRUTH, floorY: -1.4, walls: WALLS });
    const p = sim.pose(START.position, deg(START.yawDeg), deg(-89.5));
    expect(errAt(startRigid(START, p.position, p.orientation)).rotDeg).toBeLessThan(0.1);
  });

  it("저장 검사: 집 범위, 방향 0~360, 이름 40자. 이름이 없으면 가까운 물건·보는 물건으로 채운다", () => {
    const bounds = { minX: -0.3, minY: -0.3, maxX: 6.3, maxY: 5.3 };
    const describe = () => ({ label: "소파 앞", facingLabel: "식탁" });
    expect(parseStartPose({ position: [2, 2], yaw_deg: -90 }, bounds, describe)).toEqual({ position: [2, 2], yawDeg: 270, label: "소파 앞", facingLabel: "식탁" });
    expect(parseStartPose({ position: [2, 2], yaw_deg: 10, label: " 현관 ", facing_label: "" }, bounds, describe)).toMatchObject({ label: "현관", facingLabel: "식탁" });
    expect(() => parseStartPose({ position: [20, 2], yaw_deg: 0 }, bounds, describe)).toThrow(StartPoseError);
    expect(() => parseStartPose({ position: [2, 2] }, bounds, describe)).toThrow(/방향/);
    expect(() => parseStartPose({ position: [2, 2], yaw_deg: 0, label: "가".repeat(41) }, bounds, describe)).toThrow(/40자/);
  });

  it("이름 채우기: 1.5m 안 가장 가까운 물건 「… 앞」, 보는 방향 15° 안 가장 가까운 물건", () => {
    const objects = [
      { id: "sofa", name: "거실 소파", type: "sofa", category: "furniture", mount: "floor", plan: { position: [3, 0.6] } },
      { id: "table", name: "거실 식탁", type: "dining_table", category: "furniture", mount: "floor", plan: { position: [5.5, 1.3] } },
      { id: "door", name: "문", type: "mk_door", category: "fixtures", mount: "opening", plan: { position: [6, 1] } },
    ];
    const rooms = PLAN.rooms;
    expect(describeStart(objects, rooms, [3, 1.5], 0)).toEqual({ label: "거실 소파 앞", facingLabel: "거실 식탁" });
    expect(describeStart(objects, rooms, [2, 4], 90)).toEqual({ label: "거실 시작 위치", facingLabel: "" });
  });

  it("파일: runtime/homes/<집>/phone-start.json에 저장·읽기·지우기, 바뀌면 알린다", () => {
    const dir = mkdtempSync(join(tmpdir(), "start-"));
    dirs.push(dir);
    const path = startPosePath(dir, "mokryeon_180b");
    expect(path).toBe(join(dir, "homes", "mokryeon_180b", "phone-start.json"));
    expect(readStartPose(path)).toBeNull();
    const seen: (StartPose | null)[] = [];
    const store = new StartStore(path, null, () => ({ label: "가운데", facingLabel: "" }), (s) => seen.push(s));
    const saved = store.save({ position: [1, 2], yaw_deg: 45 });
    expect(readStartPose(path)).toEqual(saved);
    store.clear();
    expect(readStartPose(path)).toBeNull();
    expect(seen).toEqual([saved, null]);
  });
});

describe("물건 기준점", () => {
  it("0.3m·8° 틀린 시작에서 걸으며 물건을 보면 맞춤이 되고 오차가 준다", () => {
    const c = clock();
    const sim = new SimHome({ truth: TRUTH, floorY: -1.4, walls: WALLS, landmarks: MARKS, seed: 4 });
    const al = new SyncAligner({ landmarks: MARKS, walls: WALLS, now: c.now });
    startOff(sim, al, 0.3, -0.1, 8);
    const before = errAt(al.state().rigid!);
    walk(sim, al, c, { walls: false });
    const s = al.state();
    expect(s.aligned).toBe(true);
    expect(s.source).toBe("objects");
    expect(s.anchors).toBeGreaterThanOrEqual(3);
    // 짝지은 트윈 물건 id(하나뿐인 냉장고·소파와 여럿 중 하나인 침대도 가장 가까운 것으로)
    expect(s.anchorIds).toHaveLength(s.anchors);
    expect(s.anchorIds.every((id) => MARKS.some((m) => m.id === id))).toBe(true);
    expect(s.residualM).toBeLessThan(0.35);
    const after = errAt(s.rigid!);
    expect(after.shiftM).toBeLessThan(Math.min(0.15, before.shiftM));
    expect(after.rotDeg).toBeLessThan(2);
  });

  it("시작 위치 없이도 집에 하나뿐인 물건 셋이면 맞춘다", () => {
    const c = clock();
    const sim = new SimHome({ truth: TRUTH, floorY: -1.4, walls: WALLS, landmarks: MARKS, seed: 5 });
    const al = new SyncAligner({ landmarks: MARKS, walls: WALLS, now: c.now });
    walk(sim, al, c, { walls: false });
    const s = al.state();
    expect(s.rigid).not.toBeNull();
    expect(errAt(s.rigid!).shiftM).toBeLessThan(0.2);
    expect(s.aligned).toBe(true);
  });
});

describe("벽 모양", () => {
  it("0.5m·15° 틀린 시작에서 벽만으로 5cm·1° 안으로 맞춘다", () => {
    const c = clock();
    const sim = new SimHome({ truth: TRUTH, floorY: -1.4, walls: WALLS, seed: 6 });
    const al = new SyncAligner({ landmarks: MARKS, walls: WALLS, now: c.now });
    startOff(sim, al, -0.35, 0.35, -15);
    walk(sim, al, c, { objects: false });
    const s = al.state();
    expect(s).toMatchObject({ aligned: true, source: "walls", twoD: true });
    expect(s.wallPoints).toBeGreaterThanOrEqual(40);
    expect(s.wallRmsM).toBeLessThan(0.06);
    const e = errAt(s.rigid!);
    expect(e.shiftM).toBeLessThan(0.05);
    expect(e.rotDeg).toBeLessThan(1);
    // 바닥 hit이 있으면 바닥 높이를 잰다
    expect(s.floorY).toBeCloseTo(-1.4, 1);
  });

  it("점이 몇 개뿐이면 바꾸지 않는다", () => {
    const c = clock();
    const sim = new SimHome({ truth: TRUTH, floorY: -1.4, walls: WALLS, seed: 7, hitDropout: 0 });
    const al = new SyncAligner({ landmarks: MARKS, walls: WALLS, now: c.now });
    startOff(sim, al, 0.3, 0, 6);
    const was = al.state().rigid!;
    for (let i = 0; i < 6; i++) {
      c.tick(600);
      const pose = sim.pose([2.5, 2.5], deg(i * 60), deg(-5));
      const hit = sim.centerHit(pose);
      al.addPose({ ...pose, hit: hit?.hit ?? null, hitNormal: hit?.normal ?? null });
    }
    expect(al.state().rigid).toEqual(was);
    expect(al.state().aligned).toBe(false);
  });

  it("맞춘 뒤 AR이 0.4m 밀리면 한 번에 0.3m까지만 옮기며 따라간다", () => {
    const c = clock();
    const sim = new SimHome({ truth: TRUTH, floorY: -1.4, walls: WALLS, seed: 8 });
    const al = new SyncAligner({ landmarks: MARKS, walls: WALLS, now: c.now });
    startOff(sim, al, 0, 0, 0);
    walk(sim, al, c, { objects: false, steps: 300 });
    expect(al.state().aligned).toBe(true);
    // 추적이 밀림: 같은 AR 점이 트윈에서 0.4m 옆이 된다
    const drifted: Rigid = { ...TRUTH, tx: TRUTH.tx + 0.4 };
    const sim2 = new SimHome({ truth: drifted, floorY: -1.4, walls: WALLS, seed: 9 });
    // 고칠 때마다 폰 자리에서 잰 움직임
    let prev = al.state().rigid!;
    let maxStep = 0;
    const after = (pose: SimPose) => {
      const now = al.state().rigid!;
      maxStep = Math.max(maxStep, rigidGap(prev, now, [[pose.position[0], pose.position[2]]]).shiftM);
      prev = now;
    };
    for (let k = 0; k < 8; k++) walk(sim2, al, c, { objects: false, steps: 60, after });
    expect(maxStep).toBeLessThanOrEqual(0.3 + 1e-6);
    expect(maxStep).toBeGreaterThan(0.05);
    expect(rigidGap(al.state().rigid!, drifted, [[0, 0]]).shiftM).toBeLessThan(0.06);
  });
});

describe("지우기·A·B 기록", () => {
  it("reset은 변환·증거·시작을 모두 지운다", () => {
    const sim = new SimHome({ truth: TRUTH, floorY: -1.4, walls: WALLS });
    const al = new SyncAligner({ landmarks: MARKS, walls: WALLS });
    startOff(sim, al, 0, 0, 0);
    al.reset();
    expect(al.state()).toMatchObject({ rigid: null, aligned: false, started: false, source: null, wallPoints: 0, anchors: 0 });
  });

  it("A·B로 맞춘 변환을 넣으면 맞춤이다", () => {
    const al = new SyncAligner({ landmarks: MARKS, walls: WALLS });
    al.seed({ ...TRUTH, floorY: -1.4 }, "touch", 0.04);
    expect(al.state()).toMatchObject({ aligned: true, source: "touch", residualM: 0.04, floorY: -1.4 });
  });
});
