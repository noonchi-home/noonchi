import { useCallback, useReducer, useRef, useState } from "react";
import type { ChatResult, ConfirmResult, ServerMessage } from "../../../src/contract/events.ts";
import { api } from "../lib/api";
import { turnsReducer } from "./turns";

const KEY = "twin-home.session"; // web/app.js와 같은 저장 이름
const newId = () => (typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function loadSession(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
    const id = newId();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return newId();
  }
}

function saveSession(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // 저장소를 못 쓰면 이번 화면에서만 쓴다
  }
}

const OFFLINE = "서버에 연결하지 못했어요.";

/**
 * 대화 상태와 동작. 서버 메시지는 대시보드의 /events 하나에서 onMessage로 받는다.
 * 보내기: POST /api/agent/chat { message, sessionId }. 승인·취소: POST /api/agent/confirm|cancel { token }(web/app.js와 같음).
 */
export function useChat() {
  const [turns, dispatch] = useReducer(turnsReducer, []);
  const [sessionId, setSessionId] = useState(loadSession);
  const [restarted, setRestarted] = useState(false);
  const session = useRef(sessionId);
  session.current = sessionId;

  const onMessage = useCallback((message: ServerMessage) => dispatch({ type: "message", message, sessionId: session.current }), []);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message) return;
    const id = newId();
    dispatch({ type: "ask", id, source: "dashboard", text: message });
    try {
      const r = await api<Partial<ChatResult> & { error?: string }>("/api/agent/chat", { message, sessionId: session.current });
      const j = r.json;
      if (!j?.reply) dispatch({ type: "result", id, error: j?.error ?? "에이전트가 답하지 못했습니다." });
      else dispatch({ type: "result", id, reply: j.reply, actions: j.actions ?? [], pending: j.pendingConfirmations ?? [] });
    } catch {
      dispatch({ type: "result", id, error: OFFLINE });
    }
  }, []);

  const confirm = useCallback(async (token: string) => {
    dispatch({ type: "confirming", token });
    try {
      const r = await api<Partial<ConfirmResult>>("/api/agent/confirm", { token });
      dispatch({ type: "settle", token, ok: !!r.json?.ok, reply: r.json?.reply ?? r.json?.error ?? "" });
    } catch {
      dispatch({ type: "settle", token, ok: false, reply: OFFLINE });
    }
  }, []);

  const cancel = useCallback(async (token: string) => {
    try {
      const r = await api<{ ok?: boolean; reply?: string }>("/api/agent/cancel", { token });
      dispatch({ type: "settle", token, ok: false, reply: r.json?.reply ?? "취소했어요.", cancelled: true });
    } catch {
      dispatch({ type: "settle", token, ok: false, reply: OFFLINE });
    }
  }, []);

  const reset = useCallback(() => {
    const id = newId();
    saveSession(id);
    session.current = id;
    setSessionId(id);
    dispatch({ type: "reset" });
    setRestarted(true);
  }, []);

  const busy = turns.some((t) => t.source === "dashboard" && t.state === "busy");
  return { turns, busy, restarted, sessionId, onMessage, send, confirm, cancel, reset };
}

export type Chat = ReturnType<typeof useChat>;
