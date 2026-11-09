// 기록 DB 글: 판단 기록·하루 요약·반성 결과에 그대로 나간다. npm run lint가 검사한다(60자 아래, 화살표·괄호 없음).
import type { PlanStatus } from "../contract/plan.js";
import type { ControlMode } from "../contract/setup.js";

export const MODE_TEXT: Record<ControlMode, string> = { live: "실제 모드", test: "시험 모드" };

export const PLAN_STATUS_TEXT: Record<PlanStatus, string> = { planned: "계획됨", running: "진행 중", done: "끝남", cancelled: "취소됨", failed: "실패" };

export const DECISION_TEXT = { wait: "대기", failed: (error: string) => `판단 실패: ${error}` };

/** 하루 요약 글: 행동 요약 줄 머리, 줄인 줄 수, 하루 분석 수. */
export const SUMMARY_TEXT = {
  decision: "클로이드 판단: ",
  execution: "클로이드 실행: ",
  feedback: "사용자: ",
  dropped: (n: number) => `앞선 기록 ${n}줄 생략`,
  tally: (vlm: number, vlmMissing: number, yoloMissing: number) => `[하루] VLM 분석 ${vlm}장 · VLM 분석 없음 ${vlmMissing}장 · YOLO 분석 없음 ${yoloMissing}장`,
};

/** 사진 찍기 기록 글. */
export const PHOTO_TEXT = { saved: "사진 찍기 사진 저장" };

/** 반성 결과 글(판단 기록·기록 DB). 비어 있는 하루 요약 칸에 넣는 글. */
export const REFLECT_TEXT = {
  done: (version: number, day: string) => `반성 완료: 기억 ${version}판, ${day}부터`,
  failed: (error: string) => `반성 실패: ${error}`,
  empty: "그날 기록 없음",
  tooBig: "기억이 커서 반성 입력 한도를 넘어요",
  running: "이미 반성하는 중이에요",
  noObservation: "관찰 없음",
  noAction: "행동 없음",
};

/** 폰 부탁·질문의 답과 그동안의 말(반성 피드백). */
export const FEEDBACK_TEXT = {
  answer: (said: string, kind: "command" | "ask", asked: string) => `${said} · ${kind === "ask" ? "질문" : "부탁"}: ${asked}`,
};
