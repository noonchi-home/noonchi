import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquire, alive, cmdLine, killTree, withHeavy } from "../scripts/twin3d/heavy.js";
import { runHeavy } from "../scripts/twin3d/run-heavy.js";

const dir = () => mkdtempSync(join(tmpdir(), "heavy-"));
const win = process.platform === "win32";
const COMSPEC = process.env.ComSpec ?? "cmd.exe";
const hourAgo = () => new Date(Date.now() - 3600_000).toISOString();
const waitDead = async (pid: number) => { for (let i = 0; i < 30 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100)); };
/** 60초 동안 도는 명령 창(cmd.exe → ping.exe) */
const cmdChild = () => spawn(COMSPEC, ["/d", "/c", "ping -n 60 127.0.0.1"], { stdio: "ignore", windowsHide: true });
const nodeChild = () => spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });

describe("무거운 일 잠금", () => {
  it("하나가 잡고 있으면 둘째는 막힌다", () => {
    const path = join(dir(), "lock");
    const lock = acquire("npm test", path);
    expect(() => acquire("vite build", path)).toThrow("다른 무거운 일이 돌고 있어요: npm test");
    lock.release();
    expect(existsSync(path)).toBe(false);
  }, 20_000);
  it("note는 pid와 적은 때를 잠금에 더하고, 앞서 적은 것을 지우지 않는다", () => {
    const path = join(dir(), "lock");
    const lock = acquire("capture", path);
    lock.note({ chromePid: 1234 });
    lock.note({ childPid: 5678 });
    const held = JSON.parse(readFileSync(path, "utf8"));
    expect(held).toMatchObject({ name: "capture", pid: process.pid, chromePid: 1234, childPid: 5678 });
    expect([held.chromePidAt, held.childPidAt].every((t: string) => Math.abs(Date.parse(t) - Date.now()) < 5000)).toBe(true);
    lock.release();
  });
  it("withHeavy는 일이 끝나거나 오류가 나도 잠금을 푼다", async () => {
    const path = join(dir(), "lock");
    await expect(withHeavy("boom", async () => { expect(existsSync(path)).toBe(true); throw new Error("boom"); }, path)).rejects.toThrow("boom");
    expect(existsSync(path)).toBe(false);
    expect(await withHeavy("ok", async (lock) => { lock.note({ chromePid: 42 }); return JSON.parse(readFileSync(path, "utf8")).chromePid; }, path)).toBe(42);
    expect(existsSync(path)).toBe(false);
  });
  it.runIf(win)("끝난 프로세스가 남긴 잠금은 치우고, 그때 띄운 자식 트리를 끝낸다", async () => {
    const path = join(dir(), "lock");
    const child = cmdChild();
    writeFileSync(path, JSON.stringify({ name: "old", pid: 99999999, at: new Date(Date.now() - 5000).toISOString(), childPid: child.pid, childPidAt: new Date().toISOString() }));
    const lock = acquire("capture", path);
    await waitDead(child.pid!);
    expect(alive(child.pid!)).toBe(false);
    lock.release();
  }, 20_000);
  it.runIf(win)("적힌 pid가 그때 띄운 프로세스가 아니면 끄지 않는다: 실행 파일이 다르거나 적은 때보다 늦게 시작", async () => {
    const path = join(dir(), "lock");
    const notChrome = nodeChild();
    const later = cmdChild();
    writeFileSync(path, JSON.stringify({ name: "old", pid: 99999999, at: hourAgo(), chromePid: notChrome.pid, chromePidAt: new Date().toISOString(), childPid: later.pid, childPidAt: hourAgo() }));
    const lock = acquire("capture", path);
    await new Promise((r) => setTimeout(r, 300));
    expect([alive(notChrome.pid!), alive(later.pid!)]).toEqual([true, true]);
    lock.release();
    killTree(notChrome.pid!); killTree(later.pid!);
  }, 30_000);
  it.runIf(win)("잠금 주인 pid를 그 뒤에 시작한 다른 프로세스가 쓰고 있으면 죽은 잠금으로 보고, 그 프로세스는 끄지 않는다", () => {
    const path = join(dir(), "lock");
    const other = nodeChild();
    writeFileSync(path, JSON.stringify({ name: "old", pid: other.pid, at: hourAgo() }));
    const lock = acquire("capture", path);
    expect(alive(other.pid!)).toBe(true);
    lock.release();
    killTree(other.pid!);
  }, 20_000);
});

describe("npm run heavy", () => {
  it("cmd.exe 한 줄: 띄어쓰기·&가 든 인자는 따옴표로", () => {
    expect(cmdLine(["uv", "run", "pytest", "-m", "not blender", "-q"])).toBe('uv run pytest -m "not blender" -q');
    expect(cmdLine(["x", "a&b"])).toBe('x "a&b"');
  });
  it.runIf(win)("기본으로 부른 폴더(INIT_CWD)에서 돌고, 인자가 그대로 가고, 자식 pid를 잠금에 적고, 끝나면 잠금을 푼다", async () => {
    const d = dir();
    const out = join(d, "out.json");
    const lockPath = join(d, "lock");
    const script = "const fs = require('fs'); fs.writeFileSync(process.argv[1], JSON.stringify({ cwd: process.cwd(), ppid: process.ppid, lock: JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), args: process.argv.slice(3) }))";
    const saved = process.env.INIT_CWD;
    process.env.INIT_CWD = d;
    let code: number;
    try { code = await runHeavy([process.execPath, "-e", script, out, lockPath, "not blender", "a&b"], undefined, lockPath); } finally {
      if (saved === undefined) delete process.env.INIT_CWD; else process.env.INIT_CWD = saved;
    }
    expect(code).toBe(0);
    const got = JSON.parse(readFileSync(out, "utf8"));
    expect([realpathSync(got.cwd), got.args]).toEqual([realpathSync(d), ["not blender", "a&b"]]);
    expect(got.lock.childPid).toBe(got.ppid);
    expect(existsSync(lockPath)).toBe(false);
  }, 20_000);
  it.runIf(win)("명령의 끝 코드를 돌려주고, 실패해도 잠금을 푼다", async () => {
    const d = dir();
    const lockPath = join(d, "lock");
    expect(await runHeavy([process.execPath, "-e", "process.exit(3)"], d, lockPath)).toBe(3);
    expect(existsSync(lockPath)).toBe(false);
  }, 20_000);
});
