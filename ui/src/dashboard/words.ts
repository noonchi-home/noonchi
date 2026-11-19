// 대시보드 화면 글: 칩 이름과 지금 상태 한 줄, YOLO 이름(감지 종류 → 화면 이름, 낱말 표 src/world/vocab.ts).
import { CLASSES } from "../../../src/world/vocab.ts";

export const WORDS = {
  waiting: "기다리는 중",
  /** 메시지 상자 오른쪽 아래 이어짐 표시. */
  more: "▼",
  /** 시간 줄 카드: 줄 이름, 계획 밖 로봇, 지금 선, 초 눈금 「N초 전」, 반응 간격 「N.N초」. */
  timeline: {
    rows: { person: "사람", robot: "로봇" },
    watch: "지켜봄",
    robot: { idle: "지켜봄", observe: "살펴보는 중", move: "이동 중", run: "실행 중", return: "충전 자리로 가는 중", recover: "다시 확인하는 중" },
    now: "지금",
    ago: (sec: number) => `${sec}초 전`,
    gap: (sec: string) => `${sec}초`,
  },
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
