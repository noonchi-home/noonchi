// SIGTERM·SIGINT를 받으면 서버를 닫고 끝낸다(docker stop, Ctrl+C). 닫기가 timeoutMs 안에 안 끝나거나 실패하면 1로 끝낸다.
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
