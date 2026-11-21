// npm run capture -- --url <주소> --out <폴더> (--views a,b | --script <파일>) [--legacy] [--ready <CSS 선택자>] [--gpu] [--size 960x600] [--timeout 90] [--load-timeout 300]
// 잠금을 잡고 크롬 하나만 띄운다(빈 포트, 임시 프로필, cdp.ts). 기다리는 것: 새 엔진은 window.__twin3d.ready(기본), 옛 뷰어(--legacy)는 window.aptViewer,
// --ready면 페이지 불러오기가 끝나고 그 CSS 선택자에 맞는 요소가 생길 때(React 대시보드처럼 엔진 객체가 없는 페이지. 예: --ready "[data-check]").
// 집 픽셀은 3D 마스크(물건 흰색·배경 검정으로 한 장, 사진 안 캔버스 자리 left·top, 화면 크기 cssWidth·cssHeight)로 가르고, 통계용 사진은 덮개(HUD·미니맵·이름표)를 숨기고 찍는다.
// --ready 페이지는 마스크·통계 없이 화면 그대로 <이름>.png를 찍고, 스크립트 줄은 shot·wait만 된다. --views 이름마다 사진 한 장.
// 옛 뷰어 보기는 overview·room:<id>만 된다. 안 되는 보기·줄은 크롬을 띄우기 전에 멈춘다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { legacyView, pageStep, readyCheck, stepsOf } from "./capture-lib.js";
import { chromePath, closeChrome, devtoolsPort, launchChrome, openPage, type Page } from "./cdp.js";
import { withHeavy } from "./heavy.js";
import { maskFromBits, sampleColors, shotStats, type MaskBits } from "./shot-stats.js";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
if (process.argv.includes("--home-shots")) {
  const { captureHomeShots } = await import("./home-shots.js");
  await captureHomeShots(arg("out", "runtime/shots")!, process.argv.includes("--software"),
    process.argv.includes("--depth"), process.argv.includes("--holdout"));
  process.exit(0);
}
const url = arg("url")!;
const out = arg("out")!;
if (!url || !out) { console.error("쓰는 법: npm run capture -- --url <주소> --out <폴더> (--views a,b | --script <파일>) [--legacy] [--ready <CSS 선택자>]"); process.exit(2); }
const legacy = process.argv.includes("--legacy");
const selector = arg("ready");
const page = selector !== undefined;
const gpu = process.argv.includes("--gpu");
const [W, H] = arg("size", "960x600")!.split("x").map(Number) as [number, number];
const viewMs = Number(arg("timeout", "90")) * 1000;
const loadMs = Number(arg("load-timeout", "300")) * 1000;
const steps = arg("script")
  ? readFileSync(arg("script")!, "utf8").split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#"))
  : stepsOf(arg("views", "overview")!.split(","), page);
let READY = "";
try {
  READY = readyCheck({ legacy, selector });
  if (legacy) for (const s of steps) if (s.startsWith("view:")) legacyView(s.slice(5));
  if (page) for (const s of steps) pageStep(s);
} catch (e) { console.error((e as Error).message); process.exit(2); }
const chromeExe = chromePath();
mkdirSync(out, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const median = (c: [number, number, number][]) => (c.length ? [0, 1, 2].map((k) => c.map((x) => x[k]!).sort((a, b) => a - b)[Math.floor((c.length - 1) / 2)]) : null);

// 옛 뷰어 마스크는 바닥판을 숨기고 흰 재질·검정 배경으로 한 장 그려 읽는다.
const MASK_BITS = `(gl, w, h) => { const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const bits = new Uint8Array(Math.ceil(w * h / 8));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[((h - 1 - y) * w + x) * 4] > 127) { const i = y * w + x; bits[i >> 3] |= 1 << (i & 7); }
  let s = ""; for (const b of bits) s += String.fromCharCode(b); const r = gl.canvas.getBoundingClientRect();
  return { width: w, height: h, bits: btoa(s), left: r.left, top: r.top, cssWidth: r.width, cssHeight: r.height }; }`;
const LEGACY_MASK = `(() => { const v = window.aptViewer, T = v.THREE; v.setPaused(true);
  const hidden = []; v.scene.traverse((o) => { if (o.isMesh && o.visible && o.geometry?.type === "PlaneGeometry" && Math.abs(o.position.y + 0.15) < 1e-6) { o.visible = false; hidden.push(o); } });
  const bg = v.scene.background, ov = v.scene.overrideMaterial, tm = v.renderer.toneMapping;
  v.scene.background = new T.Color(0); v.scene.overrideMaterial = new T.MeshBasicMaterial({ color: 0xffffff }); v.renderer.toneMapping = T.NoToneMapping;
  v.renderer.render(v.scene, v.camera);
  const c = v.renderer.domElement, m = (${MASK_BITS})(v.renderer.getContext(), c.width, c.height);
  v.scene.background = bg; v.scene.overrideMaterial = ov; v.renderer.toneMapping = tm; hidden.forEach((o) => { o.visible = true; }); v.setPaused(false);
  return m; })()`;

await withHeavy(`capture ${url}`, async (lock) => {
  const chrome = launchChrome({ path: chromeExe, size: [W, H], gpu });
  lock.note({ chromePid: chrome.proc.pid });
  const errors: string[] = [];
  const views: Record<string, unknown> = {};
  const measures: Record<string, unknown> = {};
  let cdp: Page | null = null;
  let load = 0;
  try {
    cdp = await openPage(await devtoolsPort(chrome), (msg) => errors.push(msg));
    const send = cdp.send;
    const evaluate = (expression: string, ms = viewMs) => cdp!.evaluate(expression, ms);
    await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url });
    const started = Date.now();
    while (!(await evaluate(READY))) {
      if (Date.now() - started > loadMs) throw new Error(`불러오기 시간 초과(${loadMs / 1000}초)`);
      await sleep(500);
    }
    load = Date.now() - started;
    if (legacy && (await evaluate("window.aptViewer.results.error ?? null"))) throw new Error(`옛 뷰어 오류: ${await evaluate("String(window.aptViewer.results.error)")}`);
    const shot = (quality: number) => cdp!.screenshot({ format: "jpeg", quality }, viewMs);
    const shoot = async (name: string) => {
      if (page) {
        const file = `${name.replace(/[:,/]/g, "_")}.png`;
        writeFileSync(join(out, file), await cdp!.screenshot({ format: "png" }, viewMs));
        views[name] = { file };
        return;
      }
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
        await evaluate(legacyView(a));
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
    writeFileSync(join(out, "stats.json"), JSON.stringify({ url, size: [W, H], legacy, ready: selector ?? null, gpu, loadMs: load, views, measures, errors }, null, 1));
    cdp?.close();
    await closeChrome(chrome);
  }
  console.log(JSON.stringify({ views: Object.keys(views), measures, errors }, null, 1));
  if (errors.length) process.exitCode = 1;
});
