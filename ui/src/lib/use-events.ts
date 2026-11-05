import { useEffect, useRef } from "react";
import type { ServerMessage } from "../../../src/contract/events.ts";
import { parseMessage } from "./messages";

/** /events에 붙어 메시지마다 onMessage를 부른다. 끊기면 2초 뒤 다시 붙는다. */
export function useEvents(onMessage: (m: ServerMessage) => void, onOpen?: (open: boolean) => void) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/events`);
      ws.onopen = () => onOpen?.(true);
      ws.onmessage = (e) => { const m = parseMessage(String(e.data)); if (m) handler.current(m); };
      ws.onclose = () => { onOpen?.(false); if (!closed) timer = setTimeout(connect, 2000); };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }, [onOpen]);
}
