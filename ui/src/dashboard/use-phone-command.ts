import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerMessage } from "../../../src/contract/events.ts";

/** 서버가 공개한 실제 폰 명령을 영상과 같은 지연으로 표시한다. */
export function usePhoneCommand() {
  const [command, setCommand] = useState<string | null>(null);
  const delay = useRef(0);
  const due = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const cancelPending = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current.clear();
    due.current = 0;
  }, []);
  useEffect(() => cancelPending, [cancelPending]);
  const reset = useCallback(() => {
    cancelPending();
    setCommand(null);
  }, [cancelPending]);
  const onDelay = useCallback((ms: number) => { delay.current = ms; }, []);
  const onMessage = useCallback((message: ServerMessage) => {
    if (message.type === "hello") return reset();
    if (message.type !== "phone_command") return;
    if (delay.current <= 0 && !timers.current.size) {
      setCommand(message.text);
      return;
    }
    // 지연이 줄어도 먼저 온 명령·해제를 새 명령이 앞지르지 않는다.
    const now = Date.now();
    due.current = Math.max(due.current, now + delay.current);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setCommand(message.text);
    }, due.current - now);
    timers.current.add(timer);
  }, [reset]);
  return { command, onMessage, onDelay, reset };
}
