// 폰 한 대의 AR 세션 상태. 트윈에 맞추고, 그 뒤 자세를 눈 자세로 바꾼다. 네트워크와 무관하므로 server.ts가 WebSocket 메시지를 그대로 넘긴다.
// 맞추는 길은 둘이다.
// - 위치 맞춤 모듈(sync, src/sync/aligner.ts): 「여기서 시작」(start)이면 바로 어림, 걸으며 오는 실제 hit 벽 점(pose의 hit·hit_normal,
//   앱은 surface)과 물건 상자(엔진 프레임 YOLO 또는 앱의 landmarks)가 기준을 넘으면 맞춤. 어림이면 눈만 estimated로 보내고
//   사진·카메라(World State)·고리·「여기」에는 쓰지 않는다.
// - 예전 기준점 두 곳(바닥 ar_anchors 또는 벽 대기 A·B): 기록하면 맞춤. 모듈이 있으면 그 변환을 모듈에 맞춤으로 넣어 같은 변환을 쓴다.

import { z } from "zod";
import type { EyeEvent } from "../contract/events.js";
import { SyncAligner, type SyncSource, type SyncState } from "../sync/aligner.js";
import type { TwinLandmark } from "../sync/landmarks.js";
import { rigidGap } from "../sync/rigid.js";
import type { StartPose } from "../sync/start.js";
import type { WallSeg } from "../sync/walls.js";
import { fromTwin, planOf, solveAlignment, toTwin, type Alignment, type Plan2, type Quat, type Vec3 } from "./align.js";
import type { AnchorTarget } from "./anchors.js";
import type { FrameHeader } from "./packet.js";
import { DEFAULT_EYE_HEIGHT_M } from "./touch.js";

export type { EyeEvent } from "../contract/events.js";

const num = z.number().refine(Number.isFinite);
const Vec3Schema = z.tuple([num, num, num]);
const QuatSchema = z.tuple([num, num, num, num]);
const BoxSchema = z.tuple([num, num, num, num]);
/** 폰이 AR 세션을 열거나 추적 원점이 다시 잡힐 때마다 새로 만드는 값. 바뀌면 이전 AR 좌표의 기록·맞춤은 못 쓴다. */
const Epoch = z.string().min(1).max(64).optional();
const MessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("pose"),
    position: Vec3Schema,
    orientation: z.tuple([num, num, num, num]),
    tracking: z.enum(["ok", "limited"]).default("ok"),
    /** 화면 가운데 조준점이 닿은 바닥 점(AR 공간). 닿지 않으면 null. */
    hit: Vec3Schema.nullable().optional(),
    /** hit이 hit-test 점이 아니라 어림 바닥 점(시선과 local-floor 또는 폰 1.5m 아래 면이 만나는 점). */
    hit_estimated: z.boolean().optional(),
    /** 실제 hit-test 점의 면 법선(AR, hit 자세의 +Y). 벽 점·바닥 점을 가른다. */
    hit_normal: Vec3Schema.nullable().optional(),
    /** 폰이 어림한 바닥 높이(AR y: local-floor, 없으면 폰 1.5m 아래). */
    floor_y: num.nullable().optional(),
    epoch: Epoch,
  }),
  /** 「여기서 시작」: 시작 자리에 서서 그 방향을 본 순간의 자세. */
  z.object({ type: z.literal("start"), position: Vec3Schema, orientation: QuatSchema, epoch: Epoch }),
  /** 앱: 한꺼번에 보내는 면 점 [x, y, z, nx, ny, nz]와 그때 카메라 자리. */
  z.object({ type: z.literal("surface"), camera: Vec3Schema, points: z.array(z.tuple([num, num, num, num, num, num])).max(256), epoch: Epoch }),
  /** 앱: 자기 감지기로 찾은 기준점 상자(이름 또는 COCO 번호)와 그 순간 카메라. */
  z.object({
    type: z.literal("landmarks"), position: Vec3Schema, orientation: QuatSchema, projection: z.array(num).length(16),
    width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192),
    boxes: z.array(z.object({ label: z.union([z.string().max(32), z.number().int()]).optional(), cls: z.number().int().optional(), score: num, box: BoxSchema })).max(32),
    epoch: Epoch,
  }),
  /** floor: touch 모드에서 기록하는 순간 조준점이 닿은 바닥 점(바닥 높이를 잴 때만 쓴다).
   *  estimated: 기록한 점이 어림 바닥 점이다(pose hit_estimated와 같다).
   *  revision: 기록을 시작할 때 본 기준점 판(status.revision). 그 사이 기준점이 바뀌었으면 받지 않는다. */
  z.object({
    type: z.literal("anchor"), id: z.string(), point: Vec3Schema, floor: Vec3Schema.nullable().optional(),
    estimated: z.boolean().optional(), epoch: Epoch, revision: z.number().int().optional(),
  }),
  /** epoch: 폰의 지금 AR 원점. 같으면 기록만 지우고(메뉴 '다시 맞추기'), 새 원점이면 이전 원점을 버린다. */
  z.object({ type: z.literal("reset"), epoch: Epoch }),
]);

/** touch 모드에서 바닥으로 받는 면은 폰보다 이만큼 아래여야 한다(탁자·선반 윗면을 바닥으로 잡지 않게). */
export const MIN_FLOOR_DROP_M = 0.9;
/** 기억해 둘 버린 원점 수(오래된 것부터 잊는다). */
const MAX_RETIRED = 64;
const avg = (vs: number[]) => vs.reduce((a, b) => a + b, 0) / vs.length;

/** floor: 평면도 ar_anchors 바닥을 조준한다. touch: 대시보드에서 고른 벽 지점 A·B에 폰을 댄다(touch.ts). */
export type AlignMode = "floor" | "touch";

/** 폰에 보내는 위치 맞춤 상태(설정 모달·비전 상태 줄). */
export interface SyncStatus {
  /** none: 변환 없음, estimated: 어림(시작 위치만·증거 모자람), aligned: 맞춤. */
  state: "none" | "estimated" | "aligned";
  source: SyncSource | null;
  /** 이 집의 시작 위치 이름(설정에서 저장). 없으면 null. */
  start: { label: string; facing: string } | null;
  /** 이 AR에서 「여기서 시작」을 했다. */
  started: boolean;
  /** 짝지은 물건 수, 벽에 맞는 점 수, 오차(m). */
  anchors: number;
  wall_points: number;
  residual_m: number | null;
}

export interface PhoneStatus {
  type: "status";
  mode: AlignMode;
  /** 기준점이 바뀔 때마다 1씩 오른다. 폰은 바뀌면 진행 중인 기록을 버린다. */
  revision: number;
  anchors: { id: string; label: string; recorded: boolean }[];
  aligned: boolean;
  mismatch_m: number | null;
  error?: string;
  /** 엔진 프레임 간격(ms). 관찰 흐름이 켜졌을 때 폰 서버가 싣는다(server.ts). */
  engine_ms?: number;
  /** 위치 맞춤 모듈이 있을 때만. */
  sync?: SyncStatus;
}

/** 맞추기 전 눈을 둘 자리: 평면도 위치, 'AR 시작 방향'으로 볼 방위(도), 눈 높이. */
export interface FallbackViewpoint {
  position: Plan2;
  yawDeg: number;
  heightM: number;
}

const FALLBACK_HEIGHT_M = 1.3;
const FALLBACK_INSET_M = 0.8;

type Poly = number[][];
function polygonArea(poly: Poly): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    a += x1! * y2! - x2! * y1!;
  }
  return a / 2;
}
function centroid(poly: Poly): Plan2 {
  const a = polygonArea(poly);
  if (Math.abs(a) < 1e-9) return [poly.reduce((s, p) => s + p[0]!, 0) / poly.length, poly.reduce((s, p) => s + p[1]!, 0) / poly.length];
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    const f = x1! * y2! - x2! * y1!;
    cx += (x1! + x2!) * f;
    cy += (y1! + y2!) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/** 맞추기 전 기본 눈: 가장 넓은 방(창이 있는 방 중)의 가장 넓은 창에서 방 무게중심 쪽으로 0.8m, 높이 1.3m.
 *  창이 없으면 가장 넓은 방 무게중심, 방위 90(평면도 아래쪽). */
export function estimateViewpoint(scene: { plan?: { rooms?: { id: string; polygon?: Poly }[]; windows?: { id?: string; position?: number[]; width?: number; room?: string }[] } }): FallbackViewpoint {
  const rooms = (scene.plan?.rooms ?? []).filter((r) => Array.isArray(r.polygon) && r.polygon.length >= 3);
  const area = (id?: string) => Math.abs(polygonArea(rooms.find((r) => r.id === id)?.polygon ?? []));
  const windows = (scene.plan?.windows ?? []).filter((w) => Array.isArray(w.position) && rooms.some((r) => r.id === w.room));
  const win = [...windows].sort((a, b) => area(b.room) - area(a.room) || (b.width ?? 0) - (a.width ?? 0))[0];
  if (!win) {
    const big = [...rooms].sort((a, b) => Math.abs(polygonArea(b.polygon!)) - Math.abs(polygonArea(a.polygon!)))[0];
    return { position: big ? centroid(big.polygon!) : [0, 0], yawDeg: 90, heightM: FALLBACK_HEIGHT_M };
  }
  const [wx, wy] = win.position as Plan2;
  const [cx, cy] = centroid(rooms.find((r) => r.id === win.room)!.polygon!);
  const len = Math.hypot(cx - wx, cy - wy) || 1;
  const d: Plan2 = [(cx - wx) / len, (cy - wy) / len];
  const round = (v: number) => Math.round(v * 1000) / 1000 + 0;
  return {
    position: [round(wx + d[0] * FALLBACK_INSET_M), round(wy + d[1] * FALLBACK_INSET_M)],
    yawDeg: round((((Math.atan2(d[1], d[0]) * 180) / Math.PI) + 360) % 360),
    heightM: FALLBACK_HEIGHT_M,
  };
}

/** 엔진 프레임의 카메라: 원점은 트윈 눈 위치 [x, 높이, y], 방향 계산에 쓸 AR 회전과 맞춤 회전(theta), 투영 행렬(16개, 열 우선). */
export interface CameraView {
  origin: Vec3;
  orientation: Quat;
  theta: number;
  projection: number[];
}

/** '여기'로 쓸 수 있는 마지막 자세의 나이(ms). */
export const HERE_MAX_AGE_MS = 15_000;

export type HerePoint = { position: Plan2; from: Plan2 } | { error: string };

/** 실제 두 기준점 거리와 트윈 거리의 차이가 이보다 크면 맞추지 않는다(SSOT 17절 초안 30cm). */
export const DEFAULT_MAX_MISMATCH_M = 0.3;

export interface PhoneSessionOptions {
  now?: () => Date;
  maxMismatchM?: number;
  /** 있으면 맞추기 전에도 추정 눈(estimated)을 보낸다. */
  fallback?: FallbackViewpoint;
  mode?: AlignMode;
  /** touch 모드의 눈 높이(방 바닥 위 m). 높이는 재지 않고 이 값으로 둔다. 기본 1.5. */
  eyeHeightM?: number;
  /** 평면 점이 있는 방의 바닥 높이(floor_z). touch 모드 눈 높이에 더한다. 없으면 0. */
  floorAt?: (p: Plan2) => number;
  /** 위치 맞춤 모듈(src/sync): 트윈 물건 기준점, 방 쪽 벽 면, 이 집의 시작 위치. 없으면 기준점 두 곳으로만 맞춘다. */
  sync?: { landmarks: readonly TwinLandmark[]; walls: readonly WallSeg[]; start?: StartPose | null };
}

/** 기준점 상자 하나(엔진 프레임 YOLO, src/brain/detector.ts LandmarkBox). */
export interface LandmarkBoxIn { cls: number; score: number; box: [number, number, number, number] }

export class PhoneSession {
  private readonly points = new Map<string, Vec3>();
  private alignment: Alignment | null = null;
  /** 맞춘 뒤 받은 마지막 자세: 조준점(평면도, 없으면 null)과 폰 위치. */
  private last: { at: number; hit: Plan2 | null; eye: Plan2 } | null = null;
  private readonly now: () => Date;
  private readonly maxMismatchM: number;
  private readonly fallback?: FallbackViewpoint;
  private readonly eyeHeightM: number;
  private readonly floorAt: (p: Plan2) => number;
  /** touch 모드에서 기록할 때 바닥 조준점(기준점 id별). */
  private readonly floors = new Map<string, Vec3>();
  private targets: AnchorTarget[] = [];
  private mode: AlignMode = "floor";
  /** 지금 기록·맞춤이 속한 AR 원점(폰이 보낸 epoch). 다른 epoch가 오면 이전 것은 버린다. */
  private epoch: string | null = null;
  /** 이미 버린 원점들. 늦게 도착한 그 원점의 메시지로 되돌아가지 않게 한다. */
  private readonly retired = new Set<string>();
  private revision = 0;
  /** 위치 맞춤 모듈과 이 집의 시작 위치. */
  private readonly sync: SyncAligner | null;
  private startPose: StartPose | null;
  /** 폰에 마지막으로 알린 맞춤 상태(바뀜 알림용)와 그때 변환·폰 자리. */
  private told = "";
  private toldRigid: SyncState["rigid"] = null;
  private lastPhone: Plan2 = [0, 0];

  constructor(targets: AnchorTarget[], opts: PhoneSessionOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    this.maxMismatchM = opts.maxMismatchM ?? DEFAULT_MAX_MISMATCH_M;
    this.fallback = opts.fallback;
    this.eyeHeightM = opts.eyeHeightM ?? DEFAULT_EYE_HEIGHT_M;
    this.floorAt = opts.floorAt ?? (() => 0);
    this.sync = opts.sync
      ? new SyncAligner({ landmarks: opts.sync.landmarks, walls: opts.sync.walls, eyeHeightM: this.eyeHeightM, floorAt: this.floorAt, now: () => this.now().getTime() })
      : null;
    this.startPose = opts.sync?.start ?? null;
    this.setTargets(targets, opts.mode ?? "floor");
    this.told = this.syncKey();
  }

  /** 설정에서 시작 위치를 저장·지우면 바꾼다(이번 AR의 시작 기록은 그대로). */
  setStart(start: StartPose | null): void {
    this.startPose = start ? { ...start, position: [start.position[0], start.position[1]] } : null;
  }

  /** 배치 보정으로 트윈 물건이 바뀌면 기준점 목록을 바꾼다. */
  setLandmarks(list: readonly TwinLandmark[]): void {
    this.sync?.setLandmarks(list);
  }

  /** 위치 맞춤 모듈 상태(GET /api/phone/sync). 모듈이 없으면 null. */
  syncState(): SyncState | null {
    return this.sync?.state() ?? null;
  }

  /** 지금 쓰는 변환과 맞춤인지. 모듈이 있으면 모듈의 변환(기준점 두 곳 기록도 모듈에 넣는다), 없으면 기준점 두 곳 맞춤. */
  private active(): { al: Alignment; aligned: boolean } | null {
    if (this.sync) {
      const st = this.sync.state();
      if (!st.rigid) return null;
      return { al: { ...st.rigid, floorY: st.floorY ?? 0, mismatchM: this.alignment?.mismatchM ?? 0 }, aligned: st.aligned };
    }
    return this.alignment ? { al: this.alignment, aligned: true } : null;
  }

  /** 맞춘 변환(어림이면 null). */
  private alignedNow(): Alignment | null {
    const a = this.active();
    return a?.aligned ? a.al : null;
  }

  private syncStatus(): SyncStatus | undefined {
    if (!this.sync) return undefined;
    const st = this.sync.state();
    return {
      state: !st.rigid ? "none" : st.aligned ? "aligned" : "estimated",
      source: st.source,
      start: this.startPose ? { label: this.startPose.label, facing: this.startPose.facingLabel } : null,
      started: st.started,
      anchors: st.anchors,
      wall_points: st.wallPoints,
      residual_m: st.residualM === null ? null : Math.round(st.residualM * 100) / 100,
    };
  }

  /** 폰에 다시 알릴 만큼 바뀌었는지 보는 열쇠: 상태·출처·시작·물건 수·벽 점 10개 단위·오차 cm. */
  private syncKey(): string {
    const s = this.syncStatus();
    return s ? JSON.stringify([s.state, s.source, s.started, s.anchors, Math.floor(s.wall_points / 10), s.residual_m, s.start?.label ?? null]) : "";
  }

  /** 맞춤 상태가 바뀌었거나 변환이 폰 자리에서 5cm 넘게 움직였으면 true(그때 폰 서버가 상태와 지금 명령을 다시 보낸다). */
  private syncChanged(): boolean {
    if (!this.sync) return false;
    const key = this.syncKey();
    const rigid = this.sync.state().rigid;
    const moved = (rigid === null) !== (this.toldRigid === null)
      || (rigid !== null && this.toldRigid !== null && rigidGap(rigid, this.toldRigid, [this.lastPhone]).shiftM > 0.05);
    if (key === this.told && !moved) return false;
    this.told = key;
    this.toldRigid = rigid;
    return true;
  }

  /** 엔진 프레임 YOLO 기준점 상자(서버 감지기). 찍은 원점이 지금 원점이 아니거나 자세·투영이 없으면 버린다. 맞춤이 바뀌면 true. */
  landmarks(header: FrameHeader, boxes: readonly LandmarkBoxIn[]): boolean {
    if (!this.sync || !boxes.length || !header.position || !header.orientation || header.projection?.length !== 16) return false;
    if (header.epoch !== undefined && header.epoch !== this.epoch) return false;
    this.sync.addLandmarks(
      { position: header.position, orientation: header.orientation, projection: header.projection },
      { width: header.width, height: header.height }, boxes.map((b) => ({ label: b.cls, score: b.score, box: b.box })),
    );
    return this.syncChanged();
  }

  /** 기준점·모드를 바꾼다(대시보드에서 A·B를 저장·지울 때). 기록과 맞춤은 지운다. */
  setTargets(targets: AnchorTarget[], mode: AlignMode): void {
    if (targets.length !== 2) throw new Error("기준점은 두 곳이어야 합니다");
    this.targets = targets.map((t) => ({ ...t, plan: [t.plan[0], t.plan[1]] }));
    this.mode = mode;
    this.revision += 1;
    this.forgetManual();
  }

  /** 기준점 기록·맞춤과 위치 맞춤 모듈을 모두 지운다(새 원점·다시 맞추기). */
  private forget(): void {
    this.forgetManual();
    this.sync?.reset();
  }

  /** 기준점 두 곳 기록만 지운다. 모듈 변환이 그 기록에서 왔으면 그것도 지운다. */
  private forgetManual(): void {
    this.points.clear();
    this.floors.clear();
    this.alignment = null;
    this.last = null;
    const src = this.sync?.state().source;
    if (src === "touch" || src === "floor") this.sync!.reset();
  }

  private retire(epoch: string | null): void {
    if (epoch === null) return;
    this.retired.add(epoch);
    if (this.retired.size > MAX_RETIRED) this.retired.delete(this.retired.values().next().value!);
  }

  /** 폰이 보낸 AR 원점을 따른다. 새 원점이면 이전 기록·맞춤을 버린다(reset이 연결 끊김으로 못 와도).
   *  stale: 이미 버린 원점의 늦은 메시지. dropped: 이번에 버린 기록·맞춤이 있었다. */
  private adoptEpoch(epoch: string | undefined): { stale: boolean; dropped: boolean } {
    if (epoch === undefined || epoch === this.epoch) return { stale: false, dropped: false };
    if (this.retired.has(epoch)) return { stale: true, dropped: false };
    const had = this.points.size > 0 || this.alignment !== null || this.active() !== null;
    this.retire(this.epoch);
    this.epoch = epoch;
    this.forget();
    return { stale: false, dropped: had };
  }

  get aligned(): boolean {
    return this.alignedNow() !== null;
  }

  /** '여기' = 마지막 자세의 조준점(평면도)과 그때 폰 위치. 모르면 이유. */
  here(): HerePoint {
    if (!this.alignedNow()) {
      return this.active()
        ? { error: "폰 위치를 맞추는 중이에요. 방을 천천히 둘러본 뒤 다시 말해 주세요." }
        : { error: "폰을 트윈에 맞추기 전이에요. 폰 화면에서 기준점 두 곳을 먼저 기록해 주세요." };
    }
    if (!this.last) return { error: "폰 AR이 켜져 있지 않아요. 폰에서 AR 시작을 눌러 주세요." };
    if (this.now().getTime() - this.last.at > HERE_MAX_AGE_MS) return { error: "폰 AR 자세가 15초 넘게 오지 않았어요. 폰 화면을 켜고 다시 말해 주세요." };
    if (!this.last.hit) return { error: "폰 조준점이 바닥에 닿지 않았어요. 물건 아래 바닥을 가리키고 다시 말해 주세요." };
    return { position: this.last.hit, from: this.last.eye };
  }

  /** 트윈 점 [x, 높이, y] → AR 좌표. 맞추기 전이면 null. */
  toAr(point: Vec3): Vec3 | null {
    const al = this.alignedNow();
    return al ? fromTwin(point, al) : null;
  }

  /** 맞춘 뒤에만 트윈 좌표의 눈 자세를 준다. */
  eyeFor(position: Vec3, orientation: Quat, tracking: "ok" | "limited"): EyeEvent | null {
    const al = this.alignedNow();
    if (!al) return null;
    const pose = toTwin(position, orientation, al);
    // touch 모드는 높이를 재지 않는다: 눈은 그 자리 방 바닥 위 사람 눈높이
    if (this.mode === "touch") pose.height_m = Math.round((this.eyeHeightM + this.floorAt(pose.position)) * 1000) / 1000;
    return { ...pose, tracking, at: this.now().toISOString() };
  }

  /** 사진처럼 늦게 도착할 수 있는 자세: 찍은 원점(epoch)이 지금 맞춤의 원점과 다르면 null. 원점이 없으면 eyeFor와 같다. */
  eyeAt(position: Vec3, orientation: Quat, tracking: "ok" | "limited", epoch: string | undefined): EyeEvent | null {
    if (epoch !== undefined && epoch !== this.epoch) return null;
    return this.eyeFor(position, orientation, tracking);
  }

  /** 엔진 프레임의 카메라. 원점은 eyeAt의 트윈 눈 위치(touch 모드 높이 규칙 포함). 맞추기 전·다른 원점·투영 없음이면 null. */
  viewAt(position: Vec3, orientation: Quat, projection: number[] | undefined, epoch: string | undefined): CameraView | null {
    if (!projection || projection.length !== 16) return null;
    const eye = this.eyeAt(position, orientation, "ok", epoch);
    const al = this.alignedNow();
    if (!eye || !al) return null;
    return { origin: [eye.position[0], eye.height_m, eye.position[1]], orientation, theta: al.theta, projection: [...projection] };
  }

  /** 맞추기 전 추정 눈: 위치·높이는 고정, 방향은 폰 자세. AR local 공간이 시작할 때 폰은 -Z를 보므로
   *  -Z를 fallback.yawDeg로 돌리는 가상 맞춤을 써서 돌리면 yaw, 기울이면 pitch가 바뀐다. */
  estimateFor(position: Vec3, orientation: Quat, tracking: "ok" | "limited"): EyeEvent | null {
    // 위치 맞춤 모듈의 어림 변환(시작 위치 등)이 있으면 그것으로: 자리·방향 모두 따라가되 estimated
    const act = this.active();
    if (act && !act.aligned) return { ...toTwin(position, orientation, act.al), tracking, at: this.now().toISOString(), estimated: true };
    if (!this.fallback) return null;
    const virtual: Alignment = { theta: (this.fallback.yawDeg * Math.PI) / 180 + Math.PI / 2, tx: 0, ty: 0, floorY: 0, mismatchM: 0 };
    const pose = toTwin(position, orientation, virtual);
    return {
      ...pose, position: [...this.fallback.position], height_m: this.fallback.heightM,
      tracking, at: this.now().toISOString(), estimated: true,
    };
  }

  status(error?: string): PhoneStatus {
    return {
      type: "status",
      mode: this.mode,
      revision: this.revision,
      anchors: this.targets.map((t) => ({ id: t.id, label: t.label, recorded: this.points.has(t.id) })),
      aligned: this.alignedNow() !== null,
      mismatch_m: this.alignment ? Math.round(this.alignment.mismatchM * 100) / 100 : null,
      ...(error ? { error } : {}),
      ...(this.sync ? { sync: this.syncStatus() } : {}),
    };
  }

  /** changed: 위치 맞춤 상태가 바뀌었다(폰 서버가 모든 폰에 상태를, 맞췄으면 지금 명령을 다시 보낸다). */
  handle(raw: unknown): { reply?: PhoneStatus; eye?: EyeEvent; changed?: boolean } {
    const out = this.handleMessage(raw);
    return this.syncChanged() ? { ...out, changed: true } : out;
  }

  private handleMessage(raw: unknown): { reply?: PhoneStatus; eye?: EyeEvent } {
    const parsed = MessageSchema.safeParse(raw);
    if (!parsed.success) return { reply: this.status("알 수 없는 메시지입니다") };
    const msg = parsed.data;
    if (msg.type === "reset") {
      // 버린 원점의 늦은 reset은 지금 맞춤을 건드리지 않는다
      if (this.adoptEpoch(msg.epoch).stale) return { reply: this.status() };
      this.forget();
      return { reply: this.status() };
    }
    if (msg.type === "start") {
      if (!this.sync || !this.startPose) return { reply: this.status("시작 위치가 없어요. 설정 화면에서 시작 위치를 먼저 정해 주세요") };
      if (this.adoptEpoch(msg.epoch).stale) return { reply: this.status("이전 AR 세션의 기록이라 받지 않았어요. 다시 눌러 주세요") };
      // 시작 위치로 다시 맞추면 기준점 두 곳 기록은 버린다
      this.points.clear();
      this.floors.clear();
      this.alignment = null;
      this.last = null;
      this.lastPhone = [msg.position[0], msg.position[2]];
      this.sync.confirmStart(this.startPose, msg.position, msg.orientation);
      return { reply: this.status() };
    }
    if (msg.type === "surface" || msg.type === "landmarks") {
      if (!this.sync || this.adoptEpoch(msg.epoch).stale) return {};
      if (msg.type === "surface") {
        this.sync.addSurface(msg.points.map((p) => ({ point: [p[0], p[1], p[2]] as Vec3, normal: [p[3], p[4], p[5]] as Vec3 })), msg.camera);
      } else {
        const boxes = msg.boxes.flatMap((b) => {
          const label = b.label ?? b.cls;
          return label === undefined ? [] : [{ label, score: b.score, box: b.box }];
        });
        this.sync.addLandmarks({ position: msg.position, orientation: msg.orientation, projection: msg.projection }, { width: msg.width, height: msg.height }, boxes);
      }
      return {};
    }
    if (msg.type === "anchor") {
      if (!this.targets.some((t) => t.id === msg.id)) return { reply: this.status(`모르는 기준점입니다: ${msg.id}`) };
      if (msg.revision !== undefined && msg.revision !== this.revision) {
        return { reply: this.status("기록하는 사이 기준점이 바뀌었어요. 다시 기록해 주세요") };
      }
      if (this.adoptEpoch(msg.epoch).stale) return { reply: this.status("이전 AR 세션의 기록이라 받지 않았어요. 다시 기록해 주세요") };
      this.points.set(msg.id, msg.point);
      if (msg.floor) this.floors.set(msg.id, msg.floor);
      else this.floors.delete(msg.id);
      this.alignment = null;
      this.last = null;
      if (this.points.size < this.targets.length) return { reply: this.status() };
      const [a, b] = this.targets.map((t) => ({ ar: this.points.get(t.id)!, plan: t.plan }));
      let al: Alignment;
      try {
        al = solveAlignment(a!, b!);
      } catch (e) {
        return { reply: this.status((e as Error).message) };
      }
      if (al.mismatchM > this.maxMismatchM) {
        const cm = (m: number) => Math.round(m * 100);
        return { reply: this.status(`실제 거리와 트윈 거리가 ${cm(al.mismatchM)}cm 달라요(허용 ${cm(this.maxMismatchM)}cm). 기준점을 다시 찍어 주세요`) };
      }
      // floorY = 트윈 높이 0의 AR y. 기준점이 있는 방의 바닥 단차(floor_z)를 빼서 맞춘다.
      // touch 모드의 기록 점은 벽 아래 바닥을 조준한 점(point = floor)이거나, 예전처럼 벽에 댄 폰 높이다.
      // 바닥은 기록 점 자체가 바닥이면 그 높이, 아니면 조준점이 닿은 면 중 폰보다 MIN_FLOOR_DROP_M 이상
      // 아래인 것으로 재고(초점 고리에만 쓰임), 하나도 없으면 눈높이만큼 아래로 어림한다
      const ar = (t: AnchorTarget) => this.points.get(t.id)!;
      if (this.mode === "touch") {
        const measured = this.targets.flatMap((t) => {
          const f = this.floors.get(t.id);
          const isFloor = f && Math.hypot(ar(t)[0] - f[0], ar(t)[1] - f[1], ar(t)[2] - f[2]) < 0.01;
          return f && (isFloor || ar(t)[1] - f[1] >= MIN_FLOOR_DROP_M) ? [f[1] - this.floorAt(t.plan)] : [];
        });
        al.floorY = measured.length ? avg(measured) : avg(this.targets.map((t) => ar(t)[1] - this.eyeHeightM - this.floorAt(t.plan)));
      } else {
        al.floorY = avg(this.targets.map((t) => ar(t)[1] - this.floorAt(t.plan)));
      }
      this.alignment = al;
      this.sync?.seed(al, this.mode, al.mismatchM);
      return { reply: this.status() };
    }
    const { stale, dropped } = this.adoptEpoch(msg.epoch);
    if (stale) return {};
    this.lastPhone = [msg.position[0], msg.position[2]];
    this.sync?.addPose({
      position: msg.position, orientation: msg.orientation, hit: msg.hit ?? null, hitNormal: msg.hit_normal ?? null,
      hitEstimated: msg.hit_estimated === true, floorY: msg.floor_y ?? null,
    });
    const eye = this.eyeFor(msg.position, msg.orientation, msg.tracking) ?? this.estimateFor(msg.position, msg.orientation, msg.tracking);
    const al = this.alignedNow();
    if (eye && al) {
      this.last = { at: this.now().getTime(), hit: msg.hit ? planOf(msg.hit, al) : null, eye: eye.position };
    }
    const reply = dropped ? this.status("AR 원점이 바뀌어 맞춤을 지웠어요. 기준점을 다시 기록해 주세요") : undefined;
    return { ...(reply ? { reply } : {}), ...(eye ? { eye } : {}) };
  }
}
