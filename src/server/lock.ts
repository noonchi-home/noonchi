// 서버 잠금: 런타임 폴더 안 파일(RUNTIME_DIR/server.lock.db)에 SQLite 배타 잠금(OS 파일 잠금)을 건다.
// - 서버는 기록 DB를 열기 전에 잡고(src/server/start.ts) 프로세스가 사는 동안 그 연결을 쥔다. 이미 잡혀 있으면(SQLITE_BUSY) 「이 폴더를 쓰는 서버가 이미 있어요」로 멈춘다.
// - 프로세스가 죽으면 OS가 잠금을 푼다. 파일이 남아도 남은 잠금이 아니다.
// - 같은 파일이면 정션·심볼릭 링크·대소문자가 다른 경로로 열어도 같은 잠금이다.
// - 시연 준비(scripts/demo-setup.ts)의 --fresh·reflect --scripted도 같은 잠금을 잡고 일이 끝날 때까지 쥔다.
// 호스트와 컨테이너(다른 OS)가 같은 폴더를 함께 쓰면 두 OS의 파일 잠금이 서로 안 보일 수 있다(docs/reference.md).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class ServerLockError extends Error {}

export interface HeldServerLock {
  /** 잠금을 놓는다(연결을 닫는다). 두 번 불러도 된다. */
  release(): void;
}

export const serverLockPath = (runtimeDir: string): string => join(runtimeDir, "server.lock.db");

/** 시연 준비 --fresh가 옛 항목을 다 되돌리지 못했을 때 남기는 표시 파일(백업 위치·못 돌린 항목). 있으면 서버·준비 명령이 멈춘다. */
export const restoreNeededPath = (runtimeDir: string): string => join(runtimeDir, "RESTORE_NEEDED.json");

/** 표시 파일이 있으면 멈출 까닭 글, 없으면 null. */
export function restoreNeeded(runtimeDir: string): string | null {
  const path = restoreNeededPath(runtimeDir);
  if (!existsSync(path)) return null;
  let backup = "";
  try {
    backup = String((JSON.parse(readFileSync(path, "utf8")) as { backup?: unknown }).backup ?? "");
  } catch { /* 깨진 표시 파일도 표시로 본다 */ }
  return `--fresh 복구가 덜 끝났어요: ${path}${backup ? ` (백업 ${backup})` : ""}. 백업의 항목을 이 폴더로 옮긴 뒤 표시 파일을 지우세요`;
}

/** SQLITE_BUSY·SQLITE_LOCKED: 다른 연결이 잠금을 쥐고 있다. */
const busy = (e: unknown) => [5, 6].includes((e as { errcode?: number }).errcode ?? -1);

/** 그 폴더의 잠금을 잡는다. 다른 프로세스·연결이 쥐고 있으면 ServerLockError. */
export function acquireServerLock(runtimeDir: string): HeldServerLock {
  mkdirSync(runtimeDir, { recursive: true });
  const db = new DatabaseSync(serverLockPath(runtimeDir));
  try {
    // 배타 잠금 방식에서 처음 쓰면 잡은 배타 잠금을 연결을 닫을 때까지 놓지 않는다. 기다리지 않는다(busy_timeout 0)
    db.exec("PRAGMA busy_timeout=0; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS held(at TEXT); DELETE FROM held; INSERT INTO held VALUES (datetime('now')); COMMIT;");
  } catch (e) {
    db.close();
    if (busy(e)) throw new ServerLockError(`이 폴더를 쓰는 서버가 이미 있어요(${runtimeDir}). 그 서버를 끈 뒤 다시 켜세요`);
    throw e;
  }
  let open = true;
  return {
    release: () => {
      if (!open) return;
      open = false;
      db.close();
    },
  };
}
