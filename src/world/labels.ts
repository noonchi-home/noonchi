// 서버가 화면·PAM 관찰 텍스트에 그대로 내보내는 World State 글. npm run lint가 검사한다(60자 아래, 화살표·괄호 없음).
export const OBJECT_NAME: Record<string, string> = { person: "사람", cup: "컵", bottle: "병", bowl: "그릇" };

/** YOLO 기록 글: 이 프레임에 찾은 것이 없음, 감지기가 없어 VLM만 돎. */
export const YOLO_TEXT = { none: "감지 없음", noDetector: "감지기 없음" };

/** VLM 상태 값 → 글. */
export const STATE_TEXT: Record<string, string> = {
  on_table: "식탁 위", on_counter: "조리대 위", in_sink: "싱크대 안", on_floor: "바닥", in_hand: "손에 있음", in_use: "쓰는 중",
  empty: "비어 있음", has_contents: "내용물 있음", contents_unknown: "안이 안 보임", sitting: "앉아 있음", standing: "서 있음",
  holding_object: "물건을 들고 있음", eating_or_drinking: "먹거나 마시는 중",
};

/** World State 변화 글(관찰 텍스트 줄, 판단 기록 줄). */
export const CHANGE_TEXT = {
  appeared: (name: string, where: string | null) => `${name} 보임${where ? ` · ${where}` : ""}`,
  gone: (name: string) => `${name} 사라짐`,
  outOfView: (name: string) => `${name} 시야 밖`,
  backInView: (name: string) => `${name} 다시 시야 안`,
  personAppeared: "사람 보임",
  personGone: "사람 안 보임",
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

/** 놓인 면 글(식탁 위). */
export const onSurface = (label: string) => `${label} 위`;

/** 관찰 텍스트 사실 글. */
export const PLACE_UNKNOWN = "자리 모름";
export const OUT_OF_VIEW_NOW = "지금 시야 밖";
export const EYE_TEXT = "클로이드 눈:";
export const ROOM_UNKNOWN = "방 모름";

/** PAM 연결과 주기 판단 멈춤 기록 글. */
export const LINK_TEXT = { up: "PAM 연결됨", down: "PAM 연결 끊김" } as const;
export const TRIGGER_TEXT = { paused: "사람이 없어 판단을 멈춤", resumed: "판단을 다시 시작함" } as const;
