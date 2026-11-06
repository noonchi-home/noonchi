// npm run heavy -- <명령>: 잠금을 잡고, 부른 폴더(INIT_CWD)에서 명령을 돌린다. 다른 무거운 일이 돌면 바로 끝낸다.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { acquire, cmdLine, LOCK_PATH } from "./heavy.js";

export function runHeavy(args: string[], cwd = process.env.INIT_CWD ?? process.cwd(), lockPath = LOCK_PATH): number {
  const line = cmdLine(args);
  const lock = acquire(line, lockPath);
  try { return spawnSync(line, { stdio: "inherit", shell: true, cwd }).status ?? 1; } finally { lock.release(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  if (!args.length) { console.error("쓰는 법: npm run heavy -- <명령>"); process.exit(2); }
  try { process.exit(runHeavy(args)); } catch (e) { console.error((e as Error).message); process.exit(3); }
}
