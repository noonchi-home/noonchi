// 폰 한 대의 AR 세션 상태. 위치 맞춤 모듈(src/phone/sync/aligner.ts)로 트윈에 맞추고, 그 뒤 자세를 눈 자세로 바꾼다.
// 네트워크와 무관하므로 server.ts가 WebSocket 메시지를 그대로 넘긴다.
// 「여기서 시작」(start)이면 바로 어림, 걸으며 오는 실제 hit 벽 점(pose의 hit·hit_normal, 앱은 surface)과 물건 상자(엔진 프레임 YOLO 또는
// 앱의 landmarks)가 기준을 넘으면 맞춤. 어림이면 눈만 estimated로 보내고 사진·카메라(World State)·고리·「여기」에는 쓰지 않는다.
// 아무 변환도 없으면 창가 고정 자리 + 폰 방향의 추정 눈(estimateViewpoint)을 보낸다.

import { z } from "zod";
import type { EyeEvent } from "../contract/events.js";
import { SyncAligner, type SyncSource, type SyncState } from "./sync/aligner.js";
import type { TwinLandmark } from "./sync/landmarks.js";
import { rigidGap } from "./sync/rigid.js";
import type { StartPose } from "./sync/start.js";
import type { WallSeg } from "./sync/walls.js";
import { fromTwin, planOf, toTwin, type Alignment, type Plan2, type Vec3 } from "../shared/geometry.js";
import type { Quat, CameraView } from "../contract/observe.js";
import { DEFAULT_EYE_HEIGHT_M } from "../layout/index.js";
import { PHOTO_GAP_DEG, photoConflict } from "../shared/photo-alignment.js";
import type { FrameHeader } from "./packet.js";

export type { EyeEvent } from "../contract/events.js";

const num = z.number().refine(Number.isFinite);
const Vec3Schema = z.tuple([num, num, num]);
const QuatSchema = z.tuple([num, num, num, num]);
const BoxSchema = z.tuple([num, num, num, num]);
/** 폰이 AR 세션을 열거나 추적 원점이 다시 잡힐 때마다 새로 만드는 값. 바뀌면 이전 AR 좌표의 증거·맞춤은 못 쓴다. */
const Epoch = z.string().min(1).max(64).optional();
const MessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("pose"),
    position: Vec3Schema,
    orientation: QuatSchema,
    tracking: z.enum(["ok", "limited"]).default("ok"),
    /** 화면 가운데 조준점이 닿은 점(AR 공간). 닿지 않으면 null. */
    hit: Vec3Schema.nullable().optional(),
    /** hit이 hit-test 점이 아니라 어림 바닥 점(시선과 local-floor 또는 폰 1.5m 아래 면이 만나는 점). */
    hit_estimated: z.boolean().optional(),
    /** 실제 hit-test 점의 면 법선(AR, hit 자세의 +Y). 벽 점·바닥 점을 가른다. */
    hit_normal: Vec3Schema.nullable().optional(),
    /** 폰이 어림한 바닥 높이(AR y: local-floor, 없으면 폰 1.5m 아래). */
    floor_y: num.nullable().optional(),
    epoch: Epoch,
  }),
  /** 「여기서 시작」: 시작 자리에 서서 그 방향을 본 순간의 자세. fixed: 영상 모드 고정 카메라라 바로 맞춤(aligner.ts fixStart). */
  z.object({ type: z.literal("start"), position: Vec3Schema, orientation: QuatSchema, fixed: z.boolean().optional(), epoch: Epoch }),
  /** 앱: 한꺼번에 보내는 면 점 [x, y, z, nx, ny, nz]와 그때 카메라 자리. */
  z.object({ type: z.literal("surface"), camera: Vec3Schema, points: z.array(z.tuple([num, num, num, num, num, num])).max(256), epoch: Epoch }),
  /** 앱: 자기 감지기로 찾은 기준점 상자(낱말 표 키 또는 COCO 번호)와 그 순간 카메라. */
  z.object({
    type: z.literal("landmarks"), position: Vec3Schema, orientation: QuatSchema, projection: z.array(num).length(16),
    width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192),
    boxes: z.array(z.object({ label: z.union([z.string().max(32), z.number().int()]).optional(), cls: z.number().int().optional(), score: num, box: BoxSchema })).max(32),
    epoch: Epoch,
  }),
  /** epoch: 폰의 지금 AR 원점. 같으면 맞춤만 지우고, 새 원점이면 이전 원점을 버린다. */
  z.object({ type: z.literal("reset"), epoch: Epoch }),
]);

/** 기억해 둘 버린 원점 수(오래된 것부터 잊는다). */
const MAX_RETIRED = 64;

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
  aligned: boolean;
  sync: SyncStatus;
  error?: string;
  /** 엔진 프레임 간격(ms). 관찰 흐름이 켜졌을 때 폰 서버가 싣는다(server.ts). */
  engine_ms?: number;
  /** 서버가 쓰는 폰 계약 판본(src/phone/protocol.ts). 폰 서버가 싣는다(server.ts). 폰 빌드와 다르면 폰 페이지가 다시 읽는다. */
  protocol?: number;
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


/** '여기'로 쓸 수 있는 마지막 자세의 나이(ms). */
export const HERE_MAX_AGE_MS = 15_000;

export type HerePoint = { position: Plan2; from: Plan2 } | { error: string };

export interface PhoneSessionOptions {
  now?: () => Date;
  /** 있으면 맞추기 전에도 추정 눈(estimated)을 보낸다. */
  fallback?: FallbackViewpoint;
  /** 바닥 hit이 없을 때 폰 높이에서 빼는 눈높이(m, 기본 1.5). */
  eyeHeightM?: number;
  /** 평면 점이 있는 방의 바닥 높이(floor_z). 없으면 0. */
  floorAt?: (p: Plan2) => number;
  /** 트윈 물건 기준점, 방 쪽 벽 면, 이 집의 시작 위치. */
  sync: { landmarks: readonly TwinLandmark[]; walls: readonly WallSeg[]; start?: StartPose | null };
}

/** 기준점 상자 하나(엔진 프레임 YOLO, src/observe/detector.ts LandmarkBox). */
export interface LandmarkBoxIn { cls: number; score: number; box: [number, number, number, number] }

export class PhoneSession {
  /** 맞춘 뒤 받은 마지막 자세: 조준점(평면도, 없으면 null)과 폰 위치. */
  private last: { at: number; hit: Plan2 | null; eye: Plan2 } | null = null;
  private readonly now: () => Date;
  private readonly fallback?: FallbackViewpoint;
  /** 지금 증거·맞춤이 속한 AR 원점(폰이 보낸 epoch). 다른 epoch가 오면 이전 것은 버린다. */
  private epoch: string | null = null;
  /** 이미 버린 원점들. 늦게 도착한 그 원점의 메시지로 되돌아가지 않게 한다. */
  private readonly retired = new Set<string>();
  private readonly sync: SyncAligner;
  private startPose: StartPose | null;
  /** 폰에 마지막으로 알린 맞춤 상태(바뀜 알림용)와 그때 변환·폰 자리. */
  private told = "";
  private toldRigid: SyncState["rigid"] = null;
  private photoFrames=new WeakSet<FrameHeader>();
  private photoAt=-Infinity;
  markEngine(header:FrameHeader):void { this.photoFrames.add(header); }
  localized(header:FrameHeader,r:import("../bus/index.js").Body<"/perception/localized">):boolean {
    if(!this.photoFrames.delete(header) || header.held || header.tracking==="limited" ||
      !header.position || !header.orientation || !header.projection || (header.epoch!==undefined && header.epoch!==this.epoch) ||
      this.photoAt>=r.captured_ms) return false;
    this.photoAt=r.captured_ms;
    const ar=toTwin(header.position,header.orientation,{theta:0,tx:0,ty:0,floorY:0});
    const conflict=photoConflict(r.ar_gap_m,r.ar_gap_deg) || (r.pitch_deg!==null && Math.abs(ar.pitch_deg-r.pitch_deg)>PHOTO_GAP_DEG);
    if(r.position && r.yaw_deg!==null && (!this.aligned || conflict)) {
      // 다시 맞췄을 때만 그 전 원점으로 표시한 프레임을 버린다
      if(this.sync.photo(header.position,header.orientation,r.position,r.yaw_deg,conflict)) this.photoFrames=new WeakSet();
    } else if(r.position && r.yaw_deg!==null) this.sync.photoAgrees();
    return true;
  }
  private lastPhone: Plan2 = [0, 0];

  constructor(opts: PhoneSessionOptions) {
    this.now = opts.now ?? (() => new Date());
    this.fallback = opts.fallback;
    this.sync = new SyncAligner({
      landmarks: opts.sync.landmarks, walls: opts.sync.walls, eyeHeightM: opts.eyeHeightM ?? DEFAULT_EYE_HEIGHT_M,
      floorAt: opts.floorAt ?? (() => 0), now: () => this.now().getTime(),
    });
    this.startPose = opts.sync.start ?? null;
    this.told = this.syncKey();
  }

  /** 설정에서 시작 위치를 저장·지우면 바꾼다(이번 AR의 시작 기록은 그대로). */
  setStart(start: StartPose | null): void {
    this.startPose = start ? { ...start, position: [start.position[0], start.position[1]] } : null;
  }

  /** 배치 보정으로 트윈 물건이 바뀌면 기준점 목록을 바꾼다. */
  setLandmarks(list: readonly TwinLandmark[]): void {
    this.sync.setLandmarks(list);
  }

  /** 위치 맞춤 모듈 상태(GET /api/phone/sync). */
  syncState(): SyncState {
    return this.sync.state();
  }

  /** 지금 변환과 맞춤인지. 변환이 없으면 null. */
  private active(): { al: Alignment; aligned: boolean } | null {
    const st = this.sync.state();
    return st.rigid ? { al: { ...st.rigid, floorY: st.floorY ?? 0 }, aligned: st.aligned } : null;
  }

  /** 맞춘 변환(어림이면 null). */
  private alignedNow(): Alignment | null {
    const a = this.active();
    return a?.aligned ? a.al : null;
  }

  private syncStatus(): SyncStatus {
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
    return JSON.stringify([s.state, s.source, s.started, s.anchors, Math.floor(s.wall_points / 10), s.residual_m, s.start?.label ?? null]);
  }

  /** 맞춤 상태가 바뀌었거나 변환이 폰 자리에서 5cm 넘게 움직였으면 true(그때 폰 서버가 상태와 지금 명령을 다시 보낸다). */
  private syncChanged(): boolean {
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
    if (!boxes.length || !header.position || !header.orientation || header.projection?.length !== 16) return false;
    if (header.epoch !== undefined && header.epoch !== this.epoch) return false;
    this.sync.addLandmarks(
      { position: header.position, orientation: header.orientation, projection: header.projection },
      { width: header.width, height: header.height }, boxes.map((b) => ({ label: b.cls, score: b.score, box: b.box })),
    );
    return this.syncChanged();
  }

  /** 맞춤과 모은 증거를 모두 지운다(새 원점·다시 맞추기). */
  private forget(): void {
    this.photoFrames=new WeakSet();
    this.photoAt=-Infinity;
    this.last = null;
    this.sync.reset();
  }

  private retire(epoch: string | null): void {
    if (epoch === null) return;
    this.retired.add(epoch);
    if (this.retired.size > MAX_RETIRED) this.retired.delete(this.retired.values().next().value!);
  }

  /** 폰이 보낸 AR 원점을 따른다. 새 원점이면 이전 맞춤을 버린다(reset이 연결 끊김으로 못 와도).
   *  stale: 이미 버린 원점의 늦은 메시지. dropped: 이번에 버린 맞춤이 있었다. */
  private adoptEpoch(epoch: string | undefined): { stale: boolean; dropped: boolean } {
    if (epoch === undefined || epoch === this.epoch) return { stale: false, dropped: false };
    if (this.retired.has(epoch)) return { stale: true, dropped: false };
    const had = this.active() !== null;
    this.retire(this.epoch);
    this.epoch = epoch;
    this.forget();
    return { stale: false, dropped: had };
  }

  private navRigid: SyncState["rigid"]=null;
  navigationShifted():boolean {
    const rigid=this.sync.state().rigid;
    const gap=rigid && this.navRigid ? rigidGap(this.navRigid,rigid,[this.lastPhone]) : null;
    const shifted=gap ? gap.shiftM>0.10 || gap.rotDeg>5 : rigid!==this.navRigid;
    if(shifted) this.navRigid=rigid;
    return shifted;
  }

  retiredOrigin(epoch:string):boolean { return this.retired.has(epoch); }

  get aligned(): boolean {
    return this.alignedNow() !== null;
  }

  /** '여기' = 마지막 자세의 조준점(평면도)과 그때 폰 위치. 모르면 이유. */
  here(): HerePoint {
    if (!this.alignedNow()) {
      return this.active()
        ? { error: "폰 위치를 맞추는 중이에요. 방을 천천히 둘러본 뒤 다시 말해 주세요." }
        : { error: "폰을 트윈에 맞추기 전이에요. 폰에서 시작 위치에 서서 「여기서 시작」을 해 주세요." };
    }
    if (!this.last) return { error: "폰 AR이 켜져 있지 않아요. 폰에서 ‘카메라 켜기’를 눌러 주세요." };
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
    return al ? { ...toTwin(position, orientation, al), tracking, at: this.now().toISOString() } : null;
  }

  /** 사진처럼 늦게 도착할 수 있는 자세: 찍은 원점(epoch)이 지금 맞춤의 원점과 다르면 null. 원점이 없으면 eyeFor와 같다. */
  eyeAt(position: Vec3, orientation: Quat, tracking: "ok" | "limited", epoch: string | undefined): EyeEvent | null {
    if (epoch !== undefined && epoch !== this.epoch) return null;
    return this.eyeFor(position, orientation, tracking);
  }

  /** 엔진 프레임의 카메라. 원점은 eyeAt의 트윈 눈 위치. 맞추기 전·다른 원점·투영 없음이면 null. */
  viewAt(position: Vec3, orientation: Quat, projection: number[] | undefined, epoch: string | undefined): CameraView | null {
    if (!projection || projection.length !== 16) return null;
    const eye = this.eyeAt(position, orientation, "ok", epoch);
    const al = this.alignedNow();
    if (!eye || !al) return null;
    return { origin: [eye.position[0], eye.height_m, eye.position[1]], orientation, theta: al.theta, projection: [...projection] };
  }

  /** 맞추기 전 추정 눈. 어림 변환(시작 위치 등)이 있으면 그것으로 자리·방향을 따라간다.
   *  없으면 위치·높이는 창가 고정이고 방향만 폰 자세: AR local 공간이 시작할 때 폰은 -Z를 보므로
   *  -Z를 fallback.yawDeg로 돌리는 가상 맞춤을 써서 돌리면 yaw, 기울이면 pitch가 바뀐다. */
  estimateFor(position: Vec3, orientation: Quat, tracking: "ok" | "limited"): EyeEvent | null {
    const act = this.active();
    if (act && !act.aligned) return { ...toTwin(position, orientation, act.al), tracking, at: this.now().toISOString(), estimated: true };
    if (!this.fallback) return null;
    const virtual: Alignment = { theta: (this.fallback.yawDeg * Math.PI) / 180 + Math.PI / 2, tx: 0, ty: 0, floorY: 0 };
    const pose = toTwin(position, orientation, virtual);
    return {
      ...pose, position: [...this.fallback.position], height_m: this.fallback.heightM,
      tracking, at: this.now().toISOString(), estimated: true,
    };
  }

  status(error?: string): PhoneStatus {
    return { type: "status", aligned: this.alignedNow() !== null, sync: this.syncStatus(), ...(error ? { error } : {}) };
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
      if (!this.startPose) return { reply: this.status("시작 위치가 없어요. 설정 화면에서 시작 위치를 먼저 정해 주세요") };
      if (this.adoptEpoch(msg.epoch).stale) return { reply: this.status("이전 AR 세션의 기록이라 받지 않았어요. 다시 눌러 주세요") };
      this.last = null;
      this.photoFrames=new WeakSet();
      this.lastPhone = [msg.position[0], msg.position[2]];
      // 영상 모드: 자세 흉내
      if (msg.fixed) this.sync.fixStart(this.startPose, msg.position, msg.orientation);
      else this.sync.confirmStart(this.startPose, msg.position, msg.orientation);
      return { reply: this.status() };
    }
    if (msg.type === "surface" || msg.type === "landmarks") {
      if (this.adoptEpoch(msg.epoch).stale) return {};
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
    const { stale, dropped } = this.adoptEpoch(msg.epoch);
    if (stale) return {};
    this.lastPhone = [msg.position[0], msg.position[2]];
    this.sync.addPose({
      position: msg.position, orientation: msg.orientation, hit: msg.hit ?? null, hitNormal: msg.hit_normal ?? null,
      hitEstimated: msg.hit_estimated === true, floorY: msg.floor_y ?? null,
    });
    const eye = this.eyeFor(msg.position, msg.orientation, msg.tracking) ?? this.estimateFor(msg.position, msg.orientation, msg.tracking);
    const al = this.alignedNow();
    if (eye && al) {
      this.last = { at: this.now().getTime(), hit: msg.hit ? planOf(msg.hit, al) : null, eye: eye.position };
    }
    const reply = dropped ? this.status("AR 원점이 바뀌어 맞춤을 지웠어요. 시작 위치에서 다시 맞춰 주세요") : undefined;
    return { ...(reply ? { reply } : {}), ...(eye ? { eye } : {}) };
  }
}
