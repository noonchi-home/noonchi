// twin-studio 결과물 중 서버·뷰어가 읽는 것만 이 저장소 twin/으로 복사한다. twin-studio 위치는 인자로 받는다.
//   npx tsx scripts/twin-assets.ts --from <twin-studio 폴더> [--commit <커밋>] [--to twin] [--only <경로>]…
// 복사: homes.json, 뷰어(test/ 빼고), library/assets, data/catalog, 집마다 floorplan.json·placement.json·drawn_fixtures.json·catalog/, scene.json·assets/,
// bake/의 *_baked.glb·lm<n>.webp·ground.png·manifest.json. --only <경로>(여러 번, 끝이 /면 그 아래 전부)는 고른 파일만 바꾸고
// 다른 파일과 SOURCE.json 줄은 그대로 두며, 바꾼 줄에 그 커밋을 단다.
// 글 파일(json·mjs·js·html·css)은 줄 끝을 LF로 맞춘다. twin/SOURCE.json에 커밋과 파일마다 sha256을 적는다.
// --to는 비었거나 이전 복사 결과(SOURCE.json)인 폴더만 지우고 새로 쓴다. 저장소 뿌리와 그 위 폴더는 거절한다.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readRegistry } from "../src/layout/homes.js";

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

/** 이 저장소 뿌리. */
const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** child가 parent와 같거나 그 안에 있는가. */
function within(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** 지워도 되는 복사할 곳인가: 없거나 비었거나 이전 복사 결과(SOURCE.json source twin-studio)다. 저장소 뿌리와 그 위 폴더, twin-studio를 품는 폴더는 거절한다. */
function checkTarget(to: string, from: string): void {
  if (within(from, to)) throw new Error(`복사할 곳(${to})이 twin-studio 폴더를 품어요. 다른 폴더를 주세요.`);
  if (within(REPO, to)) throw new Error(`복사할 곳(${to})이 이 저장소 뿌리이거나 그 위 폴더예요. 저장소 안 twin/을 주세요.`);
  if (!existsSync(to) || readdirSync(to).length === 0) return;
  let source: unknown = null;
  try {
    source = JSON.parse(readFileSync(join(to, "SOURCE.json"), "utf8")).source;
  } catch { /* 이전 복사 결과가 아님 */ }
  if (source !== "twin-studio") throw new Error(`복사할 곳(${to})이 비어 있지 않고 이전 복사 결과(SOURCE.json)도 아니에요. 빈 폴더나 twin/을 주세요.`);
}

/** 구운 결과 중 화면이 읽는 것. 굽기 장면·중간 파일(bake.blend, lm/, lm<n>.png, layout.json, timings.json)은 twin-studio에 남는다. */
const BAKE_FILE = /^(?:[\w-]+_baked\.glb|lm\d+\.webp|ground\.png|manifest\.json)$/;
const HOME_DATA = ["floorplan.json", "placement.json", "drawn_fixtures.json"];
/** SOURCE.json 한 줄. patched: 이 저장소에서 고친 복사본의 고친 커밋(해시는 고친 내용, docs/provenance.md). --only가 아닌 새 복사는 고친 것을 덮는다. */
type Entry = { path: string; bytes: number; sha256: string; commit?: string; patched?: string };
const byPath = (a: Entry, b: Entry) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function copyTwinAssets(o: { from: string; to: string; commit?: string; only?: string[] }): { files: number; bytes: number; commit: string } {
  const from = resolve(o.from);
  const to = resolve(o.to);
  checkTarget(to, from);
  const reg = readRegistry(from);
  const commit = o.commit ?? gitCommit(from);
  const only = o.only?.map((p) => p.replace(/\\/g, "/"));
  const wanted = (rel: string) => !only || only.some((p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p));
  const relOf = (p: string) => relative(from, p).replace(/\\/g, "/");
  const picks = new Set<string>([join(from, "homes.json")]);
  walk(reg.viewerDir, (rel) => rel === "test" || rel.startsWith("test/")).forEach((p) => picks.add(p));
  walk(join(reg.libraryDir, "assets")).forEach((p) => picks.add(p));
  walk(join(from, "data", "catalog")).forEach((p) => picks.add(p));
  for (const h of reg.homes) {
    if (existsSync(h.scenePath)) picks.add(h.scenePath);
    else if (!only) throw new Error(`집 ${h.id}의 scene.json이 없어요(${h.scenePath}). twin-studio에서 먼저 빌드하세요.`);
    walk(join(h.outDir, "assets")).forEach((p) => picks.add(p));
    const bake = join(h.outDir, "bake");
    walk(bake).filter((p) => dirname(p) === bake && BAKE_FILE.test(basename(p))).forEach((p) => picks.add(p));
    for (const f of HOME_DATA) if (existsSync(join(h.dataDir, f))) picks.add(join(h.dataDir, f));
    walk(join(h.dataDir, "catalog")).forEach((p) => picks.add(p));
  }
  const chosen = [...picks].filter((p) => wanted(relOf(p))).sort();
  if (only && chosen.length === 0) throw new Error(`--only ${only.join(", ")}에 맞는 파일이 없어요.`);
  // --only: 이전 SOURCE.json의 다른 줄과 파일은 그대로 두고, 고른 경로의 파일만 지우고 다시 쓴다
  let kept: Entry[] = [];
  let top = commit;
  if (only) {
    if (!existsSync(join(to, "SOURCE.json"))) throw new Error(`--only는 이전 복사 결과가 있는 폴더에만 써요(${to}).`);
    const prev = JSON.parse(readFileSync(join(to, "SOURCE.json"), "utf8")) as { commit: string; files: Entry[] };
    top = prev.commit;
    kept = prev.files.filter((f) => !wanted(f.path));
    for (const f of prev.files.filter((x) => wanted(x.path))) rmSync(join(to, f.path), { force: true });
  } else rmSync(to, { recursive: true, force: true });
  const files: Entry[] = [];
  for (const p of chosen) {
    const rel = relOf(p);
    const dest = join(to, rel);
    mkdirSync(dirname(dest), { recursive: true });
    // 글 파일은 LF로 맞춘다(.gitattributes eol=lf와 같은 내용이라 어느 OS에서 받아도 sha256이 맞는다)
    const body = TEXT.test(rel) ? Buffer.from(readFileSync(p, "utf8").replace(/\r\n/g, "\n"), "utf8") : readFileSync(p);
    if (TEXT.test(rel)) writeFileSync(dest, body);
    else copyFileSync(p, dest);
    files.push({ path: rel, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), ...(only ? { commit } : {}) });
  }
  const all = [...kept, ...files].sort(byPath);
  writeFileSync(join(to, "SOURCE.json"), `${JSON.stringify({ source: "twin-studio", commit: top, homes: reg.homes.map((h) => h.id), files: all }, null, 2)}\n`);
  return { files: files.length, bytes: files.reduce((a, f) => a + f.bytes, 0), commit };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const from = arg("--from");
  if (!from) { console.error("쓰는 법: npx tsx scripts/twin-assets.ts --from <twin-studio 폴더> [--commit <커밋>] [--to twin] [--only <경로>]…"); process.exit(2); }
  const to = resolve(arg("--to") ?? fileURLToPath(new URL("../twin/", import.meta.url)));
  const only = process.argv.flatMap((a, i, all) => (a === "--only" && all[i + 1] ? [all[i + 1]!] : []));
  const r = copyTwinAssets({ from, to, commit: arg("--commit"), ...(only.length ? { only } : {}) });
  console.log(`복사: ${r.files}개 ${(r.bytes / 1e6).toFixed(1)}MB → ${to} (twin-studio ${r.commit})`);
}
