// 서버 잠금: 런타임 폴더마다 OS가 하나만 허락하는 이름 있는 파이프.
// - 이름: 런타임 폴더 절대 경로의 해시. Windows는 \\.\pipe\twin-home-<해시>(같은 이름 두 번째 listen은 EADDRINUSE), Linux는 추상 소켓 \0twin-home-<해시>.
//   그 밖의 OS(macOS)는 임시 폴더의 소켓 파일을 쓰고, 연결을 거부하는 남은 파일만 지운 뒤 다시 잡는다.
// - 서버는 DB를 열기 전에 listen한다(src/server/start.ts). 이미 있으면 「이 폴더를 쓰는 서버가 이미 있어요」로 멈춘다.
// - 프로세스가 죽으면 OS가 파이프를 치우므로 남은 잠금이 없다. 서버 밖 명령(scripts/demo-setup.ts)은 같은 이름에 connect해서 켜진 서버를 알아본다.
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { connect, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export class ServerLockError extends Error {}

export interface HeldServerLock {
  /** 잠금을 놓는다(서버를 끌 때·시작이 실패할 때). */
  release(): Promise<void>;
}

const BUSY = (runtimeDir: string) => `이 폴더를 쓰는 서버가 이미 있어요(${runtimeDir}). 그 서버를 끈 뒤 다시 켜세요`;

/** 런타임 폴더 → 잠금 이름. Windows는 대소문자를 가리지 않는 경로라 소문자로 맞춘다. */
export function serverLockName(runtimeDir: string): string {
  const abs = resolve(runtimeDir);
  const hash = createHash("sha256").update(process.platform === "win32" ? abs.toLowerCase() : abs).digest("hex").slice(0, 16);
  if (process.platform === "win32") return `\\\\.\\pipe\\twin-home-${hash}`;
  if (process.platform === "linux") return `\0twin-home-${hash}`;
  return join(tmpdir(), `twin-home-${hash}.sock`);
}

/** 소켓 파일 방식(macOS)만: 남은 파일이 있을 수 있다. */
const usesFile = () => process.platform !== "win32" && process.platform !== "linux";

const listenOn = (name: string): Promise<Server> => new Promise((ok, fail) => {
  const server = createServer((socket) => socket.destroy());
  server.once("error", fail);
  server.listen(name, () => {
    server.off("error", fail);
    server.unref();
    ok(server);
  });
});

/** 그 폴더의 서버가 켜져 있는가: 잠금 이름에 붙으면 true, 없으면(ENOENT·ECONNREFUSED) false. 그 밖의 오류·시간 초과면 그 까닭을 던진다. */
export function serverRunning(runtimeDir: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((ok, fail) => {
    const socket = connect(serverLockName(runtimeDir));
    const timer = setTimeout(() => {
      socket.destroy();
      fail(new Error(`${timeoutMs / 1000}초 안에 답이 없음`));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      ok(true);
    });
    socket.once("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e.code === "ENOENT" || e.code === "ECONNREFUSED") ok(false);
      else fail(e);
    });
  });
}

/** 잠금을 잡는다. 같은 폴더의 서버가 이미 있으면 ServerLockError. */
export async function acquireServerLock(runtimeDir: string): Promise<HeldServerLock> {
  const name = serverLockName(runtimeDir);
  let server: Server;
  try {
    server = await listenOn(name);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
    if (!usesFile() || (await serverRunning(runtimeDir))) throw new ServerLockError(BUSY(runtimeDir));
    rmSync(name, { force: true });
    try {
      server = await listenOn(name);
    } catch (again) {
      if ((again as NodeJS.ErrnoException).code === "EADDRINUSE") throw new ServerLockError(BUSY(runtimeDir));
      throw again;
    }
  }
  let released = false;
  return {
    release: () => new Promise<void>((ok) => {
      if (released) return ok();
      released = true;
      server.close(() => ok());
    }),
  };
}
