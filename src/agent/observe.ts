// 관찰 문장: 도구 결과를 화면의 추론 과정(ReAct: 생각 → 행동 → 관찰)에 보일 한 줄로 줄인다. 모델이 아니라 결과에서 만든다.

import type { DeviceKind } from "../hub/types.js";
import { stateText } from "./phrases.js";
import type { ToolResult } from "./tools.js";

type Named = { label?: string; roomLabel?: string };

const listOf = (items: Named[], empty: string, max = 5) =>
  items.length === 0 ? empty : items.slice(0, max).map((d) => (d.roomLabel ? `${d.label} · ${d.roomLabel}` : String(d.label))).join(", ") + (items.length > max ? ` 외 ${items.length - max}개` : "");

const at = (d: Named & { position?: [number, number] }) =>
  `${d.label} → ${d.roomLabel ?? ""}${d.position ? ` (${d.position[0].toFixed(2)}, ${d.position[1].toFixed(2)})` : ""}`;

export function observe(tool: string, r: ToolResult): string {
  const approval = r.needsConfirmation?.reason ?? r.pendingApproval?.reason;
  if (approval) return `승인 대기 · ${approval}`;
  if (!r.ok) return `실패 · ${r.error ?? "알 수 없는 오류"}`;
  const data = r.data as Record<string, unknown> | Named[] | undefined;
  switch (tool) {
    case "find_devices":
      return listOf(((data as { devices?: Named[] })?.devices ?? []), "찾은 기기 없음");
    case "list_devices":
      return `기기 ${(data as Named[] | undefined)?.length ?? 0}개`;
    case "list_rooms":
      return listOf((data as Named[] | undefined) ?? [], "방 없음", 8);
    case "get_state": {
      const d = data as { label?: string; kind?: DeviceKind; state?: Record<string, unknown>; matter?: Record<string, unknown> } | undefined;
      return d?.kind ? `${d.label}: ${stateText({ kind: d.kind }, { twin: d.state ?? {}, matter: d.matter ?? {} })}` : (r.message ?? "확인함");
    }
    case "find_objects":
      return listOf((data as Named[] | undefined) ?? [], "찾은 물건 없음");
    case "find_object_types":
      return listOf((data as Named[] | undefined) ?? [], "찾은 종류 없음");
    case "move_object":
    case "add_object":
      return at(data as Named & { position?: [number, number] });
    case "save_layout":
      return `수정본 ${(data as { count?: number } | undefined)?.count ?? 0}건 저장`;
    default:
      return r.message ?? "완료";
  }
}
