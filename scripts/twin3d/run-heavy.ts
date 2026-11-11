// npm run heavy -- <명령>: 잠금을 잡고, 부른 폴더(INIT_CWD)에서 명령을 돌린다. 다른 무거운 일이 돌면 바로 끝낸다.
// 명령 창 pid를 잠금에 적는다. 이 프로세스가 먼저 죽어 명령만 남으면, 다음 잠금이 죽은 잠금을 치우면서 그 트리를 끝낸다.
// 명령에는 이 pid를 TWIN3D_HEAVY_PID로 넘긴다. 스스로 잠금을 잡는 스크립트는 그 값으로 이 잠금 안인 줄 안다(heavy.ts heldLock).
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { acquire, cmdLine, HEAVY_PID_ENV, LOCK_PATH } from "./heavy.js";

export async function runHeavy(args: string[], cwd = process.env.INIT_CWD ?? process.cwd(), lockPath = LOCK_PATH): Promise<number> {
  const line = cmdLine(args);
  const lock = acquire(line, lockPath);
  try {
    const child = spawn(line, { stdio: "inherit", shell: true, cwd, env: { ...process.env, [HEAVY_PID_ENV]: String(process.pid) } });
    if (child.pid) lock.note({ childPid: child.pid });
    return await new Promise<number>((resolve) => {
      child.on("error", () => resolve(1));
      child.on("close", (code) => resolve(code ?? 1));
    });
  } finally { lock.release(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  if (!args.length) { console.error("쓰는 법: npm run heavy -- <명령>"); process.exit(2); }
  runHeavy(args).then((code) => process.exit(code), (e) => { console.error((e as Error).message); process.exit(3); });
}
