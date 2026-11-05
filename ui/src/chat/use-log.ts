import { useCallback, useReducer } from "react";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { turnsReducer } from "./turns";

/** 판단 기록 상태. 서버 메시지는 대시보드의 /events 하나에서 onMessage로 받는다. 대시보드는 아무것도 보내지 않는다. */
export function useLog() {
  const [turns, dispatch] = useReducer(turnsReducer, []);
  const onMessage = useCallback((m: ServerMessage) => dispatch(m), []);
  return { turns, onMessage };
}
