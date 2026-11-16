// World State의 가전(DeviceSight): 가전 설비(보임·사라짐 없이 방마다 종류 하나), 카메라로 가전 상태 맞추기(src/world/sight.ts: 설비 상자마다 그 사진의 방·시야·상자 방향으로
// 트윈 가전 하나를 고르고, 그 프레임 VLM 답의 값이 연속으로 이어지면 see로 허브에 넘긴다), 가전 상태(상태 키·바뀐 속성 이력·사건 줄·남은 시간·오래 이어진 상태 tick).
// 카메라로 본 값이 상태가 된 가전 줄은 「카메라로 봄」을 붙이고, 실제 상태와 다르면 다름 줄 하나.
import type { DeviceState, SightEvidence, VisionSeen } from "../../contract/devices.js";
import type { Detection, EngineFrame, Mask, SceneObservation } from "../../contract/observe.js";
import type { FixtureClass, WorldChange, WorldDevice, WorldView } from "../../contract/world.js";
import { maskCells } from "../../shared/mask.js";
import { CHANGE_TEXT } from "../labels.js";
import { RemainingTracker, becameKey, deviceStateKeys, deviceStatus, deviceText } from "../relations.js";
import { SightReadings, linkDevice, rulesOf, sightValues, type SightLink } from "../sight.js";
import { kindEntry } from "../../devices/kinds.js";
import { DEVICE_LONG, DEVICE_STATES, STATES, VLM_ONLY, type DeviceLongKey, type DeviceStateKey, type StateKey } from "../vocab.js";
import { Part, fits, type Fix } from "./core.js";

const HISTORY_MAX = 20;
/** VLM 답이 오지 않은 프레임의 가전 맞춤은 이만큼(촬영 시각 기준) 두었다가 버린다. */
const LINK_KEEP_MS = 60_000;
/** 가까이 본 가전 관측(sight_last close): 맞춘 감지 마스크가 사진 넓이의 이 비율 이상. */
const CLOSE_AREA = 0.1;
/** 마스크가 덮는 넓이(원본 픽셀²): 1인 칸 비율 × 그림 자리 넓이. 모양이 없으면 0. */
function maskArea(m: Mask): number {
  const cells = m.cols * m.rows ? maskCells(m) : null;
  if (!cells) return 0;
  let n = 0;
  for (const c of cells) n += c;
  return (n / cells.length) * m.at[2] * m.at[3];
}

interface Dev {
  id: string; kind: string; label: string; twin: Record<string, unknown>; status: string | null; state: DeviceStateKey[]; changed: number; eventAt: number | null;
  /** 지금 상태 키마다 그 상태가 된 시각. */
  since: Partial<Record<DeviceStateKey, number>>;
  /** 이미 낸 오래 이어진 사건(규칙@시작 시각). */
  long: Set<string>;
  history: WorldDevice["history"]; known: boolean;
  /** 지금 상태가 카메라로 본 것이면 그 기록(허브 vision, applied). */
  vision: VisionSeen | null;
  /** 속성마다 카메라가 마지막으로 이어 본 값·촬영 시각·근거 종류(WorldDevice.sight_last). */
  sight: Record<string, { value: unknown; seen_ms: number; explicit: boolean; close: boolean }>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 가전 설비·카메라로 본 가전·가전 상태. */
export class DeviceSight extends Part {
  private readonly devs = new Map<string, Dev>();
  private readonly remaining = new RemainingTracker();
  /** 프레임 id → 감지 번호마다 카메라로 고른 가전(그 프레임 VLM 답이 올 때까지). */
  private readonly links = new Map<string, { at: number; dets: Map<string, { cls: FixtureClass; link: SightLink; close: boolean }> }>();
  /** 가전마다 카메라로 이어 본 값의 수. */
  private readonly readings = new SightReadings();
  /** 가전마다 카메라로 마지막으로 본 촬영 시각. */
  private readonly sighted = new Map<string, number>();

  /** 가전 설비 하나: 그 사진을 찍은 클로이드 눈의 방마다 종류 하나(tv_living). */
  fixture(cls: FixtureClass, atMs: number, room: { id: string; label: string } | null): Fix {
    const id = `${cls}_${room?.id ?? "room"}`;
    let f = this.core.fixtures.get(id);
    if (!f) {
      f = { id, cls, room: room?.id ?? null, roomLabel: room?.label ?? null, firstSeen: atMs, lastSeen: atMs, facts: {}, answered: null, link: null };
      this.core.fixtures.set(id, f);
    }
    f.lastSeen = atMs;
    return f;
  }

  /** 가전 설비 상자 하나를 트윈 가전에 맞춰 두고(등록부 camera가 있는 설비만), 그 프레임 VLM 답을 기다린다. */
  sight(frame: EngineFrame, tmp: string, fix: Fix, det: Detection, room: { id: string } | null): void {
    if (!rulesOf(fix.cls).length) return;
    const at = frame.capturedAtMs;
    const link = linkDevice({
      cls: fix.cls, box: det.box, size: { width: frame.width, height: frame.height }, view: frame.view, room: room?.id ?? null, devices: this.o.devices(), place: this.o.place ?? (() => null),
    });
    fix.link = { ...link, at_ms: at };
    if (link.device) this.sighted.set(link.device, at);
    let m = this.links.get(frame.id);
    if (!m) {
      m = { at, dets: new Map() };
      this.links.set(frame.id, m);
    }
    m.dets.set(tmp, { cls: fix.cls, link, close: maskArea(det.mask) >= CLOSE_AREA * frame.width * frame.height });
  }

  /** VLM 답이 없는 프레임의 가전 맞춤을 버린다(값이 아니다). */
  dropLinks(frameId: string): void {
    this.links.delete(frameId);
  }

  /** 그 프레임 VLM 답에서 고른 가전의 값을 읽고, 이어 본 값은 허브에 넘긴다. 실제 상태와 처음 다르면 다름 줄(판단 계기 아님). */
  seeDevices(frameId: string, capturedAtMs: number, scene: SceneObservation): WorldChange[] {
    const m = this.links.get(frameId);
    this.links.delete(frameId);
    for (const [id, x] of this.links) if (x.at < capturedAtMs - LINK_KEEP_MS) this.links.delete(id);
    if (!m) return [];
    const stable: [string, Record<string, unknown>, Record<string, SightEvidence>, boolean][] = [];
    for (const [tmp, { cls, link, close }] of m.dets) {
      const device = link.device;
      if (!device) continue;
      const said = scene.observations.filter((o) => o.object_id === tmp).map((o) => o.state as string);
      if (said.some((s) => (VLM_ONLY as readonly string[]).includes(s))) continue; // 가렸다: 답이 아니다
      const keys = said.filter((s): s is StateKey => s in STATES && fits(s as StateKey, cls, "fixture"));
      const values = sightValues(cls, keys, this.o.devices().find((d) => d.id === device)?.twinAttrs);
      const twin: Record<string, unknown> = {};
      const evidence: Record<string, SightEvidence> = {};
      for (const [attr, v] of Object.entries(values)) {
        const first = this.readings.read(device, attr, v, capturedAtMs);
        if (first === null) continue;
        twin[attr] = v.value;
        evidence[attr] = { seenAt: first, explicit: v.explicit };
      }
      if (Object.keys(twin).length) stable.push([device, twin, evidence, close]);
    }
    const changes: WorldChange[] = [];
    for (const [id, twin, evidence, close] of stable) {
      const r = this.o.see?.(id, twin, capturedAtMs, evidence);
      changes.push(...this.sightLast(id, twin, evidence, capturedAtMs, close));
      if (r?.kind !== "mismatch") continue;
      const spec = this.o.devices().find((d) => d.id === id);
      const text = (t: Record<string, unknown>) => deviceStatus(spec?.kind ?? "", t) ?? Object.entries(t).map(([a, v]) => `${a} ${String(v)}`).join(" · ");
      const seen = Object.fromEntries(Object.keys(r.real).map((a) => [a, twin[a]]));
      changes.push({ kind: "device", at_ms: capturedAtMs, subject: id, meaningful: false, text: CHANGE_TEXT.deviceMismatch(spec?.label ?? id, text(seen), text(r.real)) });
    }
    return changes;
  }

  /** 카메라가 이어 본 값의 마지막 근거(sight_last)를 쓴다. 지금 값과 같은 값을 다른 근거 종류로 보면(추정 꺼짐 → 명시 꺼짐, 그 반대)
   *  이력 줄 { from: 값, to: 값, seen_ms, explicit }을 남기고 변화(판단 계기 아님)로 알린다. 같은 값·같은 종류의 새 촬영은 촬영 시각만 새로 쓴다. */
  private sightLast(id: string, twin: Record<string, unknown>, evidence: Record<string, SightEvidence>, atMs: number, close: boolean): WorldChange[] {
    const d = this.devs.get(id);
    if (!d) return [];
    const changes: WorldChange[] = [];
    for (const [attr, value] of Object.entries(twin)) {
      const ev = evidence[attr]!;
      const prev = d.sight[attr];
      d.sight[attr] = { value, seen_ms: atMs, explicit: ev.explicit, close };
      if (!prev || !same(prev.value, value) || prev.explicit === ev.explicit || !same(d.twin[attr], value)) continue;
      d.history = [...d.history, { attr, from: value, to: value, at_ms: atMs, seen_ms: ev.seenAt, explicit: ev.explicit }].slice(-HISTORY_MAX);
      const key = becameKey(attr, value);
      const text = key ? deviceText(d.kind, key).became : String(value);
      changes.push({ kind: "device", at_ms: atMs, subject: d.id, meaningful: false, text: CHANGE_TEXT.deviceSeen(d.label, text) });
    }
    return changes;
  }

  /** 가전 상태. 처음 받은 상태는 상태 이름 변화 하나, 그 뒤로는 바뀐 속성마다 이력과 사건 줄(아는 상태가 아니면 속성 줄, 판단 계기 아님).
   *  카메라로 본 값이 상태가 된 속성(vision.applied)의 줄은 「카메라로 봄」을 붙인다. */
  applyDevice(s: DeviceState, atMs: number, evidence?: Record<string, SightEvidence>): WorldChange[] {
    const spec = this.o.devices().find((d) => d.id === s.id);
    if (!spec) return [];
    let d = this.devs.get(s.id);
    if (!d) {
      d = { id: s.id, kind: spec.kind, label: spec.label, twin: {}, status: null, state: [], changed: atMs, eventAt: null, since: {}, long: new Set(), history: [], known: false, vision: null, sight: {} };
      this.devs.set(s.id, d);
    }
    d.vision = s.signal !== "none" && s.vision?.applied ? s.vision : null;
    if (s.signal === "none") {
      d.status = null;
      d.state = [];
      d.since = {};
      this.remaining.update(s.id, {}, atMs);
      return [];
    }
    const seen = (attr: string, to: unknown) => !!d.vision && attr in d.vision.twin && same(d.vision.twin[attr], to);
    // 카메라로 본 값이 상태가 된 속성의 근거(근거 사진 촬영 시각·명시/추정): 넘겨받은 것, 없으면 허브 상태의 vision.evidence
    const proof = (attr: string, to: unknown): SightEvidence | undefined => (seen(attr, to) ? evidence?.[attr] ?? d!.vision!.evidence?.[attr] : undefined);
    const changes: WorldChange[] = [];
    for (const [attr, to] of Object.entries(s.twin)) {
      const from = d.twin[attr];
      if (d.known && same(from, to)) continue;
      const ev = proof(attr, to);
      d.history = [...d.history, { attr, from: from ?? null, to, at_ms: atMs, ...(ev ? { seen_ms: ev.seenAt, explicit: ev.explicit } : {}) }].slice(-HISTORY_MAX);
      d.changed = atMs;
      const key = becameKey(attr, to);
      if (key) d.since[key] = atMs;
      if (!d.known) continue;
      if (key) {
        d.eventAt = atMs;
        const became = deviceText(d.kind, key).became;
        changes.push({ kind: "device", at_ms: atMs, subject: d.id, meaningful: true, text: seen(attr, to) ? CHANGE_TEXT.deviceSeen(d.label, became) : CHANGE_TEXT.device(d.label, became) });
      } else changes.push({ kind: "device", at_ms: atMs, subject: d.id, meaningful: false, text: CHANGE_TEXT.deviceAttr(d.label, attr, to) });
    }
    const status = deviceStatus(d.kind, s.twin);
    if (!d.known && status !== null) {
      changes.push({ kind: "device", at_ms: atMs, subject: d.id, meaningful: true, text: d.vision ? CHANGE_TEXT.deviceSeen(d.label, status) : CHANGE_TEXT.device(d.label, status) });
    }
    d.status = status;
    d.state = deviceStateKeys(d.kind, s.twin);
    for (const k of Object.keys(d.since) as DeviceStateKey[]) if (!d.state.includes(k)) delete d.since[k];
    for (const k of d.state) d.since[k] ??= atMs; // 신호가 돌아와 값이 같아도 그때부터 센다
    d.twin = { ...s.twin };
    d.known = true;
    this.remaining.update(s.id, s.twin, atMs);
    return changes;
  }

  /** 시간이 지나야 나는 사건(vocab DEVICE_LONG, 종류는 등록부 longEvents: 냉장고·현관문 문이 1분 넘게 열림). 한 상태가 이어지는 동안 한 번. 판단 타이머가 부른다. */
  tick(nowMs: number): WorldChange[] {
    const changes: WorldChange[] = [];
    for (const d of this.devs.values()) {
      for (const [key, rule] of Object.entries(DEVICE_LONG) as [DeviceLongKey, (typeof DEVICE_LONG)[DeviceLongKey]][]) {
        const since = d.since[rule.state];
        if (since === undefined || d.status === null || !d.state.includes(rule.state) || !kindEntry(d.kind)?.longEvents?.includes(key) || nowMs - since < rule.afterMs) continue;
        const mark = `${key}@${since}`;
        if (d.long.has(mark)) continue;
        d.long.add(mark);
        const seen = !!d.vision && DEVICE_STATES[rule.state].attr in d.vision.twin;
        changes.push({ kind: "device", at_ms: nowMs, subject: d.id, meaningful: true, text: seen ? CHANGE_TEXT.deviceSeen(d.label, rule.label) : CHANGE_TEXT.device(d.label, rule.label) });
      }
    }
    return changes;
  }

  /** 지금 가전 줄(view의 devices). */
  deviceViews(nowMs: number): WorldView["devices"] {
    return [...this.devs.values()].map((d) => ({
      id: d.id, kind: d.kind, label: d.label, status: d.status, state: [...d.state], active: d.state.some((k) => DEVICE_STATES[k].active),
      changed_ms: d.changed, event_ms: d.eventAt, started_ms: this.remaining.startedAt(d.id), remaining_min: this.remaining.remainingMin(d.id, nowMs), history: [...d.history],
      ...(d.vision ? { vision: { at_ms: Math.max(this.sighted.get(d.id) ?? 0, Date.parse(d.vision.at) || 0) } } : {}),
      ...(Object.keys(d.sight).length ? { sight_last: Object.fromEntries(Object.entries(d.sight).map(([a, v]) => [a, { ...v }])) } : {}),
    }));
  }
}
