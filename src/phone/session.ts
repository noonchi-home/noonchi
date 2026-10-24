// 폰 한 대의 AR 세션 상태. 기준점 두 곳을 받으면 트윈에 맞추고, 그 뒤 자세를 눈 자세로 바꾼다.
// 네트워크와 무관하므로 server.ts가 WebSocket 메시지를 그대로 넘긴다.

import { z } from "zod";
import { fromTwin, planOf, solveAlignment, toTwin, type Alignment, type EyePose, type Plan2, type Quat, type Vec3 } from "./align.js";
import type { AnchorTarget } from "./anchors.js";

const num = z.number().refine(Number.isFinite);
const Vec3Schema = z.tuple([num, num, num]);
const MessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("pose"),
    position: Vec3Schema,
    orientation: z.tuple([num, num, num, num]),
    tracking: z.enum(["ok", "limited"]).default("ok"),
    /** 화면 가운데 조준점이 닿은 바닥 점(AR 공간). 닿지 않으면 null. */
    hit: Vec3Schema.nullable().optional(),
  }),
  z.object({ type: z.literal("anchor"), id: z.string(), point: Vec3Schema }),
  z.object({ type: z.literal("reset") }),
]);

export interface PhoneStatus {
  type: "status";
  anchors: { id: string; label: string; recorded: boolean }[];
  aligned: boolean;
  mismatch_m: number | null;
  error?: string;
}

export type EyeEvent = EyePose & { tracking: "ok" | "limited"; at: string };

/** '여기'로 쓸 수 있는 마지막 자세의 나이(ms). */
export const HERE_MAX_AGE_MS = 15_000;

export type HerePoint = { position: Plan2; from: Plan2 } | { error: string };

/** 실제 두 기준점 거리와 트윈 거리의 차이가 이보다 크면 맞추지 않는다(SSOT 17절 초안 30cm). */
export const DEFAULT_MAX_MISMATCH_M = 0.3;

export interface PhoneSessionOptions {
  now?: () => Date;
  maxMismatchM?: number;
}

export class PhoneSession {
  private readonly points = new Map<string, Vec3>();
  private alignment: Alignment | null = null;
  /** 맞춘 뒤 받은 마지막 자세: 조준점(평면도, 없으면 null)과 폰 위치. */
  private last: { at: number; hit: Plan2 | null; eye: Plan2 } | null = null;
  private readonly now: () => Date;
  private readonly maxMismatchM: number;

  constructor(private readonly targets: AnchorTarget[], opts: PhoneSessionOptions = {}) {
    if (targets.length !== 2) throw new Error("기준점은 두 곳이어야 합니다");
    this.now = opts.now ?? (() => new Date());
    this.maxMismatchM = opts.maxMismatchM ?? DEFAULT_MAX_MISMATCH_M;
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
    return { ...toTwin(position, orientation, this.alignment), tracking, at: this.now().toISOString() };
  }

  status(error?: string): PhoneStatus {
    return {
      type: "status",
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
      this.points.clear();
      this.alignment = null;
      this.last = null;
      return { reply: this.status() };
    }
    if (msg.type === "anchor") {
      if (!this.targets.some((t) => t.id === msg.id)) return { reply: this.status(`모르는 기준점입니다: ${msg.id}`) };
      this.points.set(msg.id, msg.point);
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
      this.alignment = al;
      return { reply: this.status() };
    }
    const eye = this.eyeFor(msg.position, msg.orientation, msg.tracking);
    if (eye && this.alignment) {
      this.last = { at: this.now().getTime(), hit: msg.hit ? planOf(msg.hit, this.alignment) : null, eye: eye.position };
    }
    return eye ? { eye } : {};
  }
}
