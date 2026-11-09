// 서버가 화면·PAM 관찰 텍스트에 그대로 내보내는 World State 글. 종류·사실 값 글은 낱말 표(src/world/vocab.ts)에서 온다.
// npm run lint가 검사한다(60자 아래, 화살표·괄호 없음).
import { CLASSES, DAY_PARTS, STATES, WEEKDAYS } from "./vocab.js";

/** 종류 → 글(컵). */
export const OBJECT_NAME: Record<string, string> = Object.fromEntries(Object.entries(CLASSES).map(([k, c]) => [k, c.label]));

/** YOLO 기록 글: 이 프레임에 찾은 것이 없음, 감지기가 없어 VLM만 돎. */
export const YOLO_TEXT = { none: "감지 없음", noDetector: "감지기 없음" };

/** 사실 값 → 글. */
export const STATE_TEXT: Record<string, string> = Object.fromEntries(Object.entries(STATES).map(([k, s]) => [k, s.label]));

/** World State 변화 글(관찰 텍스트 줄, 판단 기록 줄). */
export const CHANGE_TEXT = {
  appeared: (name: string, where: string | null) => `${name} 보임${where ? ` · ${where}` : ""}`,
  gone: (name: string) => `${name} 사라짐`,
  outOfView: (name: string) => `${name} 시야 밖`,
  backInView: (name: string) => `${name} 다시 시야 안`,
  personAppeared: "사람 보임",
  personGone: "사람 안 보임",
  personRoom: (room: string) => `사람 ${room}에 있음`,
  people: (n: number) => `${n}명`,
  near: (label: string) => `${label} 가까이`,
  state: (name: string, value: string) => `${name} ${STATE_TEXT[value] ?? value}`,
  device: (label: string, status: string) => `${label} ${status}`,
  deviceAttr: (label: string, attr: string, to: unknown) => `${label} ${attr} ${String(to)}`,
  remaining: (min: number) => `남은 시간 ${min}분`,
  vlm: (summary: string) => `VLM: ${summary}`,
  vlmMissing: { cap: "요청이 몰려 VLM 분석 없음", timeout: "시간 초과로 VLM 분석 없음", format: "형식 오류로 VLM 분석 없음", error: "호출 오류로 VLM 분석 없음", stale: "늦게 온 사진이라 VLM 분석 없음" },
  yoloMissing: { cap: "요청이 몰려 YOLO·VLM 분석 없음", error: "감지 오류로 YOLO 분석 없음", stale: "늦게 온 사진이라 YOLO·VLM 분석 없음" },
};

/** 물건 이름: 종류 글 + id(컵 cup_1). */
export const objectName = (cls: string, id: string) => `${OBJECT_NAME[cls] ?? cls} ${id}`;

/** 가전 설비 이름: 방 이름 + 종류 글 + id(거실 TV tv_living). */
export const fixtureName = (cls: string, id: string, roomLabel: string | null) => `${roomLabel ? `${roomLabel} ` : ""}${objectName(cls, id)}`;

/** 놓인 면 글(식탁 위). */
export const onSurface = (label: string) => `${label} 위`;

/** 때 글: 날짜·요일·하루 때(11월 7일 토요일 밤). 시:분은 그 시간대 기준. */
export function dayText(month: number, day: number, weekday: number, hour: number): string {
  const part = [...DAY_PARTS].reverse().find((p) => hour >= p.from)!;
  return `${month}월 ${day}일 ${WEEKDAYS[weekday]} ${part.label}`;
}

/** 관찰 텍스트 사실 글. */
export const PLACE_UNKNOWN = "자리 모름";
export const OUT_OF_VIEW_NOW = "지금 시야 밖";
export const EYE_TEXT = "클로이드 눈:";
export const ROOM_UNKNOWN = "방 모름";

/** PAM 연결과 주기 판단 멈춤 기록 글. */
export const LINK_TEXT = { up: "PAM 연결됨", down: "PAM 연결 끊김" } as const;
export const TRIGGER_TEXT = { idle: "사람이 없어 판단을 멈춤", no_frames: "폰 사진이 오지 않아 판단을 멈춤", resumed: "판단을 다시 시작함" } as const;
