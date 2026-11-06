// 무거운 일(3D 크롬·시험·빌드·Blender·변환)을 이 PC에서 한 번에 하나만 돌리는 잠금. 띄운 크롬·명령의 pid와 띄운 때도 적어 두고,
// 죽은 잠금을 치울 때 그 프로세스가 지금도 그때 띄운 것(실행 파일 이름이 같고, 적은 때보다 늦게 시작하지 않음)일 때만 트리를 끝낸다.
// 잠금 파일은 재부팅 뒤에도 남으니 pid만 보고 끄지 않는다.
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export const LOCK_PATH = join(tmpdir(), "twin3d-heavy.lock");
/** 잠금에 적는 프로세스와 그 실행 파일 이름. childPid는 npm run heavy가 띄운 명령 창(shell). */
const SPAWNED = { chromePid: "chrome", childPid: basename(process.env.ComSpec ?? "cmd.exe") } as const;
type Spawned = keyof typeof SPAWNED;
export interface Lock { release(): void; note(extra: Partial<Record<Spawned, number>>): void }
type Held = { name?: string; pid?: number; at?: string } & Partial<Record<Spawned, number>> & Partial<Record<`${Spawned}At`, string>>;
/** 시작 시각과 적은 때를 견줄 때 봐주는 시계 차이 */
const SLACK_MS = 2000;

export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

export function killTree(pid: number): void {
  if (!(pid > 4) || !alive(pid)) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" });
  else try { process.kill(pid, "SIGKILL"); } catch { /* 이미 끝남 */ }
}

/** 살아 있는 프로세스의 실행 파일 이름(.exe 없이)과 시작 시각(ms). Windows만. 모르면 null. 약 2초 걸린다. */
export function procInfo(pid: number): { image: string; started: number } | null {
  if (!(pid > 4) || !alive(pid) || process.platform !== "win32") return null;
  const ps = `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p -and $p.StartTime) { $p.ProcessName + '|' + ([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds() }`;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  const [image, started] = (r.stdout ?? "").trim().split("|");
  return image && Number(started) > 0 ? { image, started: Number(started) } : null;
}

/** pid가 지금도 at에 적은 그 프로세스인지: 실행 파일 이름이 같고 at보다 늦게 시작하지 않았다. 모르면 false. */
export function sameProcess(pid: number, at: string | undefined, image: string): boolean {
  const info = procInfo(pid);
  const t = Date.parse(at ?? "");
  return !!info && Number.isFinite(t) && info.started <= t + SLACK_MS && info.image.toLowerCase() === image.replace(/\.exe$/i, "").toLowerCase();
}

/** 잠금 주인이 아직 돈다: 살아 있고, 잠금을 적은 뒤에 시작한 다른 프로세스가 아니다(모르면 돈다고 본다). */
function holding(held: Held): boolean {
  if (!held.pid || !alive(held.pid)) return false;
  const info = procInfo(held.pid);
  const t = Date.parse(held.at ?? "");
  return !info || !Number.isFinite(t) || info.started <= t + SLACK_MS;
}

export function acquire(name: string, path = LOCK_PATH, pid = process.pid): Lock {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      const held: Held = { name, pid, at: new Date().toISOString() };
      writeSync(fd, JSON.stringify(held));
      closeSync(fd);
      return {
        release: () => rmSync(path, { force: true }),
        note: (extra) => {
          const at = new Date().toISOString();
          for (const k of Object.keys(SPAWNED) as Spawned[]) if (extra[k]) { held[k] = extra[k]; held[`${k}At`] = at; }
          writeFileSync(path, JSON.stringify(held));
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let held: Held = {};
      try { held = JSON.parse(readFileSync(path, "utf8")); } catch { /* 깨진 잠금은 치운다 */ }
      if (holding(held)) throw new Error(`다른 무거운 일이 돌고 있어요: ${held.name} (pid ${held.pid})`);
      for (const k of Object.keys(SPAWNED) as Spawned[]) {
        const p = held[k];
        if (p && sameProcess(p, held[`${k}At`], SPAWNED[k])) killTree(p);
      }
      rmSync(path, { force: true });
    }
  }
  throw new Error("잠금을 잡지 못했어요");
}

export async function withHeavy<T>(name: string, fn: (lock: Lock) => Promise<T>, path = LOCK_PATH): Promise<T> {
  const lock = acquire(name, path);
  try { return await fn(lock); } finally { lock.release(); }
}

/** cmd.exe에 넘길 한 줄(Windows). 빈 인자·띄어쓰기·&|<>^()·큰따옴표가 든 인자는 큰따옴표로 감싸고 안의 큰따옴표는 두 번 쓴다. */
export function cmdLine(args: string[]): string {
  return args.map((a) => (a === "" || /[\s&|<>^"()]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)).join(" ");
}
