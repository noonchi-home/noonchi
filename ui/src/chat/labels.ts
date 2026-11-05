import type { AgentAction, BrainState } from "../../../src/contract/events.ts";

/** 도구 이름 → 화면 이름(web/app.js TOOL_LABELS). */
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

/** 컵 두뇌 상태 → 화면 이름. */
export const BRAIN_STATE: Record<BrainState, string> = {
  watching: "지켜봄", in_use: "사용 중", away_check: "자리 비움 확인", requesting: "사진 요청", deciding: "판단 중", confirming: "재확인", acting: "모의 행동", done: "끝",
};
