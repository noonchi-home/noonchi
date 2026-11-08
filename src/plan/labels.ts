// 서버가 만들어 화면에 그대로 나가는 글. npm run lint가 이 파일도 검사한다(60자 아래, 화살표·괄호 없음).

export const STEP_LABEL = {
  goTable: "식탁으로 가기", pickCup: "컵 집기", goSink: "싱크대로 가기", placeCup: "컵 내려놓기",
  askUser: "폰으로 물어보기", device: (device: string, verb: string) => `${device} ${verb}`.trim(),
};

/** 실제 폰 위에 보내는 단계 명령(src/act/track.ts). 열쇠는 STEP_LABEL과 같다. 사람에게 하는 말이고, 클로이드가 스스로 하는 말로 쓰지 않는다. */
export const STEP_COMMAND = {
  goTable: "식탁으로 가 주세요", pickCup: "컵을 들어 주세요", goSink: "싱크대로 가 주세요", placeCup: "컵을 싱크대에 넣어 주세요",
} as const;

/** 실제 폰 「완료」 바로 위 비전 상태 한 줄: 이동은 남은 거리, 집기·내려놓기는 World State의 컵 자리. */
export const VISION_TEXT = {
  table: "식탁", sink: "싱크대", cup: "컵", unseen: "안 보임",
  distance: (place: string, m: number | null) => (m === null ? `${place}까지 거리 모름` : `${place}까지 ${m.toFixed(1)}m`),
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
  in_sink: "대상 물건이 이미 싱크대 안이라 실행하지 않아요",
  stale: "판단 뒤에 대상을 다시 확인하지 못했어요",
  in_hand: "사람이 그 물건을 쓰는 중이라 실행하지 않아요",
  unreachable: "갈 수 있는 길이 없어 실행하지 않아요",
  device_mode: "시험 모드라 실제 가전은 부르지 않아요",
} as const;

/** 실행 추적 글(src/act/track.ts): 단계 이름과 끝난 까닭. */
export const EXEC_TEXT = {
  decided: "판단", planned: "계획", running: "실행 중", verifying: "결과 확인", done: "완료", failed: "실패",
  wait: "대기", decisionFailed: "판단 실패", superseded: "새 판단으로 바뀜", noPlan: "계획을 만들 수 없음", stopped: "사용자가 그만둠",
  timeout: "단계가 시간 안에 끝나지 않음", noAnswer: "답을 받지 못함", same: "같은 행동을 진행 중", late: "앞선 판단이라 쓰지 않음",
  answered: (label: string) => `완료: ${label}`,
} as const;
