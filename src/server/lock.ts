// 서버 잠금(RUNTIME_DIR/server.lock): 서버가 DB를 열기 전에 배타적으로 만들고(같은 폴더의 두 번째 서버는 멈춘다), 뜨면 포트를 적고, 끌 때 지운다.
// 서버 밖 명령(scripts/demo-setup.ts)이 다른 포트에서 도는 서버도 그 폴더를 쓰는 줄 알아본다. pid가 죽었으면 남은 잠금이라 무시한다.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ServerLock {
  pid: number;
  /** 서버 실행 하나의 무작위 표시. 자기 잠금인지 가린다. */
  token: string;
  at: string;
  /** 뜬 포트. 뜨기 전이면 null. */
  port: number | null;
}

export class ServerLockError extends Error {}

export interface HeldServerLock {
  readonly token: string;
  /** 뜬 포트를 적는다(아직 자기 잠금일 때만). */
  listening(port: number): void;
  /** 자기 잠금일 때만 지운다. */
  release(): void;
}

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
    if (!Number.isInteger(v.pid) || v.pid! <= 0) return null;
    return { pid: v.pid!, token: typeof v.token === "string" ? v.token : "", at: typeof v.at === "string" ? v.at : "", port: Number.isInteger(v.port) ? v.port! : null };
  } catch {
    return null;
  }
}

/** 살아 있는 서버의 잠금. 없거나 깨졌거나 pid가 죽었으면(남은 잠금) null. */
export function liveServerLock(runtimeDir: string): ServerLock | null {
  const held = readServerLock(runtimeDir);
  return held && alive(held.pid) ? held : null;
}

/** 「이 폴더를 쓰는 서버가 이미 있어요」 글. */
export const busyText = (runtimeDir: string, held: ServerLock): string =>
  `이 폴더를 쓰는 서버가 이미 있어요(${runtimeDir}, pid ${held.pid}${held.port === null ? ", 뜨는 중" : `, 포트 ${held.port}`}). 그 서버를 끈 뒤 다시 켜세요`;

/** 잠금을 배타적으로 만든다. 살아 있는 서버의 잠금이 있으면 ServerLockError, 남은 잠금이면 치우고 다시 만든다. */
export function acquireServerLock(runtimeDir: string, now = (): string => new Date().toISOString()): HeldServerLock {
  mkdirSync(runtimeDir, { recursive: true });
  const path = serverLockPath(runtimeDir);
  const lock: ServerLock = { pid: process.pid, token: randomUUID(), at: now(), port: null };
  const ours = () => readServerLock(runtimeDir)?.token === lock.token;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, `${JSON.stringify(lock)}\n`, { flag: "wx" });
      return {
        token: lock.token,
        listening: (port) => {
          if (!ours()) return;
          lock.port = port;
          writeFileSync(path, `${JSON.stringify(lock)}\n`);
        },
        release: () => {
          if (ours()) rmSync(path, { force: true });
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const held = liveServerLock(runtimeDir);
      if (held) throw new ServerLockError(busyText(runtimeDir, held));
      rmSync(path, { force: true });
    }
  }
  throw new ServerLockError(`서버 잠금을 만들지 못했어요(${path}). 다른 서버가 같은 폴더로 뜨는 중인지 보세요`);
}
