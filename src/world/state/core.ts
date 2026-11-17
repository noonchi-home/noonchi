// World State(src/world/state/)의 안쪽 공유 객체 WorldCore: 부분(objects 감지 합치기·people 사람·관절·facts VLM 사실·closer 가까이 보기·devices 카메라로 본 가전)이
// 함께 쓰는 상태(물건·가전 설비·사람·등장 셈·관절이 붙인 사실·쓰러짐)와 작은 도우미(물건 만들기·잊기·이름·보임 판단·자리 고칠 촬영·지킴).
// 부분은 이 객체를 받는 작은 클래스(Part)이고 서로를 이 객체의 칸으로 부른다. 부분끼리는 값 import가 없다(WorldState가 만들어 잇는다, world.ts).
import type { Facet, FixtureClass, ObjClass, WorldFact, WorldObject, WorldSighting } from "../../contract/world.js";
import type { Detection } from "../../contract/observe.js";
import { Confirmer, EVIDENCE_STEP_MS } from "../confirm.js";
import { objectName } from "../labels.js";
import { FALL_DEFAULTS, FallWatch, type FallConfig } from "../fall.js";
import type { SightLink } from "../sight.js";
import { CLASSES, sameDrinkware, STATES, type ClassKey, type StateKey, type Target } from "../vocab.js";
import type { CloserLook } from "./closer.js";
import type { ContentsBook, ContentsState } from "./contents.js";
import type { DeviceSight } from "./devices.js";
import type { SceneFacts } from "./facts.js";
import type { Detections } from "./objects.js";
import type { People } from "./people.js";
import type { SceneObjects } from "./sceneobjects.js";
import type { WorldStateOptions } from "./world.js";

export type V3 = [number, number, number];
export type Plan2 = [number, number];
export type Facts = Partial<Record<Facet, WorldFact>>;

export const KEYS = Object.keys(CLASSES) as ClassKey[];
export const OBJ_CLASSES: ReadonlySet<string> = new Set(KEYS.filter((k) => CLASSES[k].role === "object"));
export const PERSON = "person";
/** 가까이 보기로 찾거나 고친 물건은 이만큼(ms, 촬영 시각 기준) 전체 사진에서 못 봐도 사라짐으로 세지 않는다(전체 사진의 감지기는 그 물건을 못 본다). */
export const CLOSER_HOLD_MS = 30_000;
/** 카메라 자리에서 물건 자리로 가는 수평 방향(단위 [x, y]). 거의 바로 위면 null. */
export function fromCamera(origin: readonly number[], at: readonly number[]): [number, number] | null {
  const dx = at[0]! - origin[0]!, dz = at[2]! - origin[2]!;
  const l = Math.hypot(dx, dz);
  return l > 1e-6 ? [dx / l, dz / l] : null;
}
/** 보기 지킴(가까이 가서 위에서 비추는 동안, WorldState.guard) 한도: 풀지 않아도 이만큼(ms) 지나면 끝난다. */
export const PEEK_GUARD_MS = 60_000;
/** 크기 재기에 쌓는 최근 사진 수(가운데값을 쓴다). */
export const SIZE_SAMPLES = 5;
/** 등장 확인 전에 끊긴 후보의 마지막 자리(sightings)를 이만큼(ms) 두고, 종류마다 최근 이만큼 둔다. 같은 종류 물건이 이 거리(m) 안에 등장하면 지운다. */
export const SIGHTING_KEEP_MS = 120_000;
export const SIGHTING_MAX = 4;
export const SIGHTING_CLEAR_M = 0.5;

/** 물건을 본 자리 하나(트윈 자리·면·촬영 시각). */
export interface Spot { position: V3; surface: string | null; surfaceLabel: string | null; at: number }

/** 움직임·정지를 보는 자리 하나: 원본 프레임(전체 감지·가까이 보기)의 촬영 시각·id, 트윈 자리(모르면 null), 엔진 프레임 사진 가운데 점(0~1). */
export interface TrailSample { at: number; frame: string; position: V3 | null; center: [number, number] }

export interface Obj {
  id: string;
  cls: ObjClass;
  position: V3 | null;
  surface: string | null;
  surfaceLabel: string | null;
  /** 그 면 안의 자리(싱크볼 안이면 basin). */
  part: "basin" | null;
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
  /** 가까이 보기로 마지막에 찾거나 고친 촬영 시각(지킴의 시작). 지킴이 풀리면 null. */
  closerAt: number | null;
  /** 보기 지킴을 건 시각(가까이 가서 위에서 비추는 동안, closerAt과 다른 칸). 풀면 null. */
  peekGuard: number | null;
  /** 전체 사진 감지 상자로 잰 크기(높이·폭 m, 최근 SIZE_SAMPLES장). 그릇 종류만 잰다. */
  sizes: { height: number; width: number }[];
  /** 지금 자리(가까운 바닥 가장자리)를 잰 카메라에서 그 자리로 가는 수평 방향(단위 [x, y]). 바닥 가운데는 자리에서 이 쪽으로 반 폭이다. 모르면 null. */
  posFrom: [number, number] | null;
  /** 자리를 마지막으로 고친 촬영 시각과 그것이 가까이 보기였는가(같은 촬영이면 잘라 본 자리가 앞선다). */
  posAt: number;
  /** 마지막으로 움직인 촬영 시각(최근 본 자리에서 트윈 자리 MOVE_M, 자리를 모르면 사진 가운데 점 MOVE_IMAGE 넘게 떨어짐)과 최근 SETTLE_MS 동안 본 자리. */
  movedAt: number;
  trail: TrailSample[];
  /** 사람이 안 보이게 됐을 때 아직 움직이던 든 물건: 제자리에 SETTLE_MS 있으면 관절의 손에 있음을 지운다. */
  carried: boolean;
  posCloser: boolean;
  /** 보임(있음·시야 밖·사라짐)을 마지막으로 판단한 촬영 시각: 전체 사진이 보거나, 시야 밖이거나, 사라짐·등장을 확인한 촬영과 가까이 보기로 본 촬영.
   *  이보다 옛 촬영은 보임을 바꾸지 않고 등장·사라짐 셈에도 들어가지 않는다(넣는 전체 사진보다 새 판단은 가까이 보기에서만 나온다). 시야 안인데 못 본 프레임(사라짐 셈 중)은 판단이 아니다:
   *  전체 사진의 감지기는 싱크대 안 컵을 못 보므로 그것을 판단으로 치면 가까이 보기가 지킴을 둘 수 없다. */
  judgedAt: number;
  /** 그 판단의 원본 프레임 id와 그것이 가까이 보기 양성이었는가(같은 원본 프레임이면 잘라 본 양성이 전체 사진 판단보다 앞선다). */
  judgedFrame: string;
  judgedCloser: boolean;
  /** 지킴 중에 같은 종류 새 물건이 다른 자리에 생겼다: 그 물건 id와 촬영 시각·원본 프레임. 그보다 새 촬영이나 같은 원본 프레임에서 이 물건을 다시 보면 null. */
  followed: { id: string; at: number; frame: string } | null;
  /** 면마다 가까이 보기 VLM 답이 값을 새로 넣거나 바꾼 횟수(지금 값의 출처와 따로 남는다). */
  closerRev: Partial<Record<Facet, number>>;
  /** VLM이 이 물건을 다른 종류(마시는 그릇 무리 안)로 이어 답한 수: 서로 다른 원본 프레임의 더 새 촬영 CLASS_SWITCH_ANSWERS번이면 그 종류로 바꾼다(WorldCore.voteClass). */
  clsVote: { cls: ObjClass; n: number } | null;
  /** 종류 셈에 마지막으로 넣은 VLM 답의 촬영 시각·원본 프레임(같은 사진 재시도·늦게 온 옛 답은 세지 않는다). */
  clsAt: number;
  clsFrame: string | null;
  /** 장면·가까이 보기 VLM이 이 물건을 본 마지막 촬영 시각(VLM_SEEN_HOLD_MS 동안 YOLO가 놓쳐도 사라짐을 세지 않는다). */
  vlmSeen: number | null;
  /** 확인 전 후보를 본 VLM 답의 원본 프레임(VLM_CONFIRM_FRAMES장이면 확정). */
  vlmFrames: string[];
  /** 내용물 갱신기의 상태(src/world/state/contents.ts). 내용물을 쌓은 적 없으면 null. */
  contents: ContentsState | null;
  /** 관절의 손에 없을 때 전체 사진으로 본 마지막 자리(확인 전 후보만 쓴다: 잊을 때 후보 자리로 남긴다). */
  free: Spot | null;
}

export interface Fix {
  id: string; cls: FixtureClass; room: string | null; roomLabel: string | null; firstSeen: number; lastSeen: number; facts: Facts; answered: number | null;
  /** 카메라로 트윈 가전에 맞춘 마지막 결과와 그 촬영 시각. */
  link: (SightLink & { at_ms: number }) | null;
}

export const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** 물건 종류는 VLM이 서로 다른 원본 프레임의 더 새 촬영에서 이만큼 이어 다른 종류(마시는 그릇 무리 안)로 답해야 바뀐다. 흔들린 답(컵 → 병 → 컵)으로는 바뀌지 않는다. */
export const CLASS_SWITCH_ANSWERS = 2;
/** VLM이 본 물건은 그 촬영부터 이만큼(ms) YOLO가 놓쳐도 사라짐을 세지 않는다(VLM 무조건 우선: VLM 간격 2초 + 답 약 2초 + 여유). */
export const VLM_SEEN_HOLD_MS = 6000;
/** 장면 VLM 답 후보는 이만큼(ms) 다시 안 보이면 잊는다(VLM 두 장 사이 + 1초). */
export const VLM_CANDIDATE_MS = 5000;
/** 장면 VLM 답 후보는 서로 다른 원본 프레임 이만큼에서 보이면 확정한다. */
export const VLM_CONFIRM_FRAMES = 2;

/** 이 값이 그 종류·대상에 붙는가. */
export function fits(value: StateKey, cls: ClassKey, target: Target): boolean {
  const s = STATES[value];
  return (s.for as readonly Target[]).includes(target) && (CLASSES[cls].facets as readonly Facet[]).includes(s.facet);
}

/** World State의 안쪽 공유 상태와 부분(WorldState가 단다). */
export class WorldCore {
  readonly objects = new Map<string, Obj>();
  readonly fixtures = new Map<string, Fix>();
  private readonly counters = new Map<string, number>();
  readonly confirmer: Confirmer;
  readonly stepMs: number;
  readonly person: {
    visible: boolean; since_ms: number | null; last_seen_ms: number | null; count: number; room: { id: string; label: string } | null; position: Plan2 | null; positionAt: number | null;
    facts: Facts; answered: number | null;
  } = { visible: false, since_ms: null, last_seen_ms: null, count: 0, room: null, position: null, positionAt: null, facts: {}, answered: null };
  frameAt: number | null = null;
  /** 관절로 마지막에 든 물건 id(확인 전 물건 포함). */
  heldIds: string[] = [];
  /** 등장 확인 전에 끊긴 후보의 마지막 자리(오래된 것부터). */
  sightings: WorldSighting[] = [];
  /** 관절이 붙인 사실(그 사실 객체). VLM이 같은 면을 다시 쓰면 새 객체라 빠진다. */
  readonly byPose = new WeakSet<WorldFact>();
  readonly identityM: number;
  /** 쓰러짐 의심(가장 확실한 한 사람의 관절 자세 변화). */
  readonly fall: FallWatch;
  readonly fallCfg: FallConfig;
  /** 사람 감지가 둘 넘게 보인 마지막 촬영 시각(VLM 자리 사실은 사람을 하나로 합치므로 그동안의 답은 누구의 것인지 모른다). */
  crowdAt = Number.NEGATIVE_INFINITY;
  merge!: Detections;
  scene!: SceneObjects;
  people!: People;
  vlm!: SceneFacts;
  closer!: CloserLook;
  contents!: ContentsBook;
  sight!: DeviceSight;

  constructor(readonly o: WorldStateOptions) {
    this.fallCfg = o.fall ?? FALL_DEFAULTS;
    this.fall = new FallWatch(this.fallCfg);
    this.identityM = o.identityM ?? 0.25;
    this.stepMs = o.evidenceStepMs ?? EVIDENCE_STEP_MS;
    // 등장은 사람·물건 모두 2장(2초), 사라짐은 사람 2장(4초)·물건 3장(6초). 물건 등장을 4초에서 2초로 줄였다(흔들려 짧게 잡힌 물건은 사라짐 셈이 정리한다)
    this.confirmer = new Confirmer((key) => (key === PERSON ? 2 : 3), this.stepMs, () => 2);
  }

  /** 이 감지를 받는가: 낱말 표의 사람·물건·가전 설비 종류이고 그 종류의 최소 신뢰도 이상. 관찰 흐름은 받는 감지만 상자·YOLO 글·VLM 감지 목록에 싣는다. */
  accepts(d: Pick<Detection, "label" | "score">): boolean {
    const c = (CLASSES as Record<string, (typeof CLASSES)[ClassKey] | undefined>)[d.label];
    return !!c && c.role !== "scene" && d.score >= c.minScore;
  }

  /** 첫 프레임 시각을 사람 「안 보임」의 시작으로 둔다. */
  start(atMs: number): void {
    if (this.person.since_ms === null) this.person.since_ms = atMs;
  }

  create(cls: ObjClass, atMs: number, frameId: string): Obj {
    const n = (this.counters.get(cls) ?? 0) + 1;
    this.counters.set(cls, n);
    const obj: Obj = {
      id: `${cls}_${n}`, cls, position: null, surface: null, surfaceLabel: null, part: null, room: null, errorM: null, confirmed: false, status: "present",
      firstSeen: atMs, lastSeen: atMs, lastInView: atMs, goneAt: null, facts: {}, answered: null, closerAt: null, peekGuard: null, sizes: [], posFrom: null,
      posAt: Number.NEGATIVE_INFINITY, posCloser: false, judgedAt: atMs, judgedFrame: frameId, judgedCloser: false, followed: null, closerRev: {}, clsVote: null, clsAt: Number.NEGATIVE_INFINITY, clsFrame: null, vlmSeen: null, vlmFrames: [],
      movedAt: atMs, trail: [], carried: false, contents: null, free: null,
    };
    this.objects.set(obj.id, obj);
    return obj;
  }

  /** 가까이 보기 지킴 중인가(atMs 기준 CLOSER_HOLD_MS 안). 지킴보다 앞서 찍힌 사진도 지킴으로 본다. */
  /** 같은 물건 찾기(전체 사진 YOLO·가까이 보기·장면 VLM이 같이 쓴다): 같은 종류 중 그 종류 거리 안의 가장 가까운 것이 먼저다(사라진 것·세는 중인 것도).
   *  없으면 마시는 그릇 무리의 다른 종류가 그 거리 안에 하나뿐일 때만 잇는다(둘 이상이면 모호해 잇지 않는다). 물건 식별은 자리로 하고 종류는 voteClass가 따로 바꾼다. */
  matchAt(cls: ObjClass, position: V3, used: ReadonlySet<string>): Obj | null {
    const near = (CLASSES[cls] as { identityM?: number }).identityM ?? this.identityM;
    const pick = (ok: (x: Obj) => boolean) => [...this.objects.values()]
      .filter((x) => ok(x) && !used.has(x.id) && x.position && dist(x.position, position) <= near)
      .sort((a, b) => dist(a.position!, position) - dist(b.position!, position));
    const same = pick((x) => x.cls === cls);
    if (same.length) return same[0]!;
    const kin = pick((x) => x.cls !== cls && sameDrinkware(x.cls, cls));
    return kin.length === 1 ? kin[0]! : null;
  }

  /** VLM이 이 물건의 종류를 답했다(at 촬영, 원본 프레임 frameId). 같은 원본 프레임·마지막으로 센 촬영보다 옛 답은 세지 않는다.
   *  같은 종류면 셈을 지우고, 마시는 그릇 무리 안 다른 종류면 CLASS_SWITCH_ANSWERS번 이을 때 그 종류로 바꾼다(id는 그대로). */
  voteClass(obj: Obj, cls: ObjClass, at: number, frameId: string): void {
    if (obj.clsFrame === frameId || at <= obj.clsAt) return;
    obj.clsAt = at;
    obj.clsFrame = frameId;
    if (cls === obj.cls || !sameDrinkware(cls, obj.cls)) {
      obj.clsVote = null;
      return;
    }
    const n = obj.clsVote?.cls === cls ? obj.clsVote.n + 1 : 1;
    if (n < CLASS_SWITCH_ANSWERS) {
      obj.clsVote = { cls, n };
      return;
    }
    obj.cls = cls;
    obj.clsVote = null;
  }

  /** VLM이 이 물건을 VLM_SEEN_HOLD_MS 안에 봤다: YOLO가 놓쳐도 사라짐을 세지 않는다(VLM 무조건 우선). */
  vlmHold(obj: Obj, atMs: number): boolean {
    return obj.vlmSeen !== null && atMs - obj.vlmSeen <= VLM_SEEN_HOLD_MS;
  }

  held(obj: Obj, atMs: number): boolean {
    return obj.closerAt !== null && atMs - obj.closerAt < CLOSER_HOLD_MS;
  }

  /** 보기 지킴 중인가(atMs 기준 PEEK_GUARD_MS 안). */
  guarded(obj: Obj, atMs: number): boolean {
    return obj.peekGuard !== null && atMs - obj.peekGuard < PEEK_GUARD_MS;
  }

  /** 보임을 이 촬영(원본 프레임 frameId, closer면 가까이 보기 양성)으로 판단했다: 마지막 판단보다 새 촬영이면 그것으로 바꾸고,
   *  같은 원본 프레임의 가까이 보기 양성이면 출처만 가까이 보기로 올린다. */
  judge(obj: Obj, at: number, frameId: string, closer: boolean): void {
    if (at > obj.judgedAt) {
      obj.judgedAt = at;
      obj.judgedFrame = frameId;
      obj.judgedCloser = closer;
    } else if (at === obj.judgedAt && closer && obj.judgedFrame === frameId) obj.judgedCloser = true;
  }

  /** 자리를 고칠 촬영인가: 자리를 마지막으로 고친 촬영보다 새면. 같은 촬영이면 잘라 본 자리가 전체 사진 자리보다 앞선다. */
  newerPlace(obj: Obj, atMs: number, closer: boolean): boolean {
    return atMs > obj.posAt || (atMs === obj.posAt && closer && !obj.posCloser);
  }

  name(obj: Obj): string {
    return objectName(obj.cls, obj.id);
  }

  forget(id: string): void {
    this.objects.delete(id);
    this.confirmer.forget(id);
  }

  /** 등장 확인 전 후보를 잊는다: 트윈 자리가 있으면 그 마지막 자리를 후보 자리로 남긴다. 관절의 손에 든 채 끊겼으면 손에 없던 마지막 자리를,
   *  그런 자리가 없으면 손에 든 자리를 in_hand로 남긴다. 종류마다 최근 SIGHTING_MAX개, atMs 기준 SIGHTING_KEEP_MS 안만 둔다. */
  loseCandidate(obj: Obj, atMs: number): void {
    this.forget(obj.id);
    const inHand = this.people.posedInHand(obj);
    const spot: Spot | null = inHand && obj.free ? obj.free : obj.position ? { position: obj.position, surface: obj.surface, surfaceLabel: obj.surfaceLabel, at: obj.lastSeen } : null;
    if (!spot) return;
    const kept = this.sightings.filter((s) => atMs - s.at_ms <= SIGHTING_KEEP_MS);
    kept.push({ cls: obj.cls, position: spot.position, surface: spot.surface, surface_label: spot.surfaceLabel, at_ms: spot.at, in_hand: inHand && spot !== obj.free });
    kept.sort((a, b) => a.at_ms - b.at_ms);
    const mine = kept.filter((s) => s.cls === obj.cls);
    this.sightings = kept.filter((s) => s.cls !== obj.cls || mine.indexOf(s) >= mine.length - SIGHTING_MAX);
  }

  /** 확인 물건이 등장했다: 같은 종류 후보 자리 가운데 그 자리 SIGHTING_CLEAR_M 안의 것을 지운다. */
  clearSightings(obj: Obj): void {
    const at = obj.position;
    if (!at) return;
    this.sightings = this.sightings.filter((s) => s.cls !== obj.cls || dist(s.position, at) > SIGHTING_CLEAR_M);
  }

  /** nowMs에 남은 후보 자리(SIGHTING_KEEP_MS 안). */
  sightingsAt(nowMs: number): WorldSighting[] {
    return this.sightings.filter((s) => nowMs - s.at_ms <= SIGHTING_KEEP_MS).map((s) => ({ ...s, position: [...s.position] as V3 }));
  }
}

/** 부분: WorldCore를 받는 작은 클래스. o는 WorldCore의 것이다. */
export abstract class Part {
  constructor(protected readonly core: WorldCore) {}
  protected get o(): WorldStateOptions {
    return this.core.o;
  }
}
