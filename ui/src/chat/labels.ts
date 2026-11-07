import type { AgentAction, BrainLog, ExecState } from "../../../src/contract/events.ts";
import type { VlmMissing, YoloMissing } from "../../../src/contract/world.ts";

/** 도구 이름 → 화면 이름. */
export const TOOL_LABELS: Record<string, string> = {
  list_rooms: "방 목록 보기", list_devices: "기기 목록 보기", find_devices: "기기 찾기", get_state: "상태 확인", turn_on: "켜기", turn_off: "끄기",
  set_level: "밝기·음량 맞추기", set_climate: "냉난방 맞추기", set_covering: "커튼 맞추기", lock: "잠그기", unlock: "잠금 해제", start: "시작", stop: "정지",
  set_valve: "물 틀기·잠그기", find_objects: "물건 찾기", move_object: "물건 옮기기", add_object: "물건 더하기", remove_object: "물건 빼기",
  find_object_types: "종류 찾기", save_layout: "배치 저장", confirm: "승인 실행",
};

export const toolLabel = (tool: string) => TOOL_LABELS[tool] ?? tool;

/** 행동 대상: 기기 이름, 없으면 찾은 말·물건·종류. */
export function targetOf(a: AgentAction): string {
  if (a.deviceLabel) return a.deviceLabel;
  const args = a.args ?? {};
  if (typeof args.query === "string" && args.query) return `"${args.query}"`;
  for (const k of ["object_id", "type", "device_id"]) if (typeof args[k] === "string" && args[k]) return args[k] as string;
  return "";
}

export type ActionResult = "ok" | "wait" | "fail";

export function resultOf(a: AgentAction): ActionResult {
  if (a.needsConfirmation) return "wait";
  return a.ok ? "ok" : "fail";
}

export const RESULT_LABELS: Record<ActionResult, string> = { ok: "완료", wait: "승인 대기", fail: "실패" };

/** 결과 한 줄: 관찰, 없으면 도구 메시지·오류, 그것도 없으면 결과 이름. */
export const observedOf = (a: AgentAction) => a.observation ?? (a.ok ? a.message : a.error) ?? RESULT_LABELS[resultOf(a)];

/** 상태를 읽기만 하는 도구(단계 종류 「확인」). 나머지는 「행동」. */
const READ_TOOLS = new Set(["list_rooms", "list_devices", "find_devices", "get_state", "find_objects", "find_object_types"]);
export const stepKind = (tool: string) => (READ_TOOLS.has(tool) ? "확인" : "행동");

/** 관찰과 판단 카드 글. */
export const BRAIN_CARD = { ask: "관찰과 판단", watching: "관찰 중", wait: "대기", failed: "판단 실패" };

/** 관찰 흐름 기록 종류(줄의 mark) → 단계 이름. */
export const LOG_KIND: Record<BrainLog["type"], string> = {
  observe: "관찰", world_change: "변화", decision: "판단", execution: "실행", link: "연결", trigger: "판단 시점", reflection: "반성",
};

/** VLM 분석 없음 이유 → 글. */
export const VLM_MISSING: Record<VlmMissing, string> = {
  cap: "요청이 몰려 VLM 분석 없음", timeout: "시간 초과로 VLM 분석 없음", format: "형식 오류로 VLM 분석 없음", error: "호출 오류로 VLM 분석 없음",
};

/** YOLOX 분석 없음 이유 → 글. */
export const YOLO_MISSING: Record<YoloMissing, string> = { cap: "요청이 몰려 YOLOX·VLM 분석 없음", error: "감지 오류로 YOLOX 분석 없음" };

/** 실행 단계 → 판단 카드 알약 글. */
export const EXEC_LABEL: Record<ExecState, string> = { decided: "판단", planned: "계획", running: "실행 중", verifying: "결과 확인", done: "완료", failed: "실패" };
