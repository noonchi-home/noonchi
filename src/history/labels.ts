// 기록 DB 글: 판단 기록·하루 요약·반성 결과에 그대로 나간다. npm run lint가 검사한다(60자 아래, 화살표·괄호 없음).
import type { PlanStatus } from "../contract/plan.js";
import type { ControlMode } from "../contract/setup.js";

export const MODE_TEXT: Record<ControlMode, string> = { live: "실제 모드", test: "시험 모드" };

export const PLAN_STATUS_TEXT: Record<PlanStatus, string> = { planned: "계획됨", running: "진행 중", done: "끝남", cancelled: "취소됨", failed: "실패" };

export const DECISION_TEXT = { wait: "대기", failed: (error: string) => `판단 실패: ${error}` };
