// 서버가 만들어 화면에 그대로 나가는 글. npm run lint가 이 파일도 검사한다(60자 아래, 화살표·괄호 없음).
import { josa } from "../agent/phrases.js";
import type { CloserMiss } from "../contract/events.js";
import { OBJECT_NAME } from "../world/labels.js";

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

/** 대시보드 말풍선 카드 한 문장(src/act/say.ts). 클로이드가 정한 것과 실제 폰에 낸 명령이다. 클로이드가 몸으로 하는 말로 쓰지 않는다. */
export const SAY_TEXT = {
  watching: "지켜보고 있어요.",
  looking: (surface: string) => `${josa(surface, "을/를")} 보고 있어요.`,
  decided: (goal: string, surface: string | null = null) =>
    goal === GOAL.clearCup && surface ? `${surface} 컵을 치우기로 했어요.` : DECIDED[goal] ?? `${josa(goal, "을/를")} 하기로 했어요.`,
  told: { goTable: "식탁으로 가라고 했어요.", pickCup: "컵을 들라고 했어요.", goSink: "싱크대로 가라고 했어요.", placeCup: "컵을 싱크대에 넣으라고 했어요." },
  /** 컵 명령이 아닌 사람 단계: 단계 이름. */
  toldStep: (label: string) => `${josa(label, "을/를")} 부탁했어요.`,
  said: "폰으로 알렸어요.",
  waiting: (label: string) => `${josa(label, "을/를")} 기다리고 있어요.`,
  device: (label: string) => `${josa(label, "을/를")} 하고 있어요.`,
  asked: "폰으로 물어봤어요.",
  done: (goal: string) => DONE[goal] ?? `${josa(goal, "을/를")} 마쳤어요.`,
  stopped: (goal: string) => `${josa(goal, "을/를")} 그만뒀어요.`,
};
const DECIDED: Record<string, string> = { [GOAL.clearCup]: "컵을 치우기로 했어요.", [GOAL.askUser]: "폰으로 물어보기로 했어요." };
const DONE: Record<string, string> = { [GOAL.clearCup]: "컵을 다 치웠어요." };

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

/** 승인(src/act/track.ts): 처음 하는 계획을 실제 폰에 묻는 글, 「거절」을 받은 계획의 실행 기록. */
export const APPROVAL_TEXT = {
  ask: (task: string) => `${josa(task, "을/를")} 할까요?`,
  refused: "사용자가 거절한 일",
};

/** 시간 안에 끝나지 않은 단계를 실제 폰에 다시 묻는 글(src/act/track.ts, 답은 계속·그만). */
export const AGAIN_TEXT = { ask: (label: string) => `${josa(label, "을/를")} 계속할까요?` };

/** 비전 상태 줄에 쓰는 평면도 물건 짧은 이름(낱말 표에 없는 종류). 낱말 표 종류(식탁 등)는 그 글을 쓰고(placeShort), 둘 다 없으면 배치 이름을 쓴다. */
export const PLACE_SHORT: Record<string, string> = {
  sink_counter: "싱크대", utility_sink: "싱크대", induction_counter: "조리대", washer: "세탁기", dryer: "건조기",
  fridge: "냉장고", kimchi_fridge: "김치냉장고", dishwasher: "식기세척기", sofa: "소파", desk: "책상", coffee_table: "탁자",
  bed_queen: "침대", bed_single: "침대", stand_ac: "에어컨", wall_ac: "에어컨",
};

/** 평면도 물건 종류의 짧은 이름. 없으면 undefined. */
export const placeShort = (type: string): string | undefined => PLACE_SHORT[type] ?? OBJECT_NAME[type];

/** 실행 추적 글(src/act/track.ts): 단계 이름과 끝난 까닭. */
export const EXEC_TEXT = {
  decided: "판단", planned: "계획", running: "실행 중", verifying: "결과 확인", done: "완료", failed: "실패",
  wait: "대기", decisionFailed: "판단 실패", superseded: "새 판단으로 바뀜", noPlan: "계획을 만들 수 없음", stopped: "사용자가 그만둠",
  timeout: "단계가 시간 안에 끝나지 않음", noAnswer: "답을 받지 못함", same: "같은 행동을 진행 중", late: "앞선 판단이라 쓰지 않음",
  answered: (label: string) => `완료: ${label}`,
  badPlan: "계획이 맞지 않아 버림", held: "방금 계획한 일이라 잠시 뒤 다시 봄", deviceFailed: "가전 명령이 실패함",
  deviceUnverified: "가전 명령 결과를 확인하지 못함", busy: "할 일 중 기다리는 동안이라 쓰지 않음",
} as const;

/** 관찰 모드 기록 글(src/act/look.ts, 기록 종류 look). 가까이 본 결과, 못 본 까닭, 사람 부탁, 기다리기. capped·failed는 모델 대신 쓰는 까닭 글이다. */
export const LOOK_TEXT = {
  closer: (place: string, seen: string) => `${place} 쪽을 가까이 봄 · ${seen}`,
  seen: (names: readonly string[]) => (names.length ? `${[...new Set(names)].join("·")} 보임` : "찾은 것 없음"),
  miss: {
    no_fresh_frames: "새 사진이 모자라 못 봄", vlm_busy: "VLM 자리가 없어 못 봄", no_view: "카메라를 맞추기 전이라 못 봄", out_of_view: "사진 밖이라 못 봄",
    no_detector: "감지기가 없어 못 봄", aborted: "단계가 바뀌어 그만 봄", closed: "멈춰서 못 봄", error: "감지 오류로 못 봄",
  } satisfies Record<CloserMiss, string>,
  vlmMissing: "VLM 답 없음",
  asked: (text: string) => `가까이 비춰 달라고 부탁함 · ${text}`,
  notSent: "단계가 바뀌어 부탁하지 않음",
  waited: (place: string | null) => (place ? `${place} 쪽은 기다림` : "기다림"),
  capped: "한 시간 관찰 횟수를 다 써서 부르지 않음",
  failed: (why: string) => `관찰 모드 호출 실패: ${why}`,
};
