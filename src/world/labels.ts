// 서버가 화면·PAM 관찰 텍스트에 그대로 내보내는 World State 글. 종류·사실 값 글은 낱말 표(src/world/vocab.ts)에서 온다.
// npm run lint가 검사한다(60자 아래, 화살표·괄호 없음).
import { CLASSES, DAY_PARTS, STATES, WEEKDAYS } from "./vocab.js";

/** 종류 → 글(컵). */
export const OBJECT_NAME: Record<string, string> = Object.fromEntries(Object.entries(CLASSES).map(([k, c]) => [k, c.label]));

/** PAM FSM 기억의 상태 id → 대시보드 생각 말풍선 「상태」 칩 글. 여기 없는 상태는 칩을 보이지 않는다.
 *  열쇠는 FSM 상태 id(src/brain/decision.ts CUP_FSM_MEMORY)다. 낱말 표 값과 이름이 같은 것이 있어도 다른 것이라, 낱말 목록 검사(tests/world-vocab.test.ts)와 헷갈리지 않게 따옴표로 쓴다. */
export const FSM_STATE_TEXT: Record<string, string> = { "drinking": "먹거나 마시는 중", "watching_tv": "TV 보는 중", "left_cup": "컵을 두고 자리를 뜸", "cooking": "주방에서 할 일을 찾음" };

/** YOLO 기록 글: 이 프레임에 찾은 것이 없음, 감지기가 없어 VLM만 돎. */
export const YOLO_TEXT = { none: "감지 없음", noDetector: "감지기 없음" };

/** 사실 값 → 글. */
export const STATE_TEXT: Record<string, string> = Object.fromEntries(Object.entries(STATES).map(([k, s]) => [k, s.label]));

/** 카메라로 본 가전 상태 표시: 변화 줄·[지속] 줄 끝, 대시보드 말풍선 줄 끝. */
export const SEEN_TEXT = "카메라로 봄";
/** 내용물을 다시 연 까닭(변화 줄). */
const AGAIN_WHY = { drink: "입에 댐", pour: "따르는 모습", step: "따르기 단계" } as const;

/** World State 변화 글(관찰 텍스트 줄, 판단 기록 줄). */
export const CHANGE_TEXT = {
  /** 카메라로 본 값이 가전 상태가 됨(거실 TV 켜짐 · 카메라로 봄). */
  deviceSeen: (label: string, status: string) => `${label} ${status} · ${SEEN_TEXT}`,
  /** 실제 상태와 카메라로 본 값이 다름(판단 계기 아님). */
  deviceMismatch: (label: string, seen: string, real: string) => `${label} 카메라로는 ${seen} · 기기 값은 ${real}`,
  /** [지속] 가전 줄 끝: 카메라로 본 상태와 마지막으로 본 시각. */
  seenAt: (clock: string) => `${SEEN_TEXT}, 마지막 확인 ${clock}`,
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
  /** 마시기·따르기 사건이나 따르기 단계로 내용물을 다시 확인한다(판단 계기 아님). */
  contentsAgain: (name: string, why: keyof typeof AGAIN_WHY) => `${name} ${AGAIN_WHY[why]} · 내용물 다시 확인`,
  device: (label: string, status: string) => `${label} ${status}`,
  deviceAttr: (label: string, attr: string, to: unknown) => `${label} ${attr} ${String(to)}`,
  remaining: (min: number) => `남은 시간 ${min}분`,
  vlm: (summary: string) => `VLM: ${summary}`,
  /** 실제 폰이 들은 말 한 마디(그 순간 판단에만 쓴다. 기록에는 HEARD_MARK만 남긴다). */
  heard: (said: string) => `사람이 말함: 「${said}」`,
  vlmMissing: { cap: "요청이 몰려 VLM 분석 없음", timeout: "시간 초과로 VLM 분석 없음", format: "형식 오류로 VLM 분석 없음", error: "호출 오류로 VLM 분석 없음", stale: "늦게 온 사진이라 VLM 분석 없음" },
  yoloMissing: { cap: "요청이 몰려 YOLO·VLM 분석 없음", error: "감지 오류로 YOLO 분석 없음", stale: "늦게 온 사진이라 YOLO·VLM 분석 없음" },
};

/** 들은 말은 이 길이에서 자른다. */
export const HEARD_MAX = 200;
/** 기록(기록 DB·대시보드·반성 입력)에 남기는 들은 말 표시: 내용은 남기지 않는다. KEEP_HEARD_TEXT=1이면 그대로 남긴다(기본 꺼짐). */
export const HEARD_MARK = "들은 말 있음";
/** 다른 글(PAM의 생각 글) 안에 그대로 옮겨진 들은 말을 바꾸는 글. */
export const HEARD_WORD = "들은 말";
const HEARD_LINE = /사람이 말함: 「([^」]*)」/g;
/** 관찰 텍스트 안의 들은 말들. */
export const saidIn = (text: string): string[] => [...text.matchAll(HEARD_LINE)].map((m) => m[1]!).filter(Boolean);
/** 기록에 남길 관찰 텍스트: 들은 말 줄을 내용 없는 표시로 바꾼다. */
export const redactHeard = (text: string): string => text.replace(HEARD_LINE, HEARD_MARK);
/** 기록에 남길 다른 글: 들은 말이 그대로 들어 있으면 뺀다. */
export const redactSaid = (text: string, said: readonly string[]): string => said.reduce((t, s) => t.split(s).join(HEARD_WORD), text);

/** 물건 이름: 종류 글 + id(컵 cup_1). */
export const objectName = (cls: string, id: string) => `${OBJECT_NAME[cls] ?? cls} ${id}`;

/** 가전 설비 이름: 방 이름 + 종류 글 + id(거실 TV tv_living). */
export const fixtureName = (cls: string, id: string, roomLabel: string | null) => `${roomLabel ? `${roomLabel} ` : ""}${objectName(cls, id)}`;

/** 놓인 면 글(식탁 위). */
export const onSurface = (label: string) => `${label} 위`;
/** 싱크볼 안 물건 글(주방·식당 싱크대 안 · 치움): 치우기 계획 놓기 끝 자리라 치울 물건으로 읽히지 않게 「치움」을 붙인다. */
export const inBasin = (label: string) => `${label} 안 · 치움`;

/** 때 글: 날짜·요일·하루 때(11월 7일 토요일 밤). 시:분은 그 시간대 기준. */
export function dayText(month: number, day: number, weekday: number, hour: number): string {
  const part = [...DAY_PARTS].reverse().find((p) => hour >= p.from)!;
  return `${month}월 ${day}일 ${WEEKDAYS[weekday]} ${part.label}`;
}

/** 관찰 텍스트 사실 글. */
export const PLACE_UNKNOWN = "자리 모름";
/** VLM 한 장만 보고 붙인 사실(certainty inferred) 표시: 관찰 텍스트 [지속] 사실 줄의 값 뒤 괄호. */
export const GUESS = "짐작";
export const OUT_OF_VIEW_NOW = "지금 시야 밖";
export const EYE_TEXT = "클로이드 눈:";
export const ROOM_UNKNOWN = "방 모름";

/** PAM 연결과 주기 판단 멈춤 기록 글. */
export const LINK_TEXT = { up: "PAM 연결됨", down: "PAM 연결 끊김" } as const;
export const TRIGGER_TEXT = {
  idle: "사람이 없어 판단을 멈춤", no_frames: "폰 사진이 오지 않아 판단을 멈춤", acting: "할 일 중 기다리는 동안 판단을 멈춤", resumed: "판단을 다시 시작함",
} as const;
