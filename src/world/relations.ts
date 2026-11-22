// 관계표와 가전 상태(출처: docs/provenance.md). 물건 종류 → 관련 가전 종류, 트윈 속성 값 → 가전 상태 키·글(src/world/vocab.ts DEVICE_STATES), 남은 시간.
// 사실만 붙이고 할 일은 넣지 않는다.
import type { ObjClass } from "../contract/world.js";
import { kindEntry } from "../devices/kinds.js";
import { DEVICE_STATES, type DeviceStateKey } from "./vocab.js";

const DISHES = ["dishwasher"];
const FOOD = ["fridge"];
/** 물건 종류 → 관련 가전 종류. 식기는 식기세척기, 음식은 냉장고. */
export const RELATIONS: Record<ObjClass, string[]> = {
  cup: DISHES, bottle: DISHES, beer_can: FOOD, bowl: DISHES, fork: DISHES, knife: DISHES, spoon: DISHES, pot: DISHES, ramen: [],
  banana: FOOD, apple: FOOD, orange: FOOD, broccoli: FOOD, carrot: FOOD, sandwich: FOOD, hot_dog: FOOD, pizza: FOOD, donut: FOOD, cake: FOOD,
  book: [], cell_phone: [], remote: [], laptop: [], scissors: [], toothbrush: [], hair_drier: [], teddy_bear: [], backpack: [], handbag: [], suitcase: [],
  umbrella: [], cat: [], dog: [],
};

/** 관련 가전 종류: [지속] 줄에 상태가 늘 나온다. */
export const RELATED_KINDS: ReadonlySet<string> = new Set(Object.values(RELATIONS).flat());

export function relatedDeviceIds(cls: ObjClass, devices: readonly { id: string; kind: string }[]): string[] {
  const kinds = RELATIONS[cls];
  return devices.filter((d) => kinds.includes(d.kind)).map((d) => d.id);
}

const KEYS = Object.keys(DEVICE_STATES) as DeviceStateKey[];

/** 트윈 속성 값 → 지금 가전 상태 키(속성 순서). 모르는 속성은 뺀다. */
export function deviceStateKeys(_kind: string, twin: Record<string, unknown>): DeviceStateKey[] {
  return Object.entries(twin).flatMap(([attr, v]) => KEYS.filter((k) => DEVICE_STATES[k].attr === attr && DEVICE_STATES[k].value === v));
}

/** 그 종류에서 쓰는 상태 글·사건 글(세탁기 작동 끝남 → 세탁 끝남, 등록부 stateText). */
export function deviceText(kind: string, key: DeviceStateKey): { label: string; became: string } {
  const s = DEVICE_STATES[key];
  const o = kindEntry(kind)?.stateText?.[key];
  return { label: o?.label ?? s.label, became: o?.became ?? s.became };
}

/** 상태 이름: 아는 속성의 상태 글을 「 · 」로 잇는다. 아는 속성이 없으면 null. */
export function deviceStatus(kind: string, twin: Record<string, unknown>): string | null {
  const keys = deviceStateKeys(kind, twin);
  return keys.length ? keys.map((k) => deviceText(kind, k).label).join(" · ") : null;
}

/** 트윈 속성 하나가 바뀐 사건의 상태 키(그 값이 아는 상태가 아니면 null). */
export function becameKey(attr: string, to: unknown): DeviceStateKey | null {
  return KEYS.find((k) => DEVICE_STATES[k].attr === attr && DEVICE_STATES[k].value === to) ?? null;
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
