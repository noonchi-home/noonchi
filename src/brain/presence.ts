// YOLO 존재 판정과 "식탁을 비추는가". 둘 다 보고 말하기만 한다(판단은 machine.ts).
// - 존재 판정: 최근 holdMs 안 프레임 중 하나라도 보이면 있음(한두 장 놓쳐도 견딤), 하나도 없으면 없음, 프레임이 모자라면 모름.
// - 식탁: 맞춘 뒤 눈 자세(트윈 좌표)의 카메라 앞 방향과 식탁·책상 윗면이 이루는 각으로 본다. 맞추기 전은 모름.

import type { EyePose } from "../phone/align.js";
import type { Detection } from "./detector.js";
import type { Tri } from "./perception.js";

export interface PresenceConfig {
  /** 이만큼 안의 프레임으로 있음/없음을 정한다(ms). */
  holdMs: number;
  personMin: number;
  cupMin: number;
  /** 창 안 프레임이 이보다 적으면 모름. */
  minFrames: number;
}

export const DEFAULT_PRESENCE: PresenceConfig = { holdMs: 600, personMin: 0.5, cupMin: 0.4, minFrames: 2 };

export interface Presence {
  /** 근거 시각 = 이 판정의 마지막 프레임 촬영 시각(가장 이른 가능 시각). */
  atMs: number;
  /** 그 프레임의 가장 늦은 가능 촬영 시각(시계 오차). 구간을 시작할 때 쓴다. */
  latestMs: number;
  person: Tri;
  cup: Tri;
  /** 그 프레임 순간 식탁을 비추는가(맞추기 전은 unknown). */
  table: Tri;
  /** 비춘 식탁 id(table이 yes일 때). */
  tableId?: string;
  frames: number;
  /** 창 안 가장 높은 점수(기록용). */
  scores: { person: number; cup: number };
  /** 실제로 기준 이상 검출된 마지막 프레임 촬영 시각. 창(holdMs) 때문에 지난 검출이 "있음"으로 남는 것을 가려낸다. */
  seen: { person: number | null; cup: number | null };
}

interface Seen { atMs: number; person: number; cup: number }

export class PresenceTracker {
  private seen: Seen[] = [];
  private lastSeen: { person: number | null; cup: number | null } = { person: null, cup: null };

  constructor(private readonly cfg: PresenceConfig = DEFAULT_PRESENCE) {}

  /** 프레임 하나의 감지 결과를 넣고 그 시각의 존재 판정을 돌려준다. 앞선 시각이면 null. */
  push(frame: { atMs: number; latestMs?: number; detections: readonly Detection[]; table: Tri; tableId?: string }): Presence | null {
    const last = this.seen.at(-1);
    if (last && frame.atMs <= last.atMs) return null;
    const best = (label: Detection["label"]) => Math.max(0, ...frame.detections.filter((d) => d.label === label).map((d) => d.score));
    const now: Seen = { atMs: frame.atMs, person: best("person"), cup: best("cup") };
    if (now.person >= this.cfg.personMin) this.lastSeen.person = frame.atMs;
    if (now.cup >= this.cfg.cupMin) this.lastSeen.cup = frame.atMs;
    this.seen.push(now);
    this.seen = this.seen.filter((s) => frame.atMs - s.atMs < this.cfg.holdMs);
    const enough = this.seen.length >= this.cfg.minFrames;
    const top = { person: Math.max(...this.seen.map((s) => s.person)), cup: Math.max(...this.seen.map((s) => s.cup)) };
    const tri = (score: number, min: number): Tri => (!enough ? "unknown" : score >= min ? "yes" : "no");
    return {
      atMs: frame.atMs, latestMs: Math.max(frame.atMs, frame.latestMs ?? frame.atMs), person: tri(top.person, this.cfg.personMin), cup: tri(top.cup, this.cfg.cupMin),
      table: frame.table, ...(frame.tableId ? { tableId: frame.tableId } : {}), frames: this.seen.length, scores: top, seen: { ...this.lastSeen },
    };
  }
}

/** 컵이 놓일 만한 윗면(식탁·책상). center는 평면도 [x, y], top은 바닥에서 윗면 높이(m), radius는 윗면을 덮는 원. */
export interface Surface {
  id: string;
  label: string;
  center: [number, number];
  top: number;
  radius: number;
}

export interface SurfaceSource {
  id: string;
  name: string;
  type: string;
  plan: [number, number];
  /** 물건 바닥 높이(m). */
  base: number;
  height: number;
  footprint?: [number, number];
}

const SURFACE_TYPE = /table|desk/;

export function surfacesFrom(objects: readonly SurfaceSource[]): Surface[] {
  return objects.filter((o) => SURFACE_TYPE.test(o.type)).map((o) => ({
    id: o.id, label: o.name, center: [o.plan[0], o.plan[1]], top: o.base + o.height,
    radius: o.footprint ? Math.hypot(o.footprint[0], o.footprint[1]) / 2 : 0.4,
  }));
}

export interface ViewOptions { halfAngleDeg: number; minM: number; maxM: number }
export const DEFAULT_VIEW: ViewOptions = { halfAngleDeg: 30, minM: 0.3, maxM: 6 };

const RAD = Math.PI / 180;

/** 눈 자세의 앞 방향과 윗면 원이 halfAngle 안에서 만나면 yes(가장 가까운 각의 식탁 id). 눈 자세나 식탁이 없으면 unknown. */
export function tableInView(eye: EyePose | null, surfaces: readonly Surface[], opts: ViewOptions = DEFAULT_VIEW): { table: Tri; id?: string } {
  if (!eye || surfaces.length === 0) return { table: "unknown" };
  const cp = Math.cos(eye.pitch_deg * RAD);
  const f = [Math.cos(eye.yaw_deg * RAD) * cp, Math.sin(eye.yaw_deg * RAD) * cp, Math.sin(eye.pitch_deg * RAD)];
  let best: { id: string; gap: number } | null = null;
  for (const s of surfaces) {
    const d = [s.center[0] - eye.position[0], s.center[1] - eye.position[1], s.top - eye.height_m];
    const dist = Math.hypot(d[0]!, d[1]!, d[2]!);
    if (dist < opts.minM || dist > opts.maxM) continue;
    const cos = (f[0]! * d[0]! + f[1]! * d[1]! + f[2]! * d[2]!) / dist;
    const angle = Math.acos(Math.max(-1, Math.min(1, cos))) / RAD;
    const gap = angle - Math.atan(s.radius / dist) / RAD;
    if (gap <= opts.halfAngleDeg && (!best || gap < best.gap)) best = { id: s.id, gap };
  }
  return best ? { table: "yes", id: best.id } : { table: "no" };
}
