// World State: 엔진 프레임마다 YOLOX 감지와 VLM 관찰을 물체별로 합치고, 시간에 따른 변화(등장·사라짐·시야 밖·상태·가전)를 낸다.
// - 같은 물체: 트윈 위치 + 종류(identityM 안). 맞추기 전(카메라 없음)에는 위치를 모르므로 같은 종류의 물체에 차례로 붙인다.
// - 등장·사라짐: Confirmer(사람 2장, 물건 3장). 사라짐은 그 자리가 시야 안인 프레임만 센다. 등장 확인 전 물체는 view()에 내지 않는다.
// - VLM 사실: 면(facet)마다 하나. 촬영 시각이 더 오래된 답은 버리고, 같은 값이 연속 두 번이면 confirmed. 요약은 바뀔 때만 변화로 낸다.
// - 분석 없음(applyMissing): 셈과 변화 하나만 남기고 등장·사라짐 셈에는 넣지 않는다.
// - 가전: 관계표에 든 종류만 본다. 바뀐 속성의 이력, 상태 이름, 남은 시간(RemainingTracker).
import type { EyePose } from "../contract/events.js";
import type {
  Facet, ObjClass, VlmMissing, WorldChange, WorldDevice, WorldEye, WorldFact, WorldObject, WorldPerson, WorldView, YoloMissing,
} from "../contract/world.js";
import type { Detection } from "../brain/detector.js";
import type { DeviceState } from "../hub/types.js";
import type { EngineFrame } from "../observe/ring.js";
import type { SceneObservation } from "../observe/scene.js";
import { Confirmer } from "./confirm.js";
import { CHANGE_TEXT, OBJECT_NAME, objectName, onSurface } from "./labels.js";
import { inView, placeBox, type PlaneSurface } from "./place.js";
import { RELATED_KINDS, RemainingTracker, deviceStatus, relatedDeviceIds, DEVICE_STATUS } from "./relations.js";

type V3 = [number, number, number];
type Plan2 = [number, number];

const OBJ_CLASSES: ReadonlySet<string> = new Set<ObjClass>(["cup", "bottle", "bowl"]);
const FACET: Record<string, Facet> = {
  on_table: "place", on_counter: "place", in_sink: "place", on_floor: "place", in_hand: "place", in_use: "use",
  empty: "contents", has_contents: "contents", contents_unknown: "contents", sitting: "posture", standing: "posture",
  holding_object: "action", eating_or_drinking: "action",
};
const OBJECT_FACETS: ReadonlySet<Facet> = new Set<Facet>(["place", "use", "contents"]);
const PERSON_FACETS: ReadonlySet<Facet> = new Set<Facet>(["posture", "action"]);
const PERSON = "person";
const HISTORY_MAX = 20;
/** 사라진 물체를 이만큼 두었다가 잊는다(같은 자리에 다시 보이면 같은 id로 돌아온다). */
const GONE_KEEP_MS = 600_000;

interface Obj {
  id: string;
  cls: ObjClass;
  position: V3 | null;
  surface: string | null;
  surfaceLabel: string | null;
  room: string | null;
  errorM: number | null;
  /** 등장을 확인했는가(아니면 세는 중). */
  confirmed: boolean;
  status: WorldObject["status"];
  firstSeen: number;
  lastSeen: number;
  lastInView: number;
  goneAt: number | null;
  facts: Partial<Record<Facet, WorldFact>>;
}

interface Dev { id: string; kind: string; label: string; twin: Record<string, unknown>; status: string | null; changed: number; history: WorldDevice["history"]; known: boolean }

export interface WorldStateOptions {
  surfaces: () => PlaneSurface[];
  floorAt: (p: Plan2) => number;
  roomAt: (p: Plan2) => string | null;
  devices: () => readonly { id: string; kind: string; label: string }[];
  /** 같은 물체로 볼 거리(m, 기본 0.25). */
  identityM?: number;
  /** 감지로 받을 최소 신뢰도(기본 사람 0.5, 물건 0.4). */
  minScore?: { person: number; object: number };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export class WorldState {
  private readonly objects = new Map<string, Obj>();
  private readonly counters = new Map<string, number>();
  private readonly confirmer = new Confirmer((key) => (key === PERSON ? 2 : 3));
  private readonly person: WorldPerson = { visible: false, since_ms: null, last_seen_ms: null, facts: {} };
  private readonly devs = new Map<string, Dev>();
  private readonly remaining = new RemainingTracker();
  private eye: WorldEye | null = null;
  private summary = "";
  private summaryAt = Number.NEGATIVE_INFINITY;
  private vlmMissing = 0;
  private yoloMissing = 0;
  private readonly identityM: number;
  private readonly minScore: { person: number; object: number };

  constructor(private readonly o: WorldStateOptions) {
    this.identityM = o.identityM ?? 0.25;
    this.minScore = o.minScore ?? { person: 0.5, object: 0.4 };
  }

  /** 첫 프레임 시각을 사람 「안 보임」의 시작으로 둔다. */
  private start(atMs: number): void {
    if (this.person.since_ms === null) this.person.since_ms = atMs;
  }

  private create(cls: ObjClass, atMs: number): Obj {
    const n = (this.counters.get(cls) ?? 0) + 1;
    this.counters.set(cls, n);
    const obj: Obj = {
      id: `${cls}_${n}`, cls, position: null, surface: null, surfaceLabel: null, room: null, errorM: null, confirmed: false, status: "present",
      firstSeen: atMs, lastSeen: atMs, lastInView: atMs, goneAt: null, facts: {},
    };
    this.objects.set(obj.id, obj);
    return obj;
  }

  /** 같은 물체 찾기. 위치가 있으면 같은 종류 중 identityM 안의 가장 가까운 것(사라진 것도), 없으면 사라지지 않은 같은 종류를 처음 본 순서로. */
  private match(cls: ObjClass, position: V3 | null, used: ReadonlySet<string>): Obj | null {
    const pool = [...this.objects.values()].filter((x) => x.cls === cls && !used.has(x.id));
    if (position) {
      let best: { obj: Obj; d: number } | null = null;
      for (const x of pool) {
        if (!x.position) continue;
        const d = dist(x.position, position);
        if (d <= this.identityM && (!best || d < best.d)) best = { obj: x, d };
      }
      if (best) return best.obj;
      return pool.find((x) => x.status !== "gone" && !x.position) ?? null;
    }
    return pool.filter((x) => x.status !== "gone").sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || a.firstSeen - b.firstSeen)[0] ?? null;
  }

  /** 시야 판단: 카메라가 없으면(맞추기 전) 시야 안, 카메라가 있는데 위치를 모르면 모름(null). */
  private visible(obj: Obj, view: EngineFrame["view"]): boolean | null {
    if (!view) return true;
    if (!obj.position) return null;
    return inView(view, obj.position);
  }

  private name(obj: Obj): string {
    return objectName(obj.cls, obj.id);
  }

  applyDetections(frame: EngineFrame, dets: Detection[]): { changes: WorldChange[]; ids: Map<string, string> } {
    const at = frame.capturedAtMs;
    this.start(at);
    const view = frame.view;
    const surfaces = view ? this.o.surfaces() : [];
    const ids = new Map<string, string>();
    const seen = new Set<string>();
    const used = new Set<string>();
    dets.forEach((d, i) => {
      const tmp = `d${i + 1}`;
      if (d.label === "person") {
        if (d.score < this.minScore.person) return;
        ids.set(tmp, PERSON);
        seen.add(PERSON);
        return;
      }
      if (!OBJ_CLASSES.has(d.label) || d.score < this.minScore.object) return;
      const cls = d.label as ObjClass;
      const placed = view ? placeBox(view, d.box, { width: frame.width, height: frame.height }, surfaces, this.o.floorAt) : null;
      const obj = this.match(cls, placed?.position ?? null, used) ?? this.create(cls, at);
      used.add(obj.id);
      ids.set(tmp, obj.id);
      seen.add(obj.id);
      obj.lastSeen = Math.max(obj.lastSeen, at);
      obj.lastInView = Math.max(obj.lastInView, at);
      if (placed?.position) {
        obj.position = placed.position;
        obj.surface = placed.surface;
        obj.surfaceLabel = placed.surface ? surfaces.find((s) => s.id === placed.surface)?.label ?? null : null;
        obj.errorM = placed.errorM;
        obj.room = this.o.roomAt([placed.position[0], placed.position[2]]);
      }
    });
    if (seen.has(PERSON)) this.person.last_seen_ms = at;

    const present = [...this.objects.values()].filter((x) => x.confirmed && x.status !== "gone").map((x) => x.id);
    const candidates = this.person.visible ? [...present, PERSON] : present;
    const events = this.confirmer.observe(at, seen, candidates, (key) => key === PERSON || this.visible(this.objects.get(key)!, view) === true);
    const changes: WorldChange[] = [];
    for (const e of events) {
      if (e.key === PERSON) {
        this.person.visible = e.kind === "appeared";
        this.person.since_ms = at;
        changes.push({ kind: e.kind === "appeared" ? "person_appeared" : "person_gone", at_ms: at, subject: PERSON, meaningful: true,
          text: e.kind === "appeared" ? CHANGE_TEXT.personAppeared : CHANGE_TEXT.personGone });
        continue;
      }
      const obj = this.objects.get(e.key)!;
      if (e.kind === "appeared") {
        obj.confirmed = true;
        obj.status = "present";
        obj.goneAt = null;
        changes.push({ kind: "appeared", at_ms: at, subject: obj.id, meaningful: true, text: CHANGE_TEXT.appeared(this.name(obj), obj.surfaceLabel ? onSurface(obj.surfaceLabel) : null) });
      } else {
        obj.status = "gone";
        obj.goneAt = at;
        changes.push({ kind: "gone", at_ms: at, subject: obj.id, meaningful: true, text: CHANGE_TEXT.gone(this.name(obj)) });
      }
    }
    for (const obj of this.objects.values()) {
      if (!obj.confirmed) {
        if (!seen.has(obj.id)) this.objects.delete(obj.id);   // 세는 중에 끊기면 잊는다
        continue;
      }
      if (obj.status === "gone") {
        if (obj.goneAt !== null && at - obj.goneAt > GONE_KEEP_MS) this.objects.delete(obj.id);
        continue;
      }
      const vis = seen.has(obj.id) ? true : this.visible(obj, view);
      if (vis === true) {
        obj.lastInView = Math.max(obj.lastInView, at);
        if (obj.status === "out_of_view") {
          obj.status = "present";
          changes.push({ kind: "back_in_view", at_ms: at, subject: obj.id, meaningful: false, text: CHANGE_TEXT.backInView(this.name(obj)) });
        }
      } else if (vis === false && obj.status === "present") {
        obj.status = "out_of_view";
        changes.push({ kind: "out_of_view", at_ms: at, subject: obj.id, meaningful: false, text: CHANGE_TEXT.outOfView(this.name(obj)) });
      }
    }
    return { changes, ids };
  }

  /** 같은 면의 사실보다 오래된 답은 버린다. 값이 새로 생기거나 바뀌면 true. */
  private setFact(facts: Partial<Record<Facet, WorldFact>>, facet: Facet, value: string, atMs: number): boolean {
    const prev = facts[facet];
    if (prev && atMs < prev.at_ms) return false;
    if (prev && prev.value === value) {
      facts[facet] = { value, at_ms: atMs, certainty: "confirmed" };
      return false;
    }
    facts[facet] = { value, at_ms: atMs, certainty: "inferred" };
    return true;
  }

  applyScene(frameId: string, capturedAtMs: number, scene: SceneObservation, ids: Map<string, string>): WorldChange[] {
    this.start(capturedAtMs);
    const changes: WorldChange[] = [];
    const summary = scene.summary.trim();
    if (capturedAtMs >= this.summaryAt) {
      this.summaryAt = capturedAtMs;
      if (summary && summary !== this.summary) {
        this.summary = summary;
        changes.push({ kind: "vlm", at_ms: capturedAtMs, subject: frameId, meaningful: false, text: CHANGE_TEXT.vlm(summary) });
      }
    }
    for (const ob of scene.observations) {
      const facet = FACET[ob.state];
      const target = ids.get(ob.object_id);
      if (!facet || !target) continue;
      if (target === PERSON) {
        if (PERSON_FACETS.has(facet) && this.setFact(this.person.facts, facet, ob.state, capturedAtMs) && this.person.visible) {
          changes.push({ kind: "person_state", at_ms: capturedAtMs, subject: PERSON, meaningful: false, text: CHANGE_TEXT.state(OBJECT_NAME.person!, ob.state) });
        }
        continue;
      }
      const obj = this.objects.get(target);
      if (!obj || !OBJECT_FACETS.has(facet)) continue;
      if (this.setFact(obj.facts, facet, ob.state, capturedAtMs) && obj.confirmed && obj.status !== "gone") {
        changes.push({ kind: "state", at_ms: capturedAtMs, subject: obj.id, meaningful: true, text: CHANGE_TEXT.state(this.name(obj), ob.state) });
      }
    }
    return changes;
  }

  /** 분석 없음 프레임: 셈을 늘리고 변화 하나. 등장·사라짐 셈은 그대로다. */
  applyMissing(frameId: string, capturedAtMs: number, m: { yolo?: YoloMissing; vlm?: VlmMissing }): WorldChange[] {
    this.start(capturedAtMs);
    if (m.yolo) this.yoloMissing++;
    if (m.vlm) this.vlmMissing++;
    if (m.yolo) return [{ kind: "yolo_missing", at_ms: capturedAtMs, subject: frameId, meaningful: false, text: CHANGE_TEXT.yoloMissing[m.yolo] }];
    if (m.vlm) return [{ kind: "vlm_missing", at_ms: capturedAtMs, subject: frameId, meaningful: false, text: CHANGE_TEXT.vlmMissing[m.vlm] }];
    return [];
  }

  /** 관계표에 든 종류의 가전만 본다. 처음 받은 상태는 상태 이름 변화 하나, 그 뒤로는 바뀐 속성마다 이력과 변화. */
  applyDevice(s: DeviceState, atMs: number): WorldChange[] {
    const spec = this.o.devices().find((d) => d.id === s.id);
    if (!spec || !RELATED_KINDS.has(spec.kind)) return [];
    let d = this.devs.get(s.id);
    if (!d) {
      d = { id: s.id, kind: spec.kind, label: spec.label, twin: {}, status: null, changed: atMs, history: [], known: false };
      this.devs.set(s.id, d);
    }
    if (s.signal === "none") {
      d.status = null;
      this.remaining.update(s.id, {}, atMs);
      return [];
    }
    const statusAttr = DEVICE_STATUS[d.kind]?.attr;
    const changes: WorldChange[] = [];
    for (const [attr, to] of Object.entries(s.twin)) {
      const from = d.twin[attr];
      if (d.known && same(from, to)) continue;
      d.history = [...d.history, { attr, from: from ?? null, to, at_ms: atMs }].slice(-HISTORY_MAX);
      d.changed = atMs;
      if (d.known && attr !== statusAttr) changes.push({ kind: "device", at_ms: atMs, subject: d.id, meaningful: true, text: CHANGE_TEXT.deviceAttr(d.label, attr, to) });
    }
    const status = deviceStatus(d.kind, s.twin);
    if (status !== null && (status !== d.status || !d.known)) {
      changes.unshift({ kind: "device", at_ms: atMs, subject: d.id, meaningful: true, text: CHANGE_TEXT.device(d.label, status) });
    }
    d.status = status;
    d.twin = { ...s.twin };
    d.known = true;
    this.remaining.update(s.id, s.twin, atMs);
    return changes;
  }

  setEye(eye: EyePose | null, atMs: number): void {
    this.eye = eye
      ? { position: [eye.position[0], eye.position[1]], height_m: eye.height_m, yaw_deg: eye.yaw_deg, pitch_deg: eye.pitch_deg, room: this.o.roomAt(eye.position), at_ms: atMs }
      : null;
  }

  view(nowMs: number): WorldView {
    const devices = this.o.devices();
    const objects: WorldObject[] = [...this.objects.values()].filter((x) => x.confirmed).map((x) => ({
      id: x.id, cls: x.cls, position: x.position, surface: x.surface, surface_label: x.surfaceLabel, room: x.room, error_m: x.errorM, status: x.status,
      first_seen_ms: x.firstSeen, last_seen_ms: x.lastSeen, last_in_view_ms: x.lastInView, facts: { ...x.facts }, devices: relatedDeviceIds(x.cls, devices),
    }));
    return {
      at_ms: nowMs, objects,
      person: { ...this.person, facts: { ...this.person.facts } },
      devices: [...this.devs.values()].map((d) => ({
        id: d.id, kind: d.kind, label: d.label, status: d.status, changed_ms: d.changed,
        started_ms: this.remaining.startedAt(d.id), remaining_min: this.remaining.remainingMin(d.id, nowMs), history: [...d.history],
      })),
      eye: this.eye, vlm_missing: this.vlmMissing, yolo_missing: this.yoloMissing,
    };
  }
}
