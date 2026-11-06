// npm run capture -- --url <주소> --out <폴더> (--views a,b | --script <파일>) [--legacy] [--gpu] [--size 960x600] [--timeout 90] [--load-timeout 300]
// 잠금을 잡고 크롬 하나만 띄운다(빈 포트, 임시 프로필). 새 엔진은 window.__twin3d, 옛 뷰어(--legacy)는 window.aptViewer.
// 집 픽셀은 3D 마스크(물건 흰색·배경 검정으로 한 장, 사진 안 캔버스 자리 left·top)로 가르고, 통계용 사진은 덮개(HUD·미니맵·이름표)를 숨기고 찍는다.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { killTree, withHeavy } from "./heavy.js";
import { maskFromBits, sampleColors, shotStats, type MaskBits } from "./shot-stats.js";

type Reply = { result?: { result?: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } }; data?: string } };
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const url = arg("url")!;
const out = arg("out")!;
if (!url || !out) { console.error("쓰는 법: npm run capture -- --url <주소> --out <폴더> (--views a,b | --script <파일>)"); process.exit(2); }
const legacy = process.argv.includes("--legacy");
const gpu = process.argv.includes("--gpu");
const [W, H] = arg("size", "960x600")!.split("x").map(Number) as [number, number];
const viewMs = Number(arg("timeout", "90")) * 1000;
const loadMs = Number(arg("load-timeout", "300")) * 1000;
const steps = arg("script")
  ? readFileSync(arg("script")!, "utf8").split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#"))
  : arg("views", "overview")!.split(",").flatMap((v) => [`view:${v}`, `shot:${v}`]);
const chromePath = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => p && existsSync(p));
if (!chromePath) throw new Error("Chrome을 찾지 못했어요. CHROME 환경 변수에 경로를 넣으세요.");
mkdirSync(out, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([p, sleep(ms).then((): never => { throw new Error(`시간 초과(${ms / 1000}초): ${label}`); })]);
const median = (c: [number, number, number][]) => (c.length ? [0, 1, 2].map((k) => c.map((x) => x[k]!).sort((a, b) => a - b)[Math.floor((c.length - 1) / 2)]) : null);

// 옛 뷰어: browser-check.mjs loaded(m)과 같은 준비 조건. 마스크는 바닥판을 숨기고 흰 재질·검정 배경으로 한 장 그려 읽는다.
const LEGACY_READY = "Boolean(window.aptViewer && (window.aptViewer.results.error || (window.aptViewer.results.mode === window.aptViewer.mode && !window.aptViewer.loading)))";
const MASK_BITS = `(gl, w, h) => { const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const bits = new Uint8Array(Math.ceil(w * h / 8));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[((h - 1 - y) * w + x) * 4] > 127) { const i = y * w + x; bits[i >> 3] |= 1 << (i & 7); }
  let s = ""; for (const b of bits) s += String.fromCharCode(b); const r = gl.canvas.getBoundingClientRect();
  return { width: w, height: h, bits: btoa(s), left: r.left, top: r.top }; }`;
const LEGACY_MASK = `(() => { const v = window.aptViewer, T = v.THREE; v.setPaused(true);
  const hidden = []; v.scene.traverse((o) => { if (o.isMesh && o.visible && o.geometry?.type === "PlaneGeometry" && Math.abs(o.position.y + 0.15) < 1e-6) { o.visible = false; hidden.push(o); } });
  const bg = v.scene.background, ov = v.scene.overrideMaterial, tm = v.renderer.toneMapping;
  v.scene.background = new T.Color(0); v.scene.overrideMaterial = new T.MeshBasicMaterial({ color: 0xffffff }); v.renderer.toneMapping = T.NoToneMapping;
  v.renderer.render(v.scene, v.camera);
  const c = v.renderer.domElement, m = (${MASK_BITS})(v.renderer.getContext(), c.width, c.height);
  v.scene.background = bg; v.scene.overrideMaterial = ov; v.renderer.toneMapping = tm; hidden.forEach((o) => { o.visible = true; }); v.setPaused(false);
  return m; })()`;

await withHeavy(`capture ${url}`, async (lock) => {
  const profile = mkdtempSync(join(tmpdir(), "twin3d-chrome-"));
  const flags = gpu ? [] : ["--headless=new", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
  const chrome = spawn(chromePath, [...flags, "--remote-debugging-port=0", `--user-data-dir=${profile}`, `--window-size=${W},${H}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  lock.note({ chromePid: chrome.pid });
  const errors: string[] = [];
  const views: Record<string, unknown> = {};
  const measures: Record<string, unknown> = {};
  let ws: WebSocket | null = null;
  let load = 0;
  try {
    let port = 0;
    for (let i = 0; i < 100 && !port; i++) {
      try { port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0]); } catch { await sleep(200); }
    }
    if (!port) throw new Error("크롬 디버그 포트를 찾지 못했어요");
    let target: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 50 && !target; i++) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
        target = list.find((t) => t.type === "page");
      } catch { /* 아직 */ }
      if (!target) await sleep(200);
    }
    if (!target) throw new Error("CDP 페이지를 찾지 못했어요");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws!.addEventListener("open", r));
    let id = 0;
    const pending = new Map<number, (m: Reply) => void>();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); return; }
      const p = m.params;
      if (m.method === "Runtime.exceptionThrown") errors.push(`예외: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
      if (m.method === "Runtime.consoleAPICalled" && (p.type === "error" || p.type === "assert")) errors.push(`console.${p.type}: ${p.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(" ")}`);
      if (m.method === "Log.entryAdded" && p.entry.level === "error") errors.push(`log: ${p.entry.text} ${p.entry.url ?? ""}`);
      if (m.method === "Network.responseReceived" && p.response.status >= 400) errors.push(`HTTP ${p.response.status}: ${p.response.url}`);
      if (m.method === "Network.loadingFailed" && !p.canceled) errors.push(`받기 실패: ${p.errorText}`);
    });
    const send = (method: string, params: object = {}) => new Promise<Reply>((r) => { const i = ++id; pending.set(i, r); ws!.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expression: string, ms = viewMs) => {
      const r = await withTimeout(send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), ms, expression.slice(0, 80));
      const ex = r.result?.exceptionDetails;
      if (ex) { const msg = `evaluate 예외: ${ex.exception?.description ?? ex.text}`; errors.push(msg); throw new Error(msg); }
      return r.result?.result?.value;
    };
    for (const d of ["Runtime", "Log", "Network", "Page"]) await send(`${d}.enable`);
    await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url });
    const started = Date.now();
    while (!(await evaluate(legacy ? LEGACY_READY : "Boolean(window.__twin3d?.ready)"))) {
      if (Date.now() - started > loadMs) throw new Error(`불러오기 시간 초과(${loadMs / 1000}초)`);
      await sleep(500);
    }
    load = Date.now() - started;
    if (legacy && (await evaluate("window.aptViewer.results.error ?? null"))) throw new Error(`옛 뷰어 오류: ${await evaluate("String(window.aptViewer.results.error)")}`);
    const shot = async (quality: number) => Buffer.from((await withTimeout(send("Page.captureScreenshot", { format: "jpeg", quality }), viewMs, "사진")).result!.data!, "base64");
    const shoot = async (name: string) => {
      if (!legacy) await evaluate("window.__twin3d.overlays(false)");
      const bare = await shot(100);
      const mask = (await evaluate(legacy ? LEGACY_MASK : "window.__twin3d.mask()")) as MaskBits;
      const info = legacy ? null : ((await evaluate("window.__twin3d.info()")) as { wallSamples?: [number, number][] });
      if (!legacy) await evaluate("window.__twin3d.overlays(true).then(() => window.__twin3d.idle())");
      const people = legacy ? bare : await shot(92);
      writeFileSync(join(out, `${name.replace(/[:,/]/g, "_")}.jpg`), people);
      const img = jpeg.decode(bare, { useTArray: true });
      const walls = info?.wallSamples?.length ? sampleColors(img.data, img.width, info.wallSamples) : [];
      views[name] = { ...shotStats(img.data, img.width, img.height, maskFromBits(mask, img.width, img.height)), wall: { n: walls.length, median: median(walls) }, info };
    };
    for (const step of steps) {
      const [cmd, ...rest] = step.split(":");
      const a = rest.join(":");
      if (cmd === "view" && legacy) {
        if (a.startsWith("room:")) await evaluate(`window.aptViewer.focusRoom(${JSON.stringify(a.slice(5))})`);
        await sleep(2500);
      } else if (cmd === "view") await evaluate(`window.__twin3d.view(${JSON.stringify(a)}, { instant: true }).then(() => window.__twin3d.idle())`);
      else if (cmd === "shot") await shoot(a);
      else if (cmd === "play") await evaluate(`window.__twin3d.play(${JSON.stringify(a)}, { clock: "virtual" })`);
      else if (cmd === "step") await evaluate(`window.__twin3d.step(${Number(a)}).then(() => window.__twin3d.idle())`);
      else if (cmd === "manual") await evaluate(`window.__twin3d.manual(${JSON.stringify(a)})`);
      else if (cmd === "follow") await evaluate("window.__twin3d.follow()");
      else if (cmd === "wait") await sleep(Number(a));
      else if (cmd === "tour") measures[step] = await evaluate(`window.__twin3d.tour(${JSON.stringify(a)})`, 600_000);
      else if (cmd === "remount") measures[step] = await evaluate(`window.__twin3d.remount(${Number(a)})`, 600_000);
      else if (cmd === "cycle") measures[step] = await evaluate(`window.__twin3d.cyclePresets(${Number(a)})`, 600_000);
      else throw new Error(`모르는 스크립트 줄: ${step}`);
    }
    if (legacy) await evaluate("window.aptViewer.setPaused(true)");
  } catch (e) {
    errors.push(`중단: ${(e as Error).message}`);
  } finally {
    writeFileSync(join(out, "stats.json"), JSON.stringify({ url, size: [W, H], legacy, gpu, loadMs: load, views, measures, errors }, null, 1));
    try { ws?.close(); } catch { /* 이미 닫힘 */ }
    killTree(chrome.pid!);
    for (let i = 0; i < 10; i++) { try { rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(300); } }
  }
  console.log(JSON.stringify({ views: Object.keys(views), measures, errors }, null, 1));
  if (errors.length) process.exitCode = 1;
});
