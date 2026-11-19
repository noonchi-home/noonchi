// 기록 DB 글: 판단 기록·하루 요약·반성 결과에 그대로 나간다. npm run lint가 검사한다(60자 아래, 화살표·괄호 없음).
import type { PlanStatus } from "../../contract/plan.js";
import type { ControlMode } from "../../contract/setup.js";

export const MODE_TEXT: Record<ControlMode, string> = { live: "실제 모드", test: "시험 모드" };

export const PLAN_STATUS_TEXT: Record<PlanStatus, string> = { planned: "계획됨", running: "진행 중", done: "끝남", cancelled: "취소됨", failed: "실패" };

export const DECISION_TEXT = { wait: "대기", failed: (error: string) => `판단 실패: ${error}` };

/** 하루 요약 글: 행동 요약 줄 머리, 줄인 줄 수, 하루 분석 수. */
export const SUMMARY_TEXT = {
  decision: "클로이드 판단: ",
  execution: "클로이드 실행: ",
  feedback: "사용자: ",
  dropped: (n: number) => `앞선 기록 ${n}줄 생략`,
  /** 판단 줄 끝에 붙이는 그 판단의 사람 상태(임시 상태 ~<하는 일 값> 포함). */
  state: (s: string) => ` · 사람 상태 ${s}`,
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
  cancelled: "서버를 끄느라 반성을 멈췄어요",
  noObservation: "관찰 없음",
  noAction: "행동 없음",
  learned: (n: number) => `새 화살표 ${n}개를 배웠어요`,
  /** 반성이 낸 기억이 코드 검사·뜻 검사를 두 번 다 지나지 못해 새 판본을 저장하지 않음. */
  rejected: (why: string) => `반성 기억을 쓰지 않아요 · ${why}`,
  /** 다시 반성할 때 피드백 끝에 붙이는 까닭. */
  retry: (why: string) => `기억 검사 까닭: ${why}`,
};

/** 기억 판본 글(서버 로그). */
export const MEMORY_TEXT = { restart: (version: number) => `옛 모양 기억 ${version}판이라 새 seed로 다시 시작해요` };

/** 밤 흐름 글: 반성 입력에 붙이는 지난 검사 결과(모델이 읽는 영어 머리, 후보 줄), 서버 로그 줄. */
export const NIGHT_TEXT = {
  checksHead: "Check results:",
  check: (state: string, candidate: string, action: string, n: number, k: number, passed: boolean) => `${state} | ${candidate} | ${action} | n=${n} k=${k} ${passed ? "passed" : "not passed"}`,
  chunkFailed: (why: string) => `덩어리 기록 실패라 하루 요약으로 반성해요 · ${why}`,
  copyFailed: (why: string) => `밤 흐름 사본을 쓰지 못했어요 · ${why}`,
  markFailed: (day: string, why: string) => `${day} 시각 찾기 실패라 그날은 이번 채택 검사에서 빼요 · ${why}`,
};

/** 폰 부탁·질문의 답과 그동안의 말(반성 피드백). */
export const FEEDBACK_TEXT = {
  answer: (said: string, kind: "command" | "ask", asked: string) => `${said} · ${kind === "ask" ? "질문" : "부탁"}: ${asked}`,
};
