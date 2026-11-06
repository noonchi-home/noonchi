// npm run dev3d -- start [--home <id>] | stop: 3D 작업용 서버(8201)와 화면(Vite 5174)을 함께 켜고 끈다. 8200·5173은 건드리지 않는다.
// start: 이미 켜져 있으면 그대로 둔다. 둘 다 답할 때까지 기다리고, 화면 모듈을 한 번 훑어 Vite 의존성 묶기를 끝낸다.
// 서버는 npm start에서 화면 빌드(prestart)를 뺀 것과 같다. 화면은 5174의 Vite가 내준다.
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { alive, killTree } from "./heavy.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DEV_PATH = join(tmpdir(), "twin3d-dev.json");
export const SERVER_PORT = 8201;
export const UI_PORT = 5174;
const SERVER = `http://127.0.0.1:${SERVER_PORT}`;
const UI = `http://127.0.0.1:${UI_PORT}`;
const LOGS = join(ROOT, "runtime-3d", "logs");
interface DevState { server: number | null; ui: number | null; home: string; at: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const answers = async (url: string) => {
  try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
};
function readState(): DevState | null {
  try { return JSON.parse(readFileSync(DEV_PATH, "utf8")) as DevState; } catch { return null; }
}
const ours = (pid: number | null | undefined): pid is number => typeof pid === "number" && pid > 4 && alive(pid);

function launch(name: "server" | "ui", args: string[], cwd: string, env: NodeJS.ProcessEnv): number {
  mkdirSync(LOGS, { recursive: true });
  const fd = openSync(join(LOGS, `${name}.log`), "w");
  const child = spawn(process.execPath, args, { cwd, env, detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
  closeSync(fd);
  child.unref();
  if (!child.pid) throw new Error(`${name}를 띄우지 못했어요`);
  return child.pid;
}

function tail(name: string): string {
  try { return readFileSync(join(LOGS, `${name}.log`), "utf8").split(/\r?\n/).slice(-15).join("\n"); } catch { return ""; }
}

async function waitFor(name: string, url: string, pid: number | null, ms: number): Promise<void> {
  const started = Date.now();
  while (!(await answers(url))) {
    if (pid !== null && !alive(pid)) throw new Error(`${name}가 끝나 버렸어요:\n${tail(name)}`);
    if (Date.now() - started > ms) throw new Error(`${name}가 ${ms / 1000}초 안에 답하지 않았어요: ${url}\n${tail(name)}`);
    await sleep(500);
  }
}

/** 화면 첫 페이지에서 시작해 같은 출처 모듈을 따라 받는다. Vite가 새 의존성을 찾아 묶기를 끝낸다. */
export async function warm(base = UI, path = "/?twin=three", limit = 800): Promise<number> {
  const html = await (await fetch(new URL(path, base))).text();
  const queue = ["/@vite/client", ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]!)];
  const seen = new Set<string>();
  while (queue.length && seen.size < limit) {
    const p = queue.shift()!;
    if (seen.has(p)) continue;
    seen.add(p);
    const res = await fetch(new URL(p, base)).catch(() => null);
    if (!res?.ok || !/javascript/.test(res.headers.get("content-type") ?? "")) continue;
    const code = await res.text();
    for (const m of code.matchAll(/(?:\bimport|\bfrom)\s*\(?\s*["'](\/[^"']+)["']/g)) if (!seen.has(m[1]!)) queue.push(m[1]!);
  }
  return seen.size;
}

async function start(home: string): Promise<void> {
  const prev = readState();
  const serverUp = await answers(`${SERVER}/api/health`);
  const uiUp = await answers(`${UI}/`);
  if (serverUp && uiUp) { console.log(`이미 켜져 있어요: 서버 ${SERVER} · 화면 ${UI}`); return; }
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PHONE_PORT; // 폰 서버(8210)는 띄우지 않는다
  let server = ours(prev?.server) && serverUp ? prev!.server : null;
  let ui = ours(prev?.ui) && uiUp ? prev!.ui : null;
  if (!serverUp) {
    server = launch("server", [join(ROOT, "node_modules/tsx/dist/cli.mjs"), "src/server/main.ts"], ROOT, {
      ...env, PORT: String(SERVER_PORT), HUB: "memory", AGENT_PROVIDER: "mock", HOME_ID: home,
      RUNTIME_DIR: "runtime-3d", TWIN_STUDIO_DIR: resolve(ROOT, "../twin-studio-3d"),
    });
  }
  if (!uiUp) {
    ui = launch("ui", [join(ROOT, "ui/node_modules/vite/bin/vite.js"), "--port", String(UI_PORT), "--strictPort"], join(ROOT, "ui"), { ...env, TWIN_HOME_URL: SERVER });
  }
  writeFileSync(DEV_PATH, JSON.stringify({ server, ui, home, at: new Date().toISOString() } satisfies DevState));
  try {
    await waitFor("server", `${SERVER}/api/health`, server, 180_000);
    await waitFor("ui", `${UI}/`, ui, 120_000);
    const n = await warm();
    console.log(`켜졌어요: 서버 ${SERVER}(pid ${server ?? "-"}) · 화면 ${UI}(pid ${ui ?? "-"}) · 모듈 ${n}개 받음 · 기록 ${LOGS}`);
  } catch (e) {
    await stop();
    throw e;
  }
}

async function stop(): Promise<void> {
  const s = readState();
  if (!s) { console.log("켜 둔 3D 작업 서버가 없어요"); return; }
  for (const pid of [s.server, s.ui]) if (ours(pid)) killTree(pid);
  rmSync(DEV_PATH, { force: true });
  for (let i = 0; i < 20 && ((await answers(`${SERVER}/api/health`)) || (await answers(`${UI}/`))); i++) await sleep(500);
  console.log(`껐어요: 서버 pid ${s.server ?? "-"} · 화면 pid ${s.ui ?? "-"}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [cmd] = process.argv.slice(2);
  const i = process.argv.indexOf("--home");
  const home = i > 0 ? process.argv[i + 1]! : "mokryeon_180b";
  const run = cmd === "start" ? start(home) : cmd === "stop" ? stop() : null;
  if (!run) { console.error("쓰는 법: npm run dev3d -- start [--home <id>] | stop"); process.exit(2); }
  run.then(() => process.exit(0), (e) => { console.error((e as Error).message); process.exit(1); });
}
