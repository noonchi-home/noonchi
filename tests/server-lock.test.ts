// 서버 잠금(RUNTIME_DIR/server.lock): DB를 열기 전에 배타적으로 만들고(같은 폴더의 두 번째 서버는 멈춘다), 뜨면 포트를 적고, 끌 때·시작이 실패할 때 지운다.
// 서버 밖 명령(시연 준비)이 그 폴더를 쓰는 서버를 알아본다. 주인 확인은 pid만이 아니라 잠금의 주소 /api/health가 같은 instance(token)를 주는지로 한다.
import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireServerLock, liveServerLock, serverLockPath, ServerLockError } from "../src/server/lock.js";
import { listenRetry } from "../src/server/net.js";
import { startServer, type RunningServer } from "../src/server/start.js";

/** 끝난 프로세스의 pid(남은 잠금 흉내). */
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid!;
const dirs: string[] = [];
const servers: RunningServer[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "rt-lock-"));
  dirs.push(d);
  return d;
};
const fakes: Server[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
  while (fakes.length) { const f = fakes.pop()!; f.closeAllConnections(); f.close(); }
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
const env = (runtime: string, extra: Record<string, string> = {}) => ({
  HUB: "memory", PORT: "0", RUNTIME_DIR: runtime, REFLECT_AT: "off",
  VLM_BASE_URL: "http://127.0.0.1:9/v1", PAM_URL: "http://127.0.0.1:9", OPENAI_BASE_URL: "http://127.0.0.1:9/v1", ...extra,
});
const start = async (runtime: string, extra: Record<string, string> = {}) => {
  const srv = await startServer({ env: env(runtime, extra), log: () => {} });
  servers.push(srv);
  return srv;
};
const readLock = (dir: string) => JSON.parse(readFileSync(serverLockPath(dir), "utf8")) as Record<string, unknown>;
/** /api/health에 답하는 가짜 서버(답 늦추기 delayMs). */
async function fakeHealth(body: unknown, delayMs = 0): Promise<{ url: string; port: number }> {
  const f = createServer((_req, res) => { setTimeout(() => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }, delayMs); });
  fakes.push(f);
  const { port } = await listenRetry(f, 0, "127.0.0.1");
  return { url: `http://127.0.0.1:${port}`, port };
}
/** 잠깐 열었다 닫은 포트(연결 거부). */
async function closedPort(): Promise<{ url: string; port: number }> {
  const f = createServer();
  const { port } = await listenRetry(f, 0, "127.0.0.1");
  await new Promise<void>((ok) => f.close(() => ok()));
  return { url: `http://127.0.0.1:${port}`, port };
}
const writeLock = (dir: string, lock: Record<string, unknown>) => writeFileSync(serverLockPath(dir), JSON.stringify({ pid: process.pid, token: "run-1", at: new Date().toISOString(), ...lock }));

describe("서버 잠금", () => {
  it("서버가 켜지면 RUNTIME_DIR/server.lock에 pid·포트를 쓰고, 끄면 지운다", async () => {
    const runtime = tempDir();
    const srv = await start(runtime);
    const lock = readLock(runtime);
    expect(lock).toMatchObject({ pid: process.pid, port: srv.port, url: srv.url });
    // /api/health가 잠금의 token을 instance로 준다
    expect(((await (await fetch(`${srv.url}/api/health`)).json()) as { instance: string }).instance).toBe(lock.token);
    expect(await liveServerLock(runtime)).toMatchObject({ pid: process.pid, port: srv.port });
    await servers.pop()!.close();
    expect(existsSync(serverLockPath(runtime))).toBe(false);
  }, 60_000);

  it("같은 폴더의 두 번째 서버는 시작을 멈추고 앞 서버의 잠금은 그대로다. 앞 서버를 끄면 다시 켤 수 있다", async () => {
    const runtime = tempDir();
    const first = await start(runtime);
    await expect(start(runtime)).rejects.toThrow(/이 폴더를 쓰는 서버가 이미 있어요/);
    expect(readLock(runtime)).toMatchObject({ pid: process.pid, port: first.port });
    await servers.pop()!.close();
    const again = await start(runtime);
    expect(readLock(runtime)).toMatchObject({ port: again.port });
  }, 60_000);

  it("살아 있는 서버의 잠금이 있으면 DB를 열기 전에 멈춘다", async () => {
    const runtime = tempDir();
    writeFileSync(serverLockPath(runtime), JSON.stringify({ pid: process.pid, token: "other", at: new Date().toISOString(), port: null }));
    await expect(start(runtime)).rejects.toThrow(/이 폴더를 쓰는 서버가 이미 있어요/);
    expect(existsSync(join(runtime, "noonchi.db"))).toBe(false);
  });

  it("시작이 실패하면 잠금을 지운다", async () => {
    const runtime = tempDir();
    await expect(start(runtime, { HOME_ID: "no_such_home" })).rejects.toThrow(/없는 집입니다/);
    expect(existsSync(serverLockPath(runtime))).toBe(false);
  }, 60_000);

  it("잡기는 배타적이다: 살아 있는 잠금이 있으면 멈추고, pid가 죽은 남은 잠금은 치우고 잡는다. 풀기는 자기 잠금일 때만 지운다", async () => {
    const dir = tempDir();
    const first = await acquireServerLock(dir);
    await expect(acquireServerLock(dir)).rejects.toThrow(ServerLockError);
    first.release();
    expect(existsSync(serverLockPath(dir))).toBe(false);
    writeFileSync(serverLockPath(dir), JSON.stringify({ pid: deadPid(), token: "old", at: "2026-11-15T00:00:00.000Z", port: 8200 }));
    const second = await acquireServerLock(dir);
    second.listening("http://127.0.0.1:8201", 8201);
    expect(readLock(dir)).toMatchObject({ pid: process.pid, port: 8201, url: "http://127.0.0.1:8201" });
    // 남이 덮어쓴 잠금은 지우지 않는다
    writeFileSync(serverLockPath(dir), JSON.stringify({ pid: process.pid, token: "someone-else", at: new Date().toISOString(), port: 8300 }));
    second.release();
    expect(readLock(dir)).toMatchObject({ token: "someone-else" });
  });

  it("pid가 죽은 잠금·없는 잠금·깨진 잠금은 살아 있는 잠금이 아니다", async () => {
    const dir = tempDir();
    expect(await liveServerLock(dir)).toBeNull();
    writeFileSync(serverLockPath(dir), JSON.stringify({ pid: deadPid(), token: "old", at: "2026-11-15T00:00:00.000Z", port: 8200 }));
    expect(await liveServerLock(dir)).toBeNull();
    writeFileSync(serverLockPath(dir), "{");
    expect(await liveServerLock(dir)).toBeNull();
  });

  it("pid가 살아 있어도 주인을 확인한다: 잠금 주소 /api/health가 같은 instance면 살아 있고, 다른 instance·instance 없음·연결 거부(pid를 다른 프로세스가 다시 씀)면 아니다. 답이 늦으면 켜져 있을 수 있어 살아 있다고 본다", async () => {
    const dir = tempDir();
    const same = await fakeHealth({ ok: true, instance: "run-1" });
    writeLock(dir, { port: same.port, url: same.url });
    expect(await liveServerLock(dir)).toMatchObject({ token: "run-1", port: same.port });
    const other = await fakeHealth({ ok: true, instance: "run-2" });
    writeLock(dir, { port: other.port, url: other.url });
    expect(await liveServerLock(dir)).toBeNull();
    const plain = await fakeHealth({ ok: true });
    writeLock(dir, { port: plain.port, url: plain.url });
    expect(await liveServerLock(dir)).toBeNull();
    const gone = await closedPort();
    writeLock(dir, { port: gone.port, url: gone.url });
    expect(await liveServerLock(dir)).toBeNull();
    const slow = await fakeHealth({ ok: true, instance: "other" }, 3000);
    writeLock(dir, { port: slow.port, url: slow.url });
    expect(await liveServerLock(dir)).toMatchObject({ port: slow.port });
  }, 20_000);

  it("뜨는 중(포트 없음) 잠금은 적은 지 5분 안일 때만 살아 있다", async () => {
    const dir = tempDir();
    writeLock(dir, { port: null, at: new Date().toISOString() });
    expect(await liveServerLock(dir)).toMatchObject({ port: null });
    writeLock(dir, { port: null, at: new Date(Date.now() - 6 * 60_000).toISOString() });
    expect(await liveServerLock(dir)).toBeNull();
  });

  it("pid를 다른 프로세스가 다시 쓴 남은 잠금(그 포트가 비었음)이 있어도 서버는 뜨고 잠금을 새로 쓴다", async () => {
    const runtime = tempDir();
    const gone = await closedPort();
    writeLock(runtime, { token: "old-run", port: gone.port, url: gone.url });
    const srv = await start(runtime);
    expect(readLock(runtime)).toMatchObject({ port: srv.port });
    expect(readLock(runtime).token).not.toBe("old-run");
  }, 60_000);
});
