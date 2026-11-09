// 대시보드 단계 바뀜 재기. 크롬 하나를 띄워 대시보드 가짜 단계(?debug=steps&play=4000)를 2단계부터 자동 재생하고(main에 data-ready가 붙은 때부터 센다),
// 단계가 바뀔 때마다(main의 data-step이 바뀐 때) 앞 0.1초 ~ 뒤 0.8초 동안의 그림 간격(requestAnimationFrame),
// long task, long animation frame, 그리고 trace(그 둘레만 켠다)의 주 스레드 일 나눔·떨군 그림을 잰다.
// 판정은 바뀜마다 따로 한다(switch-judge.mjs): 한 간격이라도 그림 세 개 길이(50ms)를 넘거나, 창 안 그림이 기대의 90% 밑이거나,
// 주 스레드 일이 50ms를 넘으면 실패. 떨군 그림(간격 ÷ vsync − 1)을 모두 합한 몫도 5% 이하여야 한다. 실패면 1로 끝난다.
// 무거운 일이라 잠금 안에서만 돌린다:
//   npm run heavy -- node ui/scripts/measure-switch.mjs --mode visible
// ui/dist를 내주는 서버(npm run dev3d -- start, 8201)가 떠 있어야 한다.
//
// --mode headless|visible  headless는 GPU 없이(--disable-gpu) 1920×1080, visible은 진짜 GPU 창(--window 기본 1536,816 = 이 PC 작업 영역)
// --seconds N              잴 시간(기본 headless 10, visible 90). 4초마다 단계가 바뀐다(대시보드 가짜 단계 2→3→4→0→1→2). 0단계는 계획 전 지켜보기
// --trace N                trace를 켤 바뀜 수(기본 headless 전부, visible 4)
// --max-task MS            바뀜 둘레 주 스레드 일 하나의 상한(기본 50)
// --max-gap N              한 그림 간격의 상한, 그림 몇 개 길이(기본 3 = 60Hz에서 50ms)
// --min-frames R           바뀜 하나의 창 안 그림 수 하한, 기대치에 대한 몫(기본 0.9)
// --max-late R             모든 바뀜을 합한 떨군 그림 몫의 상한(기본 0.05)
// --from FILE              크롬을 띄우지 않고 저장한 결과 json(--out의 switch-*.json)을 다시 판정한다
// --profile DIR           크롬 프로필을 이 폴더에 두고 다시 쓴다(기본은 새 임시 폴더라 GPU 셰이더 캐시가 비어 첫 바뀜이 늦다)
// --css RULES             원인을 가를 때 덧붙일 CSS(예: "[data-say-line]{animation:none!important}")
// --runs N                새 크롬으로 N번 재고(실행마다 OUT/run-i), 첫 바뀜 가장 긴 간격을 모아 보인다. 첫 바뀜은 실행마다 한 번뿐이라 여러 번 띄워야 잡힌다
// --gl                    WebGL 부르기마다 걸린 시간을 잰다(1ms 넘는 부르기와 100ms 칸마다 이름별 합). 첫 바뀜 끊김의 원인을 가를 때만 쓴다
// --url URL --out DIR(trace·결과 json 저장)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gapsAround, judgeRun, LIMITS, stepEdges, WIN } from "./switch-judge.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"]);
  return acc;
}, []));
const MODE = args.mode === "visible" ? "visible" : "headless";
const URL_BASE = args.url ?? "http://127.0.0.1:8201/?debug=steps&play=4000";
const SECONDS = Number(args.seconds ?? (MODE === "visible" ? 90 : 10));
const TRACE_N = Number(args.trace ?? (MODE === "visible" ? 4 : 99));
const LIMITS_RUN = {
  maxTask: Number(args["max-task"] ?? LIMITS.maxTask),
  maxGapFrames: Number(args["max-gap"] ?? LIMITS.maxGapFrames),
  minFrameShare: Number(args["min-frames"] ?? LIMITS.minFrameShare),
  maxDropShare: Number(args["max-late"] ?? LIMITS.maxDropShare),
};
const OUT_BASE = args.out ?? null;
let OUT = OUT_BASE;
const PORT = Number(args.port ?? 9531);
const STEP_MS = 4000;
const START_STEP = 2;

const CHROME = args.from ? null : process.env.CHROME ?? [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
].find((p) => existsSync(p));
if (!CHROME && !args.from) { console.error("크롬을 찾지 못했어요. CHROME에 경로를 넣어 주세요."); process.exit(2); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 화면 안에서 재는 것: 그림 시각, long task, long animation frame, 단계 바뀐 때(trace에도 표시). */
const PROBE = `(() => {
  if (window.__sw) return;
  const S = window.__sw = { raf: [], lt: [], loaf: [], switches: [], mounted: null };
  const loop = (t) => { S.raf.push(t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.lt.push({ s: e.startTime, d: e.duration }); }).observe({ type: "longtask", buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.loaf.push({
    s: e.startTime, d: e.duration, b: e.blockingDuration, r: e.renderStart, sl: e.styleAndLayoutStart,
    scripts: (e.scripts || []).map((x) => ({ s: x.startTime, d: x.duration, inv: x.invoker, fn: x.sourceFunctionName || "", fl: x.forcedStyleAndLayoutDuration })),
  }); }).observe({ type: "long-animation-frame", buffered: true }); } catch {}
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      const el = m.target;
      // 처음 다 그린 때: main에 data-ready가 처음 붙은 때(트윈 첫 그림·글꼴·마스코트 그림·미리 그려 보기). 가짜 단계 재생도 이때부터 센다
      if (S.mounted === null && document.querySelector("main[data-ready]")) S.mounted = performance.now();
      if (m.type === "attributes" && m.attributeName === "data-step" && el.tagName === "MAIN") {
        const t = performance.now();
        S.switches.push({ t, step: Number(el.getAttribute("data-step")) });
        performance.mark("sw-" + S.switches.length);
      }
    }
  });
  const start = () => mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-step", "data-ready"] });
  if (document.documentElement) start(); else document.addEventListener("DOMContentLoaded", start);
})();`;

/** --gl: WebGL 부르기 시간 재기(부르기 1ms 이상은 하나씩, 그 밖은 100ms 칸마다 이름별 합). */
const GL_PROBE = `(() => {
  const G = window.__gl = { calls: [], sum: {} };
  for (const P of [window.WebGL2RenderingContext?.prototype, window.WebGLRenderingContext?.prototype]) {
    if (!P) continue;
    for (const n of Object.getOwnPropertyNames(P)) {
      const d0 = Object.getOwnPropertyDescriptor(P, n);
      if (!d0 || typeof d0.value !== "function" || n === "constructor") continue;
      const f = d0.value;
      P[n] = function (...a) {
        const t = performance.now();
        const r = f.apply(this, a);
        const d = performance.now() - t;
        const b = Math.floor(t / 100);
        const s = G.sum[b] ??= {};
        s[n] = (s[n] ?? 0) + d;
        if (d >= 1) G.calls.push({ t, n, d: Math.round(d * 10) / 10, w: a.find((x) => x && typeof x === "object" && "width" in x)?.width ?? null });
        return r;
      };
    }
  }
})();`;

const CATS = [
  "devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame",
  "blink.user_timing", "toplevel", "benchmark", "cc", "viz", "gpu", "v8.execute",
].join(",");

/** trace 이름 → 일 갈래. 갈래마다 자기 시간(안쪽 일 뺀 시간)을 더한다. */
function kindOf(name) {
  if (/^(FunctionCall|EvaluateScript|v8\.|V8\.|RunMicrotasks|TimerFire|FireAnimationFrame|EventDispatch|FireIdleCallback|ParseHTML|CompileScript|CompileCode|ResizeObserver|HandlePostMessage|MessageChannel|ProfileCall)/.test(name)) {
    return /GC|Scavenge|MarkCompact/i.test(name) ? "gc" : "script";
  }
  if (/GC|Scavenge|MarkCompact/i.test(name)) return "gc";
  if (name === "UpdateLayoutTree" || name === "RecalculateStyles" || name === "ParseAuthorStyleSheet") return "style";
  if (name === "Layout" || name === "UpdateLayout") return "layout";
  if (name === "PrePaint") return "prepaint";
  if (name === "Paint" || name === "PaintImage" || name === "PaintArtifactCompositor::Update" || name === "Layerize") return "paint";
  if (/Decode|ImageDecode/i.test(name)) return "decode";
  if (/Raster/i.test(name)) return "raster";
  if (name === "Commit" || name === "ProxyMain::BeginMainFrame::commit" || name === "UpdateLayer" || name === "CompositeLayers") return "commit";
  if (name === "HitTest" || name === "IntersectionObserverController::computeIntersections" || name === "UpdateIntersectionObservers") return "other";
  return "other";
}

/** 한 스레드 X 일들의 자기 시간(ms)을 갈래별로, 창 [a, b](us) 안에 시작한 것만. */
function selfTimes(events, a, b) {
  const sorted = events.filter((e) => e.ts >= a && e.ts <= b).sort((x, y) => x.ts - y.ts || y.dur - x.dur);
  const out = {};
  const stack = [];
  const add = (e, ms) => { const k = kindOf(e.name); out[k] = (out[k] ?? 0) + ms; };
  for (const e of sorted) {
    while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) {
      const done = stack.pop();
      add(done, done.self / 1000);
    }
    if (stack.length) stack.at(-1).self -= Math.min(e.dur, stack.at(-1).ts + stack.at(-1).dur - e.ts);
    stack.push({ ...e, self: e.dur });
  }
  while (stack.length) { const done = stack.pop(); add(done, done.self / 1000); }
  for (const k of Object.keys(out)) out[k] = Math.round(Math.max(0, out[k]) * 10) / 10;
  return out;
}

function analyzeTrace(events) {
  const threads = new Map();
  const procs = new Map();
  for (const e of events) {
    if (e.ph !== "M") continue;
    if (e.name === "thread_name") threads.set(`${e.pid}:${e.tid}`, e.args.name);
    if (e.name === "process_name") procs.set(e.pid, e.args.name);
  }
  const byThread = new Map();
  for (const e of events) {
    if (e.ph !== "X" || !e.dur) continue;
    const k = `${e.pid}:${e.tid}`;
    if (!byThread.has(k)) byThread.set(k, []);
    byThread.get(k).push(e);
  }
  // 주 스레드: CrRendererMain 중 Layout·UpdateLayoutTree가 가장 많은 것
  let main = null;
  let best = -1;
  for (const [k, list] of byThread) {
    if (threads.get(k) !== "CrRendererMain") continue;
    const n = list.filter((e) => e.name === "UpdateLayoutTree" || e.name === "Layout" || e.name === "FunctionCall").length;
    if (n > best) { best = n; main = k; }
  }
  const marks = events.filter((e) => /^sw-\d+$/.test(e.name) && (e.ph === "R" || e.ph === "I" || e.ph === "n" || e.ph === "b" || e.ph === "X" || e.ph === "i"));
  const reporters = events.filter((e) => e.name === "PipelineReporter" && e.ph === "b");
  return { threads, procs, byThread, main, marks, reporters };
}

/** 한 바뀜의 trace 숫자: 주 스레드 가장 긴 일, 막힌 시간, 일 갈래, 그리기 일꾼·GPU의 그리기·풀기, 떨군 그림. */
function traceSwitch(tr, mark) {
  const a = mark.ts - WIN.before * 1000;
  const b = mark.ts + WIN.after * 1000;
  const mainEvents = tr.byThread.get(tr.main) ?? [];
  const tasks = mainEvents.filter((e) => (e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask") && e.ts + e.dur >= a && e.ts <= b);
  // RunTask 안에 RunTask가 겹치면 바깥 것만
  const top = tasks.filter((t) => !tasks.some((o) => o !== t && o.ts <= t.ts && o.ts + o.dur >= t.ts + t.dur && o.dur > t.dur));
  const longest = top.reduce((m, t) => Math.max(m, t.dur / 1000), 0);
  const tbt = top.reduce((s, t) => s + Math.max(0, t.dur / 1000 - 50), 0);
  const longTasks = top.filter((t) => t.dur >= 16_000).map((t) => {
    const inner = mainEvents.filter((e) => e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur);
    return { at: Math.round((t.ts - mark.ts) / 1000), ms: Math.round(t.dur / 100) / 10, kinds: selfTimes(inner, t.ts, t.ts + t.dur) };
  });
  const mainKinds = selfTimes(mainEvents.filter((e) => e.ts + e.dur >= a), a, b);
  // 주 스레드 밖: 그리기 일꾼(타일 그리기·그림 풀기), 합성 스레드, GPU 프로세스(그리기·합성). 자기 시간이 큰 이름 셋씩.
  const groups = {};
  for (const [k, list] of tr.byThread) {
    if (k === tr.main) continue;
    const name = tr.threads.get(k) ?? "";
    const pname = tr.procs.get(Number(k.split(":")[0])) ?? "";
    const group = /GPU/i.test(pname) ? "gpu" : /Renderer/i.test(pname) ? (name === "Compositor" ? "compositor" : /ThreadPool|TileWorker/.test(name) ? "workers" : null) : null;
    if (!group) continue;
    const self = selfByName(list, a, b);
    groups[group] ??= {};
    for (const [n, ms] of Object.entries(self)) groups[group][n] = (groups[group][n] ?? 0) + ms;
  }
  const side = Object.fromEntries(Object.entries(groups).map(([g, names]) => {
    const total = Object.values(names).reduce((s, v) => s + v, 0);
    const top = Object.entries(names).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n, v]) => `${n} ${Math.round(v)}`);
    return [g, `${Math.round(total)}ms (${top.join(", ")})`];
  }));
  // 그림마다 화면에 나간 상태(PipelineReporter)
  const states = {};
  for (const e of tr.reporters) {
    if (e.ts < a || e.ts > b) continue;
    const st = (e.args?.frame_reporter?.state ?? e.args?.chrome_frame_reporter?.state ?? "?").replace(/^STATE_/, "");
    states[st] = (states[st] ?? 0) + 1;
  }
  return { longest: Math.round(longest * 10) / 10, tbt: Math.round(tbt * 10) / 10, longTasks, mainKinds, side, frames: states };
}

/** 이름별 자기 시간(ms), 창 [a, b](us) 안에 시작한 X 일만. */
function selfByName(events, a, b) {
  const sorted = events.filter((e) => e.ts >= a && e.ts <= b).sort((x, y) => x.ts - y.ts || y.dur - x.dur);
  const out = {};
  const stack = [];
  const pop = () => { const d = stack.pop(); out[d.name] = (out[d.name] ?? 0) + Math.max(0, d.self) / 1000; };
  for (const e of sorted) {
    while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) pop();
    if (stack.length) stack.at(-1).self -= Math.min(e.dur, stack.at(-1).ts + stack.at(-1).dur - e.ts);
    stack.push({ name: e.name, ts: e.ts, dur: e.dur, self: e.dur });
  }
  while (stack.length) pop();
  return out;
}

/** 화면 안 숫자로 한 바뀜: 그림 간격, 늦은 그림 수, long task, LoAF 나눔. */
function pageSwitch(S, sw, vsync) {
  const a = sw.t - WIN.before;
  const b = sw.t + WIN.after;
  const gaps = gapsAround(S.raf, sw.t);
  const late = gaps.filter((g) => g > vsync * 1.5).length;
  const veryLate = gaps.filter((g) => g > vsync * 2.5).length;
  const lt = S.lt.filter((e) => e.s + e.d >= a && e.s <= b);
  const loaf = S.loaf.filter((e) => e.s + e.d >= a && e.s <= b).map((e) => {
    const end = e.s + e.d;
    const script = e.scripts.reduce((s, x) => s + x.d, 0);
    const styleLayout = e.sl > 0 ? end - e.sl : 0;
    return {
      at: Math.round(e.s - sw.t), ms: Math.round(e.d), blocking: Math.round(e.b), script: Math.round(script),
      beforeStyle: e.r > 0 && e.sl > 0 ? Math.round(e.sl - e.r) : 0, styleLayout: Math.round(styleLayout),
      top: e.scripts.sort((x, y) => y.d - x.d).slice(0, 2).map((x) => `${x.inv}${x.fn ? ` ${x.fn}` : ""} ${Math.round(x.d)}ms`),
    };
  });
  return {
    frames: gaps.length, gaps: gaps.map((g) => Math.round(g * 10) / 10), late, veryLate, worstGap: Math.round(Math.max(0, ...gaps) * 10) / 10,
    longTask: Math.round(Math.max(0, ...lt.map((e) => e.d))), tbt: Math.round(lt.reduce((s, e) => s + Math.max(0, e.d - 50), 0)),
    loaf,
  };
}

/** --gl 한 바뀜: 창 안 1ms 넘는 WebGL 부르기(바뀐 때 기준 ms)와, 이름별 합이 큰 100ms 칸. */
function glSwitch(G, sw) {
  const a = sw.t - WIN.before;
  const b = sw.t + WIN.after;
  const calls = G.calls.filter((c) => c.t >= a && c.t <= b).map((c) => ({ at: Math.round(c.t - sw.t), n: c.n, d: c.d, ...(c.w ? { w: c.w } : {}) }));
  const buckets = Object.entries(G.sum).filter(([k]) => Number(k) * 100 + 100 >= a && Number(k) * 100 <= b).map(([k, v]) => {
    const total = Object.values(v).reduce((s, x) => s + x, 0);
    const top = Object.entries(v).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([n, d]) => `${n} ${Math.round(d)}`);
    return { at: Math.round(Number(k) * 100 - sw.t), total: Math.round(total), top };
  }).filter((x) => x.total >= 20);
  return { calls, buckets };
}

async function devtools(path) {
  for (let i = 0; i < 120; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}${path}`)).json(); } catch { await wait(250); }
  }
  throw new Error("크롬 devtools에 붙지 못했어요");
}

async function main() {
  const profile = args.profile ?? mkdtempSync(join(tmpdir(), "measure-switch-"));
  const flags = [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--hide-scrollbars",
  ];
  if (MODE === "headless") flags.push("--headless=new", "--disable-gpu", "--window-size=1920,1080");
  else flags.push(`--window-size=${args.window ?? "1536,816"}`, "--window-position=0,0", "--app=about:blank");
  const chrome = spawn(CHROME, [...flags, ...(MODE === "headless" ? ["about:blank"] : [])], { stdio: "ignore" });
  const result = { mode: MODE, url: URL_BASE, seconds: SECONDS, win: WIN, switches: [] };
  try {
    const page = (await devtools("/json/list")).find((t) => t.type === "page");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); });
    let seq = 0;
    const pending = new Map();
    const listeners = new Set();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      for (const l of listeners) l(m);
    });
    const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.result?.value;

    if (MODE === "headless") await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
    // --css: 원인을 가를 때만 쓰는 덧칠(예: 어떤 움직임을 끈 채 재기)
    if (args.css) await send("Page.addScriptToEvaluateOnNewDocument", { source: `document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(args.css)}; document.head.append(s); });` });
    if (args.gl) await send("Page.addScriptToEvaluateOnNewDocument", { source: GL_PROBE });
    if (MODE === "visible") await send("Page.bringToFront");
    const url = URL_BASE + (URL_BASE.includes("?") ? "&" : "?") + "step=" + START_STEP;
    await send("Page.navigate", { url });
    // 처음 다 그린 때(main data-ready)를 기다린다(트윈을 불러오는 데 몇 초 걸린다)
    let mounted = null;
    for (let i = 0; i < 600 && mounted === null; i++) { await wait(100); mounted = await evaluate("window.__sw && window.__sw.mounted"); }
    if (mounted === null) throw new Error("대시보드가 뜨지 않았어요");
    result.viewport = await evaluate("[innerWidth, innerHeight, devicePixelRatio]");
    result.gpu = await evaluate("(() => { try { const c = document.createElement('canvas').getContext('webgl'); const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'webgl'; } catch { return 'none'; } })()");

    // 단계 경계(2단계 시작 = mounted 기준): 4s(2→3), 8s(3→4), … 그 경계마다 trace를 앞 700ms ~ 뒤 900ms만 켠다.
    const edges = stepEdges(SECONDS, STEP_MS);
    let traced = 0;
    const traces = [];
    const now0 = await evaluate("performance.now()");
    const wallAt = Date.now() - (now0 - mounted);
    for (const edge of edges) {
      const startTrace = traced < TRACE_N;
      const until = wallAt + edge - 700 - Date.now();
      if (until > 0) await wait(until);
      if (startTrace) {
        const events = [];
        const onData = (m) => { if (m.method === "Tracing.dataCollected") events.push(...m.params.value); };
        listeners.add(onData);
        const done = new Promise((r) => { const l = (m) => { if (m.method === "Tracing.tracingComplete") { listeners.delete(l); r(); } }; listeners.add(l); });
        await send("Tracing.start", { categories: CATS, transferMode: "ReportEvents" });
        await wait(Math.max(0, wallAt + edge + 900 - Date.now()));
        await send("Tracing.end");
        await done;
        listeners.delete(onData);
        traces.push(events);
        traced++;
      }
    }
    const left = wallAt + SECONDS * 1000 - Date.now();
    if (left > 0) await wait(left);
    const S = await evaluate("JSON.parse(JSON.stringify(window.__sw))");
    const GL = args.gl ? await evaluate("JSON.parse(JSON.stringify(window.__gl ?? null))") : null;
    ws.close();

    const gapsAll = S.raf.slice(1).map((t, i) => t - S.raf[i]).filter((g) => g > 0).sort((x, y) => x - y);
    const vsync = gapsAll[Math.floor(gapsAll.length / 2)] ?? 16.7;
    result.vsync = Math.round(vsync * 100) / 100;
    // 그림 시각 전부(처음 그린 때 기준 ms): 창 밖 끊김도 나중에 볼 수 있게 저장한다
    result.raf = S.raf.filter((t) => t >= S.mounted).map((t) => Math.round((t - S.mounted) * 10) / 10);
    result.switchAt = S.switches.map((s) => Math.round((s.t - S.mounted) * 10) / 10);
    const marksAll = traces.map((ev) => ({ ev, tr: analyzeTrace(ev) }));
    // 단계 바뀜 = data-step이 바뀐 때(처음 다 그린 뒤 1초 안은 뺀다)
    const sws = S.switches.filter((s, i) => s.t - S.mounted > 1000 && (i === 0 || s.step !== S.switches[i - 1].step));
    for (const [i, sw] of sws.entries()) {
      const p = pageSwitch(S, sw, vsync);
      const n = S.switches.indexOf(sw) + 1;
      let t = null;
      for (const { tr } of marksAll) {
        const mark = tr.marks.find((m) => m.name === `sw-${n}`);
        if (mark) { t = traceSwitch(tr, mark); break; }
      }
      const gl = GL ? glSwitch(GL, sw) : undefined;
      result.switches.push({ n: i + 1, at: Math.round(sw.t - S.mounted), to: `${sw.step}단계`, page: p, trace: t, ...(gl ? { gl } : {}) });
    }
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      for (const [i, ev] of traces.entries()) writeFileSync(join(OUT, `trace-${MODE}-${i + 1}.json`), JSON.stringify({ traceEvents: ev }));
      writeFileSync(join(OUT, `switch-${MODE}.json`), JSON.stringify(result, null, 1));
    }
  } finally {
    if (chrome.pid > 4) spawnSync("taskkill", ["/T", "/F", "/PID", String(chrome.pid)], { stdio: "ignore" });
    await wait(500);
    if (!args.profile) try { rmSync(profile, { recursive: true, force: true }); } catch { /* 크롬이 아직 쥐고 있으면 남긴다 */ }
  }
  return result;
}

function report(r) {
  const lines = [];
  const verdict = judgeRun(r, LIMITS_RUN);
  lines.push(`크롬 ${r.mode} ${r.viewport?.join("×")} gpu=${r.gpu} 그림 간격 중앙값 ${r.vsync}ms, 바뀜 ${r.switches.length}번`);
  for (const [i, s] of r.switches.entries()) {
    const p = s.page;
    const v = verdict.switches[i];
    lines.push(`#${s.n} ${s.at}ms ${s.to}: 그림 ${p.frames}, 떨군 그림 ${v.dropped}, 가장 긴 간격 ${p.worstGap}ms, long task ${p.longTask}ms, 막힌 시간 ${p.tbt}ms${v.fails.length ? ` · 실패: ${v.fails.join(", ")}` : ""}`);
    for (const l of (p.loaf ?? []).filter((x) => x.ms >= 50)) lines.push(`    LoAF ${l.at}ms ${l.ms}ms: script ${l.script} · rAF·RO ${l.beforeStyle} · style+layout ${l.styleLayout} | ${l.top.join(", ")}`);
    if (s.trace) {
      const t = s.trace;
      lines.push(`    trace 주 스레드 가장 긴 일 ${t.longest}ms, 막힌 시간 ${t.tbt}ms, 창 안 자기 시간 ${JSON.stringify(t.mainKinds)}`);
      lines.push(`    그리기·풀기 ${JSON.stringify(t.side)}, 그림 상태 ${JSON.stringify(t.frames)}`);
      for (const lt of t.longTasks) lines.push(`    일 ${lt.at}ms ${lt.ms}ms ${JSON.stringify(lt.kinds)}`);
    }
    if (s.gl) {
      for (const c of s.gl.calls.filter((x) => x.d >= 5)) lines.push(`    GL ${c.at}ms ${c.n} ${c.d}ms${c.w ? ` (${c.w}px)` : ""}`);
      for (const k of s.gl.buckets) lines.push(`    GL 칸 ${k.at}ms 합 ${k.total}ms: ${k.top.join(", ")}`);
    }
  }
  const share = verdict.expected ? verdict.dropped / verdict.expected : 0;
  lines.push(`합: 떨군 그림 ${verdict.dropped}/${verdict.expected} (${(share * 100).toFixed(1)}%), 가장 긴 일 ${Math.round(verdict.worstTask)}ms`);
  const L = LIMITS_RUN;
  lines.push(verdict.ok
    ? `통과: 바뀜마다 간격 그림 ${L.maxGapFrames}개 길이 이하·그림 ${Math.round(L.minFrameShare * 100)}% 이상·일 ${L.maxTask}ms 이하, 떨군 그림 합 ${(L.maxDropShare * 100).toFixed(1)}% 이하`
    : `실패: ${verdict.fails.join(" / ")}`);
  console.log(lines.join("\n"));
  return verdict.ok ? 0 : 1;
}

if (args.from) process.exit(report(JSON.parse(readFileSync(args.from, "utf8"))));

/** --runs N: 새 크롬(새 프로필)을 N번 띄워 재고, 실행마다 판정한 뒤 화면이 뜬 뒤 첫 바뀜의 가장 긴 간격을 모아 보인다. 하나라도 실패면 1. */
async function runs(n) {
  const firsts = [];
  let failed = 0;
  for (let i = 1; i <= n; i++) {
    console.log(`== 실행 ${i}/${n}`);
    OUT = OUT_BASE && join(OUT_BASE, `run-${i}`);
    const r = await main();
    if (report(r)) failed++;
    firsts.push(r.switches[0]?.page.worstGap ?? null);
  }
  console.log(`첫 바뀜 가장 긴 간격(ms): ${firsts.join(", ")} · 실패한 실행 ${failed}/${n}`);
  return failed ? 1 : 0;
}

if (Number(args.runs) > 1) runs(Number(args.runs)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(3); });
else main().then((r) => process.exit(report(r)), (e) => { console.error(e); process.exit(3); });
