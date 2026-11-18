// 대시보드 화면 글: 칩 이름과 지금 상태 한 줄, YOLO 이름(감지 종류 → 화면 이름, 낱말 표 src/world/vocab.ts).
import { CLASSES } from "../../../src/world/vocab.ts";

export const WORDS = {
  waiting: "기다리는 중",
  /** 메시지 상자 오른쪽 아래 이어짐 표시. */
  more: "▼",
  /** 메시지 상자 FSM 카드: 하는 일이 없는 상태, 행동이 여럿일 때 「<첫 행동> 외 N」. */
  fsm: { watch: "지켜봄", more: "외" },
  /** 트윈 위 사람 이름표 「사람 · …」: 하는 일·자세를 모를 때, 안 보일 때. */
  personSeen: "보임",
  personGone: "안 보임",
  /** 마스코트 머리 위 모드 말풍선. */
  mode: { noonchi: "눈치 모드", coach: "코치 모드" },
  newHabit: "새로 배운 습관이에요",
  oldHabit: "전에 배운 습관이에요",
  offline: "연결 끊김 · 다시 연결 중",
  noRobot: "클로이드 위치 모름",
  phoneOff: "폰 서버가 꺼져 있어요.",
  startAr: "폰에서 AR을 시작하세요.",
} as const;

export const BOX_NAME: Record<string, string> = Object.fromEntries(Object.entries(CLASSES).map(([k, c]) => [k, c.label]));
