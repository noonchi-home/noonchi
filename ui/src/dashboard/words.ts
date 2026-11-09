// 대시보드 화면 글: 칩 이름과 지금 상태 한 줄, YOLO 이름(COCO 영어 이름 → 화면 이름).
export const WORDS = {
  wait: "대기",
  fsm: "FSM",
  action: "행동",
  noObservation: "아직 판단 없음",
  offline: "연결 끊김 · 다시 연결 중",
  noRobot: "클로이드 위치 모름",
  phoneOff: "폰 서버가 꺼져 있어요.",
  startAr: "폰에서 AR을 시작하세요.",
} as const;

export const BOX_NAME: Record<string, string> = { person: "사람", cup: "컵", bottle: "병", bowl: "그릇" };
