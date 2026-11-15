// 서버 잠금: 런타임 폴더마다 OS가 하나만 허락하는 이름 있는 파이프(Windows \\.\pipe\twin-home-<해시>, Linux 추상 소켓).
// 서버는 DB를 열기 전에 그 이름으로 listen하고(같은 폴더의 두 번째 서버는 EADDRINUSE로 멈춘다), 프로세스가 죽으면 OS가 치운다.
// 서버 밖 명령(시연 준비)은 같은 이름에 connect해서 켜진 서버를 알아본다.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireServerLock, serverLockName, serverRunning, ServerLockError, type HeldServerLock } from "../src/server/lock.js";
import { startServer, type RunningServer } from "../src/server/start.js";

const dirs: string[] = [];
const servers: RunningServer[] = [];
const locks: HeldServerLock[] = [];
const kids: ReturnType<typeof spawn>[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "rt-lock-"));
  dirs.push(d);
  return d;
};
afterEach(async () => {
  for (const k of kids.splice(0)) k.kill("SIGKILL");
  while (servers.length) await servers.pop()!.close();
  while (locks.length) await locks.pop()!.release();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
const start = async (runtime: string, extra: Record<string, string> = {}) => {
  const srv = await startServer({ env: {
    HUB: "memory", PORT: "0", RUNTIME_DIR: runtime, REFLECT_AT: "off",
    VLM_BASE_URL: "http://127.0.0.1:9/v1", PAM_URL: "http://127.0.0.1:9", OPENAI_BASE_URL: "http://127.0.0.1:9/v1", ...extra,
  }, log: () => {} });
  servers.push(srv);
  return srv;
};
const hold = async (dir: string) => {
  const l = await acquireServerLock(dir);
  locks.push(l);
  return l;
};
const BUSY = /이 폴더를 쓰는 서버가 이미 있어요/;

describe("서버 잠금(런타임 폴더마다 OS 파이프 하나)", () => {
  it("이름은 런타임 폴더 절대 경로의 해시다: 같은 폴더는 같은 이름, 다른 폴더는 다른 이름", () => {
    const a = tempDir();
    const b = tempDir();
    expect(serverLockName(a)).toBe(serverLockName(join(a, ".")));
    expect(serverLockName(a)).not.toBe(serverLockName(b));
    if (process.platform === "win32") {
      expect(serverLockName(a)).toMatch(/^\\\\\.\\pipe\\twin-home-[0-9a-f]{16}$/);
      expect(serverLockName(a.toUpperCase())).toBe(serverLockName(a));
    } else if (process.platform === "linux") expect(serverLockName(a)).toMatch(/^\0twin-home-[0-9a-f]{16}$/);
  });

  it("같은 폴더를 두 번 잡으면 두 번째는 OS가 거절한다(EADDRINUSE → ServerLockError). 놓으면 바로 다시 잡는다. 잡혀 있는 동안만 serverRunning이 참이다", async () => {
    const dir = tempDir();
    expect(await serverRunning(dir)).toBe(false);
    const first = await hold(dir);
    const second = acquireServerLock(dir);
    await expect(second).rejects.toThrow(ServerLockError);
    await expect(second).rejects.toThrow(BUSY);
    expect(await serverRunning(dir)).toBe(true);
    await first.release();
    expect(await serverRunning(dir)).toBe(false);
    await hold(dir);
    expect(await serverRunning(dir)).toBe(true);
  });

  it("같은 폴더를 잡은 서버가 있으면 서버 시작을 DB를 열기 전에 멈춘다", async () => {
    const runtime = tempDir();
    await hold(runtime);
    await expect(start(runtime)).rejects.toThrow(BUSY);
    expect(existsSync(join(runtime, "noonchi.db"))).toBe(false);
  });

  it("같은 폴더의 두 번째 서버는 멈추고, 첫 서버를 끄면 바로 다시 뜬다. 다른 폴더 서버는 같이 뜬다. 런타임 폴더에 잠금 파일을 만들지 않는다", async () => {
    const runtime = tempDir();
    await start(runtime);
    await expect(start(runtime)).rejects.toThrow(BUSY);
    const other = await start(tempDir());
    expect(other.port).toBeGreaterThan(0);
    await servers.shift()!.close();
    expect(await serverRunning(runtime)).toBe(false);
    await start(runtime);
    expect(await serverRunning(runtime)).toBe(true);
    expect(readdirSync(runtime).filter((n) => /lock/i.test(n))).toEqual([]);
  }, 60_000);

  it("시작이 실패하면 잠금을 놓는다", async () => {
    const runtime = tempDir();
    await expect(start(runtime, { HOME_ID: "no_such_home" })).rejects.toThrow(/없는 집입니다/);
    expect(await serverRunning(runtime)).toBe(false);
  }, 60_000);

  it("서버 프로세스를 강제 종료해도 남은 잠금이 없어 같은 폴더로 바로 다시 뜬다", async () => {
    const runtime = tempDir();
    const kid = spawn(process.execPath, ["--import", "tsx", join("tests", "helpers", "server-child.ts"), runtime], { stdio: ["ignore", "pipe", "inherit"] });
    kids.push(kid);
    await new Promise<void>((ok, fail) => {
      let out = "";
      kid.stdout!.on("data", (d) => { out += String(d); if (/up \d+/.test(out)) ok(); });
      kid.once("exit", (code) => fail(new Error(`자식 서버가 끝났어요(${code}): ${out}`)));
    });
    expect(await serverRunning(runtime)).toBe(true);
    await expect(start(runtime)).rejects.toThrow(BUSY);
    kid.kill("SIGKILL");
    await new Promise((ok) => kid.once("exit", ok));
    expect(await serverRunning(runtime)).toBe(false);
    await start(runtime);
  }, 90_000);
});
