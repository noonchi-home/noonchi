// 돕는 방식(src/contract/setup.ts AssistMode)의 화면 이름. 설정 화면(돕는 방식 고르기)과 대시보드 메시지 상자 머리(지금 모드)가 같은 이름을 쓴다.
import type { AssistMode } from "../../../src/contract/setup.ts";

export const ASSIST_NAME: Record<AssistMode, string> = { auto: "자동", noonchi: "눈치 모드", coach: "코치 모드" };
