// npm run dev3d -- start [--home <id>] | stop: 3D 작업용 서버(8201)와 화면(Vite 5174)을 함께 켜고 끈다. 8200·5173은 건드리지 않는다.
// start: 같은 집 서버가 이미 켜져 있으면 그대로 둔다. 다른 집이면 내가 띄운 서버만 다시 켜고, 남이 띄운 서버면 멈춘다.
// 둘 다 답할 때까지 기다리고, 서버가 띄운 집이 요청과 같은지 본 뒤, 화면 모듈을 한 번 훑어 Vite 의존성 묶기를 끝낸다.
// 서버는 npm start에서 화면 빌드(prestart)를 뺀 것과 같고 폰 서버·두뇌는 끈다. 모델 주소는 닫힌 포트라 실제 모델을 부르지 않는다. 화면은 5174의 Vite가 내준다.
// pid는 띄운 때와 함께 적고, 끌 때는 지금도 그때 띄운 node인지 본다(재부팅 뒤 같은 pid를 쓰는 다른 프로세스를 끄지 않게).
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { alive, killTree, sameProcess } from "./heavy.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DEV_PATH = join(tmpdir(), "twin3d-dev.json");
export const SERVER_PORT = 8201;
export const UI_PORT = 5174;
const SERVER = `http://127.0.0.1:${SERVER_PORT}`;
const UI = `http://127.0.0.1:${UI_PORT}`;
const LOGS = join(ROOT, "runtime-3d", "logs");
interface Proc { pid: number; at: string }
interface DevState { server: Proc | null; ui: Proc | null; home: string; at: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const answers = async (url: string) => {
  try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
};
function readState(): DevState | null {
  try { return JSON.parse(readFileSync(DEV_PATH, "utf8")) as DevState; } catch { return null; }
}
const NODE = process.execPath;
const ours = (p: Proc | null | undefined): boolean => typeof p?.pid === "number" && sameProcess(p.pid, p.at, basename(NODE));
async function servedHome(): Promise<{ home: string | null } | null> {
  try {
    const res = await fetch(`${SERVER}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const h = (await res.json()) as { home?: { id?: string } | null };
    return { home: h.home?.id ?? null };
  } catch { return null; }
}

/** 닫힌 이 PC 포트(discard): 준비 검사(/api/health)가 모델 주소에 GET을 보내도 밖으로 나가지 않는다. */
const CLOSED = "http://127.0.0.1:9";

/** 3D 작업 서버 환경. 폰 서버·두뇌는 빈 값, VLM·PAM·에이전트 주소는 닫힌 포트, 모델 키는 빈 값으로 넣는다(지우면 서버의 dotenv가 .env 값으로 다시 채운다). */
export function serverEnv(home: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base, PORT: String(SERVER_PORT), HUB: "memory", HOME_ID: home,
    RUNTIME_DIR: "runtime-3d", TWIN_STUDIO_DIR: base.TWIN_STUDIO_DIR?.trim() || resolve(ROOT, "twin"), PHONE_PORT: "", BRAIN: "",
    INFERENCE_MODE: "openai", AGENT_PROVIDER: "openai", OPENAI_BASE_URL: `${CLOSED}/v1`, VLM_BASE_URL: `${CLOSED}/v1`, PAM_LLM_BASE_URL: `${CLOSED}/v1`,
    OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", VLM_API_KEY: "", PAM_LLM_API_KEY: "",
  };
}

/** 8201에 떠 있는 서버(served = health의 집, 안 떠 있으면 null)와 요청한 집을 견줘 할 일을 정한다. */
export function serverPlan(home: string, served: { home: string | null } | null, own: boolean): "keep" | "launch" | "restart" {
  if (!served) return "launch";
  if (served.home === home) return "keep";
  if (own) return "restart";
  throw new Error(`8201에 다른 집(${served.home ?? "모름"}) 서버가 떠 있어요. 그 서버를 끈 뒤 다시 켜세요`);
}

function launch(name: "server" | "ui", args: string[], cwd: string, env: NodeJS.ProcessEnv): Proc {
  mkdirSync(LOGS, { recursive: true });
  const fd = openSync(join(LOGS, `${name}.log`), "w");
  const child = spawn(NODE, args, { cwd, env, detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
  closeSync(fd);
  child.unref();
  if (!child.pid) throw new Error(`${name}를 띄우지 못했어요`);
  return { pid: child.pid, at: new Date().toISOString() };
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
  const served = await servedHome();
  const uiUp = await answers(`${UI}/`);
  const own = served ? ours(prev?.server) : false;
  const plan = serverPlan(home, served, own);
  if (plan === "keep" && uiUp) { console.log(`이미 켜져 있어요: 서버 ${SERVER}(집 ${home}) · 화면 ${UI}`); return; }
  if (plan === "restart") {
    killTree(prev!.server!.pid);
    for (let i = 0; i < 20 && (await answers(`${SERVER}/api/health`)); i++) await sleep(500);
    if (await answers(`${SERVER}/api/health`)) throw new Error(`다른 집(${served!.home}) 서버가 꺼지지 않았어요`);
    console.log(`다른 집(${served!.home}) 서버를 껐어요`);
  }
  const server = plan === "keep" ? (own ? prev!.server : null) : launch("server", [join(ROOT, "node_modules/tsx/dist/cli.mjs"), "src/server/main.ts"], ROOT, serverEnv(home));
  const ui = uiUp ? (ours(prev?.ui) ? prev!.ui : null)
    : launch("ui", [join(ROOT, "ui/node_modules/vite/bin/vite.js"), "--port", String(UI_PORT), "--strictPort"], join(ROOT, "ui"), { ...process.env, TWIN_HOME_URL: SERVER });
  writeFileSync(DEV_PATH, JSON.stringify({ server, ui, home, at: new Date().toISOString() } satisfies DevState));
  try {
    await waitFor("server", `${SERVER}/api/health`, server?.pid ?? null, 180_000);
    const got = (await servedHome())?.home ?? null;
    if (got !== home) throw new Error(`서버가 ${got ?? "모르는"} 집을 띄웠어요(요청 ${home}). runtime-3d에 저장된 집이 있는지 보세요`);
    await waitFor("ui", `${UI}/`, ui?.pid ?? null, 120_000);
    const n = await warm();
    console.log(`켜졌어요: 서버 ${SERVER}(집 ${home}, pid ${server?.pid ?? "-"}) · 화면 ${UI}(pid ${ui?.pid ?? "-"}) · 모듈 ${n}개 받음 · 기록 ${LOGS}`);
  } catch (e) {
    await stop();
    throw e;
  }
}

async function stop(): Promise<void> {
  const s = readState();
  if (!s) { console.log("켜 둔 3D 작업 서버가 없어요"); return; }
  const left: number[] = [];
  for (const p of [s.server, s.ui]) {
    if (p && ours(p)) killTree(p.pid);
    else if (typeof p?.pid === "number" && alive(p.pid)) left.push(p.pid);
  }
  rmSync(DEV_PATH, { force: true });
  for (let i = 0; i < 20 && ((await answers(`${SERVER}/api/health`)) || (await answers(`${UI}/`))); i++) await sleep(500);
  console.log(`껐어요: 서버 pid ${s.server?.pid ?? "-"} · 화면 pid ${s.ui?.pid ?? "-"}`);
  if (left.length) console.log(`pid ${left.join(", ")}는 그때 띄운 프로세스가 아니라 끄지 않았어요`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [cmd] = process.argv.slice(2);
  const i = process.argv.indexOf("--home");
  const home = i > 0 ? process.argv[i + 1]! : "mokryeon_180b";
  const run = cmd === "start" ? start(home) : cmd === "stop" ? stop() : null;
  if (!run) { console.error("쓰는 법: npm run dev3d -- start [--home <id>] | stop"); process.exit(2); }
  run.then(() => process.exit(0), (e) => { console.error((e as Error).message); process.exit(1); });
}
