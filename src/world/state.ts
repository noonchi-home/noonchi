// World State: 엔진 프레임마다 YOLO 감지와 VLM 관찰을 물체별로 합치고, 시간에 따른 변화(등장·사라짐·시야 밖·상태·가전)를 낸다.
// 종류·사실 값·면·신뢰도는 낱말 표(src/world/vocab.ts)를 따른다.
// - 같은 물체: 트윈 위치 + 종류(종류의 identityM, 없으면 기본 0.25m 안). 맞추기 전(카메라 없음)에는 같은 종류의 물체에 차례로 붙인다.
// - 등장·사라짐: Confirmer(사람 2장, 물건 3장). 사라짐은 그 자리가 시야 안인 프레임만 센다. 등장 확인 전 물체는 view()에 내지 않는다.
// - 가전 설비(TV·냉장고·전자레인지·오븐·토스터·싱크대): 보임·사라짐 없이 방(클로이드 눈의 방)마다 종류 하나. VLM 사실만 쌓고 같은 방 트윈 가전 id를 붙인다.
// - VLM 사실: 면(facet)마다 하나. 그 종류에 없는 면·그 대상에 붙지 않는 값은 버린다. 촬영 시각이 더 오래된 답은 버리고, 같은 값이 연속 두 번이면 confirmed.
//   지금만 맞는 면(vocab NOW_FACETS: 쓰는 중, 사람 들고 있음·하는 일·자리)은 그 대상을 본 프레임의 VLM 답에 없으면 지운다. 사람이 안 보이면 사람 사실을 지운다.
// - 관절(applyDetections의 poses): 손목이 물건 상자 안·가까이면 손에 있음과 사람 물건을 들고 있음, 관절 자세(서 있음·앉아 있음·누워 있음).
//   같은 프레임에서는 관절 사실이 VLM 답보다 앞선다. 손목이 떨어지거나 사람이 안 보이면 관절이 붙인 손에 있음만 지운다.
// - 사람 자리·방: 맞춘 뒤 가장 큰 사람 상자의 발(상자 아래가 프레임 끝에 닿지 않음)이 보이면 그 바닥 자리와 방. 눈의 방으로 대신하지 않는다. 바뀌면 변화 하나.
// - 분석 없음(applyMissing): 셈과 변화 하나만 남기고 등장·사라짐 셈에는 넣지 않는다.
// - 가전: 모든 가전의 상태 키(vocab DEVICE_STATES), 바뀐 속성의 이력, 사건 줄(세탁 끝남), 남은 시간, 오래 이어진 상태(tick: 냉장고 문 1분).
import type { EyePose } from "../contract/events.js";
import type {
  Facet, FixtureClass, ObjClass, VlmMissing, WorldChange, WorldDevice, WorldEye, WorldFact, WorldFixture, WorldObject, WorldPerson, WorldView, YoloMissing,
} from "../contract/world.js";
import type { Detection, Pose } from "../brain/detector.js";
import type { DeviceState } from "../hub/types.js";
import type { EngineFrame } from "../observe/ring.js";
import type { SceneObservation } from "../observe/scene.js";
import { Confirmer } from "./confirm.js";
import { CHANGE_TEXT, OBJECT_NAME, fixtureName, objectName, onSurface } from "./labels.js";
import { inView, placeBox, type PlaneSurface } from "./place.js";
import { describePose, heldByAny, mainPerson } from "./pose.js";
import { RemainingTracker, becameKey, deviceStateKeys, deviceStatus, deviceText, relatedDeviceIds } from "./relations.js";
import {
  CLASSES, DEVICE_LONG, DEVICE_STATES, FACT_FRESH_MS, FRESH_MS, NEAR_M, NOW_FACETS, POSE_HOLD, POSE_POSTURE, STATES, VLM_ONLY, type ClassKey, type DeviceStateKey, type StateKey, type Target,
} from "./vocab.js";

type V3 = [number, number, number];
type Plan2 = [number, number];
type Facts = Partial<Record<Facet, WorldFact>>;

const KEYS = Object.keys(CLASSES) as ClassKey[];
const OBJ_CLASSES: ReadonlySet<string> = new Set(KEYS.filter((k) => CLASSES[k].role === "object"));
const FIXTURE_CLASSES: ReadonlySet<string> = new Set(KEYS.filter((k) => CLASSES[k].role === "fixture"));
const PERSON = "person";
const HISTORY_MAX = 20;
/** 사라진 물체를 이만큼 두었다가 잊는다(같은 자리에 다시 보이면 같은 id로 돌아온다). */
const GONE_KEEP_MS = 600_000;
/** 상자 아래가 프레임 높이의 이 비율보다 아래면 발이 잘린 것으로 본다. */
const FEET_EDGE = 0.98;

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
  facts: Facts;
  answered: number | null;
}

interface Fix { id: string; cls: FixtureClass; room: string | null; roomLabel: string | null; firstSeen: number; lastSeen: number; facts: Facts; answered: number | null }

interface Dev {
  id: string; kind: string; label: string; twin: Record<string, unknown>; status: string | null; state: DeviceStateKey[]; changed: number; eventAt: number | null;
  /** 지금 상태 키마다 그 상태가 된 시각. */
  since: Partial<Record<DeviceStateKey, number>>;
  /** 이미 낸 오래 이어진 사건(규칙@시작 시각). */
  long: Set<string>;
  history: WorldDevice["history"]; known: boolean;
}

export interface WorldStateOptions {
  surfaces: () => PlaneSurface[];
  floorAt: (p: Plan2) => number;
  /** 평면 위 점이 있는 방(id와 이름). 집 밖이면 null. */
  roomAt: (p: Plan2) => { id: string; label: string } | null;
  /** 가전 목록. room은 방 id(가전 설비를 같은 방 가전에 붙인다). */
  devices: () => readonly { id: string; kind: string; label: string; room?: string }[];
  /** 가전 평면 자리 [x, y](사람 가까이). 모르면 null. */
  locate?: (id: string) => Plan2 | null;
  /** 같은 물체로 볼 기본 거리(m, 기본 0.25). 종류에 identityM이 있으면 그 값. */
  identityM?: number;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const area = (b: Detection["box"]) => Math.max(0, b[2]) * Math.max(0, b[3]);

/** 이 값이 그 종류·대상에 붙는가. */
function fits(value: StateKey, cls: ClassKey, target: Target): boolean {
  const s = STATES[value];
  return (s.for as readonly Target[]).includes(target) && (CLASSES[cls].facets as readonly Facet[]).includes(s.facet);
}

export class WorldState {
  private readonly objects = new Map<string, Obj>();
  private readonly fixtures = new Map<string, Fix>();
  private readonly counters = new Map<string, number>();
  private readonly confirmer = new Confirmer((key) => (key === PERSON ? 2 : 3));
  private readonly person: {
    visible: boolean; since_ms: number | null; last_seen_ms: number | null; count: number; room: { id: string; label: string } | null; position: Plan2 | null; positionAt: number | null;
    facts: Facts; answered: number | null;
  } = { visible: false, since_ms: null, last_seen_ms: null, count: 0, room: null, position: null, positionAt: null, facts: {}, answered: null };
  private readonly devs = new Map<string, Dev>();
  private readonly remaining = new RemainingTracker();
  private eye: WorldEye | null = null;
  private summary = "";
  private summaryAt = Number.NEGATIVE_INFINITY;
  private vlmMissing = 0;
  private yoloMissing = 0;
  private frameAt: number | null = null;
  /** 관절로 마지막에 든 물건 id(확인 전 물건 포함). */
  private heldIds: string[] = [];
  /** 관절이 붙인 사실(그 사실 객체). VLM이 같은 면을 다시 쓰면 새 객체라 빠진다. */
  private readonly byPose = new WeakSet<WorldFact>();
  private readonly identityM: number;

  constructor(private readonly o: WorldStateOptions) {
    this.identityM = o.identityM ?? 0.25;
  }

  /** 이 감지를 받는가: 낱말 표의 사람·물건·가전 설비 종류이고 그 종류의 최소 신뢰도 이상. 관찰 흐름은 받는 감지만 상자·YOLO 글·VLM 감지 목록에 싣는다. */
  accepts(d: Pick<Detection, "label" | "score">): boolean {
    const c = (CLASSES as Record<string, (typeof CLASSES)[ClassKey] | undefined>)[d.label];
    return !!c && c.role !== "scene" && d.score >= c.minScore;
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
      firstSeen: atMs, lastSeen: atMs, lastInView: atMs, goneAt: null, facts: {}, answered: null,
    };
    this.objects.set(obj.id, obj);
    return obj;
  }

  /** 같은 물체 찾기. 위치가 있으면 같은 종류 중 그 종류 거리 안의 가장 가까운 것(사라진 것도), 없으면 사라지지 않은 같은 종류를 처음 본 순서로. */
  private match(cls: ObjClass, position: V3 | null, used: ReadonlySet<string>): Obj | null {
    const pool = [...this.objects.values()].filter((x) => x.cls === cls && !used.has(x.id));
    const near = (CLASSES[cls] as { identityM?: number }).identityM ?? this.identityM;
    if (position) {
      let best: { obj: Obj; d: number } | null = null;
      for (const x of pool) {
        if (!x.position) continue;
        const d = dist(x.position, position);
        if (d <= near && (!best || d < best.d)) best = { obj: x, d };
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

  /** 가전 설비 하나: 그 사진을 찍은 클로이드 눈의 방마다 종류 하나(tv_living). */
  private fixture(cls: FixtureClass, atMs: number, room: { id: string; label: string } | null): Fix {
    const id = `${cls}_${room?.id ?? "room"}`;
    let f = this.fixtures.get(id);
    if (!f) {
      f = { id, cls, room: room?.id ?? null, roomLabel: room?.label ?? null, firstSeen: atMs, lastSeen: atMs, facts: {}, answered: null };
      this.fixtures.set(id, f);
    }
    f.lastSeen = Math.max(f.lastSeen, atMs);
    return f;
  }

  /** poses: 이 프레임의 관절(YOLO26-pose). 없으면(관절 모델이 없거나 사람이 없어 돌리지 않음) 자세·손에 듦을 보지 않는다. */
  applyDetections(frame: EngineFrame, dets: Detection[], poses?: Pose[]): { changes: WorldChange[]; ids: Map<string, string> } {
    const at = frame.capturedAtMs;
    this.start(at);
    this.frameAt = Math.max(this.frameAt ?? at, at);
    const view = frame.view;
    const surfaces = view ? this.o.surfaces() : [];
    const ids = new Map<string, string>();
    const seen = new Set<string>();
    const used = new Set<string>();
    const boxes: { obj: Obj; box: Detection["box"] }[] = [];
    const people: Detection[] = [];
    const eyeRoom = frame.eye ? this.o.roomAt([frame.eye.position[0], frame.eye.position[1]]) : null;
    dets.forEach((d, i) => {
      const tmp = `d${i + 1}`;
      if (!this.accepts(d)) return;
      if (d.label === "person") {
        ids.set(tmp, PERSON);
        seen.add(PERSON);
        people.push(d);
        return;
      }
      if (FIXTURE_CLASSES.has(d.label)) {
        ids.set(tmp, this.fixture(d.label as FixtureClass, at, eyeRoom).id);
        return;
      }
      if (!OBJ_CLASSES.has(d.label)) return;
      const cls = d.label as ObjClass;
      const placed = view ? placeBox(view, d.box, { width: frame.width, height: frame.height }, surfaces, this.o.floorAt) : null;
      const obj = this.match(cls, placed?.position ?? null, used) ?? this.create(cls, at);
      used.add(obj.id);
      ids.set(tmp, obj.id);
      seen.add(obj.id);
      boxes.push({ obj, box: d.box });
      obj.lastSeen = Math.max(obj.lastSeen, at);
      obj.lastInView = Math.max(obj.lastInView, at);
      if (placed?.position) {
        obj.position = placed.position;
        obj.surface = placed.surface;
        obj.surfaceLabel = placed.surface ? surfaces.find((s) => s.id === placed.surface)?.label ?? null : null;
        obj.errorM = placed.errorM;
        obj.room = this.o.roomAt([placed.position[0], placed.position[2]])?.id ?? null;
      }
    });
    if (seen.has(PERSON)) {
      this.person.last_seen_ms = at;
      this.person.count = people.length;
      this.locatePerson(frame, people);
    }

    const present = [...this.objects.values()].filter((x) => x.confirmed && x.status !== "gone").map((x) => x.id);
    const candidates = this.person.visible ? [...present, PERSON] : present;
    const events = this.confirmer.observe(at, seen, candidates, (key) => key === PERSON || this.visible(this.objects.get(key)!, view) === true);
    const changes: WorldChange[] = [];
    for (const e of events) {
      if (e.key === PERSON) {
        this.person.visible = e.kind === "appeared";
        this.person.since_ms = at;
        if (e.kind === "gone") {
          this.person.facts = {};
          this.person.count = 0;
          this.heldIds = [];
          for (const o of this.objects.values()) this.dropPoseFact(o.facts, "place", POSE_HOLD.object); // 사람이 없으면 손에 있을 수 없다
        }
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
        for (const f of NOW_FACETS.object) delete obj.facts[f];
        changes.push({ kind: "gone", at_ms: at, subject: obj.id, meaningful: true, text: CHANGE_TEXT.gone(this.name(obj)) });
      }
    }
    for (const obj of this.objects.values()) {
      if (!obj.confirmed) {
        if (!seen.has(obj.id)) this.forget(obj.id);   // 세는 중에 끊기면 잊는다
        continue;
      }
      if (obj.status === "gone") {
        if (obj.goneAt !== null && at - obj.goneAt > GONE_KEEP_MS) this.forget(obj.id);
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
    // 사람 방: 보이는 동안 바뀌거나 사람이 막 보이면 변화 하나
    const next = this.nextRoom;
    this.nextRoom = undefined;
    const appeared = events.some((e) => e.key === PERSON && e.kind === "appeared");
    if (next === null) this.person.room = null;
    else if (next && next.id !== this.person.room?.id) {
      this.person.room = next;
      if (this.person.visible) changes.push(this.roomChange(at));
    } else if (appeared && this.person.room) changes.push(this.roomChange(at));
    if (poses) this.applyPose(at, poses, boxes, changes);
    return { changes, ids };
  }

  /** 사람 자리·방: 맞춘 뒤 가장 큰 사람 상자의 발이 보이면 그 바닥 자리와 방. 방 반영은 applyDetections 끝에서. */
  private locatePerson(frame: EngineFrame, people: Detection[]): void {
    const main = people.reduce((a, b) => (b.score * area(b.box) > a.score * area(a.box) ? b : a));
    const feet = main.box[1] + main.box[3] < frame.height * FEET_EDGE;
    const placed = frame.view && feet ? placeBox(frame.view, main.box, { width: frame.width, height: frame.height }, [], this.o.floorAt) : null;
    if (!placed?.position) return;
    const position: Plan2 = [placed.position[0], placed.position[2]];
    this.person.position = position;
    this.person.positionAt = frame.capturedAtMs;
    this.nextRoom = this.o.roomAt(position);
  }

  /** 이번 프레임의 발 자리에서 본 방. undefined는 새 발 자리 없음, null은 집 안 방이 아님(방을 모름으로). */
  private nextRoom: { id: string; label: string } | null | undefined = undefined;

  private roomChange(at: number): WorldChange {
    return { kind: "person_room", at_ms: at, subject: PERSON, meaningful: true, text: CHANGE_TEXT.personRoom(this.person.room!.label) };
  }

  /** 관절로 본 사실(규칙: src/world/pose.ts). 어느 관절이든 손목이 물건 상자 안·가까이면 그 물건 손에 있음과 사람 물건을 들고 있음,
   *  자세는 가장 확실한 한 사람의 서 있음·앉아 있음·누워 있음.
   *  손목이 보이는데 든 것이 없으면 관절이 붙인 손에 있음·들고 있음만 지운다(VLM이 붙인 사실은 둔다). */
  private applyPose(at: number, poses: Pose[], boxes: { obj: Obj; box: Detection["box"] }[], changes: WorldChange[]): void {
    const person = mainPerson(poses);
    if (!person) return;
    const people = poses.map(describePose);
    const wrists = people.some((p) => Object.keys(p.wrists).length > 0);
    const held: string[] = [];
    for (const { obj, box } of boxes) {
      if (!heldByAny(people, box)) {
        if (wrists) this.dropPoseFact(obj.facts, "place", POSE_HOLD.object);
        continue;
      }
      held.push(obj.id);
      if (this.setPoseFact(obj.facts, "place", POSE_HOLD.object, at) && obj.confirmed && obj.status !== "gone") {
        changes.push({ kind: "state", at_ms: at, subject: obj.id, meaningful: true, text: CHANGE_TEXT.state(this.name(obj), POSE_HOLD.object) });
      }
    }
    const personFact = (facet: Facet, value: string) => {
      if (this.setPoseFact(this.person.facts, facet, value, at) && this.person.visible) {
        changes.push({ kind: "person_state", at_ms: at, subject: PERSON, meaningful: false, text: CHANGE_TEXT.state(OBJECT_NAME.person!, value) });
      }
    };
    if (held.length) {
      personFact("holding", POSE_HOLD.person);
      this.heldIds = held; // 확인 전 물건도 든다: 무엇을 들었는지는 id 앞 종류로 본다
    } else if (wrists) {
      this.dropPoseFact(this.person.facts, "holding", POSE_HOLD.person);
      this.heldIds = [];
    }
    const posture = (POSE_POSTURE as Record<string, string | undefined>)[person.posture];
    if (posture && person.level !== "low") personFact("posture", posture);
  }

  private setPoseFact(facts: Facts, facet: Facet, value: string, atMs: number): boolean {
    const changed = this.setFact(facts, facet, value, atMs, facet === "holding");
    const f = facts[facet];
    if (f && f.value === value && f.at_ms === atMs) this.byPose.add(f);
    return changed;
  }

  /** 관절이 붙인 그 값이면 지운다. */
  private dropPoseFact(facts: Facts, facet: Facet, value: string): void {
    const f = facts[facet];
    if (f && f.value === value && this.byPose.has(f)) delete facts[facet];
  }

  /** 관절이 이 프레임(또는 더 새 프레임)에서 붙인 사실이면 VLM 답이 바꾸거나 지우지 않는다. */
  private poseHolds(f: WorldFact | undefined, capturedAtMs: number): boolean {
    return !!f && this.byPose.has(f) && f.at_ms >= capturedAtMs;
  }

  private forget(id: string): void {
    this.objects.delete(id);
    this.confirmer.forget(id);
  }

  /** 같은 면의 사실보다 오래된 답은 버린다. 값이 새로 생기거나 바뀌면 true.
   *  지금만 맞는 면(now)은 같은 값이어도 앞 답과 FACT_FRESH_MS 넘게 떨어지면 그 사이를 모르므로 처음 보인 시각을 새로 둔다. */
  private setFact(facts: Facts, facet: Facet, value: string, atMs: number, now = false): boolean {
    const prev = facts[facet];
    if (prev && atMs < prev.at_ms) return false;
    if (prev && prev.value === value) {
      const since = now && atMs - prev.at_ms > FACT_FRESH_MS ? atMs : prev.since_ms;
      facts[facet] = { value, at_ms: atMs, since_ms: since, certainty: "confirmed" };
      return false;
    }
    facts[facet] = { value, at_ms: atMs, since_ms: atMs, certainty: "inferred" };
    return true;
  }

  /** VLM 대상: 사람·물건·가전 설비와 그 사실, 종류. */
  private targetOf(id: string): { kind: Target; facts: Facts; cls: ClassKey } | null {
    if (id === PERSON) return { kind: "person", facts: this.person.facts, cls: "person" };
    const obj = this.objects.get(id);
    if (obj) return { kind: "object", facts: obj.facts, cls: obj.cls };
    const fix = this.fixtures.get(id);
    return fix ? { kind: "fixture", facts: fix.facts, cls: fix.cls } : null;
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
    const said = new Set<string>();
    const hidden = new Set(scene.observations.filter((o) => (VLM_ONLY as readonly string[]).includes(o.state)).map((o) => ids.get(o.object_id)).filter((x): x is string => !!x));
    for (const ob of scene.observations) {
      const id = ids.get(ob.object_id);
      const target = id ? this.targetOf(id) : null;
      if (!id || !target || !(ob.state in STATES)) continue;
      const value = ob.state as StateKey;
      if (!fits(value, target.cls, target.kind)) continue;
      const facet = STATES[value].facet;
      said.add(`${id}|${facet}`);
      if (this.poseHolds(target.facts[facet], capturedAtMs)) continue;
      if (!this.setFact(target.facts, facet, value, capturedAtMs, NOW_FACETS[target.kind].includes(facet))) continue;
      if (target.kind === "person") {
        if (this.person.visible) changes.push({ kind: "person_state", at_ms: capturedAtMs, subject: PERSON, meaningful: false, text: CHANGE_TEXT.state(OBJECT_NAME.person!, value) });
      } else if (target.kind === "fixture") {
        const fix = this.fixtures.get(id)!;
        changes.push({ kind: "fixture", at_ms: capturedAtMs, subject: id, meaningful: true, text: CHANGE_TEXT.state(fixtureName(fix.cls, fix.id, fix.roomLabel), value) });
      } else {
        const obj = this.objects.get(id)!;
        if (obj.confirmed && obj.status !== "gone") changes.push({ kind: "state", at_ms: capturedAtMs, subject: id, meaningful: true, text: CHANGE_TEXT.state(this.name(obj), value) });
      }
    }
    // 이 프레임에서 본 대상의 지금만 맞는 사실: 이 답에 없으면 지운다(더 새 답의 사실은 그대로)
    for (const id of new Set(ids.values())) {
      const target = this.targetOf(id);
      if (!target || hidden.has(id)) continue;
      const owner = id === PERSON ? this.person : this.objects.get(id) ?? this.fixtures.get(id)!;
      owner.answered = Math.max(owner.answered ?? capturedAtMs, capturedAtMs);
      for (const f of NOW_FACETS[target.kind]) {
        const prev = target.facts[f];
        if (prev && prev.at_ms <= capturedAtMs && !said.has(`${id}|${f}`) && !this.poseHolds(prev, capturedAtMs)) delete target.facts[f];
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

  /** 가전 상태. 처음 받은 상태는 상태 이름 변화 하나, 그 뒤로는 바뀐 속성마다 이력과 사건 줄(아는 상태가 아니면 속성 줄, 판단 계기 아님). */
  applyDevice(s: DeviceState, atMs: number): WorldChange[] {
    const spec = this.o.devices().find((d) => d.id === s.id);
    if (!spec) return [];
    let d = this.devs.get(s.id);
    if (!d) {
      d = { id: s.id, kind: spec.kind, label: spec.label, twin: {}, status: null, state: [], changed: atMs, eventAt: null, since: {}, long: new Set(), history: [], known: false };
      this.devs.set(s.id, d);
    }
    if (s.signal === "none") {
      d.status = null;
      d.state = [];
      d.since = {};
      this.remaining.update(s.id, {}, atMs);
      return [];
    }
    const changes: WorldChange[] = [];
    for (const [attr, to] of Object.entries(s.twin)) {
      const from = d.twin[attr];
      if (d.known && same(from, to)) continue;
      d.history = [...d.history, { attr, from: from ?? null, to, at_ms: atMs }].slice(-HISTORY_MAX);
      d.changed = atMs;
      const key = becameKey(attr, to);
      if (key) d.since[key] = atMs;
      if (!d.known) continue;
      if (key) {
        d.eventAt = atMs;
        changes.push({ kind: "device", at_ms: atMs, subject: d.id, meaningful: true, text: CHANGE_TEXT.device(d.label, deviceText(d.kind, key).became) });
      } else changes.push({ kind: "device", at_ms: atMs, subject: d.id, meaningful: false, text: CHANGE_TEXT.deviceAttr(d.label, attr, to) });
    }
    const status = deviceStatus(d.kind, s.twin);
    if (!d.known && status !== null) changes.push({ kind: "device", at_ms: atMs, subject: d.id, meaningful: true, text: CHANGE_TEXT.device(d.label, status) });
    d.status = status;
    d.state = deviceStateKeys(d.kind, s.twin);
    for (const k of Object.keys(d.since) as DeviceStateKey[]) if (!d.state.includes(k)) delete d.since[k];
    for (const k of d.state) d.since[k] ??= atMs; // 신호가 돌아와 값이 같아도 그때부터 센다
    d.twin = { ...s.twin };
    d.known = true;
    this.remaining.update(s.id, s.twin, atMs);
    return changes;
  }

  /** 시간이 지나야 나는 사건(vocab DEVICE_LONG: 냉장고·현관문 문이 1분 넘게 열림). 한 상태가 이어지는 동안 한 번. 판단 타이머가 부른다. */
  tick(nowMs: number): WorldChange[] {
    const changes: WorldChange[] = [];
    for (const d of this.devs.values()) {
      for (const [key, rule] of Object.entries(DEVICE_LONG)) {
        const since = d.since[rule.state];
        if (since === undefined || d.status === null || !d.state.includes(rule.state) || !(rule.kinds as readonly string[]).includes(d.kind) || nowMs - since < rule.afterMs) continue;
        const mark = `${key}@${since}`;
        if (d.long.has(mark)) continue;
        d.long.add(mark);
        changes.push({ kind: "device", at_ms: nowMs, subject: d.id, meaningful: true, text: CHANGE_TEXT.device(d.label, rule.label) });
      }
    }
    return changes;
  }

  setEye(eye: EyePose | null, atMs: number): void {
    const room = eye ? this.o.roomAt(eye.position) : null;
    this.eye = eye
      ? { position: [eye.position[0], eye.position[1]], height_m: eye.height_m, yaw_deg: eye.yaw_deg, pitch_deg: eye.pitch_deg, room: room?.id ?? null, room_label: room?.label ?? null, at_ms: atMs }
      : null;
  }

  view(nowMs: number): WorldView {
    const devices = this.o.devices();
    const objects: WorldObject[] = [...this.objects.values()].filter((x) => x.confirmed).map((x) => ({
      id: x.id, cls: x.cls, position: x.position, surface: x.surface, surface_label: x.surfaceLabel, room: x.room, error_m: x.errorM, status: x.status,
      first_seen_ms: x.firstSeen, last_seen_ms: x.lastSeen, last_in_view_ms: x.lastInView, facts: { ...x.facts }, answered_ms: x.answered, devices: relatedDeviceIds(x.cls, devices),
    }));
    const fixtures: WorldFixture[] = [...this.fixtures.values()].map((f) => ({
      id: f.id, cls: f.cls, room: f.room, room_label: f.roomLabel, first_seen_ms: f.firstSeen, last_seen_ms: f.lastSeen, facts: { ...f.facts }, answered_ms: f.answered,
      device: devices.find((d) => d.kind === (CLASSES[f.cls] as { deviceKind?: string }).deviceKind && d.room !== undefined && d.room === f.room)?.id ?? null,
    }));
    const p = this.person;
    const near = p.visible && p.position && p.positionAt !== null && nowMs - p.positionAt <= FRESH_MS && this.o.locate
      ? devices.filter((d) => { const at = this.o.locate!(d.id); return !!at && Math.hypot(at[0] - p.position![0], at[1] - p.position![1]) <= NEAR_M; }).map((d) => d.id)
      : [];
    const person: WorldPerson = {
      visible: p.visible, since_ms: p.since_ms, last_seen_ms: p.last_seen_ms, count: p.visible ? p.count : 0,
      position: p.position, position_ms: p.positionAt, room: p.room?.id ?? null, room_label: p.room?.label ?? null, near,
      holding: [...new Set([...(this.byPose.has(p.facts.holding!) ? this.heldIds : []),
        ...objects.filter((o) => o.status !== "gone" && o.facts.place?.value === POSE_HOLD.object).map((o) => o.id)])],
      facts: { ...p.facts }, answered_ms: p.answered,
    };
    return {
      at_ms: nowMs, objects, person, fixtures,
      devices: [...this.devs.values()].map((d) => ({
        id: d.id, kind: d.kind, label: d.label, status: d.status, state: [...d.state], active: d.state.some((k) => DEVICE_STATES[k].active),
        changed_ms: d.changed, event_ms: d.eventAt, started_ms: this.remaining.startedAt(d.id), remaining_min: this.remaining.remainingMin(d.id, nowMs), history: [...d.history],
      })),
      eye: this.eye, frame_ms: this.frameAt, vlm_missing: this.vlmMissing, yolo_missing: this.yoloMissing,
    };
  }
}
