// World State 계약(서버 → 화면 /events {type:"world"}, GET /api/world, 판단 기록). 순수 타입만 둔다: ui/가 그대로 가져다 쓴다.
// 만드는 곳은 src/world/state.ts다.

/** World State가 위치·상태를 쌓는 물건 종류(YOLOX COCO cup·wine glass·bottle·bowl). */
export type ObjClass = "cup" | "bottle" | "bowl";
/** VLM 사실의 면: 놓인 자리, 쓰는 중, 안 내용, 사람 자세, 사람 행동. */
export type Facet = "place" | "use" | "contents" | "posture" | "action";

/** VLM이 본 사실 하나. 같은 값이 연속 두 번이면 confirmed, 아니면 inferred. at_ms는 그 사진의 촬영 시각. */
export interface WorldFact { value: string; at_ms: number; certainty: "confirmed" | "inferred" }

export interface WorldObject {
  /** 종류_번호(cup_1). */
  id: string;
  cls: ObjClass;
  /** 트윈 좌표 [x, 높이, y]. 맞추기 전이면 null. */
  position: [number, number, number] | null;
  /** 놓인 면(식탁·책상·조리대·싱크대) id와 이름. 바닥이거나 모르면 null. */
  surface: string | null;
  surface_label: string | null;
  room: string | null;
  /** 위치 오차(m). 위치를 모르면 null. */
  error_m: number | null;
  /** present 시야 안에서 확인됨, out_of_view 마지막 자리가 지금 시야 밖, gone 그 자리가 시야 안인데 안 보임(확인됨). */
  status: "present" | "out_of_view" | "gone";
  first_seen_ms: number;
  last_seen_ms: number;
  last_in_view_ms: number;
  facts: Partial<Record<Facet, WorldFact>>;
  /** 관계표로 붙인 관련 가전 id. */
  devices: string[];
}

export interface WorldPerson {
  visible: boolean;
  /** 보임·안 보임이 마지막으로 바뀐 시각(첫 프레임 전이면 null). */
  since_ms: number | null;
  last_seen_ms: number | null;
  facts: Partial<Record<Facet, WorldFact>>;
}

export interface WorldDevice {
  id: string;
  kind: string;
  label: string;
  /** 상태 이름(작동 중·이용 가능). 상태표가 없거나 신호가 없으면 null. */
  status: string | null;
  changed_ms: number;
  /** running이 참이 된 시각. 작동 중이 아니면 null. */
  started_ms: number | null;
  /** 남은 분(코스 시간이 없으면 null). */
  remaining_min: number | null;
  history: { attr: string; from: unknown; to: unknown; at_ms: number }[];
}

export interface WorldEye { position: [number, number]; height_m: number; yaw_deg: number; pitch_deg: number; room: string | null; at_ms: number }

export interface WorldView {
  at_ms: number;
  objects: WorldObject[];
  person: WorldPerson;
  devices: WorldDevice[];
  eye: WorldEye | null;
  /** VLM 답을 못 받은 프레임 수. */
  vlm_missing: number;
  /** YOLOX가 분석하지 못한 프레임 수(감지 오류·대기열 초과·늦게 온 프레임). */
  yolo_missing: number;
}

/** VLM 분석 없음: cap 동시 상한·대기열 초과, timeout 제한 시간, format 형식 오류, error 호출 오류, stale 고리 범위보다 늦게 온 프레임. */
export type VlmMissing = "cap" | "timeout" | "format" | "error" | "stale";
/** YOLOX 분석 없음: cap 대기열 초과(VLM도 없음), error 감지 오류(VLM은 분석), stale 늦게 온 프레임(VLM도 없음). */
export type YoloMissing = "cap" | "error" | "stale";

export type WorldChangeKind =
  | "appeared" | "gone" | "out_of_view" | "back_in_view" | "state" | "person_appeared" | "person_gone" | "person_state"
  | "device" | "vlm" | "vlm_missing" | "yolo_missing";

/** World State 변화 하나. meaningful이면 PAM 판단 계기가 된다(등장·사라짐, 물건 상태, 관련 가전). */
export interface WorldChange { kind: WorldChangeKind; at_ms: number; subject: string; text: string; meaningful: boolean }
