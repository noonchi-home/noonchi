// 크롬 하나 띄우기(빈 디버그 포트, 임시 프로필)와 CDP 조종(Runtime.evaluate, Page.captureScreenshot, 알림 받기), 같은 크롬에 탭·창 더 열기. capture.ts·e2e-dashboard.ts·video-check.ts가 쓴다.
// 페이지 오류(예외·console.error·로그 오류·HTTP 400 이상·받기 실패·evaluate 예외)는 onError로 알린다. 끌 때는 크롬 트리를 끝내고 프로필을 지운다.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTimeout } from "./capture-lib.js";
import { killTree } from "./heavy.js";

export type Reply = { result?: { result?: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } }; data?: string } };
export interface Chrome { proc: ChildProcess; profile: string }
export interface Page {
  send(method: string, params?: object): Promise<Reply>;
  /** 식을 돌려 값을 받는다(Promise면 기다림). 예외면 onError로 알리고 던진다. */
  evaluate(expression: string, ms: number): Promise<unknown>;
  /** 화면 사진(Page.captureScreenshot). */
  screenshot(params: { format: "png" | "jpeg"; quality?: number }, ms: number): Promise<Buffer>;
  /** CDP 알림(method)의 params를 받는다. 받기를 끄는 함수를 돌려준다. */
  on(method: string, fn: (params: Record<string, unknown>) => void): () => void;
  close(): void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** CHROME 환경 변수, 없으면 기본 설치 자리. 없으면 던진다. */
export function chromePath(): string {
  const found = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => p && existsSync(p));
  if (!found) throw new Error("Chrome을 찾지 못했어요. CHROME 환경 변수에 경로를 넣으세요.");
  return found;
}

/** 크롬을 띄운다: 임시 프로필, 빈 디버그 포트, 창 크기. gpu가 아니면 headless(SwiftShader). */
export function launchChrome(o: { path: string; size: [number, number]; gpu?: boolean }): Chrome {
  const profile = mkdtempSync(join(tmpdir(), "twin3d-chrome-"));
  const flags = o.gpu ? [] : ["--headless=new", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
  const proc = spawn(o.path, [...flags, "--remote-debugging-port=0", `--user-data-dir=${profile}`, `--window-size=${o.size[0]},${o.size[1]}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  return { proc, profile };
}

/** 크롬이 잡은 디버그 포트(프로필의 DevToolsActivePort). */
export async function devtoolsPort(c: Chrome): Promise<number> {
  for (let i = 0; i < 100; i++) {
    try {
      const port = Number(readFileSync(join(c.profile, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0]);
      if (port) return port;
    } catch { /* 아직 */ }
    await sleep(200);
  }
  throw new Error("크롬 디버그 포트를 찾지 못했어요");
}

/** 첫 page 대상에 붙고 Runtime·Log·Network·Page를 켠다. 페이지 오류는 onError로. */
export async function openPage(port: number, onError: (msg: string) => void): Promise<Page> {
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 50 && !target; i++) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      target = list.find((t) => t.type === "page");
    } catch { /* 아직 */ }
    if (!target) await sleep(200);
  }
  if (!target) throw new Error("CDP 페이지를 찾지 못했어요");
  return attach(target.webSocketDebuggerUrl, onError);
}

/** 같은 크롬에 빈 탭을 하나 더 열고(DevTools /json/new, PUT) openPage처럼 붙는다. */
export async function openTab(port: number, onError: (msg: string) => void): Promise<Page> {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  if (!r.ok) throw new Error(`새 탭을 열지 못했어요: HTTP ${r.status} ${await r.text()}`);
  return attach(((await r.json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl, onError);
}

/** 같은 크롬에 새 창(size)을 열고(브라우저 대상에 Target.createTarget newWindow) openPage처럼 붙는다.
 *  새 탭은 앞 탭을 가려 그 탭의 그리기(requestAnimationFrame)가 멈추지만, 새 창은 앞 탭과 함께 그려진다. */
export async function openWindow(port: number, size: [number, number], onError: (msg: string) => void): Promise<Page> {
  const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  try {
    await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", () => j(new Error("브라우저 대상에 붙지 못했어요"))); });
    const reply = await withTimeout(new Promise<{ result?: { targetId?: string }; error?: { message?: string } }>((r) => {
      ws.addEventListener("message", (ev) => { const m = JSON.parse(String(ev.data)); if (m.id === 1) r(m); });
      ws.send(JSON.stringify({ id: 1, method: "Target.createTarget", params: { url: "about:blank", newWindow: true, width: size[0], height: size[1] } }));
    }), 10_000, "새 창");
    const targetId = reply.result?.targetId;
    if (!targetId) throw new Error(`새 창을 열지 못했어요: ${reply.error?.message ?? "targetId 없음"}`);
    return await attach(`ws://127.0.0.1:${port}/devtools/page/${targetId}`, onError);
  } finally {
    try { ws.close(); } catch { /* 이미 닫힘 */ }
  }
}

async function attach(wsUrl: string, onError: (msg: string) => void): Promise<Page> {
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map<number, (m: Reply) => void>();
  const listeners = new Map<string, Set<(params: Record<string, unknown>) => void>>();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); return; }
    const p = m.params;
    for (const fn of listeners.get(m.method) ?? []) fn(p ?? {});
    if (m.method === "Runtime.exceptionThrown") onError(`예외: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
    if (m.method === "Runtime.consoleAPICalled" && (p.type === "error" || p.type === "assert")) onError(`console.${p.type}: ${p.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(" ")}`);
    if (m.method === "Log.entryAdded" && p.entry.level === "error") onError(`log: ${p.entry.text} ${p.entry.url ?? ""}`);
    if (m.method === "Network.responseReceived" && p.response.status >= 400) onError(`HTTP ${p.response.status}: ${p.response.url}`);
    if (m.method === "Network.loadingFailed" && !p.canceled) onError(`받기 실패: ${p.errorText}`);
  });
  const send = (method: string, params: object = {}) => new Promise<Reply>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const page: Page = {
    send,
    async evaluate(expression, ms) {
      const r = await withTimeout(send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), ms, expression.slice(0, 80));
      const ex = r.result?.exceptionDetails;
      if (ex) { const msg = `evaluate 예외: ${ex.exception?.description ?? ex.text}`; onError(msg); throw new Error(msg); }
      return r.result?.result?.value;
    },
    async screenshot(params, ms) {
      return Buffer.from((await withTimeout(send("Page.captureScreenshot", params), ms, "사진")).result!.data!, "base64");
    },
    on(method, fn) {
      const set = listeners.get(method) ?? new Set();
      listeners.set(method, set.add(fn));
      return () => { set.delete(fn); };
    },
    close() {
      try { ws.close(); } catch { /* 이미 닫힘 */ }
    },
  };
  for (const d of ["Runtime", "Log", "Network", "Page"]) await send(`${d}.enable`);
  return page;
}

/** 크롬 트리를 끝내고 임시 프로필을 지운다(파일을 놓을 때까지 몇 번 다시). */
export async function closeChrome(c: Chrome): Promise<void> {
  killTree(c.proc.pid!);
  for (let i = 0; i < 10; i++) { try { rmSync(c.profile, { recursive: true, force: true }); break; } catch { await sleep(300); } }
}
