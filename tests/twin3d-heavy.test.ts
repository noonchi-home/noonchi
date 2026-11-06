import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquire, alive, cmdLine } from "../scripts/twin3d/heavy.js";
import { runHeavy } from "../scripts/twin3d/run-heavy.js";

const dir = () => mkdtempSync(join(tmpdir(), "heavy-"));

describe("무거운 일 잠금", () => {
  it("하나가 잡고 있으면 둘째는 막힌다", () => {
    const path = join(dir(), "lock");
    const lock = acquire("npm test", path);
    expect(() => acquire("vite build", path)).toThrow("다른 무거운 일이 돌고 있어요: npm test");
    lock.release();
    expect(existsSync(path)).toBe(false);
  });
  it("끝난 프로세스가 남긴 잠금은 치우고, 거기 적힌 크롬은 끝낸다", async () => {
    const path = join(dir(), "lock");
    const orphan = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    writeFileSync(path, JSON.stringify({ name: "old", pid: 99999999, chromePid: orphan.pid }));
    const lock = acquire("capture", path);
    for (let i = 0; i < 20 && alive(orphan.pid!); i++) await new Promise((r) => setTimeout(r, 100));
    expect(alive(orphan.pid!)).toBe(false);
    lock.release();
  });
});

describe("npm run heavy", () => {
  it("cmd.exe 한 줄: 띄어쓰기·&가 든 인자는 따옴표로", () => {
    expect(cmdLine(["uv", "run", "pytest", "-m", "not blender", "-q"])).toBe('uv run pytest -m "not blender" -q');
    expect(cmdLine(["x", "a&b"])).toBe('x "a&b"');
  });
  it.runIf(process.platform === "win32")("부른 폴더에서 돌고, 인자가 그대로 간다", () => {
    const d = dir();
    const out = join(d, "out.json");
    const code = runHeavy([process.execPath, "-e", "require('fs').writeFileSync(process.argv[1], JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }))", out, "not blender", "a&b"], d, join(d, "lock"));
    expect(code).toBe(0);
    const got = JSON.parse(readFileSync(out, "utf8"));
    expect([realpathSync(got.cwd), got.args]).toEqual([realpathSync(d), ["not blender", "a&b"]]);
  });
});
