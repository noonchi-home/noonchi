// 서버가 만들어 화면에 그대로 나가는 글. npm run lint가 이 파일도 검사한다(60자 아래, 화살표·괄호 없음).

export const STEP_LABEL = {
  goTable: "식탁으로 가기", pickCup: "컵 집기", goSink: "싱크대로 가기", placeCup: "컵 내려놓기",
  askUser: "폰으로 물어보기", device: (device: string, verb: string) => `${device} ${verb}`.trim(),
};

export const GOAL = { clearCup: "컵 치우기", askUser: "사용자에게 물어보기" };

/** 기기를 바꾸는 에이전트 도구 → 단계 글 끝말. 여기 없는 도구(읽기·배치)는 계획을 만들지 않는다. */
export const DEVICE_VERB: Record<string, string> = {
  turn_on: "켜기", turn_off: "끄기", set_level: "맞추기", set_climate: "맞추기", set_covering: "맞추기",
  lock: "잠그기", unlock: "잠금 풀기", start: "시작", stop: "멈추기", set_valve: "맞추기",
};

/** 실행 전 검사를 통과하지 못한 이유(src/act/check.ts). */
export const CHECK_TEXT = {
  unknown_task: "행동 목록에 없는 행동이라 실행하지 않아요",
  no_target: "대상 물건이 보이지 않아 실행하지 않아요",
  stale: "판단 뒤에 대상을 다시 확인하지 못했어요",
  in_hand: "사람이 그 물건을 쓰는 중이라 실행하지 않아요",
  unreachable: "갈 수 있는 길이 없어 실행하지 않아요",
  device_mode: "시험 모드라 실제 가전은 부르지 않아요",
} as const;
