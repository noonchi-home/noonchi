// 영상 모드 고정 자세: 폰 페이지가 영상을 카메라로 틀면 카메라가 움직이지 않는다. 「start」에 fixed: true가 오면
// 저장한 시작 자리·방향이 곧 카메라 자리라 바로 맞춤(출처 video)이고, 그 뒤 물건·벽 증거로 변환을 움직이지 않는다.
// 한양목련 평면도, 시작 자리는 식탁 1.5m 앞에서 식탁을 본다.
import { describe, expect, it } from "vitest";
import type { SceneObject } from "../src/contract/layout.js";
import { loadCatalog } from "../src/layout/catalog.js";
import { loadScene } from "../src/model/scene.js";
import type { Quat, Vec3 } from "../src/phone/align.js";
import { readScenePlan } from "../src/phone/home-plan.js";
import { PhoneSession } from "../src/phone/session.js";
import { LANDMARK_IDS, landmarkClass } from "../src/sync/classes.js";
import { twinLandmarks, type TwinLandmark } from "../src/sync/landmarks.js";
import { rigidGap, type P2, type Rigid } from "../src/sync/rigid.js";
import { startRigid, type StartPose } from "../src/sync/start.js";
import { wallSegments, type WallSeg } from "../src/sync/walls.js";
import { BOX_START, BOX_WALLS } from "./helpers/align.js";
import { SimHome } from "./helpers/sync-sim.js";

const deg = (d: number) => (d * Math.PI) / 180;
const scene = loadScene({ scenePath: "twin/homes/mokryeon_180b/scene.json", dataDir: "twin/data/homes/mokryeon_180b" })!;
const MARKS = twinLandmarks(scene.objects as SceneObject[], loadCatalog("twin/data/catalog"));
const WALLS = wallSegments(readScenePlan("twin/homes/mokryeon_180b/scene.json"));
const START: StartPose = { position: [8.4612, 3.9242], yawDeg: 0, label: "거실 식탁 옆", facingLabel: "거실·복도 식탁" };
/** 영상 폰 자세: AR 원점 1.4m 높이, 방향은 그대로(서버가 시작 방향으로 맞춘다), 25° 아래. */
const POSITION: Vec3 = [0, 1.4, 0];
const PITCH: Quat = [Math.sin(deg(-25) / 2), 0, 0, Math.cos(deg(-25) / 2)];
const PROJECTION = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0];
/** 기준점 종류 → COCO 번호(엔진 프레임 YOLO 상자). */
const COCO = new Map<string, number>(LANDMARK_IDS.map((n) => [landmarkClass(n)!, n]));
const NO_START = "시작 위치가 없어요. 설정 화면에서 시작 위치를 먼저 정해 주세요";

/** 6×5 네모 방(tests/helpers/align.ts)과 그 방에 하나뿐인 물건 셋: 시작 없이 둘러봐도 물건으로 변환을 세울 수 있다. */
const BOX_MARKS: TwinLandmark[] = [
  { cls: "refrigerator", id: "fridge", label: "fridge", center: [0.6, 4.4], footprint: [0.9, 0.75], facingDeg: 0, baseM: 0, unique: true },
  { cls: "couch", id: "sofa", label: "sofa", center: [3, 0.6], footprint: [2, 0.9], facingDeg: 90, baseM: 0, unique: true },
  { cls: "dining_table", id: "table", label: "table", center: [4.6, 3.4], footprint: [1.4, 0.8], facingDeg: 0, baseM: 0, unique: true },
];

function setup(start: StartPose | null = START, world: { landmarks: TwinLandmark[]; walls: WallSeg[] } = { landmarks: MARKS, walls: WALLS }) {
  let t = 0;
  const s = new PhoneSession({ now: () => new Date(Date.UTC(2026, 10, 11) + t), sync: { ...world, start } });
  return { s, tick: (ms: number) => { t += ms; } };
}
const fixedStart = (epoch = "v1") => ({ type: "start", fixed: true, position: POSITION, orientation: PITCH, epoch });

/** 시작 자리에서 조금 어긋난 정답 변환의 집에서 식탁·거실을 돌며 증거를 보낸다. */
function feedEvidence(env: ReturnType<typeof setup>, epoch = "v1") {
  const base = startRigid(START, POSITION, PITCH);
  const truth: Rigid = { theta: base.theta + deg(8), tx: base.tx + 0.4, ty: base.ty - 0.3 };
  const sim = new SimHome({ truth, floorY: POSITION[1] - 1.5, walls: WALLS, landmarks: MARKS, seed: 5 });
  walk(env, sim, [[8.46, 3.92], [10.4, 4.8], [10.3, 6.9], [7.8, 6.9], [8.05, 9.5], [8.3, 10.6], [10.4, 10.8], [10.2, 6.4], [9.6, 3.0], [8.46, 3.92]], epoch);
}

/** path를 따라 걸으며 벽 hit 자세, 앱 기준점 상자, 엔진 프레임 YOLO 상자(COCO 번호)를 보낸다. */
function walk(env: ReturnType<typeof setup>, sim: SimHome, path: P2[], epoch = "v1") {
  const steps = 400;
  for (let i = 0; i < steps; i++) {
    const u = (i / steps) * (path.length - 1);
    const k = Math.min(path.length - 2, Math.floor(u)), f = u - k;
    const a = path[k]!, b = path[k + 1]!;
    const pose = sim.pose([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.sin(i / 11) * deg(70), deg(-25));
    env.tick(100);
    const hit = sim.centerHit(pose);
    env.s.handle({ type: "pose", position: pose.position, orientation: pose.orientation, hit: hit?.hit ?? null, hit_normal: hit?.normal ?? null, hit_estimated: false, epoch });
    if (i % 10) continue;
    const d = sim.detections(pose);
    env.s.handle({ type: "landmarks", epoch, position: pose.position, orientation: pose.orientation, projection: d.projection, width: d.width, height: d.height, boxes: d.boxes });
    const yolo = d.boxes.flatMap((x) => (COCO.has(x.label) ? [{ cls: COCO.get(x.label)!, score: x.score, box: x.box }] : []));
    env.s.landmarks({ kind: "engine", width: d.width, height: d.height, position: pose.position, orientation: pose.orientation, projection: d.projection, epoch }, yolo);
  }
}

describe("영상 모드 고정 자세", () => {
  it("reset 뒤 start fixed면 바로 맞춤(출처 video)이고 바뀜을 알린다", () => {
    const env = setup();
    env.s.handle({ type: "reset", epoch: "v1" });
    const out = env.s.handle(fixedStart());
    expect(out.changed).toBe(true);
    expect(out.reply?.error).toBeUndefined();
    const st = env.s.status();
    expect(st.aligned).toBe(true);
    expect(st.sync).toMatchObject({ state: "aligned", source: "video", started: true });
    expect(env.s.aligned).toBe(true);
  });

  it("눈은 시작 자리·시작 방향이고 estimated가 없다. 엔진 프레임 카메라·명령 대상 AR 자리가 나온다", () => {
    const env = setup();
    env.s.handle({ type: "reset", epoch: "v1" });
    env.s.handle(fixedStart());
    const eye = env.s.eyeAt(POSITION, PITCH, "ok", "v1")!;
    expect(eye.estimated).toBeUndefined();
    expect(eye.position[0]).toBeCloseTo(START.position[0], 3);
    expect(eye.position[1]).toBeCloseTo(START.position[1], 3);
    expect(((eye.yaw_deg - START.yawDeg + 540) % 360) - 180).toBeCloseTo(0, 1);
    expect(eye.pitch_deg).toBeCloseTo(-25, 1);
    // 바닥 증거가 없으면 눈높이 = 시작 높이 − 기본 눈높이 1.5m 아래 바닥에서 잰 값
    expect(eye.height_m).toBeCloseTo(1.5, 3);
    expect(env.s.eyeAt(POSITION, PITCH, "ok", "other")).toBeNull();
    const view = env.s.viewAt(POSITION, PITCH, PROJECTION, "v1");
    expect(view).not.toBeNull();
    expect(view!.origin[0]).toBeCloseTo(START.position[0], 3);
    expect(view!.origin[2]).toBeCloseTo(START.position[1], 3);
    expect(view!.projection).toEqual(PROJECTION);
    // 식탁 가운데(1.5m 앞)는 AR에서 카메라 앞(-Z) 1.5m
    const ar = env.s.toAr([9.9612, 0.75, 3.9242])!;
    expect(ar[0]).toBeCloseTo(0, 3);
    expect(ar[2]).toBeCloseTo(-1.5, 3);
    const pose = env.s.handle({ type: "pose", position: POSITION, orientation: PITCH, tracking: "ok", epoch: "v1" });
    expect(pose.eye!.estimated).toBeUndefined();
    expect(pose.eye!.position[0]).toBeCloseTo(START.position[0], 3);
    expect(pose.eye!.position[1]).toBeCloseTo(START.position[1], 3);
  });

  it("고정이면 벽 hit·물건 상자를 아무리 넣어도 변환이 그대로다. 고정이 아닌 시작은 같은 증거로 움직인다", () => {
    const env = setup();
    env.s.handle({ type: "reset", epoch: "v1" });
    env.s.handle(fixedStart());
    const before = env.s.syncState().rigid!;
    feedEvidence(env);
    const st = env.s.syncState();
    expect(st.observed.landmarks).toBeGreaterThan(0);
    expect(st.rigid).toEqual(before);
    expect(st).toMatchObject({ aligned: true, source: "video", updates: 0 });

    // 같은 증거로 보통 「여기서 시작」은 어림에서 정답 쪽으로 움직인다(이 시험의 증거가 실제로 변환을 움직일 만하다)
    const plain = setup();
    plain.s.handle({ type: "reset", epoch: "v1" });
    plain.s.handle({ type: "start", position: POSITION, orientation: PITCH, epoch: "v1" });
    const from = plain.s.syncState().rigid!;
    feedEvidence(plain);
    const moved = plain.s.syncState();
    expect(moved.source).not.toBe("start");
    expect(rigidGap(from, moved.rigid!, [[0, 0]]).shiftM).toBeGreaterThan(0.1);
  });

  it("새 reset이면 맞춤이 없어진다(같은 원점·새 원점 모두)", () => {
    const env = setup();
    env.s.handle({ type: "reset", epoch: "v1" });
    env.s.handle(fixedStart());
    env.s.handle({ type: "reset", epoch: "v1" });
    expect(env.s.status().sync).toMatchObject({ state: "none", source: null, started: false });
    expect(env.s.aligned).toBe(false);
    env.s.handle(fixedStart());
    env.s.handle({ type: "reset", epoch: "v2" });
    expect(env.s.status().sync.state).toBe("none");
    // 새 원점에서 다시 고정 시작하면 다시 맞춤
    env.s.handle(fixedStart("v2"));
    expect(env.s.status().sync).toMatchObject({ state: "aligned", source: "video" });
  });

  it("시작 위치가 없으면 start fixed도 지금과 같은 오류다", () => {
    const env = setup(null);
    env.s.handle({ type: "reset", epoch: "v1" });
    const out = env.s.handle(fixedStart());
    expect(out.reply!.error).toBe(NO_START);
    expect(env.s.status().sync.state).toBe("none");
    expect(env.s.aligned).toBe(false);
  });

  it("fixed 없는 start는 지금처럼 어림이고, 고정 뒤에 온 보통 start도 고정을 푼다", () => {
    const env = setup();
    env.s.handle({ type: "reset", epoch: "v1" });
    const out = env.s.handle({ type: "start", position: POSITION, orientation: PITCH, epoch: "v1" });
    expect(out.reply!.sync).toMatchObject({ state: "estimated", source: "start", started: true });
    expect(out.reply!.aligned).toBe(false);
    env.s.handle(fixedStart());
    expect(env.s.status().sync.state).toBe("aligned");
    env.s.handle({ type: "start", position: POSITION, orientation: PITCH, epoch: "v1" });
    expect(env.s.status().sync).toMatchObject({ state: "estimated", source: "start" });
    expect(env.s.eyeAt(POSITION, PITCH, "ok", "v1")).toBeNull();
  });

  it("고정은 reset·보통 start에서 풀린다: 그 뒤 같은 증거로 다시 물건·벽으로 맞춘다", () => {
    // 고정 → reset(같은 원점) → 시작 없이 둘러보기: 하나뿐인 물건 셋으로 변환을 처음부터 세운다
    const again = setup(BOX_START, { landmarks: BOX_MARKS, walls: BOX_WALLS });
    again.s.handle({ type: "reset", epoch: "v1" });
    again.s.handle(fixedStart());
    again.s.handle({ type: "reset", epoch: "v1" });
    const sim = new SimHome({ truth: { theta: deg(-63), tx: 1.7, ty: 2.9 }, floorY: POSITION[1] - 1.5, walls: BOX_WALLS, landmarks: BOX_MARKS, seed: 5 });
    walk(again, sim, [[2.5, 2.5], [4.5, 1.8], [4.8, 3.8], [1.5, 3.8], [1.2, 1.5], [2.5, 2.5]]);
    const boot = again.s.syncState();
    expect(boot.updates).toBeGreaterThan(0);
    expect(boot.rigid).not.toBeNull();
    expect(boot.started).toBe(false);
    expect(["objects", "walls"]).toContain(boot.source);

    // 고정 → 보통 start(reset 없이): 어림에서 정답 쪽으로 움직인다
    const plain = setup();
    plain.s.handle({ type: "reset", epoch: "v1" });
    plain.s.handle(fixedStart());
    plain.s.handle({ type: "start", position: POSITION, orientation: PITCH, epoch: "v1" });
    const from = plain.s.syncState().rigid!;
    feedEvidence(plain);
    const moved = plain.s.syncState();
    expect(moved.updates).toBeGreaterThan(0);
    expect(moved.source).not.toBe("start");
    expect(rigidGap(from, moved.rigid!, [[0, 0]]).shiftM).toBeGreaterThan(0.1);
  });
});
