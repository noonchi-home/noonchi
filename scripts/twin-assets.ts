// twin-studio 결과물 중 서버·뷰어가 읽는 것만 이 저장소 twin/으로 복사한다. twin-studio 위치는 인자로 받는다.
//   npx tsx scripts/twin-assets.ts --from <twin-studio 폴더> [--commit <커밋>] [--to twin]
// 복사: homes.json, 뷰어(test/ 빼고), library/assets, data/catalog, 집마다 floorplan.json·placement.json·catalog/, scene.json·assets/.
// 글 파일(json·mjs·js·html·css)은 줄 끝을 LF로 맞춘다. twin/SOURCE.json에 커밋과 파일마다 sha256을 적는다.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readRegistry } from "../src/model/homes.js";

const TRACKED = ["homes.json", "apartment/viewer", "data"];
/** 줄 끝을 LF로 맞춰 복사하는 글 파일. 나머지(GLB 등)는 바이트 그대로. */
const TEXT = /\.(json|mjs|js|html|css)$/;

function walk(dir: string, skip: (rel: string) => boolean = () => false, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const rel = relative(base, p).replace(/\\/g, "/");
    if (skip(rel)) continue;
    if (statSync(p).isDirectory()) out.push(...walk(p, skip, base));
    else out.push(p);
  }
  return out;
}

function gitCommit(dir: string): string {
  try {
    const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = execFileSync("git", ["-C", dir, "status", "--porcelain", "--", ...TRACKED], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (dirty) throw new Error(`twin-studio에 커밋하지 않은 변경이 있어요(${dir}). 정리하거나 --commit으로 커밋을 적어 주세요.`);
    return head;
  } catch (e) {
    if ((e as Error).message.startsWith("twin-studio에")) throw e;
    throw new Error(`git 커밋을 알 수 없어요(${dir}). --commit <커밋>을 주세요.`);
  }
}

export function copyTwinAssets(o: { from: string; to: string; commit?: string }): { files: number; bytes: number; commit: string } {
  const from = resolve(o.from);
  const to = resolve(o.to);
  if (to === from || from.startsWith(`${to}\\`) || from.startsWith(`${to}/`)) throw new Error(`복사할 곳(${to})이 twin-studio 폴더를 품어요. 다른 폴더를 주세요.`);
  const reg = readRegistry(from);
  const commit = o.commit ?? gitCommit(from);
  const picks = new Set<string>([join(from, "homes.json")]);
  walk(reg.viewerDir, (rel) => rel === "test" || rel.startsWith("test/")).forEach((p) => picks.add(p));
  walk(join(reg.libraryDir, "assets")).forEach((p) => picks.add(p));
  walk(join(from, "data", "catalog")).forEach((p) => picks.add(p));
  for (const h of reg.homes) {
    if (!existsSync(h.scenePath)) throw new Error(`집 ${h.id}의 scene.json이 없어요(${h.scenePath}). twin-studio에서 먼저 빌드하세요.`);
    picks.add(h.scenePath);
    walk(join(h.outDir, "assets")).forEach((p) => picks.add(p));
    for (const f of ["floorplan.json", "placement.json"]) if (existsSync(join(h.dataDir, f))) picks.add(join(h.dataDir, f));
    walk(join(h.dataDir, "catalog")).forEach((p) => picks.add(p));
  }
  rmSync(to, { recursive: true, force: true });
  const files: { path: string; bytes: number; sha256: string }[] = [];
  for (const p of [...picks].sort()) {
    const rel = relative(from, p).replace(/\\/g, "/");
    const dest = join(to, rel);
    mkdirSync(dirname(dest), { recursive: true });
    // 글 파일은 LF로 맞춘다(.gitattributes eol=lf와 같은 내용이라 어느 OS에서 받아도 sha256이 맞는다)
    const body = TEXT.test(rel) ? Buffer.from(readFileSync(p, "utf8").replace(/\r\n/g, "\n"), "utf8") : readFileSync(p);
    if (TEXT.test(rel)) writeFileSync(dest, body);
    else copyFileSync(p, dest);
    files.push({ path: rel, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") });
  }
  writeFileSync(join(to, "SOURCE.json"), `${JSON.stringify({ source: "twin-studio", commit, homes: reg.homes.map((h) => h.id), files }, null, 2)}\n`);
  return { files: files.length, bytes: files.reduce((a, f) => a + f.bytes, 0), commit };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const from = arg("--from");
  if (!from) { console.error("쓰는 법: npx tsx scripts/twin-assets.ts --from <twin-studio 폴더> [--commit <커밋>] [--to twin]"); process.exit(2); }
  const to = resolve(arg("--to") ?? fileURLToPath(new URL("../twin/", import.meta.url)));
  const r = copyTwinAssets({ from, to, commit: arg("--commit") });
  console.log(`복사: ${r.files}개 ${(r.bytes / 1e6).toFixed(1)}MB → ${to} (twin-studio ${r.commit})`);
}
