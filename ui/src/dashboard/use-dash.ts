import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { EMPTY_DASH, reduceDash, type DashData } from "./data";
import { createSeenStore } from "./masks";

type DashEvent = { type: "message"; message: ServerMessage; now: number } | { type: "load"; messages: ServerMessage[]; now: number };

function dashEvent(s: DashData, e: DashEvent): DashData {
  if (e.type === "load") return e.messages.reduce((x, m) => reduceDash(x, m, e.now), EMPTY_DASH);
  return reduceDash(s, e.message, e.now);
}

/**
 * 대시보드 자료(data.ts reduceDash)와 물체 모양 저장소(masks.ts). onMessage는 /events 메시지 하나, load는 메시지 묶음 하나를 처음부터 넣는다(가짜 단계 순간).
 * seen 메시지는 초당 10번 오므로 리듀서에 넣지 않고 저장소에만 둔다: 대시보드 폰 칸의 마스크 층만 다시 그린다.
 * 저장소는 seen이 600ms 넘게 안 오면 비운다. hold면 비우지 않는다(가짜 단계). hello(다시 접속)면 바로 비운다.
 */
export function useDash({ hold = false }: { hold?: boolean } = {}) {
  const [dash, dispatch] = useReducer(dashEvent, EMPTY_DASH);
  const seen = useMemo(() => createSeenStore({ hold }), [hold]);
  useEffect(() => () => seen.clear(), [seen]);
  const onMessage = useCallback((message: ServerMessage) => {
    if (message.type === "seen") {
      seen.set(message);
      return;
    }
    if (message.type === "hello") seen.clear();
    dispatch({ type: "message", message, now: Date.now() });
  }, [seen]);
  const load = useCallback((messages: ServerMessage[]) => {
    const last = [...messages].reverse().find((m) => m.type === "seen");
    if (last?.type === "seen") seen.set(last);
    else seen.clear();
    dispatch({ type: "load", messages: messages.filter((m) => m.type !== "seen"), now: Date.now() });
  }, [seen]);
  return { dash, seen, onMessage, load };
}
