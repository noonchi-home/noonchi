// SIGTERM·SIGINT를 받으면 서버를 닫고 끝낸다(docker stop, Ctrl+C). 닫기가 timeoutMs 안에 안 끝나거나 실패하면 1로 끝낸다.
// 데스크톱 앱(apps/desktop)은 NOONCHI_STDIN_CONTROL=1로 띄우고 표준 입력으로 끈다. Windows는 자식에 SIGTERM을 보내면 정리 없이 죽는다.
import { createInterface } from "node:readline";

export interface ShutdownTarget {
  on(signal: "SIGTERM" | "SIGINT", fn: () => void): unknown;
  exit(code: number): unknown;
}

export function installShutdown(proc: ShutdownTarget, close: () => Promise<void>, opts: { log?: (l: string) => void; timeoutMs?: number } = {}): () => Promise<void> {
  let running: Promise<void> | null = null;
  const run = () => (running ??= (async () => {
    opts.log?.("종료하는 중…");
    let timer: NodeJS.Timeout | undefined;
    const failed = await Promise.race([
      close().then(() => false, (e: unknown) => { opts.log?.(`닫기 실패: ${(e as Error).message}`); return true; }),
      new Promise<boolean>((r) => { timer = setTimeout(() => { opts.log?.("닫기가 제한 시간 안에 끝나지 않았어요"); r(true); }, opts.timeoutMs ?? 15_000); }),
    ]);
    clearTimeout(timer);
    proc.exit(failed ? 1 : 0);
  })());
  proc.on("SIGTERM", () => void run());
  proc.on("SIGINT", () => void run());
  return run;
}

/** NOONCHI_STDIN_CONTROL=1일 때만 표준 입력 줄을 읽는다. `shutdown` 줄, 표준 입력 끝·오류(실행기가 죽음)면 run을 부른다.
 *  값이 없으면 표준 입력을 건드리지 않고 false(Docker, npm start). */
export function installStdinShutdown(input: NodeJS.ReadableStream, run: () => unknown, env: Record<string, string | undefined>): boolean {
  if (env.NOONCHI_STDIN_CONTROL?.trim() !== "1") return false;
  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on("line", (line) => { if (line.trim() === "shutdown") void run(); });
  lines.on("close", () => void run());
  // readline이 표준 입력 오류를 자기 error로 다시 내보낸다. 받지 않으면 처리 안 된 예외로 정리 없이 죽는다
  lines.on("error", () => void run());
  return true;
}
