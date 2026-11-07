// 서버가 화면·PAM 관찰 텍스트에 그대로 내보내는 World State 글. npm run lint가 검사한다(60자 아래, 화살표·괄호 없음).
export const OBJECT_NAME: Record<string, string> = { person: "사람", cup: "컵", bottle: "병", bowl: "그릇" };

/** 관찰 텍스트 줄 머리: 어느 분석에서 온 줄인지. */
export const LINE = { vlm: "VLM", answerPhoto: "요청 답 사진", sceneFrame: "장면 사진", noVlm: "VLM 분석 없음" };

/** VLM이 확신한 컵 안([지속] 사실). */
export const CONTENTS_FACT = { empty: "컵 안: 빈 컵 확신", not_empty: "컵 안: 음료 남음 확신" };

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
  vlmMissing: { cap: "요청이 몰려 VLM 분석 없음", timeout: "시간 초과로 VLM 분석 없음", format: "형식 오류로 VLM 분석 없음", error: "호출 오류로 VLM 분석 없음" },
  yoloMissing: { cap: "요청이 몰려 YOLOX·VLM 분석 없음", error: "감지 오류로 YOLOX 분석 없음" },
};

/** 물건 이름: 종류 글 + id(컵 cup_1). */
export const objectName = (cls: string, id: string) => `${OBJECT_NAME[cls] ?? cls} ${id}`;

/** 놓인 면 글(식탁 위). */
export const onSurface = (label: string) => `${label} 위`;
