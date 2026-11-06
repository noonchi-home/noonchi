// 서버가 만들어 화면에 그대로 나가는 글. npm run lint가 이 파일도 검사한다(60자 아래, 화살표·괄호 없음).
import type { BrainStage } from "../contract/events.js";

export const JUDGMENT: Record<BrainStage, string> = {
  use: "사람이 컵을 쓰고 있어요", away: "자리를 비웠는지 보는 중", request: "폰으로 사진을 부탁했어요",
  answer: "부탁한 사진을 받았어요", decide: "할 일을 고르는 중", confirm: "하기 전에 한 번 더 보는 중",
  act: "컵을 치우러 가요", result: "끝났어요", wait: "근거를 모으는 중",
  cancel: "사람이 돌아와 멈췄어요", stale: "화면이 오래돼 다시 보는 중", error: "판단하지 못했어요",
};

/** 사용자에게 물어보기로 정했을 때의 판단(act 단계). */
export const ASK_JUDGMENT = "치울지 폰으로 물어봐요";

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
