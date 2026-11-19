// 실제 폰 명령의 소리 등급(src/contract/phone.ts TalkGrade)을 정하는 하나뿐인 자리. 실행 추적(src/act/robot/phone.ts)이 폰으로 보낼 때 붙인다.
// safety: 닫힌 계획의 끄기 안내·부탁(off: 단계), 계획 안 끄는 단계(손 끄기 do·꺼짐 기다리기·가전 꺼짐·멈춤을 기다리는 단계)의 명령·부탁.
// question: 답 단추가 「완료」 말고 있는 명령(승인·시간 초과·물어보기). 그 밖의 명령은 등급이 없다.
import type { PlannedCommand, TalkGrade } from "../contract/phone.js";
import { isOffStep } from "./off-step.js";

/** offStep: 그 명령이 계획 안 끄는 단계의 것인가(실행 추적이 단계를 보고 정한다). */
export function talkGrade(c: Pick<PlannedCommand, "step" | "choices">, offStep: boolean): TalkGrade | undefined {
  if (offStep || isOffStep(c.step)) return "safety";
  return c.choices.some((x) => x.id !== "done") ? "question" : undefined;
}
