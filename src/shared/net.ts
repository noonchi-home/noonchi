// 네트워크 도우미: Windows의 일시적 EFAULT("bad address in system call argument")를 견딘다.
// 이 PC(Windows 11, Node 22.15)에서 IPv4 bind/connect가 가끔 EFAULT로 실패했다. 순수 Node 스크립트로
// 127.0.0.1 listen(0)을 반복하면 300번에 5~44번, HTTP+fetch를 섞으면 2000번에 909번 났고, ::1·localhost는 0번이었다.
// 원인(Winsock을 가로채는 보안 프로그램 의심)은 확인하지 못했다. EFAULT일 때만 잠깐 뒤 다시 시도하고 다른 오류는 바로 던진다.
// 시험을 많이 함께 돌리면 EFAULT가 몇 번 이어서 나(listen 6번·connect 4번으로는 모자랐다) 12번까지, 간격은 50ms씩 늘려 300ms에서 멈춘다(모두 합쳐 약 2.5초).

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface RetryOptions {
  attempts?: number;
  log?: (msg: string) => void;
  /** 다시 해 보는 간격의 단위(ms, 기본 50). n번째 실패 뒤 min(n × baseMs, 6 × baseMs)를 쉰다. 시험이 줄인다. */
  baseMs?: number;
}

/** EFAULT일 때 다시 해 보는 기본 횟수(처음 포함). */
export const RETRY_ATTEMPTS = 12;
const waitFor = (attempt: number, base = 50) => Math.min(attempt, 6) * base;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorCode(e: unknown): { code?: string; syscall?: string } {
  const err = e as { code?: string; syscall?: string; cause?: { code?: string; syscall?: string } };
  return err?.cause?.code ? err.cause : (err ?? {});
}

/** server.listen(port, host)을 Promise로. EFAULT면 다시 시도한다(EADDRINUSE 등은 바로 던짐). */
export async function listenRetry(server: Server, port: number, host: string, opts: RetryOptions = {}): Promise<AddressInfo> {
  const attempts = opts.attempts ?? RETRY_ATTEMPTS;
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
      await sleep(waitFor(attempt, opts.baseMs));
    }
  }
}

/** fetch. 연결 단계(connect)의 EFAULT면 다시 보낸다(요청이 나가지 않았으므로 POST도 안전). */
export async function fetchRetry(
  input: string | URL,
  init: RequestInit = {},
  opts: RetryOptions & { fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const attempts = opts.attempts ?? RETRY_ATTEMPTS;
  const impl = opts.fetchImpl ?? fetch;
  for (let attempt = 1; ; attempt++) {
    try {
      return await impl(input, init);
    } catch (e) {
      const { code, syscall } = errorCode(e);
      if (code !== "EFAULT" || (syscall && syscall !== "connect") || attempt >= attempts) throw e;
      opts.log?.(`[net] ${String(input)} 연결 실패(EFAULT), ${attempt}번째 다시 시도`);
      await sleep(waitFor(attempt, opts.baseMs));
    }
  }
}

/** 이 PC 안에서만 닿는 주소인가: 127.0.0.0/8, localhost, ::1. 0.0.0.0·::(모든 주소)와 네트워크 주소는 아니다. */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return h === "localhost" || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h);
}
