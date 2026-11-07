// 서버가 화면·PAM 관찰 텍스트에 그대로 내보내는 World State 글. npm run lint가 검사한다(60자 아래, 화살표·괄호 없음).
export const OBJECT_NAME: Record<string, string> = { person: "사람", cup: "컵", bottle: "병", bowl: "그릇" };

/** 관찰 텍스트 줄 머리: 어느 분석에서 온 줄인지. */
export const LINE = { vlm: "VLM", answerPhoto: "요청 답 사진", sceneFrame: "장면 사진", noVlm: "VLM 분석 없음" };

/** VLM이 확신한 컵 안([지속] 사실). */
export const CONTENTS_FACT = { empty: "컵 안: 빈 컵 확신", not_empty: "컵 안: 음료 남음 확신" };
