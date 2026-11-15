// 서버 잠금(RUNTIME_DIR/server.lock): 서버가 DB를 열기 전에 배타적으로 만들고(같은 폴더의 두 번째 서버는 멈춘다), 뜨면 주소·포트를 적고, 끌 때 지운다.
// 서버 밖 명령(scripts/demo-setup.ts)이 다른 포트에서 도는 서버도 그 폴더를 쓰는 줄 알아본다.
// 주인 확인: pid가 죽었으면 남은 잠금이다. pid가 살아 있어도 비정상 종료 뒤 다른 프로세스가 그 pid를 다시 썼을 수 있어,
// 잠금 주소의 /api/health가 잠금 token과 같은 instance를 줄 때만 주인이 살아 있다고 본다(셸을 띄우지 않는다).
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
  /** 뜬 주소(이 PC에서 여는 http://호스트:포트). 뜨기 전이면 null. */
  url: string | null;
}

export class ServerLockError extends Error {}

export interface HeldServerLock {
  readonly token: string;
  /** 뜬 주소·포트를 적는다(아직 자기 잠금일 때만). */
  listening(url: string, port: number): void;
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
    return {
      pid: v.pid!, token: typeof v.token === "string" ? v.token : "", at: typeof v.at === "string" ? v.at : "",
      port: Number.isInteger(v.port) ? v.port! : null, url: typeof v.url === "string" && v.url ? v.url : null,
    };
  } catch {
    return null;
  }
}

/** 뜨는 중(주소 없음) 잠금을 살아 있다고 보는 시간. 지나면 뜨다가 죽은 뒤 pid가 다시 쓰인 것으로 본다. */
export const STARTING_MS = 5 * 60_000;
const PROBE_MS = 1500;

/** 잠금 주소의 /api/health가 같은 token을 주는가. 연결 거부·다른 instance·instance 없음·JSON 아님이면 다른 주인, 답이 늦거나 그 밖의 오류면 모름. */
async function probe(held: ServerLock & { url: string }): Promise<"same" | "other" | "unknown"> {
  try {
    const r = await fetch(`${held.url}/api/health`, { signal: AbortSignal.timeout(PROBE_MS) });
    const body = (await r.json()) as { instance?: unknown } | null;
    return body?.instance === held.token ? "same" : "other";
  } catch (e) {
    if (e instanceof SyntaxError) return "other";
    const cause = (e as { cause?: { code?: string; errors?: { code?: string }[] } }).cause;
    const code = cause?.code ?? cause?.errors?.find((x) => x.code)?.code;
    return code === "ECONNREFUSED" ? "other" : "unknown";
  }
}

/** 살아 있는 서버의 잠금. 없거나 깨졌거나 주인이 아니면(남은 잠금) null.
 *  - pid가 죽었으면 남은 잠금.
 *  - 주소가 있으면 그 /api/health가 같은 instance를 줄 때 살아 있고, 다른 주인이면 남은 잠금. 답이 늦거나 모르는 오류면 켜져 있을 수 있어 살아 있다고 본다.
 *  - 주소가 없으면(뜨는 중) 적은 지 STARTING_MS 안일 때만 살아 있다. */
export async function liveServerLock(runtimeDir: string, now: () => number = Date.now): Promise<ServerLock | null> {
  const held = readServerLock(runtimeDir);
  if (!held || !alive(held.pid)) return null;
  if (held.url === null) {
    const t = Date.parse(held.at);
    return Number.isFinite(t) && now() - t < STARTING_MS ? held : null;
  }
  return (await probe({ ...held, url: held.url })) === "other" ? null : held;
}

/** 「이 폴더를 쓰는 서버가 이미 있어요」 글. */
export const busyText = (runtimeDir: string, held: ServerLock): string =>
  `이 폴더를 쓰는 서버가 이미 있어요(${runtimeDir}, pid ${held.pid}${held.port === null ? ", 뜨는 중" : `, 포트 ${held.port}`}). 그 서버를 끈 뒤 다시 켜세요`;

/** 잠금을 배타적으로 만든다. 살아 있는 서버의 잠금이 있으면 ServerLockError, 남은 잠금이면 치우고 다시 만든다. */
export async function acquireServerLock(runtimeDir: string, now = (): string => new Date().toISOString()): Promise<HeldServerLock> {
  mkdirSync(runtimeDir, { recursive: true });
  const path = serverLockPath(runtimeDir);
  const lock: ServerLock = { pid: process.pid, token: randomUUID(), at: now(), port: null, url: null };
  const ours = () => readServerLock(runtimeDir)?.token === lock.token;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, `${JSON.stringify(lock)}\n`, { flag: "wx" });
      return {
        token: lock.token,
        listening: (url, port) => {
          if (!ours()) return;
          lock.url = url;
          lock.port = port;
          writeFileSync(path, `${JSON.stringify(lock)}\n`);
        },
        release: () => {
          if (ours()) rmSync(path, { force: true });
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const held = await liveServerLock(runtimeDir);
      if (held) throw new ServerLockError(busyText(runtimeDir, held));
      rmSync(path, { force: true });
    }
  }
  throw new ServerLockError(`서버 잠금을 만들지 못했어요(${path}). 다른 서버가 같은 폴더로 뜨는 중인지 보세요`);
}
