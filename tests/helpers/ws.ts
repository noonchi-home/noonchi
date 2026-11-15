// 테스트용 WebSocket 열기. 이 PC의 Windows는 127.0.0.1 connect가 가끔 EFAULT로 실패해(src/server/net.ts) 다시 시도한다.
// openPhone: 이 저장소 빌드의 폰 페이지처럼 열리자마자 판본 hello를 보낸다(src/phone/server.ts: hello가 없으면 옛 탭으로 둔다).
// heardAtOf: 받은 메시지로 지금 폰 명령 줄을 따라가 말의 at(HeardAt)을 만든다(새 폰이 말할 때 싣는 것과 같다).
import WebSocket from "ws";
import { RETRY_ATTEMPTS } from "../../src/server/net.js";
import type { HeardAt } from "../../src/contract/phone.js";
import { PHONE_PROTOCOL } from "../../src/phone/protocol.js";

export interface OpenOptions {
  /** 시도마다 소켓을 만들자마자 부른다(open 전에 오는 메시지를 놓치지 않게 여기서 리스너를 단다). */
  setup?: (ws: WebSocket) => void;
  options?: WebSocket.ClientOptions;
  attempts?: number;
}

export async function openWebSocket(url: string, opts: OpenOptions = {}): Promise<WebSocket> {
  const attempts = opts.attempts ?? RETRY_ATTEMPTS;
  for (let attempt = 1; ; attempt++) {
    const ws = new WebSocket(url, opts.options);
    opts.setup?.(ws);
    try {
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
      });
      return ws;
    } catch (e) {
      ws.terminate();
      if ((e as { code?: string }).code !== "EFAULT" || attempt >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 50 * Math.min(attempt, 6)));
    }
  }
}

/** 폰 소켓을 열고 바로 판본 hello를 보낸다(새 폰 페이지와 같다). */
export async function openPhone(url: string, opts: OpenOptions = {}): Promise<WebSocket> {
  const ws = await openWebSocket(url, opts);
  ws.send(JSON.stringify({ type: "hello", protocol: PHONE_PROTOCOL }));
  return ws;
}

/** 받은 명령 메시지(command·command_clear)를 차례로 따라간 지금 명령 줄 → 말의 at. pending: 승인 대기 목록에 보인 token들. */
export function heardAtOf(messages: readonly object[], pending: string[] = []): HeardAt {
  let cur: { id: string; step: string } | null = null;
  for (const raw of messages) {
    const m = raw as { type?: unknown; id?: unknown; step?: unknown };
    if (m.type === "command" && typeof m.id === "string" && typeof m.step === "string") cur = { id: m.id, step: m.step };
    else if (m.type === "command_clear" && (m.id === undefined || m.id === cur?.id)) cur = null;
  }
  return cur ? { kind: "command", ...cur, pending } : { kind: "none", pending };
}
