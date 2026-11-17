// 대시보드 화면 글: 칩 이름과 지금 상태 한 줄, YOLO 이름(감지 종류 → 화면 이름, 낱말 표 src/world/vocab.ts).
import { CLASSES } from "../../../src/world/vocab.ts";

export const WORDS = {
  waiting: "기다리는 중",
  state: "상태",
  noonchi: "눈치",
  /** 메시지 상자: 배운 습관대로 행동할 때 맨 위 한 줄의 앞말, 오른쪽 아래 이어짐 표시. */
  habitLine: "배운 습관",
  more: "▼",
  coach: "코치",
  habit: "습관",
  learnedRule: "배운 규칙",
  learnedNow: "새로 배움",
  newHabit: "새로 배운 습관이에요",
  oldHabit: "전에 배운 습관이에요",
  offline: "연결 끊김 · 다시 연결 중",
  noRobot: "클로이드 위치 모름",
  phoneOff: "폰 서버가 꺼져 있어요.",
  startAr: "폰에서 AR을 시작하세요.",
} as const;

export const BOX_NAME: Record<string, string> = Object.fromEntries(Object.entries(CLASSES).map(([k, c]) => [k, c.label]));
