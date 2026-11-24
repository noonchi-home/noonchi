// World State(src/world/state/)의 안쪽 공유 객체 WorldCore: 부분(objects YOLO 감지(사람·가전 설비·관절)·sceneobjects 장면 VLM 물건·people 사람·관절·facts VLM 사실·closer 가까이 보기·devices 카메라로 본 가전)이
// 함께 쓰는 상태(물건·가전 설비·사람·등장 셈·관절이 붙인 사실·쓰러짐)와 작은 도우미(물건 만들기·잊기·이름·보임 판단·자리 고칠 촬영·지킴).
// 부분은 이 객체를 받는 작은 클래스(Part)이고 서로를 이 객체의 칸으로 부른다. 부분끼리는 값 import가 없다(WorldState가 만들어 잇는다, world.ts).
import type { Facet, FixtureClass, ObjClass, WorldFact, WorldObject, WorldSighting } from "../../contract/world.js";
import type { Detection } from "../../contract/observe.js";
import { OBJ_CLASSES, accepts } from "../accept.js";
import { Confirmer, EVIDENCE_STEP_MS } from "../confirm.js";
import { objectName } from "../labels.js";
import { FALL_DEFAULTS, FallWatch, type FallConfig } from "../fall.js";
import type { SightLink } from "../sight.js";
import { CLASSES, NEAR_M, sameDrinkware, STATES, type ClassKey, type StateKey, type Target } from "../vocab.js";
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
export { OBJ_CLASSES };
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
  /** 장면·가까이 보기 VLM이 이 물건을 본 마지막 촬영 시각. 사라짐 셈(vlmMiss)은 이보다 새 촬영만 센다. */
  vlmSeen: number | null;
  /** 마지막으로 본 촬영(vlmSeen) 뒤에 그 자리가 시야 안인데 장면 VLM 목록에 없던 사진(원본 프레임마다 하나). VLM_GONE_PHOTOS장이면 사라짐이다. */
  vlmMiss: { frame: string; at: number }[];
  /** 사라짐을 장면 VLM 사라짐 셈(vlmMiss)으로 정했다: 늦게 온 옛 사진이 그 뒤에 봤으면 셈을 다시 해 거둔다. */
  missGone: boolean;
  /** 확인 전 후보를 본 VLM 답의 원본 프레임(VLM_CONFIRM_FRAMES장이면 확정). */
  vlmFrames: string[];
  /** 장면 VLM이 말한 다른 놓인 곳(place) 하나: 다음 원본 프레임의 더 새 촬영이 같은 값을 말하면 바꾼다(SceneFacts.steady). */
  placeVote: { value: string; frame: string; at: number } | null;
  /** VLM이 손에 있음으로 답한 적이 있다(옮긴 컵이라는 근거). */
  heldSeen: boolean;
  /** 장면 VLM 후보를 처음 본 사진의 폰 눈(두 장의 폰 눈이 가까워야 확정한다). YOLO 후보는 null. */
  vlmEye: [number, number] | null;
  /** 장면 VLM 상자로 낸 VLM_MOVE_M 넘게 떨어진 새 자리 하나: 다음 원본 프레임의 더 새 촬영이 그 근처를 말하면 옮긴다(sceneobjects.ts). */
  posVote: { position: V3; frame: string; at: number; surface: string | null; part: "basin" | null } | null;
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
/** 확인된 물건은 그 자리가 시야 안인 장면 VLM 사진 이만큼(서로 다른 원본 프레임, 촬영 순서)이 이어 목록에 없으면 사라짐이다. */
export const VLM_GONE_PHOTOS = 3;
/** 떠남 빠르게(2026-11-25 사용자 결정 D): 사람이 있던 자리가 화면 안인데 YOLO가 그 사람을 이만큼(ms) 이어 못 보면 사라짐 확정(4초)을 기다리지 않고 안 보임이다. */
export const FAST_GONE_MS = 500;
/** 사람 등장(안 보임 → 보임): 사용자로 세는 사람 상자를 이만큼(ms) 이어 보면 보임이다(2026-11-25 사용자 결정, 시연자 손 규칙 2). */
export const PERSON_RETURN_MS = 600;
/** 사라진 물체를 이만큼 두었다가 잊는다(같은 자리에 다시 보이면 같은 id로 돌아온다). */
export const GONE_KEEP_MS = 600_000;
/** 장면 VLM 답 후보는 이만큼(ms) 다시 안 보이면 잊는다(VLM 두 장 사이 + 1초). */
export const VLM_CANDIDATE_MS = 5000;
/** 손에 있음 보호(사라짐을 세지 않음)는 사람이 보이고 손에 있음 답이 이만큼(ms) 안에 왔을 때만이다(장면 VLM 사진 3장쯤). 들고 나가면 풀린다(Codex P2 b8fe7bf). */
export const HAND_HOLD_MS = 6000;
/** 자리 잇기에서 다른 종류 같은 무리 둘 중 가장 가까운 것을 고르는 거리 비(둘째가 이 배 이상 멀어야 한다). */
const KIN_CLEAR = 3;
/** 장면 VLM 답 후보는 서로 다른 원본 프레임 이만큼에서 보이면 확정한다. */
export const VLM_CONFIRM_FRAMES = 2;
/** 장면 VLM 상자 투영은 흔들린다: 확인된 물건 자리는 이만큼(m) 넘게, 사진 2장 이어서 옮겼다고 할 때만 옮긴다. */
export const VLM_MOVE_M = 0.3;
/** 손에 있던 물건을 내려놓은 자리로 잇는 거리(m, 그 물건 마지막 자리에서). */
export const PUT_DOWN_M = 1.0;
/** 집기 단계 동안 대상으로 잇는 감지 자리(m, 대상 자리에서). */
export const FOCUS_PICK_M = 0.5;
/** 장면 VLM 상자로 같은 물건을 잇는 거리(m): 상자 투영 흔들림이 YOLO보다 커서 종류 거리보다 넓게 본다. */
export const VLM_MATCH_M = 0.5;

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
  /** 카메라 자세가 있는 사진을 본 적이 있다(맞춘 뒤). 그 뒤 카메라 없는 장면 VLM 답은 물건 식별·사라짐 셈에 쓰지 않는다(자리 모름 유령 컵). */
  sawCamera = false;
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
  /** 사람이 있던 자리가 화면 안인데 YOLO가 그 사람을 못 본 첫 촬영 시각(이어지는 동안). 보거나 자리가 화면 밖이면 null. */
  vacantFrom: number | null = null;
  /** 빠른 떠남으로 안 보임이 된 때와 그 전 사람 상태(VLM 답이 사람을 보면 되돌린다, WorldState.revertGone). 되돌리면 YOLO가 다시 볼 때까지 빠른 떠남을 쓰지 않는다. */
  fastGone: { at: number; since: number | null; count: number; facts: Facts } | null = null;
  fastBlocked = false;
  /** 로봇 실행 단계 중(폰에 명령이 떠 있어 폰을 든 시연자가 움직인다, WorldState.robotActing). 아래 가장자리에 닿고 얼굴 관절이 없는 사람 상자를 사용자로 세지 않는다. */
  acting = false;
  /** 실행 추적이 지금 집기·내려놓기 하는 대상(WorldState.focus): 물건 id, 단계, 자리(집기는 그 물건 자리, 내려놓기는 목적지, 수평 [x, z]). */
  focusOn: { id: string; step: "pick" | "place" | "carry"; spot: [number, number] | null } | null = null;
  /** 지금 든 물건(focusOn)을 처음 알린 촬영 시각: 그 뒤에 생긴 같은 무리 둘째 id를 내려놓기 시작 때 대상으로 합친다. */
  focusFrom: number | null = null;
  /** 내려놓기 단계를 시작한 촬영 시각: 그 뒤 처음 보인 같은 종류 물건이 목적지 가까이면 대상이다(placeDups). */
  placeFrom: number | null = null;
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
    // 사람만 센다(YOLO 사람 감지 가운데 사용자로 세는 상자, people.ts users): 등장(안 보임 → 보임) PERSON_RETURN_MS 이어 보임, 사라짐 2장(4초).
    // 물건 등장·사라짐은 장면 VLM 사진으로 센다(sceneobjects.ts)
    this.confirmer = new Confirmer(() => 2, this.stepMs, () => 1 + PERSON_RETURN_MS / this.stepMs);
  }

  /** 이 감지를 받는가(src/world/accept.ts accepts). */
  accepts(d: Pick<Detection, "label" | "score">): boolean {
    return accepts(d);
  }

  /** 첫 프레임 시각을 사람 「안 보임」의 시작으로 둔다. */
  start(atMs: number): void {
    if (this.person.since_ms === null) this.person.since_ms = atMs;
  }

  /** 확인 전 후보의 종류를 바꾸고 그 종류 꼴의 새 id를 준다(후보는 World State 보기에 없어 아무도 옛 id를 쓰지 않았다). */
  recast(obj: Obj, cls: ObjClass): Obj {
    this.objects.delete(obj.id);
    const n = (this.counters.get(cls) ?? 0) + 1;
    this.counters.set(cls, n);
    Object.assign(obj, { id: `${cls}_${n}`, cls });
    this.objects.set(obj.id, obj);
    return obj;
  }

  create(cls: ObjClass, atMs: number, frameId: string): Obj {
    const n = (this.counters.get(cls) ?? 0) + 1;
    this.counters.set(cls, n);
    const obj: Obj = {
      id: `${cls}_${n}`, cls, position: null, surface: null, surfaceLabel: null, part: null, room: null, errorM: null, confirmed: false, status: "present",
      firstSeen: atMs, lastSeen: atMs, lastInView: atMs, goneAt: null, facts: {}, answered: null, closerAt: null, peekGuard: null, sizes: [], posFrom: null,
      posAt: Number.NEGATIVE_INFINITY, posCloser: false, judgedAt: atMs, judgedFrame: frameId, judgedCloser: false, followed: null, closerRev: {}, clsVote: null, clsAt: Number.NEGATIVE_INFINITY, clsFrame: null, vlmSeen: null, vlmMiss: [], missGone: false, vlmFrames: [], placeVote: null, posVote: null, vlmEye: null, heldSeen: false,
      movedAt: atMs, trail: [], carried: false, contents: null, free: null,
    };
    this.objects.set(obj.id, obj);
    return obj;
  }

  /** 가까이 보기 지킴 중인가(atMs 기준 CLOSER_HOLD_MS 안). 지킴보다 앞서 찍힌 사진도 지킴으로 본다. */
  /** 같은 물건 찾기(전체 사진 YOLO·가까이 보기·장면 VLM이 같이 쓴다): 같은 종류 중 그 종류 거리 안의 가장 가까운 것이 먼저다(사라진 것·세는 중인 것도).
   *  없으면 마시는 그릇 무리의 다른 종류가 그 거리 안에 하나뿐일 때만 잇는다(둘 이상이면 모호해 잇지 않는다). 물건 식별은 자리로 하고 종류는 voteClass가 따로 바꾼다. */
  matchAt(cls: ObjClass, position: V3, used: ReadonlySet<string>, nearMin = 0): Obj | null {
    const near = Math.max((CLASSES[cls] as { identityM?: number }).identityM ?? this.identityM, nearMin);
    const pick = (ok: (x: Obj) => boolean) => [...this.objects.values()]
      .filter((x) => ok(x) && !used.has(x.id) && x.position && dist(x.position, position) <= near)
      .sort((a, b) => dist(a.position!, position) - dist(b.position!, position));
    const same = pick((x) => x.cls === cls);
    if (same.length) return same[0]!;
    // 다른 종류 같은 무리는 하나뿐이거나, 가장 가까운 것이 둘째보다 KIN_CLEAR배 이상 가까울 때만(키 큰 컵 q2: 컵 0.03m·0.38m 사이 병 답이 새 병이 됐다)
    const kin = pick((x) => x.cls !== cls && sameDrinkware(x.cls, cls));
    return kin.length === 1 || (kin.length > 1 && dist(kin[0]!.position!, position) * KIN_CLEAR <= dist(kin[1]!.position!, position)) ? kin[0]! : null;
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

  /** 맞는 물건이 없는 감지를 실행 추적의 지금 대상(focusOn)으로 잇는가: 같은 종류이고 이번 사진에서 아직 쓰지 않았어야 한다. 식별 근거가 모자라면 잇지 않는다(미룬다).
   *  - 집기: 그 감지 자리가 대상 자리 FOCUS_PICK_M 안이거나, 들린 근거가 있거나(lifted: 이 답이 손에 있음, 또는 대상이 이미 손에 있음),
   *    그 사진에서 대상 자리가 감지 상자 안에 비친다(sees).
   *  - 내려놓기: 그 감지 자리를 알고 목적지 NEAR_M 안이다(자리를 모르면 잇지 않는다). */
  focusTarget(cls: ObjClass, position: V3 | null, used: ReadonlySet<string>, lifted = false, sees?: (target: V3) => boolean, eye?: [number, number] | null): Obj | null {
    const f = this.focusOn;
    const t = f ? this.objects.get(f.id) : undefined;
    if (!f || !t || t.cls !== cls || used.has(t.id)) return null;
    const near = (m: number) => !!position && !!f.spot && Math.hypot(position[0] - f.spot[0], position[2] - f.spot[1]) <= m;
    if (f.step === "place") return near(NEAR_M) ? t : null;
    // 든 물건(집기 끝 ~ 내려놓기 끝): 그 사진의 폰 눈 NEAR_M 안(폰을 든 사람의 손)이거나 들린 근거가 있을 때
    // 손에 든 대상이 자리를 잃었으면(시야 밖·자리 모름) 폰 눈을 모르는 사진의 같은 종류 새 감지도 그 대상이다(가로 머그 r6)
    const lost = t.facts.place?.value === "in_hand" && (!t.position || t.status === "out_of_view");
    if (f.step === "carry") return lifted || lost || (!!eye && !!position && Math.hypot(position[0] - eye[0], position[2] - eye[1]) <= NEAR_M) ? t : null;
    // 그 사진에서 대상 자리가 감지 상자 안에 비친다(바짝 댄 잔: 상자 아랫변 투영은 대상 자리와 멀다, 가로 유리컵 r7)
    const inBox = !!sees && !!t.position && sees(t.position);
    return near(FOCUS_PICK_M) || lifted || inBox || t.facts.place?.value === "in_hand" ? t : null;
  }

  /** 손에 있던 물건이 다른 자리에 다시 보였다(내려놓음): 손에 있음인 확인 물건 중 같은 무리이고 마지막 자리 PUT_DOWN_M 안인 것이 하나면 그것(가로 키 큰 컵 r1). */
  putDown(cls: ObjClass, position: V3, used: ReadonlySet<string>): Obj | null {
    const held = [...this.objects.values()].filter((x) => x.confirmed && !used.has(x.id) && sameDrinkware(x.cls, cls) && x.facts.place?.value === "in_hand"
      && x.position && dist(x.position, position) <= PUT_DOWN_M);
    return held.length === 1 ? held[0]! : null;
  }

  /** 내려놓기 단계: 시작 뒤 처음 보인 같은 종류 물건(대상 아님)이 목적지 NEAR_M 안이면 그것은 놓인 대상이다. 대상이 그 자리·보임·더 새 사실을 받고,
   *  그 물건은 사라짐과 옮김 표시(followed_by: 대상)를 남긴다(가로 키 큰 컵 r3·가로 유리컵 r9: 눈 자리 모름 사진 때문에 대상 잇기를 놓쳤다). 시작 전부터 보이던 물건은 뺀다. */
  placeDups(): void {
    const f = this.focusOn;
    const t = f?.step === "place" ? this.objects.get(f.id) : undefined;
    if (!f || !t || !f.spot || this.placeFrom === null) return;
    for (const d of [...this.objects.values()]) {
      if (d === t || d.status === "gone" || d.cls !== t.cls || d.firstSeen < this.placeFrom || !d.position) continue;
      if (Math.hypot(d.position[0] - f.spot[0], d.position[2] - f.spot[1]) > NEAR_M) continue;
      if (d.posAt >= t.posAt) Object.assign(t, { position: d.position, surface: d.surface, surfaceLabel: d.surfaceLabel, part: d.part, room: d.room, errorM: d.errorM, posAt: d.posAt, posCloser: d.posCloser });
      for (const [facet, fact] of Object.entries(d.facts)) if (fact && (!t.facts[facet as Facet] || fact.at_ms > t.facts[facet as Facet]!.at_ms)) (t.facts as Record<string, unknown>)[facet] = fact;
      t.status = "present";
      t.goneAt = null;
      t.lastSeen = Math.max(t.lastSeen, d.lastSeen);
      t.lastInView = Math.max(t.lastInView, d.lastInView);
      d.status = "gone";
      d.goneAt = d.lastSeen;
      d.followed = { id: t.id, at: d.lastSeen, frame: d.judgedFrame };
      if (!d.confirmed) this.forget(d.id);
    }
  }

  /** 내려놓기 중 대상의 놓인 곳은 목적지에서 먼 면 위 값으로 바꾸지 않는다(손에 있음 → 목적지 쪽만). 대상 자리를 모르거나 목적지 NEAR_M 밖이면 막는다. */
  placeHeld(obj: Obj): boolean {
    const f = this.focusOn;
    if (f?.step !== "place" || f.id !== obj.id || !f.spot) return false;
    return !obj.position || Math.hypot(obj.position[0] - f.spot[0], obj.position[2] - f.spot[1]) > NEAR_M;
  }

  /** 실행 추적이 지금 집기·내려놓기 하는 대상이다: 그 단계 동안 사라짐을 세지 않는다(들고 옮기는 동안 전체 사진이 놓친다). */
  focusHold(obj: Obj): boolean {
    return this.focusOn?.id === obj.id;
  }

  /** 이 촬영(원본 프레임 frameId)은 이 물건 보임을 바꾸지 못하는가: 마지막 보임 판단보다 옛 촬영이거나(가까이 보기가 더 새 촬영으로 봤다),
   *  같은 원본 프레임을 잘라 본 양성이 그 판단이다. 그런 사진은 사라짐 셈에도 넣지 않는다. */
  staleJudge(obj: Obj, at: number, frameId: string): boolean {
    return at < obj.judgedAt || (at === obj.judgedAt && obj.judgedCloser && obj.judgedFrame === frameId);
  }

  /** 사라짐을 세지 않는 물건: 가까이 보기 지킴·보기 지킴·실행 추적의 지금 대상·손에 있음(사람이 보이고 HAND_HOLD_MS 안 답)·들고 감 보호. */
  missHeld(obj: Obj, atMs: number): boolean {
    const hand = obj.facts.place?.value === "in_hand" && this.person.visible && atMs - obj.facts.place.at_ms <= HAND_HOLD_MS;
    return this.held(obj, atMs) || this.guarded(obj, atMs) || this.focusHold(obj) || hand || obj.carried;
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

  /** 등장 확인 전 후보를 잊는다: 트윈 자리가 있으면 그 마지막 자리를 후보 자리로 남긴다. 종류마다 최근 SIGHTING_MAX개, atMs 기준 SIGHTING_KEEP_MS 안만 둔다. */
  loseCandidate(obj: Obj, atMs: number): void {
    this.forget(obj.id);
    const spot: Spot | null = obj.position ? { position: obj.position, surface: obj.surface, surfaceLabel: obj.surfaceLabel, at: obj.lastSeen } : null;
    if (!spot) return;
    const kept = this.sightings.filter((s) => atMs - s.at_ms <= SIGHTING_KEEP_MS);
    kept.push({ cls: obj.cls, position: spot.position, surface: spot.surface, surface_label: spot.surfaceLabel, at_ms: spot.at, in_hand: false });
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
