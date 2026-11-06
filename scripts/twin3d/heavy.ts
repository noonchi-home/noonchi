// 무거운 일(3D 크롬·시험·빌드·Blender·변환)을 이 PC에서 한 번에 하나만 돌리는 잠금. 크롬 pid도 적어 두고, 죽은 잠금을 치울 때 남은 크롬을 끝낸다.
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const LOCK_PATH = join(tmpdir(), "twin3d-heavy.lock");
export interface Lock { release(): void; note(extra: { chromePid?: number }): void }
interface Held { name?: string; pid?: number; chromePid?: number; at?: string }

export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

export function killTree(pid: number): void {
  if (!(pid > 4) || !alive(pid)) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" });
  else try { process.kill(pid, "SIGKILL"); } catch { /* 이미 끝남 */ }
}

export function acquire(name: string, path = LOCK_PATH, pid = process.pid): Lock {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      const held: Held = { name, pid, at: new Date().toISOString() };
      writeSync(fd, JSON.stringify(held));
      closeSync(fd);
      return { release: () => rmSync(path, { force: true }), note: (extra) => writeFileSync(path, JSON.stringify({ ...held, ...extra })) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let held: Held = {};
      try { held = JSON.parse(readFileSync(path, "utf8")); } catch { /* 깨진 잠금은 치운다 */ }
      if (held.pid && alive(held.pid)) throw new Error(`다른 무거운 일이 돌고 있어요: ${held.name} (pid ${held.pid})`);
      if (held.chromePid) killTree(held.chromePid);
      rmSync(path, { force: true });
    }
  }
  throw new Error("잠금을 잡지 못했어요");
}

export async function withHeavy<T>(name: string, fn: (lock: Lock) => Promise<T>): Promise<T> {
  const lock = acquire(name);
  try { return await fn(lock); } finally { lock.release(); }
}

/** cmd.exe에 넘길 한 줄(Windows). 빈 인자·띄어쓰기·&|<>^()·큰따옴표가 든 인자는 큰따옴표로 감싸고 안의 큰따옴표는 두 번 쓴다. */
export function cmdLine(args: string[]): string {
  return args.map((a) => (a === "" || /[\s&|<>^"()]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)).join(" ");
}
