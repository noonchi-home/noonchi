import { useCallback, useEffect, useReducer } from "react";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { checksReducer, EMPTY_CHECKS } from "./checks";

/** 확인 목록 상태. 서버 메시지는 대시보드의 /events 하나에서 onMessage로 받는다. 두뇌 줄이 있는 동안만 1초마다 시간을 센다. */
export function useChecks() {
  const [checks, dispatch] = useReducer(checksReducer, EMPTY_CHECKS);
  const onMessage = useCallback((message: ServerMessage) => dispatch({ type: "message", message, now: Date.now() }), []);
  const ask = useCallback(() => dispatch({ type: "ask", now: Date.now() }), []);
  const watching = checks.brainAt !== null;
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => dispatch({ type: "tick", now: Date.now() }), 1000);
    return () => clearInterval(timer);
  }, [watching]);
  return { checks, onMessage, ask };
}
