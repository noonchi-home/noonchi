// 폰 한 대의 AR 세션 상태. 기준점 두 곳을 받으면 트윈에 맞추고, 그 뒤 자세를 눈 자세로 바꾼다.
// 네트워크와 무관하므로 server.ts가 WebSocket 메시지를 그대로 넘긴다.

import { z } from "zod";
import type { EyeEvent } from "../contract/events.js";
import { fromTwin, planOf, solveAlignment, toTwin, type Alignment, type Plan2, type Quat, type Vec3 } from "./align.js";
import type { AnchorTarget } from "./anchors.js";
import { DEFAULT_EYE_HEIGHT_M } from "./touch.js";

export type { EyeEvent } from "../contract/events.js";

const num = z.number().refine(Number.isFinite);
const Vec3Schema = z.tuple([num, num, num]);
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
    epoch: Epoch,
  }),
  /** floor: touch 모드에서 기록하는 순간 조준점이 닿은 바닥 점(바닥 높이를 잴 때만 쓴다).
   *  revision: 기록을 시작할 때 본 기준점 판(status.revision). 그 사이 기준점이 바뀌었으면 받지 않는다. */
  z.object({
    type: z.literal("anchor"), id: z.string(), point: Vec3Schema, floor: Vec3Schema.nullable().optional(),
    epoch: Epoch, revision: z.number().int().optional(),
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

export interface PhoneStatus {
  type: "status";
  mode: AlignMode;
  /** 기준점이 바뀔 때마다 1씩 오른다. 폰은 바뀌면 진행 중인 기록을 버린다. */
  revision: number;
  anchors: { id: string; label: string; recorded: boolean }[];
  aligned: boolean;
  mismatch_m: number | null;
  error?: string;
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
}

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

  constructor(targets: AnchorTarget[], opts: PhoneSessionOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    this.maxMismatchM = opts.maxMismatchM ?? DEFAULT_MAX_MISMATCH_M;
    this.fallback = opts.fallback;
    this.eyeHeightM = opts.eyeHeightM ?? DEFAULT_EYE_HEIGHT_M;
    this.floorAt = opts.floorAt ?? (() => 0);
    this.setTargets(targets, opts.mode ?? "floor");
  }

  /** 기준점·모드를 바꾼다(대시보드에서 A·B를 저장·지울 때). 기록과 맞춤은 지운다. */
  setTargets(targets: AnchorTarget[], mode: AlignMode): void {
    if (targets.length !== 2) throw new Error("기준점은 두 곳이어야 합니다");
    this.targets = targets.map((t) => ({ ...t, plan: [t.plan[0], t.plan[1]] }));
    this.mode = mode;
    this.revision += 1;
    this.forget();
  }

  private forget(): void {
    this.points.clear();
    this.floors.clear();
    this.alignment = null;
    this.last = null;
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
    const had = this.points.size > 0 || this.alignment !== null;
    this.retire(this.epoch);
    this.epoch = epoch;
    this.forget();
    return { stale: false, dropped: had };
  }

  get aligned(): boolean {
    return this.alignment !== null;
  }

  /** '여기' = 마지막 자세의 조준점(평면도)과 그때 폰 위치. 모르면 이유. */
  here(): HerePoint {
    if (!this.alignment) return { error: "폰을 트윈에 맞추기 전이에요. 폰 화면에서 기준점 두 곳을 먼저 기록해 주세요." };
    if (!this.last) return { error: "폰 AR이 켜져 있지 않아요. 폰에서 AR 시작을 눌러 주세요." };
    if (this.now().getTime() - this.last.at > HERE_MAX_AGE_MS) return { error: "폰 AR 자세가 15초 넘게 오지 않았어요. 폰 화면을 켜고 다시 말해 주세요." };
    if (!this.last.hit) return { error: "폰 조준점이 바닥에 닿지 않았어요. 물건 아래 바닥을 가리키고 다시 말해 주세요." };
    return { position: this.last.hit, from: this.last.eye };
  }

  /** 트윈 점 [x, 높이, y] → AR 좌표. 맞추기 전이면 null. */
  toAr(point: Vec3): Vec3 | null {
    return this.alignment ? fromTwin(point, this.alignment) : null;
  }

  /** 맞춘 뒤에만 트윈 좌표의 눈 자세를 준다. */
  eyeFor(position: Vec3, orientation: Quat, tracking: "ok" | "limited"): EyeEvent | null {
    if (!this.alignment) return null;
    const pose = toTwin(position, orientation, this.alignment);
    // touch 모드는 높이를 재지 않는다: 눈은 그 자리 방 바닥 위 사람 눈높이
    if (this.mode === "touch") pose.height_m = Math.round((this.eyeHeightM + this.floorAt(pose.position)) * 1000) / 1000;
    return { ...pose, tracking, at: this.now().toISOString() };
  }

  /** 사진처럼 늦게 도착할 수 있는 자세: 찍은 원점(epoch)이 지금 맞춤의 원점과 다르면 null. 원점이 없으면 eyeFor와 같다. */
  eyeAt(position: Vec3, orientation: Quat, tracking: "ok" | "limited", epoch: string | undefined): EyeEvent | null {
    if (epoch !== undefined && epoch !== this.epoch) return null;
    return this.eyeFor(position, orientation, tracking);
  }

  /** 맞추기 전 추정 눈: 위치·높이는 고정, 방향은 폰 자세. AR local 공간이 시작할 때 폰은 -Z를 보므로
   *  -Z를 fallback.yawDeg로 돌리는 가상 맞춤을 써서 돌리면 yaw, 기울이면 pitch가 바뀐다. */
  estimateFor(position: Vec3, orientation: Quat, tracking: "ok" | "limited"): EyeEvent | null {
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
      aligned: this.alignment !== null,
      mismatch_m: this.alignment ? Math.round(this.alignment.mismatchM * 100) / 100 : null,
      ...(error ? { error } : {}),
    };
  }

  handle(raw: unknown): { reply?: PhoneStatus; eye?: EyeEvent } {
    const parsed = MessageSchema.safeParse(raw);
    if (!parsed.success) return { reply: this.status("알 수 없는 메시지입니다") };
    const msg = parsed.data;
    if (msg.type === "reset") {
      // 버린 원점의 늦은 reset은 지금 맞춤을 건드리지 않는다
      if (this.adoptEpoch(msg.epoch).stale) return { reply: this.status() };
      this.forget();
      return { reply: this.status() };
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
      return { reply: this.status() };
    }
    const { stale, dropped } = this.adoptEpoch(msg.epoch);
    if (stale) return {};
    const eye = this.eyeFor(msg.position, msg.orientation, msg.tracking) ?? this.estimateFor(msg.position, msg.orientation, msg.tracking);
    if (eye && this.alignment) {
      this.last = { at: this.now().getTime(), hit: msg.hit ? planOf(msg.hit, this.alignment) : null, eye: eye.position };
    }
    const reply = dropped ? this.status("AR 원점이 바뀌어 맞춤을 지웠어요. 기준점을 다시 기록해 주세요") : undefined;
    return { ...(reply ? { reply } : {}), ...(eye ? { eye } : {}) };
  }
}
