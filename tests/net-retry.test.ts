// 이 PC의 Windows는 127.0.0.1 listen·connect가 가끔 EFAULT로 실패하고, 시험을 많이 함께 돌리면 몇 번 이어서 난다(src/server/net.ts).
// 서버 listen·fetch·시험 소켓 열기는 EFAULT가 여러 번 이어져도 다시 해 끝내 붙는다. 다른 오류는 바로 던진다.
// 시험 파일은 소켓을 helpers/ws.ts(openWebSocket·openPhone)로만 연다: 직접 new WebSocket(...)으로 열면 EFAULT를 다시 해 보지 않아 가끔 깨진다.
import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchRetry, listenRetry } from "../src/server/net.js";

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

describe("시험 소켓은 helpers/ws.ts로 연다", () => {
  it("tests/*.ts에 직접 new WebSocket(...)이 없다(거절을 보는 시험은 `시험 소켓: 거절 확인` 표시를 단다)", () => {
    const dir = join(import.meta.dirname);
    const bad = readdirSync(dir).filter((f) => f.endsWith(".ts")).flatMap((f) =>
      readFileSync(join(dir, f), "utf8").split(/\r?\n/).flatMap((line, i) =>
        /new WebSocket\(/.test(line) && !/시험 소켓: 거절 확인/.test(line) && f !== "net-retry.test.ts" ? [`tests/${f}:${i + 1}`] : []));
    expect(bad).toEqual([]);
  });
});
