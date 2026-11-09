// 걷기 모의: 목련 트윈(벽·가구·물건)에서 정답 변환을 알고 자세·hit 점·YOLO 기준점 상자를 만든다.
// 잡음(hit 1.5cm, 상자 3px), hit-test가 빠지는 몫 30%, 가구가 벽을 가림(가구 옆면 hit은 이상치), 복도(옆 벽만 보임)를 본다.
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/layout/catalog.js";
import { readScenePlan } from "../src/phone/home-plan.js";
import { loadScene } from "../src/model/scene.js";
import type { SceneObject } from "../src/contract/layout.js";
import { SyncAligner } from "../src/sync/aligner.js";
import { twinLandmarks } from "../src/sync/landmarks.js";
import { applyRigid, invertRigid, rigidGap, rotateVec, type P2, type Rigid } from "../src/sync/rigid.js";
import type { StartPose } from "../src/sync/start.js";
import { wallSegments } from "../src/sync/walls.js";
import { SimHome, type SimBox, type SimPose } from "./helpers/sync-sim.js";

const deg = (d: number) => (d * Math.PI) / 180;
const scene = loadScene({ scenePath: "twin/homes/mokryeon_180b/scene.json", dataDir: "twin/data/homes/mokryeon_180b" })!;
const OBJECTS = scene.objects as SceneObject[];
const catalog = loadCatalog("twin/data/catalog");
const plan = readScenePlan("twin/homes/mokryeon_180b/scene.json");
const WALLS = wallSegments(plan);
const MARKS = twinLandmarks(OBJECTS, catalog);
/** 바닥에 놓인 가구·가전: 화면 가운데 광선이 먼저 닿으면 벽을 가린다. */
const BOXES: SimBox[] = OBJECTS.flatMap((o) => {
  if (!["furniture", "appliances", "fixtures"].includes(o.category) || o.mount !== "floor") return [];
  const info = catalog.get(o.type.replace(/_\d+$/, ""));
  const fp = (o.footprint ?? info?.footprint) as [number, number] | undefined;
  const h = o.height ?? info?.height;
  return fp && h ? [{ center: [o.plan.position[0]!, o.plan.position[1]!] as P2, footprint: fp, facingDeg: o.plan.facing_deg ?? 0, height: h }] : [];
});
const TRUTH: Rigid = { theta: deg(71), tx: 5.2, ty: 8.1 };
const FLOOR_Y = -1.43;

function clock() {
  let t = 0;
  return { now: () => t, tick: (ms: number) => { t += ms; } };
}

/** 거실 → 식탁 → 복도 → 거실. 걷는 방향 ±70°로 둘러보고 25° 아래를 본다. 2초마다 엔진 프레임. */
const LOOP: P2[] = [[8.3, 10.6], [10.4, 10.8], [10.3, 8.4], [10.2, 6.4], [10.1, 4.6], [9.6, 3.0], [10.4, 4.8], [10.3, 6.9], [7.8, 6.9], [5.6, 6.9], [7.8, 6.95], [8.0, 7.3], [8.05, 9.5], [8.3, 10.6]];
const START: StartPose = { position: [8.3, 10.6], yawDeg: 0, label: "거실·복도 소파 앞", facingLabel: "거실·복도 TV수납장" };

interface WalkOpts { path: P2[]; steps: number; hits?: boolean; objects?: boolean; sweep?: number; heading?: (i: number, dir: number) => number; keepHit?: (normal: [number, number, number]) => boolean }

function walk(sim: SimHome, al: SyncAligner, c: ReturnType<typeof clock>, o: WalkOpts, after?: (pose: SimPose) => void) {
  for (let i = 0; i < o.steps; i++) {
    const s = (i / o.steps) * (o.path.length - 1);
    const k = Math.min(o.path.length - 2, Math.floor(s)), f = s - k;
    const a = o.path[k]!, b = o.path[k + 1]!;
    const at: P2 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const heading = o.heading ? o.heading(i, dir) : dir + Math.sin(i / 11) * (o.sweep ?? deg(70));
    const pose = sim.pose(at, heading, deg(-25 + 15 * Math.sin(i / 17)));
    c.tick(100);
    const hit = o.hits === false ? null : sim.centerHit(pose);
    // 복도: 옆 벽 hit만 남긴다(트윈 법선이 ±y)
    const keep = hit && (!o.keepHit || o.keepHit(twinNormal(hit.normal)));
    al.addPose({ ...pose, hit: keep ? hit!.hit : null, hitNormal: keep ? hit!.normal : null, hitEstimated: false });
    if (o.objects !== false && i % 20 === 0) {
      const d = sim.detections(pose);
      al.addLandmarks({ ...pose, projection: d.projection }, d, d.boxes);
    }
    after?.(pose);
  }
}
const twinNormal = (n: [number, number, number]): [number, number, number] => {
  const h = rotateVec(TRUTH.theta, [n[0], n[2]]);
  return [h[0], n[1], h[1]];
};

/** 오차: 걸은 곳의 트윈 자리 차이(가장 큰 값)와 회전. */
const errAt = (T: Rigid, where: P2[] = LOOP) => rigidGap(T, TRUTH, where.map((p) => applyRigid(invertRigid(TRUTH), p)));

function aligner(c: ReturnType<typeof clock>) {
  return new SyncAligner({ landmarks: MARKS, walls: WALLS, now: c.now });
}
function startOff(sim: SimHome, al: SyncAligner, dx: number, dy: number, dDeg: number) {
  const p = sim.pose([START.position[0] + dx, START.position[1] + dy], deg(START.yawDeg + dDeg), deg(-10));
  al.confirmStart(START, p.position, p.orientation);
}

describe("목련 걷기 모의", () => {
  it.each([
    [0.35, -0.35, 15],
    [-0.4, 0.3, -15],
    [0.5, 0, 10],
    [0, -0.5, -12],
  ])("시작이 (%s, %s)m·%s° 틀려도 한 바퀴 걸으면 10cm·2° 안으로 맞춘다", (dx, dy, dDeg) => {
    const c = clock();
    const sim = new SimHome({ truth: TRUTH, floorY: FLOOR_Y, walls: WALLS, boxes: BOXES, landmarks: MARKS, seed: 11 + dx * 10 + dDeg });
    const al = aligner(c);
    startOff(sim, al, dx, dy, dDeg);
    const before = errAt(al.state().rigid!);
    expect(before.shiftM).toBeGreaterThan(0.3);
    walk(sim, al, c, { path: LOOP, steps: 900 });
    const s = al.state();
    const e = errAt(s.rigid!);
    expect(s.aligned).toBe(true);
    expect(s.source).toBe("walls");
    expect(e.shiftM).toBeLessThan(0.1);
    expect(e.rotDeg).toBeLessThan(2);
    expect(s.floorY).toBeCloseTo(FLOOR_Y, 1);
  });

  it("걷는 동안 한 번에 움직이는 양: 어림이면 1m·20°, 맞춘 뒤면 0.3m·5° 안", () => {
    const c = clock();
    const sim = new SimHome({ truth: TRUTH, floorY: FLOOR_Y, walls: WALLS, boxes: BOXES, landmarks: MARKS, seed: 21 });
    const al = aligner(c);
    startOff(sim, al, 0.35, -0.35, 15);
    let prev = al.state();
    const jumps: { aligned: boolean; shift: number; rot: number }[] = [];
    walk(sim, al, c, { path: LOOP, steps: 900 }, (pose) => {
      const now = al.state();
      const g = rigidGap(prev.rigid!, now.rigid!, [[pose.position[0], pose.position[2]]]);
      if (g.shiftM > 1e-6) jumps.push({ aligned: prev.aligned, shift: g.shiftM, rot: g.rotDeg });
      prev = now;
    });
    expect(jumps.length).toBeGreaterThan(3);
    for (const j of jumps) {
      expect(j.shift).toBeLessThanOrEqual((j.aligned ? 0.3 : 1) + 1e-6);
      expect(j.rot).toBeLessThanOrEqual((j.aligned ? 5 : 20) + 1e-6);
    }
  });

  it("벽 hit이 없어도 물건 기준점(엔진 프레임 2초마다)으로 두 바퀴면 20cm·2° 안으로 고친다. 물건 둘이면 어림, 셋부터 맞춤", () => {
    const c = clock();
    const sim = new SimHome({ truth: TRUTH, floorY: FLOOR_Y, walls: WALLS, boxes: BOXES, landmarks: MARKS, seed: 31 });
    const al = aligner(c);
    startOff(sim, al, 0.3, 0.1, 10);
    walk(sim, al, c, { path: [...LOOP, ...LOOP.slice(1)], steps: 1800, hits: false });
    const s = al.state();
    const e = errAt(s.rigid!);
    expect(s.source).toBe("objects");
    expect(s.anchors).toBeGreaterThanOrEqual(2);
    expect(s.aligned).toBe(s.anchors >= 3);
    expect(e.shiftM).toBeLessThan(0.2);
    expect(e.rotDeg).toBeLessThan(2);
  });

  it("복도에서 옆 벽만 보이면 회전·벽에 수직인 자리는 맞추고, 길이 방향은 시작 그대로 두며 어림으로 남는다", () => {
    const c = clock();
    const sim = new SimHome({ truth: TRUTH, floorY: FLOOR_Y, walls: WALLS, boxes: BOXES, seed: 41 });
    const al = aligner(c);
    const corridor: P2[] = [[5.0, 6.9], [8.5, 6.9], [5.0, 6.95], [8.5, 6.9]];
    const start: StartPose = { position: [6.5, 6.9], yawDeg: 90, label: "복도", facingLabel: "" };
    // 길이 방향(x) 0.4m, 수직(y) 0.2m, 6° 틀리게 선다
    const p = sim.pose([6.5 + 0.4, 6.9 + 0.2], deg(90 + 6), deg(-10));
    al.confirmStart(start, p.position, p.orientation);
    const along0 = applyRigid(al.state().rigid!, applyRigid(invertRigid(TRUTH), [6.5, 6.9]))[0] - 6.5;
    walk(sim, al, c, {
      path: corridor, steps: 500, objects: false,
      heading: (i) => deg((i % 2 ? 90 : -90) + 20 * Math.sin(i / 7)),
      keepHit: (n) => Math.abs(n[1]) > 0.9 || Math.abs(n[2]) > 0.95,
    });
    const s = al.state();
    expect(s.aligned).toBe(false);
    expect(s.twoD).toBe(false);
    expect(s.source).toBe("walls");
    const probe = applyRigid(invertRigid(TRUTH), [6.5, 6.9]);
    const got = applyRigid(s.rigid!, probe);
    expect(Math.abs(got[1] - 6.9)).toBeLessThan(0.1); // 벽에 수직: 맞춤
    expect(errAt(s.rigid!, corridor).rotDeg).toBeLessThan(2);
    expect(Math.abs(got[0] - 6.5 - along0)).toBeLessThan(0.1); // 길이 방향: 시작 그대로(튀지 않음)
  });

  it("점이 적으면(벽 점 8개) 시작 변환 그대로", () => {
    const c = clock();
    const sim = new SimHome({ truth: TRUTH, floorY: FLOOR_Y, walls: WALLS, boxes: BOXES, seed: 51, hitDropout: 0 });
    const al = aligner(c);
    startOff(sim, al, 0.3, -0.2, 8);
    const was = al.state().rigid!;
    for (let i = 0; i < 8; i++) {
      c.tick(700);
      const pose = sim.pose([8.6, 10.4], deg(i * 45), deg(-5));
      const hit = sim.centerHit(pose);
      al.addPose({ ...pose, hit: hit?.hit ?? null, hitNormal: hit?.normal ?? null });
    }
    expect(al.state().rigid).toEqual(was);
    expect(al.state().aligned).toBe(false);
  });

  it("한 번 다시 풀기는 이 PC에서 50ms 안(벽 점 1200개 상한)", () => {
    const c = clock();
    const sim = new SimHome({ truth: TRUTH, floorY: FLOOR_Y, walls: WALLS, boxes: BOXES, landmarks: MARKS, seed: 61, hitDropout: 0 });
    const al = aligner(c);
    startOff(sim, al, 0.2, 0.2, 5);
    walk(sim, al, c, { path: LOOP, steps: 1500 });
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) al.update();
    const ms = (performance.now() - t0) / 5;
    expect(ms).toBeLessThan(50);
  });
});
