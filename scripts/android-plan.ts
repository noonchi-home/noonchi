// 안드로이드 간략 평면도 그리기: 웹 평면도 SVG(ui/src/mobile/mokryeon-plan.svg, Pretendard SemiBold 조각을 품음)를 크롬 하나로
// 840×763 투명 PNG로 그려 apps/android/assets/mokryeon-plan.png에 쓴다. PNG tEXt(noonchi:source-sha256)에 그린 SVG의 sha256을 적고,
// tests/android-plan.test.ts가 지금 SVG와 맞는지 본다. npm run tokens로 SVG 글꼴 조각이 바뀌면 이것도 다시 돌린다.
// 사용: npm run heavy -- npx tsx scripts/android-plan.ts
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { PLAN_SVG, repoPath } from "./design-tokens.js";
import { chromePath, closeChrome, devtoolsPort, launchChrome, openPage } from "./twin3d/cdp.js";

export const PLAN_PNG = "apps/android/assets/mokryeon-plan.png";
const SIZE: [number, number] = [840, 763];
const SOURCE_KEY = "noonchi:source-sha256";

/** PNG의 tEXt 조각(이름 → 글). */
export function pngText(png: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  for (let at = 8; at + 8 <= png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    if (type === "tEXt") {
      const body = png.subarray(at + 8, at + 8 + length);
      const nul = body.indexOf(0);
      out[body.toString("latin1", 0, nul)] = body.toString("latin1", nul + 1);
    }
    if (type === "IEND") break;
    at += 12 + length;
  }
  return out;
}

/** IHDR 바로 뒤에 tEXt 조각 하나를 넣는다. */
export function withText(png: Buffer, key: string, value: string): Buffer {
  const typeAndData = Buffer.from(`tEXt${key}\0${value}`, "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(typeAndData.length - 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData) >>> 0);
  const afterHeader = 8 + 12 + png.readUInt32BE(8);
  return Buffer.concat([png.subarray(0, afterHeader), length, typeAndData, crc, png.subarray(afterHeader)]);
}

async function main() {
  const svg = readFileSync(repoPath(PLAN_SVG), "utf8").replace(/\r\n/g, "\n");
  const errors: string[] = [];
  const chrome = launchChrome({ path: chromePath(), size: SIZE });
  try {
    const page = await openPage(await devtoolsPort(chrome), (message) => errors.push(message));
    await page.send("Emulation.setDeviceMetricsOverride", { width: SIZE[0], height: SIZE[1], deviceScaleFactor: 1, mobile: false });
    await page.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    const html = `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:${SIZE[0]}px}</style><img src="${image}">`;
    const loaded = new Promise<void>((resolve) => { const off = page.on("Page.loadEventFired", () => { off(); resolve(); }); });
    await page.send("Page.navigate", { url: `data:text/html;base64,${Buffer.from(html).toString("base64")}` });
    await loaded;
    // <img> 안 SVG는 품은 글꼴을 받은 뒤에 글자를 그린다: 그림을 풀고 두 프레임 더 기다린다.
    await page.evaluate("document.images[0].decode().then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))", 10_000);
    const png = await page.screenshot({ format: "png" }, 10_000);
    page.close();
    if (errors.length) throw new Error(errors.join("\n"));
    writeFileSync(repoPath(PLAN_PNG), withText(png, SOURCE_KEY, createHash("sha256").update(svg).digest("hex")));
    console.log(`만듦 ${PLAN_PNG}`);
  } finally {
    await closeChrome(chrome);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
