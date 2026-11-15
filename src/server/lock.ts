// 서버 잠금(RUNTIME_DIR/server.lock): 서버가 켜져 있는 동안 pid·포트를 두고 끌 때 지운다.
// 서버 밖 명령(scripts/demo-setup.ts)이 다른 포트에서 도는 서버도 그 폴더를 쓰는 줄 알아본다. pid가 죽었으면 남은 잠금이라 무시한다.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ServerLock { pid: number; port: number; at: string }

export const serverLockPath = (runtimeDir: string): string => join(runtimeDir, "server.lock");

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** 잠금 파일. 없거나 읽지 못하면 null. */
export function readServerLock(runtimeDir: string): ServerLock | null {
  try {
    const v = JSON.parse(readFileSync(serverLockPath(runtimeDir), "utf8")) as Partial<ServerLock>;
    if (!Number.isInteger(v.pid) || v.pid! <= 0 || !Number.isInteger(v.port)) return null;
    return { pid: v.pid!, port: v.port!, at: typeof v.at === "string" ? v.at : "" };
  } catch {
    return null;
  }
}

/** 살아 있는 서버의 잠금. 없거나 깨졌거나 pid가 죽었으면(남은 잠금) null. */
export function liveServerLock(runtimeDir: string): ServerLock | null {
  const held = readServerLock(runtimeDir);
  return held && alive(held.pid) ? held : null;
}

/** 이 프로세스·포트로 잠금을 쓰고 풀기 함수를 준다. 풀기는 파일이 아직 이 서버 것일 때만 지운다(같은 폴더에 다른 서버가 덮어썼으면 둔다). */
export function holdServerLock(runtimeDir: string, port: number, now = (): string => new Date().toISOString()): () => void {
  const lock: ServerLock = { pid: process.pid, port, at: now() };
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(serverLockPath(runtimeDir), `${JSON.stringify(lock)}\n`);
  return () => {
    const held = readServerLock(runtimeDir);
    if (held?.pid === lock.pid && held.port === lock.port) rmSync(serverLockPath(runtimeDir), { force: true });
  };
}
