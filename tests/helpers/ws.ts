// 테스트용 WebSocket 열기. 이 PC의 Windows는 127.0.0.1 connect가 가끔 EFAULT로 실패해(src/server/net.ts) 다시 시도한다.
import WebSocket from "ws";

export interface OpenOptions {
  /** 시도마다 소켓을 만들자마자 부른다(open 전에 오는 메시지를 놓치지 않게 여기서 리스너를 단다). */
  setup?: (ws: WebSocket) => void;
  options?: WebSocket.ClientOptions;
  attempts?: number;
}

export async function openWebSocket(url: string, opts: OpenOptions = {}): Promise<WebSocket> {
  const attempts = opts.attempts ?? 5;
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
      await new Promise((r) => setTimeout(r, 50 * attempt));
    }
  }
}
