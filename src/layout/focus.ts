// 초점: 클로이드가 방금 다룬 물건(에이전트 도구가 성공했거나 승인을 기다리는 대상). 대시보드 3D·폰 화면에 고리로 보인다.
// 화면 표시 전용이다(엔진 입력 아님).

import type { AgentAction } from "../agent/agent.js";
import type { FocusTarget } from "../phone/server.js";

export const FOCUS_TTL_MS = 8000;
const MAX_TARGETS = 6;

export interface Focus {
  targets: FocusTarget[];
  at: string;
  ttl_ms: number;
}

/** 도구 결과의 대상 id를 순서대로 한 번씩. 위치를 모르는 것(지운 물건 등)은 뺀다. */
export function focusFromActions(actions: AgentAction[], locate: (id: string) => FocusTarget | undefined): FocusTarget[] {
  const out: FocusTarget[] = [];
  for (const a of actions) {
    if (!a.deviceId || (!a.ok && !a.needsConfirmation) || out.some((t) => t.id === a.deviceId)) continue;
    const t = locate(a.deviceId);
    if (t) out.push(t);
    if (out.length >= MAX_TARGETS) break;
  }
  return out;
}
