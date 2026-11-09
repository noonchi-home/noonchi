// 카메라로 본 가전 설비 → 트윈 가전(낱말 표 src/world/vocab.ts SIGHT·SIGHT_MATCH·SIGHT_STABLE).
// - 고르기: 그 사진을 찍은 눈의 방에서 같은 종류(CLASSES deviceKind)이고 SIGHT 속성이 있는 트윈 가전 가운데, 가운데 자리가 시야 안인 것.
//   상자 가운데 광선과 가전 가운데 방향의 각이 가장 작은 것을 고른다. 너무 멀거나(maxDeg) 둘 이상을 가르지 못하면(marginDeg) 고르지 않는다.
// - 값: 그 감지에 대한 VLM 답의 사실 값 → 트윈 속성 값. 쓰는 중처럼 답에 없으면 꺼짐인 면(absent)은 그 면 값을 하나도 말하지 않았을 때.
// - 안정: 같은 가전·속성에서 같은 값이 연속으로 이어져야 넘긴다. 값이 없는 프레임(시야 밖·가림·답 없음)은 셈을 끊지 않고 상태도 바꾸지 않는다.
import type { SightMiss } from "../contract/world.js";
import type { CameraView } from "../phone/session.js";
import { inView, rayDir } from "./place.js";
import { CLASSES, SIGHT, SIGHT_MATCH, SIGHT_STABLE, STATES, type FixtureClass, type SightRule, type StateKey } from "./vocab.js";

type V3 = [number, number, number];

export type SightLink = { device: string; miss: null } | { device: null; miss: SightMiss };

/** 고를 수 있는 트윈 가전(허브 목록). twinAttrs가 없으면 SIGHT 속성이 있다고 본다. */
export interface SightDevice { id: string; kind: string; room?: string; twinAttrs?: Readonly<Record<string, readonly unknown[]>> }

const rulesOf = (cls: FixtureClass): readonly SightRule[] => (SIGHT as Partial<Record<FixtureClass, readonly SightRule[]>>)[cls] ?? [];
const fitsDevice = (d: SightDevice, rules: readonly SightRule[]) => !d.twinAttrs || rules.some((r) => r.attr in d.twinAttrs!);
const deg = (a: V3, b: V3) => {
  const l = Math.hypot(...a) * Math.hypot(...b);
  return l > 0 ? (Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / l))) * 180) / Math.PI : 180;
};

/** 가전 설비 상자 하나를 트윈 가전 하나에 맞춘다. room은 그 사진을 찍은 눈의 방 id. */
export function linkDevice(o: {
  cls: FixtureClass; box: [number, number, number, number]; size: { width: number; height: number }; view: CameraView | null; room: string | null;
  devices: readonly SightDevice[]; place: (id: string) => V3 | null;
}): SightLink {
  const kind = (CLASSES[o.cls] as { deviceKind?: string }).deviceKind;
  const rules = rulesOf(o.cls);
  if (!o.view) return { device: null, miss: "no_view" };
  if (!o.room) return { device: null, miss: "no_room" };
  const same = kind && rules.length ? o.devices.filter((d) => d.kind === kind && d.room === o.room && fitsDevice(d, rules)) : [];
  if (!same.length) return { device: null, miss: "no_device" };
  const view = o.view;
  const seen = same.flatMap((d) => {
    const p = o.place(d.id);
    return p && inView(view, p, SIGHT_MATCH.viewMargin) ? [{ id: d.id, p }] : [];
  });
  if (!seen.length) return { device: null, miss: "out_of_view" };
  const [x, y, w, h] = o.box;
  const ray = rayDir(view, [((x + w / 2) / o.size.width) * 2 - 1, 1 - ((y + h / 2) / o.size.height) * 2]);
  const by = seen
    .map(({ id, p }) => ({ id, deg: deg(ray, [p[0] - view.origin[0], p[1] - view.origin[1], p[2] - view.origin[2]]) }))
    .sort((a, b) => a.deg - b.deg);
  if (by[0]!.deg > SIGHT_MATCH.maxDeg) return { device: null, miss: "off_box" };
  if (by.length > 1 && by[1]!.deg - by[0]!.deg <= SIGHT_MATCH.marginDeg) return { device: null, miss: "ambiguous" };
  return { device: by[0]!.id, miss: null };
}

/** 한 감지에 대한 VLM 답의 사실 값들 → 넘길 트윈 속성 값(그 가전에 있는 속성만). */
export function sightValues(cls: FixtureClass, said: readonly StateKey[], twinAttrs?: Readonly<Record<string, readonly unknown[]>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rulesOf(cls)) {
    if (twinAttrs && !(r.attr in twinAttrs)) continue;
    const hit = said.find((v) => r.values[v] !== undefined);
    if (hit) out[r.attr] = r.values[hit];
    else if (r.absent !== undefined && !said.some((v) => STATES[v].facet === r.facet)) out[r.attr] = r.absent;
  }
  return out;
}

/** 가전·속성마다 이어 본 같은 값의 수. */
export class SightReadings {
  private readonly runs = new Map<string, { value: unknown; count: number; at: number }>();

  /** 값 하나(촬영 시각 atMs). 같은 값이 SIGHT_STABLE.frames번 이어졌으면 true. 앞선 사진의 늦은 답은 버린다. */
  read(device: string, attr: string, value: unknown, atMs: number): boolean {
    const key = `${device}|${attr}`;
    const run = this.runs.get(key);
    if (run && atMs <= run.at) return false;
    const next = run && JSON.stringify(run.value) === JSON.stringify(value) && atMs - run.at <= SIGHT_STABLE.withinMs
      ? { value, count: run.count + 1, at: atMs }
      : { value, count: 1, at: atMs };
    this.runs.set(key, next);
    return next.count >= SIGHT_STABLE.frames;
  }
}
