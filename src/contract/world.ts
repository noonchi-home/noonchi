// World State 계약(서버 → 화면 /events {type:"world"}, GET /api/world, 판단 기록). 순수 타입만 둔다: ui/가 그대로 가져다 쓴다.
// 만드는 곳은 src/world/state/다.

import type { DeviceStateKey, Facet, FixtureClass, ObjClass } from "../world/vocab.js";
import type { EyePose } from "./events.js";
import type { CloserAtInput, CloserPassInput, Detection, FrameMeta, Pose, SceneLookInput, SceneObservation } from "./observe.js";

/** 낱말 표(src/world/vocab.ts)의 물건 종류·가전 설비 종류·사실 면·가전 상태 키. */
export type { DeviceStateKey, Facet, FixtureClass, ObjClass };

/** VLM·관절이 본 사실 하나. 같은 값이 연속 두 번이면 confirmed, 아니면 inferred. at_ms는 마지막으로 본 사진의 촬영 시각, since_ms는 그 값이 처음 보인 촬영 시각.
 *  closer_ms: 가까이 보기(src/observe/pipeline.ts closer)의 VLM 답이 이 값을 새로 넣거나 바꿨으면 그 원본 사진의 촬영 시각. 같은 값이 이어지는 동안 남고,
 *  다른 값이 들어오면 없어진다. 판단 뒤에 가까이 보기가 바꾼 면인지는 이것이 아니라 물건의 closer_rev로 본다(전체 사진이 값을 바꾸면 이것은 없어진다). */
export interface WorldFact {
  value: string; at_ms: number; since_ms: number; certainty: "confirmed" | "inferred"; closer_ms?: number;
}

export interface WorldObject {
  /** 종류_번호(cup_1). */
  id: string;
  cls: ObjClass;
  /** 트윈 좌표 [x, 높이, y]. 맞추기 전이면 null. */
  position: [number, number, number] | null;
  /** 놓인 면(식탁·책상·조리대·싱크대) id와 이름. 바닥이거나 모르면 null. */
  surface: string | null;
  surface_label: string | null;
  /** 그 면 안의 자리: basin 싱크볼 안(src/world/place.ts placeBox). 아니면 칸이 없다. */
  surface_part?: "basin";
  room: string | null;
  /** 위치 오차(m). 위치를 모르면 null. */
  error_m: number | null;
  /** present 시야 안에서 확인됨, out_of_view 마지막 자리가 지금 시야 밖, gone 그 자리가 시야 안인데 안 보임(확인됨). */
  status: "present" | "out_of_view" | "gone";
  first_seen_ms: number;
  last_seen_ms: number;
  last_in_view_ms: number;
  facts: Partial<Record<Facet, WorldFact>>;
  /** 이 물건이 든 마지막 VLM 답의 촬영 시각(없으면 null). */
  answered_ms: number | null;
  /** 관계표로 붙인 관련 가전 id. */
  devices: string[];
  /** 가까이 보기 지킴 중: 가까이 보기(src/observe/pipeline.ts closer)로 찾거나 고친 지 30초가 안 됐고, 같은 종류 새 물건이 다른 자리에 생겨 풀리지 않았다.
   *  그동안 전체 사진이 그 자리를 보면서 못 봐도 사라짐으로 세지 않는다. 그래서 지킴 중인 물건이 있다는 것은 전체 사진으로 본 근거가 아니다. */
  closer_hold: boolean;
  /** 지킴 중이던 이 물건을 두고 같은 종류 새 물건이 다른 자리에 생겼다(옮겼을 수 있다): 그 새 물건 id. 한 촬영에서 그런 새 물건이 여럿이면 어느 것인지 몰라 null이다.
   *  그 뒤 전체 사진·가까이 보기가 이 물건을 다시 보면 null.
   *  지킴(closer_hold)은 그때 풀려 이 물건도 사라짐을 센다. 실행 추적은 이 표시가 있는 물건을 「아직 있음」으로 세지 않고 새 물건으로 바로 이어 간다. */
  followed_by: string | null;
  /** 면마다 가까이 보기 VLM 답이 그 면 값을 새로 넣거나 바꾼 횟수(한 번도 없으면 칸이 없다). 지금 값의 출처와 따로 남아 전체 사진이 값을 바꿔도 줄지 않는다.
   *  실행 추적이 판단 기록의 횟수(DecisionWorld closer_rev)와 견줘 판단 뒤에 가까이 보기가 바꾼 면인지 본다(src/act/track/start.ts closerNewer). */
  closer_rev?: Partial<Record<Facet, number>>;
  /** 내용물 세대(src/world/state/contents.ts): 확인 값이 정해지거나 바뀌거나 거둬지거나 다시 열릴 때 오른다. 내용물을 쌓은 적 없으면 칸이 없다(0으로 본다).
   *  내용물(facts.contents)은 확인됨일 때만 믿는 값이다: 3장·4초 이어진 사진. */
  contents_gen?: number;
  /** 보관한 이전 확인 값(최근 것부터 3개). 다시 열리거나 바뀔 때 남긴다. */
  contents_past?: { value: "empty" | "has_contents"; at_ms: number }[];
  /** 그릇 크기(높이·폭 m, 전체 사진 감지 상자로 잰 최근 5장의 가운데값, src/world/place.ts sizeOf)와 바닥 가운데(트윈 [x, 높이, y]: 자리는 가까운 바닥 가장자리라
   *  지금 자리를 잰 카메라 반대쪽으로 반 폭 옮긴 점, 그 카메라를 모르면 없음). 잰 적 없으면 칸이 없다. 위에서 컵 안을 보는 판정이 쓴다. */
  size_m?: { height: number; width: number; center?: [number, number, number] };
  /** 들고 감 보호 중: 사람이 안 보이게 될 때 관절이 붙인 「손에 있음」 물건이 아직 움직이고 있어, 3초 동안 움직임이 없을 때까지 그 손에 있음을 두고
   *  VLM·가까이 보기의 다른 자리 답이 덮지 않는다(src/world/state/objects.ts track). 실행 추적은 이 동안 실행 전 다시 보기 기한을 세지 않는다. 아니면 칸이 없다. */
  carried?: true;
}

export interface WorldPerson {
  visible: boolean;
  /** 보임·안 보임이 마지막으로 바뀐 시각(첫 프레임 전이면 null). */
  since_ms: number | null;
  last_seen_ms: number | null;
  /** 마지막 감지 프레임에 보인 사람 수(받은 감지). */
  count: number;
  /** 발이 보인 마지막 바닥 자리(평면 [x, y])와 그 방, 그 촬영 시각. 맞춘 뒤 발이 보여야 생긴다. 모르면 null. */
  position: [number, number] | null;
  position_ms: number | null;
  room: string | null;
  room_label: string | null;
  /** 그 자리에서 가까운(vocab NEAR_M 안) 가전 id. */
  near: string[];
  /** 든 물건 id: 관절로 든 물건(확인 전 물건 포함, 종류는 id 앞 cup_)과 손에 있음인 물건. */
  holding: string[];
  facts: Partial<Record<Facet, WorldFact>>;
  /** 사람이 든 마지막 VLM 답의 촬영 시각(없으면 null). */
  answered_ms: number | null;
}

/** 자리가 정해진 가전·설비(TV·냉장고·전자레인지·오븐·토스터·싱크대)를 YOLO·VLM으로 본 것. 방마다 종류 하나. */
export interface WorldFixture {
  /** 종류_방(tv_living). 방을 모르면 종류_room. */
  id: string;
  cls: FixtureClass;
  room: string | null;
  room_label: string | null;
  /** 같은 방의 같은 종류 트윈 가전 id(없으면 null). */
  device: string | null;
  first_seen_ms: number;
  last_seen_ms: number;
  facts: Partial<Record<Facet, WorldFact>>;
  answered_ms: number | null;
  /** 이 설비를 카메라로 트윈 가전에 맞춘 마지막 결과(src/world/sight.ts): 고른 가전 id, 못 골랐으면 null과 까닭. 그 사진의 촬영 시각. 맞춰 본 적 없으면 없음. */
  link?: { device: string | null; miss: SightMiss | null; at_ms: number };
}

/** 카메라로 가전을 못 고른 까닭: no_view 맞추기 전(카메라 없음), no_room 사진의 방 모름, no_device 그 방에 그 종류 가전 없음,
 *  out_of_view 그 가전이 시야 밖, off_box 상자 방향이 가전과 멂, ambiguous 같은 종류 둘 이상을 상자 방향으로 가르지 못함. */
export type SightMiss = "no_view" | "no_room" | "no_device" | "out_of_view" | "off_box" | "ambiguous";

export interface WorldDevice {
  id: string;
  kind: string;
  label: string;
  /** 상태 이름(작동 중 · 문 닫힘). 아는 속성이 없거나 신호가 없으면 null. */
  status: string | null;
  /** 지금 상태 키(vocab DEVICE_STATES). 신호가 없으면 빈 목록. */
  state: DeviceStateKey[];
  /** 켜짐·작동 중·열림처럼 늘 보일 상태가 있는가. */
  active: boolean;
  changed_ms: number;
  /** 처음 받은 뒤 상태가 마지막으로 바뀐 시각(바뀐 적 없으면 null). */
  event_ms: number | null;
  /** running이 참이 된 시각. 작동 중이 아니면 null. */
  started_ms: number | null;
  /** 남은 분(코스 시간이 없으면 null). */
  remaining_min: number | null;
  history: {
    attr: string; from: unknown; to: unknown; at_ms: number;
    /** 카메라로 본 바뀜이면 그 근거 사진의 촬영 시각(안정 셈을 채운 연속 프레임 가운데 가장 이른 것). 허브·실제 가전 신호면 없음. */
    seen_ms?: number;
    /** 카메라로 본 바뀜이면 VLM이 그 값을 직접 답했는가(true 명시, false 답이 없어 넣은 추정). 허브·실제 가전 신호면 없음(명시로 본다). */
    explicit?: boolean;
  }[];
  /** 지금 상태가 카메라로 본 것(실제 신호가 없음)이면 마지막으로 본 촬영 시각. 실제 신호 상태면 없음. */
  vision?: { at_ms: number };
  /** 속성마다 카메라가 마지막으로 이어 본 값과 그 촬영 시각·근거 종류(같은 값·같은 종류의 새 촬영은 이력 줄 대신 여기만 바뀐다). 본 적 없으면 없음.
   *  close: 가까이 본 관측(맞춘 감지 마스크가 사진 넓이의 10% 이상). 켠 위험 가전 추적의 확인 불가 복구(src/act/track/safety.ts cycleEnded confirmed)가 쓴다. */
  sight_last?: Record<string, { value: unknown; seen_ms: number; explicit: boolean; close: boolean }>;
}

/** 클로이드 눈(폰) 위치. room은 방 id, room_label은 방 이름(관찰 텍스트의 [눈] 줄). */
export interface WorldEye { position: [number, number]; height_m: number; yaw_deg: number; pitch_deg: number; room: string | null; room_label: string | null; at_ms: number }

/** 등장 확인 전에 끊긴 물건 후보의 마지막 자리(2분, 종류마다 최근 4개). 같은 종류 물건이 0.5m 안에 등장하면 지운다.
 *  in_hand: 관절로 손에 든 채 본 자리(그 후보의 손에 없던 자리가 있으면 그 자리를 손에 없음으로 남긴다). */
export interface WorldSighting { cls: ObjClass; position: [number, number, number]; surface: string | null; surface_label: string | null; at_ms: number; in_hand: boolean }

export interface WorldView {
  at_ms: number;
  objects: WorldObject[];
  /** 후보 자리(없으면 없음). 확인 물건이 아니므로 objects에 들지 않는다. */
  sightings?: WorldSighting[];
  person: WorldPerson;
  fixtures: WorldFixture[];
  devices: WorldDevice[];
  eye: WorldEye | null;
  /** YOLO가 분석한 마지막 엔진 프레임의 촬영 시각(없으면 null). 사람 보임·안 보임이 지금도 맞는지 본다. */
  frame_ms: number | null;
  /** VLM 답을 못 받은 프레임 수. */
  vlm_missing: number;
  /** YOLO가 분석하지 못한 프레임 수(감지 오류·대기열 초과·늦게 온 프레임). */
  yolo_missing: number;
}

/** VLM 분석 없음: cap 동시 상한·대기열 초과, timeout 제한 시간, format 형식 오류, error 호출 오류, stale 고리 범위보다 늦게 온 프레임. */
export type VlmMissing = "cap" | "timeout" | "format" | "error" | "stale";
/** YOLO 분석 없음: cap 대기열 초과(VLM도 없음), error 감지 오류(VLM은 분석), stale 늦게 온 프레임(VLM도 없음). */
export type YoloMissing = "cap" | "error" | "stale";

export type WorldChangeKind =
  | "appeared" | "gone" | "out_of_view" | "back_in_view" | "state" | "person_appeared" | "person_gone" | "person_state" | "person_room"
  | "fixture" | "device" | "vlm" | "vlm_missing" | "yolo_missing" | "heard";

/** World State 변화 하나. meaningful이면 PAM 판단 계기가 된다(등장·사라짐, 물건·가전 설비 상태, 사람 방, 가전 사건). */
export interface WorldChange { kind: WorldChangeKind; at_ms: number; subject: string; text: string; meaningful: boolean }

/** /perception/scene 몸: VLM 답 갈래(집 상태 입력의 주인, stage-queue 묶음 2). 사진은 싣지 않는다.
 *  원본 프레임 id·가까이 보기 look id로 집 상태 노드가 자기 감지 번호 표를 찾는다. observed_ms는 원본 사진의 촬영 시각이다.
 *  scene 전체 사진 VLM 답(VLM 물건 목록, 그 사진의 카메라 look), missing VLM 분석 없음, closer_scene 가까이 본 VLM 답(그 장의 자리 at),
 *  closer_end VLM 답 없이 끝난 가까이 보기(미룬 합치기를 YOLO만으로 넣는다), top 위에서 본 내용물 값.
 *  YOLO 임시 갈래(eye 눈 자리, frame 프레임 감지·관절, yolo_missing YOLO 분석 없음, closer_merge 가까이 본 장 합치기)는 VLM 답과 한 토픽이라 차례가 지켜지고 녹화·재생된다. */
export type SceneInput =
  | { kind: "scene"; frame_id: string; observed_ms: number; scene: SceneObservation; look?: SceneLookInput }
  | { kind: "missing"; frame_id: string; observed_ms: number; missing: VlmMissing }
  | { kind: "closer_scene"; look: string; frame_id: string; observed_ms: number; scene: SceneObservation; at: CloserAtInput }
  | { kind: "closer_end"; look: string }
  | { kind: "top"; object_id: string; frame_id: string; observed_ms: number; value: "empty" | "has_contents" }
  // VLM 전용으로 바뀔 자리: YOLO 임시 갈래(사진 없음, 감지 상자·눈 자리·프레임 번호만). feat/vlm-objects를 합친 뒤에도 VLM 답이 없을 때·VLM 답과 잇는 데 쓴다.
  | { kind: "eye"; eye: EyePose | null; at_ms: number }
  | { kind: "frame"; frame: FrameMeta; dets: Detection[]; poses?: Pose[] }
  | { kind: "yolo_missing"; frame_id: string; observed_ms: number; yolo: YoloMissing; vlm?: VlmMissing }
  /** from: VLM에 보낸 장(기록·재생에서 어느 장의 답인지 본다. 집 상태는 쓰지 않는다). */
  | { kind: "closer_merge"; look: string; passes: CloserPassInput[]; from: string };

/** 실행 추적이 지금 집기·내려놓기·들고 가는 대상의 단계와 목적지(트윈 [x, y], 없으면 null). */
export interface WorldFocus { step: "pick" | "place" | "carry"; spot: [number, number] | null }
/** /world/input 몸: 실행 추적이 World State에 넣는 것. guard 보기 지킴 켜기·끄기, contents 따르기 창 켜기·끄기, focus 지금 단계 대상(id null이면 풂), link 찾은 물건 잇기. */
export type WorldInput =
  | { kind: "guard" | "contents"; id: string; on: boolean; at_ms: number }
  | { kind: "focus"; id: string | null; focus: WorldFocus | null; at_ms: number }
  /** 찾기가 겨눈 자리에서 찾은 같은 무리 물건(from)을 계획 대상(to)으로 잇는다(WorldState.relink). */
  | { kind: "link"; from: string; to: string; at_ms: number };
/** /world/state 몸: 집 상태 판본과 보기. */
export interface WorldStateMsg { rev: number; view: WorldView }
/** /world/changes 몸: 그 판본에서 생긴 변화. */
export interface WorldChangesMsg { rev: number; changes: WorldChange[] }
/** /world/closer 몸: 가까이 보기 한 번(look)의 VLM 합치기가 끝난 뒤 감지 번호·VLM 물건 번호 → 물건 id 최종 표. 인식 노드가 found를 채운다. */
export interface WorldCloserMsg { look: string; ids: Record<string, string> }
