// 이 PC의 Windows는 127.0.0.1 listen·connect가 가끔 EFAULT로 실패하고, 시험을 많이 함께 돌리면 몇 번 이어서 난다(src/shared/net.ts).
// 서버 listen·fetch·시험 소켓 열기는 EFAULT가 여러 번 이어져도 다시 해 끝내 붙는다. 다른 오류는 바로 던진다.
// 시험 파일은 소켓을 helpers/ws.ts(openWebSocket·openPhone)로만 연다: 직접 new WebSocket(...)으로 열면 EFAULT를 다시 해 보지 않아 가끔 깨진다.
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { fetchRetry, listenRetry } from "../src/shared/net.js";
import { openWebSocket } from "./helpers/ws.js";

const efault = (syscall: string) => Object.assign(new Error(`${syscall} EFAULT: bad address in system call argument 127.0.0.1`), { code: "EFAULT", syscall });

/** listen이 앞 n번은 EFAULT를 내고 그다음에 붙는 가짜 서버. */
function flakyServer(n: number) {
  const s = new EventEmitter() as EventEmitter & { calls: number };
  s.calls = 0;
  Object.assign(s, {
    listen(_port: number, _host: string, cb: () => void) {
      s.calls++;
      if (s.calls <= n) setImmediate(() => s.emit("error", efault("listen")));
      else setImmediate(cb);
    },
    address: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }),
  });
  return s as unknown as Server & { calls: number };
}

describe("EFAULT를 견딘다", () => {
  it("listen: EFAULT가 9번 이어져도 다시 해 붙는다", async () => {
    const s = flakyServer(9);
    await expect(listenRetry(s, 0, "127.0.0.1", { baseMs: 1 })).resolves.toMatchObject({ port: 5000 });
    expect(s.calls).toBe(10);
  });

  it("listen: 다른 오류(EADDRINUSE)는 바로 던진다", async () => {
    const s = new EventEmitter() as EventEmitter & Server;
    let calls = 0;
    Object.assign(s, { listen() { calls++; setImmediate(() => s.emit("error", Object.assign(new Error("in use"), { code: "EADDRINUSE" }))); } });
    await expect(listenRetry(s, 0, "127.0.0.1", { baseMs: 1 })).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(calls).toBe(1);
  });

  it("fetch: 연결(connect) EFAULT가 7번 이어져도 다시 보내 받는다", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls <= 7) throw Object.assign(new TypeError("fetch failed"), { cause: efault("connect") });
      return new Response("ok");
    }) as typeof fetch;
    const r = await fetchRetry("http://127.0.0.1:1/x", {}, { fetchImpl, baseMs: 1 });
    expect(await r.text()).toBe("ok");
    expect(calls).toBe(8);
  });
});

describe("시험 소켓 다시 열기는 실패한 시도의 대기를 치운다", () => {
  it("첫 시도가 EFAULT로 실패하고 마지막 시도가 붙으면, 실패한 시도마다 setup이 건 대기(타이머)는 치워져 처리되지 않은 거절이 남지 않는다", async () => {
    // 서버도 저장소의 다시 해 보는 listen으로 띄운다(EFAULT가 나도 시험이 서버 띄우기에서 깨지지 않게)
    const http = createServer();
    const { port } = await listenRetry(http, 0, "127.0.0.1");
    const wss = new WebSocketServer({ server: http });
    wss.on("connection", (s) => s.send("hi"));
    const unhandled: unknown[] = [];
    const note = (e: unknown) => { unhandled.push(e); };
    process.on("unhandledRejection", note);
    try {
      // 시도마다: 소켓, 그 시도의 대기, 정리를 불렀는지
      const tries: { socket: WebSocket; got: Promise<string>; cleaned: boolean }[] = [];
      // 첫 시도는 시험이 만든 가짜 소켓이 연결 EFAULT를 낸다. 그다음은 실제 소켓이다(실제 EFAULT가 나도 다시 해 본다)
      const create = (url: string, options?: WebSocket.ClientOptions): WebSocket => {
        if (tries.length > 0) return new WebSocket(url, options);
        const fake = Object.assign(new EventEmitter(), { terminate() {} }) as unknown as WebSocket;
        setImmediate(() => fake.emit("error", efault("connect")));
        return fake;
      };
      const ws = await openWebSocket(`ws://127.0.0.1:${port}`, {
        create, attempts: 12,
        setup: (s) => {
          // 시험 소켓의 대기 모양(tests/phone-server.test.ts next): 오지 않으면 일정 시간 뒤 거절
          let timer: ReturnType<typeof setTimeout> | undefined;
          const got = new Promise<string>((ok, no) => {
            timer = setTimeout(() => no(new Error("메시지가 오지 않았습니다")), 150);
            s.once("message", (d) => { clearTimeout(timer); ok(String(d)); });
          });
          const t = { socket: s, got, cleaned: false };
          tries.push(t);
          return () => { t.cleaned = true; clearTimeout(timer); };
        },
      });
      // 첫 시도는 실패, 마지막 시도가 붙은 소켓이고, 실패한 시도는 모두 정리했다
      expect(tries.length).toBeGreaterThanOrEqual(2);
      expect(tries.at(-1)!.socket).toBe(ws);
      expect(tries.slice(0, -1).map((t) => t.cleaned)).toEqual(tries.slice(0, -1).map(() => true));
      expect(tries.at(-1)!.cleaned).toBe(false);
      expect(await tries.at(-1)!.got).toBe("hi");
      ws.close();
      // 실패한 시도의 타이머(150ms)가 지나도록 기다린다
      await new Promise((r) => setTimeout(r, 400));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", note);
      await new Promise<void>((ok) => wss.close(() => ok()));
      await new Promise<void>((ok) => http.close(() => ok()));
    }
  });
});

describe("시험 소켓은 helpers/ws.ts로 연다", () => {
  it("tests/*.ts에 직접 new WebSocket(...)이 없다(거절을 보는 시험은 `시험 소켓: 거절 확인` 표시를 단다)", () => {
    const dir = join(import.meta.dirname);
    const bad = readdirSync(dir).filter((f) => f.endsWith(".ts")).flatMap((f) =>
      readFileSync(join(dir, f), "utf8").split(/\r?\n/).flatMap((line, i) =>
        /new WebSocket\(/.test(line) && !/시험 소켓: 거절 확인/.test(line) && f !== "net-retry.test.ts" ? [`tests/${f}:${i + 1}`] : []));
    expect(bad).toEqual([]);
  });
});
