// 서버 잠금: 런타임 폴더 안 파일(RUNTIME_DIR/server.lock.db)의 SQLite 배타 잠금(OS 파일 잠금).
// 서버는 기록 DB를 열기 전에 잡고(같은 폴더의 두 번째 서버·시연 준비가 쥔 동안에는 멈춘다), 프로세스가 죽으면 OS가 푼다.
// 같은 파일이면 정션·심볼릭 링크·대소문자가 다른 경로도 같은 잠금이다.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ServerLockError, acquireServerLock, serverLockPath, type HeldServerLock } from "../src/server/lock.js";
import { startServer, type RunningServer } from "../src/server/start.js";

const dirs: string[] = [];
const servers: RunningServer[] = [];
const locks: HeldServerLock[] = [];
const kids: ChildProcess[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "rt-lock-"));
  dirs.push(d);
  return d;
};
afterEach(async () => {
  // 자식 프로세스가 끝난 뒤에 폴더를 지운다(열린 파일이 남아 있으면 Windows는 지우지 못한다)
  for (const k of kids.splice(0)) {
    if (k.exitCode === null && k.signalCode === null) {
      const done = new Promise((ok) => k.once("exit", ok));
      k.kill("SIGKILL");
      await done;
    }
  }
  while (servers.length) await servers.pop()!.close();
  while (locks.length) locks.pop()!.release();
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
const hold = (dir: string) => {
  const l = acquireServerLock(dir);
  locks.push(l);
  return l;
};
/** 지금 그 폴더 잠금을 잡을 수 있는가(잡았다가 바로 놓는다). */
const free = (dir: string): boolean => {
  try {
    acquireServerLock(dir).release();
    return true;
  } catch (e) {
    if (e instanceof ServerLockError) return false;
    throw e;
  }
};
const BUSY = /이 폴더를 쓰는 서버가 이미 있어요/;

describe("서버 잠금(RUNTIME_DIR/server.lock.db 파일 잠금)", () => {
  it("같은 폴더를 두 번 잡으면 두 번째는 멈춘다. 놓으면 바로 다시 잡고, 잠금 파일이 남아도 남은 잠금이 아니다", () => {
    const dir = tempDir();
    const first = hold(dir);
    expect(() => acquireServerLock(dir)).toThrow(ServerLockError);
    expect(() => acquireServerLock(dir)).toThrow(BUSY);
    first.release();
    expect(existsSync(serverLockPath(dir))).toBe(true);
    expect(free(dir)).toBe(true);
  });

  it("다른 프로세스가 잠금 파일을 잠깐 읽는 중(SHARED)이면 곧 놓이니 잠깐 다시 해 보고 잡는다: 준비 명령 둘이 함께 잡으려 할 때 둘 다 멈추지 않는다", async () => {
    const dir = tempDir();
    acquireServerLock(dir).release();
    // 자식: 배타 잠금 방식으로 잠금 파일을 읽어 SHARED를 쥐고 「ready」를 찍은 뒤 120ms 뒤에 놓는다(함께 잡으려던 다른 준비 명령과 같은 모양)
    const code = `const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(${JSON.stringify(serverLockPath(dir))});
      db.exec("PRAGMA locking_mode=EXCLUSIVE; BEGIN; SELECT count(*) FROM held;"); console.log("ready"); setTimeout(() => { db.close(); process.exit(0); }, 120);`;
    const kid = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "inherit"] });
    kids.push(kid);
    await new Promise<void>((ok) => kid.stdout!.on("data", (d) => { if (String(d).includes("ready")) ok(); }));
    const held = acquireServerLock(dir);
    locks.push(held);
    expect(free(dir)).toBe(false);
  });

  it("정션(심볼릭 링크)·대소문자가 다른 경로로 열어도 같은 잠금이다", () => {
    const dir = tempDir();
    hold(dir);
    const link = `${dir}-link`;
    symlinkSync(dir, link, process.platform === "win32" ? "junction" : "dir");
    dirs.push(link);
    expect(free(link)).toBe(false);
    if (process.platform === "win32") expect(free(dir.toUpperCase())).toBe(false);
  });

  it("잠금이 잡혀 있으면(시연 준비가 쥔 동안) 서버 시작을 기록 DB를 열기 전에 멈춘다", async () => {
    const runtime = tempDir();
    hold(runtime);
    await expect(start(runtime)).rejects.toThrow(BUSY);
    expect(existsSync(join(runtime, "noonchi.db"))).toBe(false);
  });

  it("같은 폴더의 두 번째 서버는 멈추고, 첫 서버를 끄면 바로 다시 뜬다. 다른 폴더 서버는 같이 뜬다", async () => {
    const runtime = tempDir();
    await start(runtime);
    await expect(start(runtime)).rejects.toThrow(BUSY);
    expect((await start(tempDir())).port).toBeGreaterThan(0);
    await servers.shift()!.close();
    expect(free(runtime)).toBe(true);
    await start(runtime);
    expect(free(runtime)).toBe(false);
  }, 60_000);

  it("시작이 실패하면 잠금을 놓는다", async () => {
    const runtime = tempDir();
    await expect(start(runtime, { HOME_ID: "no_such_home" })).rejects.toThrow(/없는 집입니다/);
    expect(free(runtime)).toBe(true);
  }, 60_000);

  it("서버 프로세스를 강제 종료해도 OS가 잠금을 풀어 같은 폴더로 바로 다시 뜬다", async () => {
    const runtime = tempDir();
    const kid = spawn(process.execPath, ["--import", "tsx", join("tests", "helpers", "server-child.ts"), runtime], { stdio: ["ignore", "pipe", "inherit"] });
    kids.push(kid);
    await new Promise<void>((ok, fail) => {
      let out = "";
      kid.stdout!.on("data", (d) => { out += String(d); if (/up \d+/.test(out)) ok(); });
      kid.once("exit", (code) => fail(new Error(`자식 서버가 끝났어요(${code}): ${out}`)));
    });
    expect(free(runtime)).toBe(false);
    await expect(start(runtime)).rejects.toThrow(BUSY);
    const exited = new Promise((ok) => kid.once("exit", ok));
    kid.kill("SIGKILL");
    await exited;
    expect(free(runtime)).toBe(true);
    await start(runtime);
  }, 90_000);
});
