// 종료(src/server/shutdown.ts): SIGTERM·SIGINT를 받으면 서버를 한 번 닫고 끝낸다(docker stop, Ctrl+C).
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { installShutdown } from "../src/server/shutdown.js";

const fakeProc = () => Object.assign(new EventEmitter(), { exit: vi.fn() });

describe("종료", () => {
  it("SIGTERM이면 한 번만 닫고 0으로 끝낸다", async () => {
    const proc = fakeProc();
    const close = vi.fn(async () => {});
    const run = installShutdown(proc, close);
    proc.emit("SIGTERM");
    proc.emit("SIGTERM");
    await run();
    expect(close).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  it("닫기가 실패하면 1로 끝낸다", async () => {
    const proc = fakeProc();
    const lines: string[] = [];
    const run = installShutdown(proc, async () => { throw new Error("허브"); }, { log: (l) => lines.push(l) });
    proc.emit("SIGINT");
    await run();
    expect(proc.exit).toHaveBeenCalledWith(1);
    expect(lines).toContain("닫기 실패: 허브");
  });

  it("닫기가 제한 시간 안에 안 끝나면 1로 끝낸다", async () => {
    vi.useFakeTimers();
    try {
      const proc = fakeProc();
      const run = installShutdown(proc, () => new Promise(() => {}), { timeoutMs: 1000 });
      proc.emit("SIGTERM");
      await vi.advanceTimersByTimeAsync(1000);
      await run();
      expect(proc.exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.skipIf(process.platform === "win32")("실제 SIGTERM으로 서버가 0으로 끝난다", async () => {
    // 빈 임시 폴더에서 띄워 .env를 읽지 않게 한다
    const cwd = mkdtempSync(join(tmpdir(), "cwd-"));
    const main = fileURLToPath(new URL("../src/server/main.ts", import.meta.url));
    const tsx = pathToFileURL(fileURLToPath(new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url))).href;
    const child = spawn(process.execPath, ["--import", tsx, main], {
      cwd, env: { ...process.env, PORT: "0", HUB: "memory", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), PHONE_PORT: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise<void>((ok) => child.stdout!.on("data", (d) => { if (String(d).includes("서버:")) ok(); }));
    child.kill("SIGTERM");
    const code = await new Promise<number | null>((ok) => child.on("exit", ok));
    expect(code).toBe(0);
  }, 30_000);
});
