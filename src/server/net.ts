// 네트워크 도우미: Windows의 일시적 EFAULT("bad address in system call argument")를 견딘다.
// 이 PC(Windows 11, Node 22.15)에서 IPv4 bind/connect가 가끔 EFAULT로 실패했다. 순수 Node 스크립트로
// 127.0.0.1 listen(0)을 반복하면 300번에 5~44번, HTTP+fetch를 섞으면 2000번에 909번 났고, ::1·localhost는 0번이었다.
// 원인(Winsock을 가로채는 보안 프로그램 의심)은 확인하지 못했다. EFAULT일 때만 잠깐 뒤 다시 시도하고 다른 오류는 바로 던진다.

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface RetryOptions {
  attempts?: number;
  log?: (msg: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorCode(e: unknown): { code?: string; syscall?: string } {
  const err = e as { code?: string; syscall?: string; cause?: { code?: string; syscall?: string } };
  return err?.cause?.code ? err.cause : (err ?? {});
}

/** server.listen(port, host)을 Promise로. EFAULT면 다시 시도한다(EADDRINUSE 등은 바로 던짐). */
export async function listenRetry(server: Server, port: number, host: string, opts: RetryOptions = {}): Promise<AddressInfo> {
  const attempts = opts.attempts ?? 6;
  const once = () =>
    new Promise<AddressInfo>((resolve, reject) => {
      const fail = (e: Error) => reject(e);
      server.once("error", fail);
      server.listen(port, host, () => {
        server.off("error", fail);
        resolve(server.address() as AddressInfo);
      });
    });
  for (let attempt = 1; ; attempt++) {
    try {
      return await once();
    } catch (e) {
      if (errorCode(e).code !== "EFAULT" || attempt >= attempts) throw e;
      opts.log?.(`[server] listen ${host}:${port} 실패(EFAULT), ${attempt}번째 다시 시도`);
      await sleep(50 * attempt);
    }
  }
}

/** fetch. 연결 단계(connect)의 EFAULT면 다시 보낸다(요청이 나가지 않았으므로 POST도 안전). */
export async function fetchRetry(
  input: string | URL,
  init: RequestInit = {},
  opts: RetryOptions & { fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const attempts = opts.attempts ?? 4;
  const impl = opts.fetchImpl ?? fetch;
  for (let attempt = 1; ; attempt++) {
    try {
      return await impl(input, init);
    } catch (e) {
      const { code, syscall } = errorCode(e);
      if (code !== "EFAULT" || (syscall && syscall !== "connect") || attempt >= attempts) throw e;
      opts.log?.(`[net] ${String(input)} 연결 실패(EFAULT), ${attempt}번째 다시 시도`);
      await sleep(50 * attempt);
    }
  }
}
