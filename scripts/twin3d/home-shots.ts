// npm run capture -- --home-shots [--out runtime/shots] [--software] [--depth] [--holdout] [--views <json>]
// --views: 장면 목록 대신 그 파일의 카메라(id·position·yaw_deg·pitch_deg·vfov_deg, doors 선택)만 찍는다(예: 실영상 시작 자리 깊이).
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { build } from "esbuild";
import type { SceneObject } from "../../src/contract/layout.js";
import { resolveHome, type Home } from "../../src/layout/homes.js";
import { loadScene } from "../../src/layout/scene.js";
import { BAKED_SCENE_PATH, SCENE_PATH } from "../../src/shared/scene-paths.js";
import { chromePath, closeChrome, devtoolsPort, launchChrome, openPage, type Page } from "./cdp.js";
import { withTimeout } from "./capture-lib.js";
import { withHeavy } from "./heavy.js";
import { height, homeShotViews, width } from "./home-shot-views.js";

/** 장면 사진용 가짜 서버: 그리기 페이지·묶은 스크립트·집 장면·구운 자산만 답한다. 배치를 고치지 않았으니 구운 장면과 고친 배치 장면이 같다. */
export async function shotServer(home: Home, scene: NonNullable<ReturnType<typeof loadScene>>) {
  const bundle = await build({
    entryPoints: ["scripts/twin3d/home-shot-browser.mjs"], bundle: true, format: "esm", write: false,
    alias: { "@viewer": resolve(home.viewerDir) }, nodePaths: [resolve("ui/node_modules")],
  });
  const assets = new Map<string,string>();
  const bake = join(home.outDir, "bake");
  for (const name of readdirSync(bake)) assets.set("/twin/bake/" + name, join(bake, name));
  for (const obj of scene.objects as SceneObject[]) {
    if (!scene.added?.includes(obj.id) || !obj.asset) continue;
    const file = obj.asset.startsWith("lib/") ? join(home.libraryDir, obj.asset.slice(4)) : join(home.outDir, obj.asset);
    assets.set("/twin/" + obj.asset, file);
  }
  const mime: Record<string,string> = { ".webp": "image/webp", ".png": "image/png", ".glb": "model/gltf-binary", ".json": "application/json" };
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    if (url === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end('<!doctype html><link rel="icon" href="data:,"><style>*{margin:0}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas>');
    } else if (url === "/render.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle.outputFiles[0]!.contents);
    } else if (url === SCENE_PATH || url === BAKED_SCENE_PATH) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ scene }));
    } else if (assets.has(url)) {
      const file = assets.get(url)!;
      res.setHeader("Content-Type", mime[extname(file)] ?? "application/octet-stream");
      createReadStream(file).on("error", e => res.destroy(e)).pipe(res);
    } else res.writeHead(404).end();
  });
  await new Promise<void>((ready, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ready);
  });
  return server;
}

/** --views 파일의 카메라 줄. 없는 칸은 장면 목록과 같은 기본값(1920×1080, 문은 그대로)으로 채운다. */
export function customViews(rows: unknown): ReturnType<typeof homeShotViews> {
  if (!Array.isArray(rows) || !rows.length) throw new Error("--views 파일은 카메라 줄 배열이어야 합니다.");
  return rows.map((r, i) => {
    const row = r as Record<string, unknown>;
    const id = String(row.id ?? "");
    const position = row.position as number[] | undefined;
    const nums = [row.yaw_deg, row.pitch_deg, row.vfov_deg];
    if (!/^[A-Za-z0-9_-]+$/.test(id) || !Array.isArray(position) || position.length !== 3 ||
        ![...position, ...nums].every(v => typeof v === "number" && Number.isFinite(v)))
      throw new Error(`--views ${i}번 줄: id·position[x,높이,y]·yaw_deg·pitch_deg·vfov_deg가 필요합니다.`);
    return { ...row, id, file: id + ".png", position, yaw_deg: row.yaw_deg, pitch_deg: row.pitch_deg, vfov_deg: row.vfov_deg,
      width, height, doors: (row.doors ?? {}) as Record<string,string> } as unknown as ReturnType<typeof homeShotViews>[number];
  });
}

export async function captureHomeShots(out: string, software: boolean, depth = false, holdout = false, viewsFile?: string) {
  const home = resolveHome("twin", "mokryeon_180b");
  const scene = loadScene(home);
  if (!scene) throw new Error("목련 집 장면을 찾을 수 없습니다.");
  const views = viewsFile ? customViews(JSON.parse(readFileSync(viewsFile, "utf8"))) : homeShotViews(home, scene, holdout);
  const shots = views.map(s => ({ ...s, home: home.id,
    ...(depth ? { depth_file: s.id + ".depth.png", depth_encoding: "axial_mm_rg16" } : {}) }));
  const exe = chromePath();
  await withHeavy("capture mokryeon first-person", async lock => {
    if (existsSync(out)) throw new Error(`출력 폴더가 이미 있습니다. --out 으로 새 폴더를 고르세요: ${out}`);
    mkdirSync(dirname(out), { recursive: true });
    const stage = mkdtempSync(out + ".partial-");
    try {
      const server = await shotServer(home, scene);
      try {
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const chrome = launchChrome({ path: exe, size: [width,height], gpu: software ? "swiftshader" : "headless-gpu" });
        lock.note({ chromePid: chrome.proc.pid });
        let page: Page | undefined;
        const errors: string[] = [];
        try {
          page = await openPage(await devtoolsPort(chrome), message => errors.push(message));
          await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
          const loaded = new Promise<void>(ready => page!.on("Page.loadEventFired", () => ready()));
          await page.send("Page.navigate", { url });
          await withTimeout(loaded, 30000, "촬영 페이지");
          await page.evaluate('import("/render.js").then(async m => { window.drawHomeShot = await m.loadRoom(); return true })', 180000);
          for (const shot of shots) {
            await page.evaluate(`window.drawHomeShot(${JSON.stringify(shot)})`, 60000);
            const png = await page.screenshot({ format: "png" }, 60000);
            if (errors.length) throw new Error(errors.join("\n"));
            if (png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) throw new Error(shot.id + " PNG 크기 오류");
            writeFileSync(join(stage, shot.file), png);
            if (shot.depth_file) {
              const packed = await page.evaluate(`window.drawHomeShot(${JSON.stringify(shot)}, true)`, 60000);
              if (typeof packed !== "string" || !packed) throw new Error(shot.id + " 깊이 렌더 오류");
              writeFileSync(join(stage, shot.depth_file), Buffer.from(packed,"base64"));
              if (errors.length) throw new Error(errors.join("\n"));
            }
            console.log(shot.id);
          }
        } finally {
          page?.close();
          await closeChrome(chrome);
        }
      } finally { server.closeAllConnections(); server.close(); }
      writeFileSync(join(stage, "manifest.json"), JSON.stringify(shots, null, 2) + "\n");
      renameSync(stage, out);
    } finally {
      if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
    }
  });
}
