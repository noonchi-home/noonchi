// 관계표: 물건 종류 → 관련 가전 종류, 가전 상태 이름, 남은 시간(출처: docs/provenance.md). 사실만 붙이고 할 일은 넣지 않는다.
import type { ObjClass } from "../contract/world.js";

export const RELATIONS: Record<ObjClass, string[]> = { cup: ["dishwasher"], bottle: ["dishwasher"], bowl: ["dishwasher"] };

/** 가전 종류 → 상태 이름: attr이 true면 active, 아니면 inactive. */
export const DEVICE_STATUS: Record<string, { attr: string; active: string; inactive: string }> = {
  dishwasher: { attr: "running", active: "작동 중", inactive: "이용 가능" },
};

/** World State가 보는 가전 종류: 관계표에 든 것. */
export const RELATED_KINDS: ReadonlySet<string> = new Set(Object.values(RELATIONS).flat());

export function relatedDeviceIds(cls: ObjClass, devices: readonly { id: string; kind: string }[]): string[] {
  const kinds = RELATIONS[cls];
  return devices.filter((d) => kinds.includes(d.kind)).map((d) => d.id);
}

/** 상태 이름. 상태표가 없는 종류면 null. */
export function deviceStatus(kind: string, twin: Record<string, unknown>): string | null {
  const s = DEVICE_STATUS[kind];
  return s ? (twin[s.attr] === true ? s.active : s.inactive) : null;
}

/** 남은 시간: running이 참이 된 시각(받은 시각)을 시작으로 두고 course_min에서 지난 분을 뺀다. 코스 시간이 없으면 null(추정하지 않는다). */
export class RemainingTracker {
  private readonly runs = new Map<string, { started: number; course: number | null }>();
  private readonly runningAttr: string;
  private readonly courseAttr: string;
  constructor(o: { runningAttr?: string; courseAttr?: string } = {}) {
    this.runningAttr = o.runningAttr ?? "running";
    this.courseAttr = o.courseAttr ?? "course_min";
  }

  update(deviceId: string, twin: Record<string, unknown>, atMs: number): void {
    if (twin[this.runningAttr] !== true) {
      this.runs.delete(deviceId);
      return;
    }
    const c = twin[this.courseAttr];
    const course = typeof c === "number" && Number.isFinite(c) ? c : null;
    this.runs.set(deviceId, { started: this.runs.get(deviceId)?.started ?? atMs, course });
  }

  startedAt(deviceId: string): number | null {
    return this.runs.get(deviceId)?.started ?? null;
  }

  /** max(0, ceil(코스 − 지난 분)). */
  remainingMin(deviceId: string, nowMs: number): number | null {
    const r = this.runs.get(deviceId);
    if (!r || r.course === null) return null;
    return Math.max(0, Math.ceil(r.course - (nowMs - r.started) / 60_000));
  }
}
