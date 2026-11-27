// 서버 밖(대시보드 WebSocket)으로 보내는 반성 사건. 모델이 쓴 글(화살표 사건·조건 on·when, 뺀 후보의 조건, 거절 까닭 rejected, 그 까닭·오류가 든 글 text)은 뺀다.
// 기록 DB에는 그대로 남는다(다음 밤 반성과 GET /api/reflection/:day가 서버 안에서 읽는다).
import type { BrainLog } from "../../contract/events.js";
import { REFLECT_TEXT } from "./labels.js";

type Reflection = Extract<BrainLog, { type: "reflection" }>;

/** 코드가 쓴 실패 글(그대로 보낸다). 나머지 실패 글은 까닭이 모델·연결 오류 글이라 고정 글로 바꾼다. */
const FIXED_FAILS = new Set([REFLECT_TEXT.failed(REFLECT_TEXT.empty), REFLECT_TEXT.failed(REFLECT_TEXT.tooBig), REFLECT_TEXT.failed(REFLECT_TEXT.cancelled)]);
const edge = ({ from, to, action }: { from: string; to: string; action: string }) => ({ from, to, action });

export function publicReflection(e: Reflection): Reflection {
  const text = e.ok ? e.text : e.rejected ? REFLECT_TEXT.notUsed : FIXED_FAILS.has(e.text) ? e.text : REFLECT_TEXT.failedPlain;
  return {
    type: "reflection", at_ms: e.at_ms, day: e.day, ok: e.ok, version: e.version, applies_day: e.applies_day, text,
    ...(e.usage ? { usage: e.usage } : {}),
    ...(e.learned ? { learned: e.learned.map(edge) } : {}),
    ...(e.active ? { active: e.active.map(edge) } : {}),
    ...(e.dropped ? { dropped: e.dropped.map(({ from, to, action, kept, reason, seen, fired, p }) => ({ from, to, action, kept, reason,
      ...(seen !== undefined ? { seen } : {}), ...(fired !== undefined ? { fired } : {}), ...(p !== undefined ? { p } : {}) })) } : {}),
    ...(e.checks ? { checks: e.checks.map(({ on: _on, when: _when, ...c }) => c) } : {}),
  };
}
