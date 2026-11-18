// PAM 오류 갈래(예전 HTTP 상태 대신). 앞 셋은 ContractError라 판단 실패로, PamLinkError는 PAM 연결 끊김으로 기록된다.
import { ContractError } from "../decision.js";

/** 요청이 pam-predict/3·pam-reflect/2 모양에 안 맞음·사진 칸(예전 400). LLM에 보내지 않는다. */
export class PamRequestError extends ContractError {}
/** 입력 추정 토큰 + 출력 상한이 문맥 길이를 넘음(예전 413). LLM에 보내지 않는다. */
export class PamBudgetError extends ContractError {}
/** LLM 답이 계약에 안 맞음(예전 200 invalid). 대기(-1)와 다르다. */
export class PamAnswerError extends ContractError {}
/** LLM에 닿지 않음·HTTP 오류·잘린 답·chat completions 모양 아님(예전 502). */
export class PamLinkError extends Error {}
