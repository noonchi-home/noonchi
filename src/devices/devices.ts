// 날 물건 목록 → DeviceSpec 목록·초기 상태(docs/plan.md "기기 목록 만들기"의 가전 만들기).
// 파일 읽기(scene.json, 없으면 placement·floorplan·카탈로그)는 배치 저장소 src/layout/twin-files.ts가 하고 목록을 넘긴다.

import type { DeviceSpec, RoomSpec } from "../contract/devices.js";
import { defaultTwinValue, describeDevice } from "./mapping.js";

export interface SkippedObject {
  id: string;
  type: string;
  reason: string;
}

export type Attrs = Record<string, unknown[]>;
export type StatesSpec = Record<string, { default?: unknown } | undefined>;

/** 배치 저장소(src/layout/twin-files.ts)가 읽어 넘기는 날 물건 하나. */
export interface RawObject {
  id: string;
  type: string;
  label: string;
  room: string;
  attrs: Attrs;
  states?: StatesSpec;
  state?: Record<string, unknown>;
}

/** 초기 twin 상태: placement/scene state > 카탈로그 states.default > attr 기본값. */
export function initialTwinState(attrs: Attrs, states?: StatesSpec, state?: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [attr, values] of Object.entries(attrs)) {
    const explicit = state?.[attr];
    const fallback = states?.[attr]?.default;
    out[attr] = explicit !== undefined && explicit !== null ? explicit
      : fallback !== undefined && fallback !== null ? fallback
      : defaultTwinValue(attr, values);
  }
  return out;
}

/** 날 물건 목록으로 만든 가전: DeviceSpec·초기 상태·기기로 만들지 않은 객체. */
export interface TwinDevices {
  devices: DeviceSpec[];
  /** 기기 id → twin 초기 상태(twinAttrs의 모든 키). */
  initial: Record<string, Record<string, unknown>>;
  /** 상태(attrs)는 있지만 기기로 만들지 않은 객체(twin 전용·매핑 없음). */
  skipped: SkippedObject[];
}

/** 날 물건 목록(방·물건)에서 가전을 만든다. 겹친 id·매핑 없음·초기값 경고는 warnings에 더한다. */
export function buildDevices(rooms: RoomSpec[], objects: RawObject[], warnings: string[]): TwinDevices {
  const roomLabel = new Map(rooms.map((r) => [r.id, r.label]));
  const devices: DeviceSpec[] = [];
  const initial: Record<string, Record<string, unknown>> = {};
  const skipped: SkippedObject[] = [];
  const seen = new Set<string>();
  for (const o of objects) {
    if (Object.keys(o.attrs).length === 0) continue;
    if (seen.has(o.id)) {
      warnings.push(`id가 겹쳐 뒤의 것을 뺐습니다: ${o.id}`);
      continue;
    }
    const d = describeDevice(o.type, o.attrs);
    if (!d) {
      skipped.push({ id: o.id, type: o.type, reason: "Matter 기기 매핑 없음(twin 전용이거나 모르는 종류)" });
      continue;
    }
    seen.add(o.id);
    devices.push({
      id: o.id, label: o.label, room: o.room, roomLabel: roomLabel.get(o.room) ?? o.room,
      twinType: o.type, ...d, twinAttrs: o.attrs,
    });
    initial[o.id] = initialTwinState(o.attrs, o.states, o.state);
    for (const [attr, value] of Object.entries(initial[o.id]!)) {
      const allowed = o.attrs[attr] ?? [];
      if (allowed.length > 0 && !allowed.includes(value)) warnings.push(`${o.id}.${attr} 초기값 ${JSON.stringify(value)}이 attrs 목록에 없습니다`);
    }
  }
  return { devices, initial, skipped };
}
