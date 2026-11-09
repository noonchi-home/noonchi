import { useCallback, useEffect, useReducer, useState } from "react";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { BOX_TTL_MS, EMPTY_DASH, liveBoxes, reduceDash, type DashData } from "./data";

type DashEvent = { type: "message"; message: ServerMessage; now: number } | { type: "load"; messages: ServerMessage[]; now: number };

function dashEvent(s: DashData, e: DashEvent): DashData {
  if (e.type === "load") return e.messages.reduce((x, m) => reduceDash(x, m, e.now), EMPTY_DASH);
  return reduceDash(s, e.message, e.now);
}

/**
 * 대시보드 자료(data.ts reduceDash). onMessage는 /events 메시지 하나, load는 메시지 묶음 하나를 처음부터 넣는다(가짜 단계 순간).
 * YOLO 상자가 보이는 동안만 1초마다 시간을 세서 BOX_TTL_MS가 지나면 상자를 내린다. hold면 상자를 내리지 않는다(가짜 단계).
 */
export function useDash({ hold = false }: { hold?: boolean } = {}) {
  const [dash, dispatch] = useReducer(dashEvent, EMPTY_DASH);
  const [now, setNow] = useState(() => Date.now());
  const onMessage = useCallback((message: ServerMessage) => dispatch({ type: "message", message, now: Date.now() }), []);
  const load = useCallback((messages: ServerMessage[]) => dispatch({ type: "load", messages, now: Date.now() }), []);
  const at = dash.boxes?.at ?? null;
  const live = at !== null && (hold || now - at <= BOX_TTL_MS);
  useEffect(() => {
    if (!live || hold) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live, hold, at]);
  const boxes = live && at !== null ? liveBoxes(dash, hold ? at : Math.max(now, at)) : [];
  return { dash, boxes, onMessage, load };
}
