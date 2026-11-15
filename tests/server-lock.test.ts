// 서버 잠금(RUNTIME_DIR/server.lock): 켜져 있는 동안 pid·포트를 두고 끌 때 지운다. 서버 밖 명령(시연 준비)이 그 폴더를 쓰는 서버를 알아본다.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { holdServerLock, liveServerLock, serverLockPath } from "../src/server/lock.js";
import { startServer } from "../src/server/start.js";

/** 끝난 프로세스의 pid(남은 잠금 흉내). */
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid!;

describe("서버 잠금", () => {
  it("서버가 켜지면 RUNTIME_DIR/server.lock에 pid·포트를 쓰고, 끄면 지운다", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "rt-lock-"));
    try {
      const srv = await startServer({ env: {
        HUB: "memory", PORT: "0", RUNTIME_DIR: runtime, REFLECT_AT: "off",
        VLM_BASE_URL: "http://127.0.0.1:9/v1", PAM_URL: "http://127.0.0.1:9", OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
      }, log: () => {} });
      try {
        expect(JSON.parse(readFileSync(serverLockPath(runtime), "utf8"))).toMatchObject({ pid: process.pid, port: srv.port });
        expect(liveServerLock(runtime)).toMatchObject({ pid: process.pid, port: srv.port });
      } finally {
        await srv.close();
      }
      expect(existsSync(serverLockPath(runtime))).toBe(false);
    } finally {
      rmSync(runtime, { recursive: true, force: true });
    }
  }, 60_000);

  it("pid가 죽은 잠금·없는 잠금·깨진 잠금은 살아 있는 잠금이 아니다", () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-lock-"));
    try {
      expect(liveServerLock(dir)).toBeNull();
      writeFileSync(serverLockPath(dir), JSON.stringify({ pid: deadPid(), port: 8200, at: "2026-11-15T00:00:00.000Z" }));
      expect(liveServerLock(dir)).toBeNull();
      writeFileSync(serverLockPath(dir), "{");
      expect(liveServerLock(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("풀기는 파일이 아직 그 서버 것일 때만 지운다(같은 폴더에 다른 서버가 덮어썼으면 둔다)", () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-lock-"));
    try {
      const first = holdServerLock(dir, 8200);
      const second = holdServerLock(dir, 8201);
      first();
      expect(liveServerLock(dir)).toMatchObject({ port: 8201 });
      second();
      expect(existsSync(serverLockPath(dir))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
