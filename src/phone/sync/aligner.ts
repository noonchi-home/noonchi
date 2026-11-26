// 위치 맞춤 모듈: 폰과 상관없이 자세 흐름(자세·hit 점·면 법선·어림 바닥)과 물건 관찰(카메라 + 기준점 상자)을 받아
// 바닥 평면 2D 강체 변환(AR → 평면) 하나와 품질을 낸다. 웹(ui/src/phone)이든 앱이든 같은 메시지만 보내면 된다(src/phone/session.ts).
//
// 세 겹이 한 변환을 고친다.
// 1. 시작 위치(confirmStart): 그 순간 자세로 변환을 바로 정한다. 어림(aligned false). 그 뒤로는 약한 사전값이다
//    (자리 시그마 0.3m, 1분마다 0.1m씩 커짐, 방향 시그마 10°).
// 2. 물건 기준점(addLandmarks): 관찰을 종류·자리로 묶고, 트윈 물건과 짝지어(하나뿐인 종류 먼저, 변환이 있으면 가장 가까운 같은 종류)
//    관찰마다 점-점 항(시그마 0.15m + 거리 1m마다 0.04m, 물건 하나에 관찰 8개가 넘으면 그만큼 키움). 변환이 없으면 하나뿐인 종류
//    둘 이상으로 RANSAC 해서 처음 변환을 만든다.
// 3. 벽 모양(addPose의 실제 hit 벽 점): 지금 변환에서 2D ICP(src/phone/sync/walls.ts, 시그마 0.05m). 짝 문턱은 반복마다 좁힌다
//    (어림이면 1.0 → 0.15m, 맞춘 뒤면 0.5 → 0.15m). 최근 45초 점만 쓴다(추적이 밀려도 옛 점에 붙잡히지 않게).
//
// 받는 기준(SYNC_LIMITS): 벽 = 맞는 점(10cm 안) 40개 이상·RMS 6cm 이하·짝 중 맞는 몫 절반 이상, 물건 = 짝(50cm 안)과 그 RMS 35cm 이하.
// 어림일 때는 ICP 전에 벽 점 법선과 트윈 벽 방향을 겹쳐 방향만 먼저 고친다(±20°, src/phone/sync/walls.ts normalRotation).
// 맞춤(aligned)은 벽이 두 방향 이상이거나, 벽 한 방향 + 물건 하나, 또는 물건 셋. 벽 한 방향(복도)·물건 둘이면
// 변환은 고치지만 어림으로 둔다(물건 하나는 회전을 못 정해 쓰지 않는다). 기준을 못 넘으면 바꾸지 않고, 맞춘 뒤에는 맞춤 기준을 넘을 때만 바꾼다.
// 한 번에 움직이는 양은 폰 자리에서 어림이면 1.0m·20°, 맞춘 뒤면 0.3m·5°까지다(넘으면 그만큼만 가고 다음에 마저 간다).
// 다시 푸는 것은 0.5초에 한 번, 새 벽 점 10개나 새 물건 관찰이 있을 때만.
// 영상 모드(fixStart): 고정 카메라라 시작 자리가 곧 카메라 자리다. 바로 맞춤(출처 video)으로 두고 물건·벽으로 변환을 움직이지 않는다.

import { PHOTO_GAP_M, photoConflict } from "../../shared/photo-alignment.js";
import type { Vec3 } from "../../shared/geometry.js";
import type { Quat } from "../../contract/observe.js";
import { landmarkClass, type LandmarkClass } from "./classes.js";
import { LandmarkStore, boxRay, edgePoint, rayFloor, type FrameCamera, type LandmarkCluster, type LandmarkObs, type TwinLandmark } from "./landmarks.js";
import { applyRigid, limitStep, ransacRigid, rigidGap, solveTerms, type P2, type Rigid, type Term } from "./rigid.js";
import { startRigid, type StartPose } from "./start.js";
import { SurfacePoints, classifyHit, normalRotation, wallQuality, wallTerms, type WallPoint, type WallSeg } from "./walls.js";

// 영상 모드: 자세 흉내
export type SyncSource = "start" | "objects" | "walls" | "video" | "photo";

export const SYNC_LIMITS = {
  startSigmaM: 0.3,
  startGrowMPerMin: 0.1,
  startSigmaDeg: 10,
  landmarkMinScore: 0.4,
  /** 상자가 그림 가장자리(폭·높이의 이 몫 안)에 닿으면 아래 가운데가 물건 바닥이 아니라서 버린다. */
  edgeMargin: 0.015,
  objGatesEstimated: [1.5, 1.0, 0.7, 0.5, 0.5, 0.5],
  objGatesAligned: [0.8, 0.6, 0.5, 0.5],
  objInlierM: 0.5,
  objAmbiguityM: 0.5,
  objSigmaM: 0.15,
  objSigmaPerM: 0.04,
  objPerInstance: 8,
  objMaxRmsM: 0.35,
  bootstrapInlierM: 0.8,
  bootstrapPairM: 0.5,
  /** 어림일 때 벽 점 법선으로 찾는 방향 고침 범위(°). */
  normalSearchDeg: 20,
  wallGatesEstimated: [1.0, 0.6, 0.35, 0.2, 0.15, 0.15],
  wallGatesAligned: [0.5, 0.35, 0.2, 0.15],
  wallSigmaM: 0.05,
  wallInlierM: 0.1,
  wallMinInliers: 40,
  wallMaxRmsM: 0.06,
  wallMinRatio: 0.5,
  wallMaxAgeMs: 45_000,
  hitMaxRangeM: 5,
  stepEstimated: { shiftM: 1.0, rotDeg: 20 },
  stepAligned: { shiftM: 0.3, rotDeg: 5 },
  updateMs: 500,
  minNewWalls: 10,
} as const;

export interface SyncState {
  /** AR [x, z] → 평면 [x, y]. 아무것도 없으면 null. */
  rigid: Rigid | null;
  /** 트윈 높이 0의 AR y. 모르면 null. */
  floorY: number | null;
  /** 맞춤(기준을 넘었음). false면 어림이거나 없음. */
  aligned: boolean;
  /** 마지막으로 변환을 정한 것. */
  source: SyncSource | null;
  /** 이 AR에서 「여기서 시작」을 했다. */
  started: boolean;
  /** 짝지은 물건 수, 그 트윈 물건 id, RMS(m). */
  anchors: number;
  anchorIds: string[];
  anchorRmsM: number | null;
  /** 벽에 맞는 점 수와 그 RMS(m), 벽이 두 방향 이상인지. */
  wallPoints: number;
  wallRmsM: number | null;
  twoD: boolean;
  /** 보여 줄 오차(m): 벽이 기준을 넘으면 벽 RMS, 아니면 물건 RMS. */
  residualM: number | null;
  /** 받아들인 고침 수. */
  updates: number;
  /** 모아 둔 증거: 물건 관찰 수, 벽 점 칸 수. */
  observed: { landmarks: number; walls: number };
}

export interface PoseInput {
  position: Vec3;
  orientation: Quat;
  /** 화면 가운데 조준점(AR). 어림 바닥 점이면 hitEstimated. */
  hit?: Vec3 | null;
  /** 조준점 면 법선(AR). 실제 hit-test 점일 때만 있다. */
  hitNormal?: Vec3 | null;
  hitEstimated?: boolean;
  /** 폰이 어림한 바닥 높이(AR y, local-floor 또는 폰 1.5m 아래). */
  floorY?: number | null;
}

export interface LandmarkBoxInput {
  /** 기준점 종류(낱말 표 키, src/phone/sync/classes.ts) 또는 COCO 번호. */
  label: string | number;
  score: number;
  /** 원본 픽셀 [x, y, w, h]. */
  box: [number, number, number, number];
}

export interface AlignerOptions {
  landmarks: readonly TwinLandmark[];
  walls: readonly WallSeg[];
  /** 바닥 점이 없을 때 폰 높이에서 뺄 값(m, 기본 1.5). */
  eyeHeightM?: number;
  /** 평면 점이 있는 방의 바닥 높이(floor_z). */
  floorAt?: (p: P2) => number;
  now?: () => number;
}

interface Match { cluster: LandmarkCluster; cand: TwinLandmark; r: number }
interface Evaluated {
  anchors: number; anchorIds: string[]; anchorRmsM: number | null; wallPoints: number; wallRmsM: number | null; ratio: number; twoD: boolean;
}

const median = (vs: number[]) => {
  const s = [...vs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const L = SYNC_LIMITS;

export class SyncAligner {
  private photoFloor:number|null=null;
  /** 맞춘 동안 AR과 다르다고 나온 사진 결과(아직 따르지 않음). 서로 맞는 결과가 한 번 더 오면 그쪽으로 다시 맞춘다. */
  private doubt:{rigid:Rigid;floor:number}|null=null;
  private rigid: Rigid | null = null;
  private aligned = false;
  private source: SyncSource | null = null;
  private start: { pose: StartPose; position: Vec3; rigid: Rigid; at: number } | null = null;
  private quality: Evaluated = { anchors: 0, anchorIds: [], anchorRmsM: null, wallPoints: 0, wallRmsM: null, ratio: 0, twoD: false };
  private readonly surface = new SurfacePoints();
  private readonly store: LandmarkStore;
  private floorHints: number[] = [];
  private lastCamera: P2 | null = null;
  private lastPhoneY: number | null = null;
  private lastUpdate = -Infinity;
  private newWalls = 0;
  private newObs = 0;
  private dirty = false;
  /** 영상 모드 고정 자세: 다시 풀지 않는다. */
  private fixed = false;
  private updates = 0;
  private readonly now: () => number;
  private readonly eyeHeightM: number;
  private readonly floorAt: (p: P2) => number;
  private readonly byClass = new Map<LandmarkClass, TwinLandmark[]>();
  private readonly classBase = new Map<LandmarkClass, number>();

  constructor(private readonly o: AlignerOptions) {
    this.now = o.now ?? (() => Date.now());
    this.eyeHeightM = o.eyeHeightM ?? 1.5;
    this.floorAt = o.floorAt ?? (() => 0);
    this.setLandmarks(o.landmarks);
    // 묶는 거리: 그 종류에서 가장 큰 물건 대각선의 0.6배(1m 이상), 버리는 거리: 대각선의 절반(0.4m 이상)
    const diag = (cls: LandmarkClass) => Math.max(0, ...(this.byClass.get(cls) ?? []).map((l) => Math.hypot(...l.footprint)));
    this.store = new LandmarkStore({ radiusM: (c) => Math.max(1, 0.6 * diag(c)), outlierM: (c) => Math.max(0.4, 0.5 * diag(c)) });
    // 처음 목록은 고칠 거리가 아니다(아직 증거가 없다)
    this.dirty = false;
  }

  /** 트윈 물건이 바뀌면(배치 보정) 짝 목록을 바꾼다. 모은 관찰은 그대로 둔다. */
  setLandmarks(list: readonly TwinLandmark[]): void {
    this.byClass.clear();
    this.classBase.clear();
    for (const l of list) this.byClass.set(l.cls, [...(this.byClass.get(l.cls) ?? []), l]);
    for (const [cls, items] of this.byClass) this.classBase.set(cls, median(items.map((l) => l.baseM)));
    this.dirty = true;
  }

  /** 새 AR 원점·다시 맞추기: 변환·증거·시작을 모두 지운다. */
  reset(): void {
    this.photoFloor=null;
    this.doubt=null;
    this.fixed = false;
    this.rigid = null;
    this.aligned = false;
    this.source = null;
    this.start = null;
    this.quality = { anchors: 0, anchorIds: [], anchorRmsM: null, wallPoints: 0, wallRmsM: null, ratio: 0, twoD: false };
    this.surface.clear();
    this.store.clear();
    this.floorHints = [];
    this.lastUpdate = -Infinity;
    this.newWalls = 0;
    this.newObs = 0;
    this.dirty = false;
  }

  /** 시작 자리에 서서 그 방향을 본 순간의 자세. 변환을 그 자세로 바로 정하고 어림으로 둔다(모은 증거는 남겨 곧 다시 맞춘다). */
  confirmStart(pose: StartPose, position: Vec3, orientation: Quat): void {
    this.photoFloor=null;
    this.fixed = false;
    const rigid = startRigid(pose, position, orientation);
    this.start = { pose, position: [...position], rigid, at: this.now() };
    this.rigid = rigid;
    this.aligned = false;
    this.source = "start";
    this.lastCamera = [position[0], position[2]];
    this.lastPhoneY = position[1];
    this.dirty = true;
  }

  /** 영상 모드: 고정 카메라라 시작 자리가 곧 카메라 자리다. 바로 맞춤으로 두고 물건·벽으로 움직이지 않는다. */
  // 영상 모드: 자세 흉내
  fixStart(pose: StartPose, position: Vec3, orientation: Quat): void {
    this.confirmStart(pose, position, orientation);
    this.aligned = true;
    // 영상 모드: 자세 흉내
    this.source = "video";
    this.fixed = true;
    this.dirty = false;
  }

  /** 트윈 높이 0의 AR y: 실제 바닥 hit 중앙값 → 폰 어림 바닥 → 시작 높이 − 눈높이 → 마지막 폰 높이 − 눈높이. */
  /** 사진으로 찾은 위치 하나. 맞춘 동안 AR과 다른 결과는 한 번으로는 따르지 않고, 서로 맞는 다른 결과가 이어서 한 번 더 와야
   *  그 결과로 다시 맞춘다(한 장의 틀린 결과로 잘 맞춘 위치를 지우지 않는다). 다시 맞췄으면(맞춤을 지웠으면) true. */
  photo(position:Vec3, orientation:Quat, world:Vec3, yaw:number, conflict:boolean):boolean {
    if(this.fixed) return false;
    const next=startRigid({position:[world[0],world[2]],yawDeg:yaw,label:"",facingLabel:""},position,orientation);
    const floor=position[1]-world[1];
    if(conflict && this.aligned) {
      const prev=this.doubt, gap=prev && rigidGap(prev.rigid,next,[[position[0],position[2]]]);
      const agreeing=!!prev && !!gap && !photoConflict(gap.shiftM,gap.rotDeg) && Math.abs(prev.floor-floor)<=PHOTO_GAP_M;
      if(!agreeing) { this.doubt={rigid:next,floor}; return false; }
      this.reset();
      this.rigid=next;
      this.photoFloor=floor;
      this.aligned=true;
      this.source="photo";
      this.updates++;
      return true;
    }
    this.doubt=null;
    const gap=this.rigid && rigidGap(this.rigid,next,[[position[0],position[2]]]);
    const confirmed=!conflict && !!gap && !photoConflict(gap.shiftM,gap.rotDeg) &&
      (this.aligned || (this.source==="photo" && this.photoFloor!==null && Math.abs(this.photoFloor-floor)<=PHOTO_GAP_M));
    if(conflict) this.reset();
    this.rigid=next;
    this.photoFloor=floor;
    this.aligned=confirmed;
    this.source="photo";
    this.updates++;
    return conflict;
  }

  /** 맞춘 동안 AR과 맞는 사진 결과가 왔다: 앞서 미뤄 둔 어긋남은 이어지지 않았으니 잊는다. */
  photoAgrees():void { this.doubt=null; }

  floorY(): number | null {
    return this.photoFloor ?? this.surface.floorY() ?? (this.floorHints.length ? median(this.floorHints) : null)
      ?? (this.start ? this.start.position[1] - this.eyeHeightM : null) ?? (this.lastPhoneY !== null ? this.lastPhoneY - this.eyeHeightM : null);
  }

  /** 자세 하나(초당 10번쯤). 실제 hit 점은 벽 점·바닥 높이로 모은다. 다시 풀어 바뀌었으면 true. */
  addPose(p: PoseInput): boolean {
    this.lastCamera = [p.position[0], p.position[2]];
    this.lastPhoneY = p.position[1];
    if (typeof p.floorY === "number" && Number.isFinite(p.floorY)) {
      this.floorHints.push(p.floorY);
      if (this.floorHints.length > 30) this.floorHints.shift();
    }
    if (p.hit && p.hitNormal && !p.hitEstimated) this.addHit(p.hit, p.hitNormal, p.position);
    return this.maybeUpdate();
  }

  /** 앱이 한꺼번에 보내는 면 점(AR 점·법선)과 그때 카메라 자리. */
  addSurface(points: readonly { point: Vec3; normal: Vec3 }[], camera: Vec3): boolean {
    for (const s of points) this.addHit(s.point, s.normal, camera);
    this.lastCamera = [camera[0], camera[2]];
    this.lastPhoneY = camera[1];
    return this.maybeUpdate();
  }

  private addHit(hit: Vec3, normal: Vec3, camera: Vec3): void {
    if (Math.hypot(hit[0] - camera[0], hit[2] - camera[2]) > L.hitMaxRangeM) return;
    const c = classifyHit(hit, normal, camera[1]);
    if (!c) return;
    if (c.kind === "wall") {
      this.surface.addWall(c.point, c.normal, [camera[0], camera[2]], this.now());
      this.newWalls += 1;
    } else {
      const plan = this.rigid ? applyRigid(this.rigid, [hit[0], hit[2]]) : null;
      this.surface.addFloor(c.y - (plan ? this.floorAt(plan) : 0), this.now());
    }
  }

  /** 엔진 프레임 한 장의 기준점 상자와 그 순간 카메라(AR). 다시 풀어 바뀌었으면 true. */
  addLandmarks(cam: FrameCamera, size: { width: number; height: number }, boxes: readonly LandmarkBoxInput[]): boolean {
    this.lastCamera = [cam.position[0], cam.position[2]];
    this.lastPhoneY = cam.position[1];
    const floor = this.floorY();
    for (const b of boxes) {
      const cls = typeof b.label === "number" ? landmarkClass(b.label) : (this.byClass.has(b.label as LandmarkClass) ? (b.label as LandmarkClass) : null);
      if (!cls || !this.byClass.has(cls) || !(b.score >= L.landmarkMinScore) || floor === null) continue;
      const [x, y, w, h] = b.box;
      const mx = L.edgeMargin * size.width, my = L.edgeMargin * size.height;
      if (x <= mx || x + w >= size.width - mx || y + h >= size.height - my) continue;
      const ray = boxRay(cam, b.box, size);
      const hit = rayFloor(ray, floor + (this.classBase.get(cls) ?? 0));
      if (!hit) continue;
      this.store.add({ cls, point: hit.point, camera: [cam.position[0], cam.position[2]], rangeM: hit.rangeM, score: b.score, at: this.now(), ray });
      this.newObs += 1;
    }
    return this.maybeUpdate();
  }

  state(): SyncState {
    const q = this.quality;
    const wallOk = this.wallOk(q);
    return {
      rigid: this.rigid ? { ...this.rigid } : null,
      floorY: this.floorY(),
      aligned: this.aligned,
      source: this.source,
      started: this.start !== null,
      anchors: q.anchors,
      anchorIds: [...q.anchorIds],
      anchorRmsM: q.anchorRmsM,
      wallPoints: q.wallPoints,
      wallRmsM: q.wallRmsM,
      twoD: q.twoD,
      residualM: wallOk ? q.wallRmsM : q.anchorRmsM,
      updates: this.updates,
      observed: { landmarks: this.store.size(), walls: this.surface.wallCount() },
    };
  }

  private maybeUpdate(): boolean {
    if (this.now() - this.lastUpdate < L.updateMs) return false;
    if (this.newWalls < L.minNewWalls && this.newObs === 0 && !this.dirty) return false;
    return this.update();
  }

  private wallOk(q: Evaluated): boolean {
    return q.wallPoints >= L.wallMinInliers && q.wallRmsM !== null && q.wallRmsM <= L.wallMaxRmsM && q.ratio >= L.wallMinRatio;
  }

  private objOk(q: Evaluated, n: number): boolean {
    return q.anchors >= n && q.anchorRmsM !== null && q.anchorRmsM <= L.objMaxRmsM;
  }

  /** 지금 증거로 다시 푼다. 기준을 넘으면 변환을 (한 걸음 묶어) 바꾼다. 바뀌었으면 true. */
  update(): boolean {
    if (this.fixed) return false;
    this.lastUpdate = this.now();
    this.newWalls = 0;
    this.newObs = 0;
    this.dirty = false;
    const floor = this.floorY();
    const walls = this.surface.walls().filter((p) => this.lastUpdate - p.at <= L.wallMaxAgeMs);
    const clusters = this.store.clusters();
    let base = this.rigid ?? this.bootstrap(clusters, floor);
    if (!base) return false;
    // 어림일 때는 먼저 벽 점 법선으로 방향만 고친다(이동과 상관없다). 시작 자리(없으면 폰 자리)를 축으로 돌려 그 자리는 그대로 둔다
    if (!this.aligned) {
      const delta = normalRotation(base, walls, this.o.walls, { maxDeg: L.normalSearchDeg });
      if (delta !== null && Math.abs(delta) > 1e-4) {
        const pivot: P2 = this.start ? [this.start.position[0], this.start.position[2]] : this.lastCamera ?? [0, 0];
        const at = applyRigid(base, pivot);
        const theta = base.theta + delta;
        const [rx, ry] = [pivot[0] * Math.cos(theta) - pivot[1] * Math.sin(theta), pivot[0] * Math.sin(theta) + pivot[1] * Math.cos(theta)];
        base = { theta, tx: at[0] - rx, ty: at[1] - ry };
      }
    }
    const objGates = this.aligned ? L.objGatesAligned : L.objGatesEstimated;
    const wallGates = this.aligned ? L.wallGatesAligned : L.wallGatesEstimated;
    let T = base;
    for (let k = 0; k < Math.max(objGates.length, wallGates.length); k++) {
      const terms: Term[] = [
        ...this.startTerms(),
        ...this.objectTerms(T, this.matchObjects(T, clusters, objGates[Math.min(k, objGates.length - 1)]!, floor), floor),
        ...wallTerms(T, walls, this.o.walls, { gateM: wallGates[Math.min(k, wallGates.length - 1)]!, sigma: L.wallSigmaM }).terms,
      ];
      if (!terms.length) break;
      T = solveTerms(T, terms, { iterations: 6 }).T;
    }
    const q = this.evaluate(T, walls, clusters, floor);
    const wallOk = this.wallOk(q);
    const full = (wallOk && q.twoD) || (wallOk && this.objOk(q, 1)) || this.objOk(q, 3);
    const partial = wallOk || this.objOk(q, 2);
    if ((!full && !partial) || (this.aligned && !full)) {
      if (!this.rigid) return false;
      // 바꾸지 않아도 지금 변환에서 잰 품질은 보인다
      this.quality = this.evaluate(this.rigid, walls, clusters, floor);
      return false;
    }
    const was = this.rigid;
    const wasAligned = this.aligned;
    const limit = this.aligned ? L.stepAligned : L.stepEstimated;
    const step = was ? limitStep(was, T, { maxShiftM: limit.shiftM, maxRotDeg: limit.rotDeg, at: this.lastCamera ?? [0, 0] }) : { T, clamped: false };
    this.rigid = step.T;
    if (full && !step.clamped) this.aligned = true;
    this.source = wallOk ? "walls" : "objects";
    this.quality = step.clamped ? this.evaluate(step.T, walls, clusters, floor) : q;
    this.updates += 1;
    const moved = !was || rigidGap(was, step.T, [this.lastCamera ?? [0, 0]]).shiftM > 1e-4 || rigidGap(was, step.T, []).rotDeg > 1e-3;
    return moved || wasAligned !== this.aligned;
  }

  private startTerms(): Term[] {
    if (!this.start) return [];
    const minutes = Math.max(0, this.now() - this.start.at) / 60_000;
    const sigma = L.startSigmaM + L.startGrowMPerMin * minutes;
    return [
      { kind: "point", from: [this.start.position[0], this.start.position[2]], to: [...this.start.pose.position], sigma },
      { kind: "angle", theta: this.start.rigid.theta, sigma: (L.startSigmaDeg * Math.PI) / 180 },
    ];
  }

  /** 관찰의 AR 바닥 점(그 물건이 놓인 면 높이로 다시 셈). */
  private obsPoint(obs: LandmarkObs, cand: TwinLandmark, floor: number | null): P2 {
    if (!obs.ray || floor === null) return obs.point;
    return rayFloor(obs.ray, floor + cand.baseM)?.point ?? obs.point;
  }

  /** 묶음 하나와 트윈 물건 하나의 어긋남: 관찰마다 (변환한 관찰 점 ↔ 카메라 쪽 앞 가장자리) 거리의 중앙값. */
  private residual(T: Rigid, c: LandmarkCluster, cand: TwinLandmark, floor: number | null): number {
    return median(c.obs.map((ob) => dist(applyRigid(T, this.obsPoint(ob, cand, floor)), edgePoint(cand, applyRigid(T, ob.camera)))));
  }

  /** 묶음마다 문턱 안 가장 가까운 같은 종류 물건. 둘째와 0.5m 안으로 비슷하면 버린다. 트윈 물건 하나에 묶음 하나(관찰 많은 쪽). */
  private matchObjects(T: Rigid, clusters: readonly LandmarkCluster[], gateM: number, floor: number | null): Match[] {
    const byTwin = new Map<string, Match>();
    for (const c of clusters) {
      const scored = (this.byClass.get(c.cls) ?? []).map((cand) => ({ cand, r: this.residual(T, c, cand, floor) })).sort((a, b) => a.r - b.r);
      const best = scored[0], second = scored[1];
      if (!best || best.r > gateM) continue;
      if (second && second.r - best.r < L.objAmbiguityM) continue;
      const prior = byTwin.get(best.cand.id);
      if (prior && prior.cluster.obs.length >= c.obs.length) continue;
      byTwin.set(best.cand.id, { cluster: c, cand: best.cand, r: best.r });
    }
    return [...byTwin.values()];
  }

  private objectTerms(T: Rigid, matches: readonly Match[], floor: number | null): Term[] {
    return matches.flatMap(({ cluster, cand }) => {
      const scale = Math.sqrt(Math.max(1, cluster.obs.length / L.objPerInstance));
      return cluster.obs.map((ob): Term => ({
        kind: "point", from: this.obsPoint(ob, cand, floor), to: edgePoint(cand, applyRigid(T, ob.camera)),
        sigma: (L.objSigmaM + L.objSigmaPerM * ob.rangeM) * scale,
      }));
    });
  }

  private evaluate(T: Rigid, walls: readonly WallPoint[], clusters: readonly LandmarkCluster[], floor: number | null): Evaluated {
    const w = wallQuality(T, walls, this.o.walls, { inlierM: L.wallInlierM });
    const m = this.matchObjects(T, clusters, L.objInlierM, floor);
    return {
      anchors: m.length,
      anchorIds: m.map((x) => x.cand.id).sort(),
      anchorRmsM: m.length ? Math.sqrt(m.reduce((s, x) => s + x.r * x.r, 0) / m.length) : null,
      wallPoints: w.inliers, wallRmsM: w.rmsM, ratio: w.ratio, twoD: w.twoD,
    };
  }

  /** 변환이 없을 때: 하나뿐인 종류 묶음(종류마다 관찰이 가장 많은 것)의 가운데 ↔ 트윈 물건 가운데로 RANSAC. */
  private bootstrap(clusters: readonly LandmarkCluster[], _floor: number | null): Rigid | null {
    const seen = new Set<LandmarkClass>();
    const pairs: { from: P2; to: P2 }[] = [];
    for (const c of clusters) {
      const cands = this.byClass.get(c.cls) ?? [];
      if (cands.length !== 1 || seen.has(c.cls)) continue;
      seen.add(c.cls);
      pairs.push({ from: c.center, to: cands[0]!.center });
    }
    if (pairs.length < 2) return null;
    const r = ransacRigid(pairs, { inlierM: L.bootstrapInlierM, minSpanM: 1 });
    if (!r || r.inliers.length < 2) return null;
    if (r.inliers.length === 2) {
      const [a, b] = r.inliers.map((k) => pairs[k]!);
      if (Math.abs(dist(a!.from, b!.from) - dist(a!.to, b!.to)) > L.bootstrapPairM) return null;
    }
    return r.T;
  }
}
