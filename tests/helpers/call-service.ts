// 시험용 전화 서비스 자리(CALL_SERVICE_URL에 붙는 가짜 HTTP 서버): 받은 요청(방법·경로·content-type·JSON 본문)을 기록하고 정한 HTTP 상태로 답한다.
// 서버의 외부 연락 통로(src/infer/call-service.ts)는 실제 전화 서비스와 같은 길로 이 주소에 보낸다.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { listenRetry } from "../../src/shared/net.js";

export interface CallServiceRequest { method: string; path: string; contentType: string | undefined; body: any }
export interface FakeCallService {
  /** CALL_SERVICE_URL로 넣을 주소(경로 /calls까지). */
  url: string;
  requests: CallServiceRequest[];
  /** 답할 HTTP 상태(기본 200). 시험 중에 바꾼다. */
  status: number;
  close(): Promise<void>;
}

export async function startFakeCallService(status = 200): Promise<FakeCallService> {
  const requests: CallServiceRequest[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    requests.push({ method: req.method ?? "", path: req.url ?? "", contentType: req.headers["content-type"], body: raw ? JSON.parse(raw) : null });
    res.writeHead(out.status, { "content-type": "application/json" });
    res.end(JSON.stringify(out.status < 300 ? { accepted: true } : { error: "시험 오류" }));
  });
  const addr: AddressInfo = await listenRetry(server, 0, "127.0.0.1");
  const out: FakeCallService = {
    url: `http://127.0.0.1:${addr.port}/calls`, requests, status,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
  return out;
}
