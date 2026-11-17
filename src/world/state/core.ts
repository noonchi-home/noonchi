// World State(src/world/state/)의 안쪽 공유 객체 WorldCore: 부분(objects 감지 합치기·people 사람·관절·facts VLM 사실·closer 가까이 보기·devices 카메라로 본 가전)이
// 함께 쓰는 상태(물건·가전 설비·사람·등장 셈·관절이 붙인 사실·쓰러짐)와 작은 도우미(물건 만들기·잊기·이름·보임 판단·자리 고칠 촬영·지킴).
// 부분은 이 객체를 받는 작은 클래스(Part)이고 서로를 이 객체의 칸으로 부른다. 부분끼리는 값 import가 없다(WorldState가 만들어 잇는다, world.ts).
import type { Facet, FixtureClass, ObjClass, WorldFact, WorldObject } from "../../contract/world.js";
import type { Detection } from "../../contract/observe.js";
import { Confirmer, EVIDENCE_STEP_MS } from "../confirm.js";
import { objectName } from "../labels.js";
import { FALL_DEFAULTS, FallWatch, type FallConfig } from "../fall.js";
import type { SightLink } from "../sight.js";
import { CLASSES, STATES, type ClassKey, type StateKey, type Target } from "../vocab.js";
import type { CloserLook } from "./closer.js";
import type { ContentsBook, ContentsState } from "./contents.js";
import type { DeviceSight } from "./devices.js";
import type { SceneFacts } from "./facts.js";
import type { Detections } from "./objects.js";
import type { People } from "./people.js";
import type { WorldStateOptions } from "./world.js";

export type V3 = [number, number, number];
export type Plan2 = [number, number];
export type Facts = Partial<Record<Facet, WorldFact>>;

export const KEYS = Object.keys(CLASSES) as ClassKey[];
export const OBJ_CLASSES: ReadonlySet<string> = new Set(KEYS.filter((k) => CLASSES[k].role === "object"));
export const PERSON = "person";
/** 가까이 보기로 찾거나 고친 물건은 이만큼(ms, 촬영 시각 기준) 전체 사진에서 못 봐도 사라짐으로 세지 않는다(전체 사진의 감지기는 그 물건을 못 본다). */
export const CLOSER_HOLD_MS = 30_000;
/** 보기 지킴(가까이 가서 위에서 비추는 동안, WorldState.guard) 한도: 풀지 않아도 이만큼(ms) 지나면 끝난다. */
export const PEEK_GUARD_MS = 60_000;
/** 크기 재기에 쌓는 최근 사진 수(가운데값을 쓴다). */
export const SIZE_SAMPLES = 5;

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
  /** 전체 사진 감지 상자로 잰 크기(높이·폭 m)와 그때 자리에서 바닥 가운데까지(수평 [dx, dz], 최근 SIZE_SAMPLES장). 그릇 종류만 잰다. */
  sizes: { height: number; width: number; offset: [number, number] }[];
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
  /** 내용물 갱신기의 상태(src/world/state/contents.ts). 내용물을 쌓은 적 없으면 null. */
  contents: ContentsState | null;
}

export interface Fix {
  id: string; cls: FixtureClass; room: string | null; roomLabel: string | null; firstSeen: number; lastSeen: number; facts: Facts; answered: number | null;
  /** 카메라로 트윈 가전에 맞춘 마지막 결과와 그 촬영 시각. */
  link: (SightLink & { at_ms: number }) | null;
}

export const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

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
  /** 관절이 붙인 사실(그 사실 객체). VLM이 같은 면을 다시 쓰면 새 객체라 빠진다. */
  readonly byPose = new WeakSet<WorldFact>();
  readonly identityM: number;
  /** 쓰러짐 의심(가장 확실한 한 사람의 관절 자세 변화). */
  readonly fall: FallWatch;
  readonly fallCfg: FallConfig;
  /** 사람 감지가 둘 넘게 보인 마지막 촬영 시각(VLM 자리 사실은 사람을 하나로 합치므로 그동안의 답은 누구의 것인지 모른다). */
  crowdAt = Number.NEGATIVE_INFINITY;
  merge!: Detections;
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
    this.confirmer = new Confirmer((key) => (key === PERSON ? 2 : 3), this.stepMs);
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
      firstSeen: atMs, lastSeen: atMs, lastInView: atMs, goneAt: null, facts: {}, answered: null, closerAt: null, peekGuard: null, sizes: [],
      posAt: Number.NEGATIVE_INFINITY, posCloser: false, judgedAt: atMs, judgedFrame: frameId, judgedCloser: false, followed: null, closerRev: {},
      movedAt: atMs, trail: [], carried: false, contents: null,
    };
    this.objects.set(obj.id, obj);
    return obj;
  }

  /** 가까이 보기 지킴 중인가(atMs 기준 CLOSER_HOLD_MS 안). 지킴보다 앞서 찍힌 사진도 지킴으로 본다. */
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
}

/** 부분: WorldCore를 받는 작은 클래스. o는 WorldCore의 것이다. */
export abstract class Part {
  constructor(protected readonly core: WorldCore) {}
  protected get o(): WorldStateOptions {
    return this.core.o;
  }
}
