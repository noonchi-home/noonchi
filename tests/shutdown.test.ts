// 종료(src/server/shutdown.ts): SIGTERM·SIGINT를 받으면 서버를 한 번 닫고 끝낸다(docker stop, Ctrl+C).
// NOONCHI_STDIN_CONTROL=1이면 표준 입력 shutdown 줄·표준 입력 끝으로도 같은 종료를 부른다(데스크톱 앱, Windows는 SIGTERM에 정리 없이 죽는다).
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { installShutdown, installStdinShutdown } from "../src/server/shutdown.js";

const fakeProc = () => Object.assign(new EventEmitter(), { exit: vi.fn() });
const main = fileURLToPath(new URL("../src/server/main.ts", import.meta.url));

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

  it("서버 줄(「서버:」)을 찍기 전에 종료 처리를 건다", () => {
    // 아래 실제 SIGTERM 시험은 이 줄을 보자마자 보낸다. 처리를 걸기 전에 오면 신호에 바로 죽는다(종료 코드 없음)
    const src = readFileSync(main, "utf8");
    const install = src.indexOf("installShutdown(process");
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(src.indexOf("서버: ${url}"));
  });

  describe("표준 입력 종료(NOONCHI_STDIN_CONTROL=1, 데스크톱 앱)", () => {
    const on = { NOONCHI_STDIN_CONTROL: "1" };
    const setup = (env: Record<string, string | undefined> = on) => {
      const proc = fakeProc();
      const close = vi.fn(async () => {});
      const input = new PassThrough();
      const run = installShutdown(proc, close);
      const reading = installStdinShutdown(input, run, env);
      return { proc, close, input, run, reading };
    };
    const settle = () => new Promise((r) => setTimeout(r, 20));

    it("shutdown 줄이면 한 번 닫고 0으로 끝낸다", async () => {
      const { proc, close, input, run } = setup();
      input.write("상태\r\nshutdown\r\n");
      await settle();
      await run();
      expect(close).toHaveBeenCalledTimes(1);
      expect(proc.exit).toHaveBeenCalledWith(0);
    });

    it("다른 줄로는 닫지 않는다", async () => {
      const { close, input } = setup();
      input.write("shut\nshutdownx\n");
      await settle();
      expect(close).not.toHaveBeenCalled();
    });

    it("표준 입력이 끝나면(실행기가 죽음) 한 번 닫는다", async () => {
      const { proc, close, input, run } = setup();
      input.end();
      await settle();
      await run();
      expect(close).toHaveBeenCalledTimes(1);
      expect(proc.exit).toHaveBeenCalledWith(0);
    });

    it("표준 입력 오류도 끝남으로 보고 한 번 닫는다", async () => {
      const { close, input, run } = setup();
      input.destroy(new Error("EPIPE"));
      await settle();
      await run();
      expect(close).toHaveBeenCalledTimes(1);
    });

    it("shutdown 줄과 표준 입력 끝이 겹쳐도 한 번만 닫는다", async () => {
      const { close, input, run } = setup();
      input.end("shutdown\nshutdown\n");
      await settle();
      await run();
      expect(close).toHaveBeenCalledTimes(1);
    });

    it("환경 변수가 없으면 표준 입력을 읽지 않는다", async () => {
      const { close, input, reading } = setup({});
      expect(reading).toBe(false);
      expect(input.listenerCount("data")).toBe(0);
      expect(input.readableFlowing).toBeNull();
      input.end("shutdown\n");
      await settle();
      expect(close).not.toHaveBeenCalled();
    });

    it("main.ts가 서버 줄 전에 표준 입력 종료를 건다", () => {
      const src = readFileSync(main, "utf8");
      const install = src.indexOf("installStdinShutdown(process.stdin");
      expect(install).toBeGreaterThan(-1);
      expect(install).toBeLessThan(src.indexOf("서버: ${url}"));
    });

    // Windows에서도 도는 실제 시험: 데스크톱 앱처럼 표준 입력으로 끈다
    it.each([
      ["shutdown 줄을 받으면", (stdin: NodeJS.WritableStream) => stdin.write("shutdown\n")],
      ["표준 입력이 끝나면", (stdin: NodeJS.WritableStream) => stdin.end()],
    ])("실제 서버가 %s 「종료하는 중…」을 찍고 0으로 끝난다", async (_name, stop) => {
      const cwd = mkdtempSync(join(tmpdir(), "cwd-"));
      const tsx = pathToFileURL(fileURLToPath(new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url))).href;
      const child = spawn(process.execPath, ["--import", tsx, main], {
        cwd, env: { ...process.env, PORT: "0", HUB: "memory", RUNTIME_DIR: mkdtempSync(join(tmpdir(), "rt-")), PHONE_PORT: "", REDIS_URL: "", NOONCHI_STDIN_CONTROL: "1" },
        stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      });
      let out = "";
      child.stdout!.on("data", (d) => { out += String(d); });
      await new Promise<void>((ok) => child.stdout!.on("data", () => { if (out.includes("서버:")) ok(); }));
      stop(child.stdin!);
      const code = await new Promise<number | null>((ok) => child.on("exit", ok));
      expect(out).toContain("종료하는 중…");
      expect(code).toBe(0);
    }, 60_000);
  });

  it.skipIf(process.platform === "win32")("실제 SIGTERM으로 서버가 0으로 끝난다", async () => {
    // 빈 임시 폴더에서 띄워 .env를 읽지 않게 한다
    const cwd = mkdtempSync(join(tmpdir(), "cwd-"));
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
