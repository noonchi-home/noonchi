// 이동 가능 점 격자 그림: npx tsx scripts/walk-grid-svg.ts [--home mokryeon_180b] [--step 0.3] [--out runtime/walk-grid.svg]
// 평면도(방·벽), 가구 바닥 상자(실선)와 걷기 여유 0.18m(점선), 격자 점과 이음(가장 큰 덩어리는 진홍, 떨어진 덩어리는 주황), 문 점(진한 점),
// 대기·관찰 자리·가구 앞자리·충전 자리(이름표)를 SVG 한 장으로 쓴다. 위가 평면 z가 작은 쪽이다.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SceneObject, Vec2 } from "../src/contract/layout.js";
import { loadCatalog } from "../src/layout/catalog.js";
import { resolveHome } from "../src/layout/homes.js";
import { loadScene } from "../src/layout/scene.js";
import { DEFAULT_TWIN_DIR } from "../src/layout/twin-files.js";
import { walkingGeometry } from "../src/layout/walk-guide.js";
import { WALK_STEP, attach, gridParts, walkGrid } from "../src/layout/walk-grid.js";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const homeId = arg("home", "mokryeon_180b");
const step = Number(arg("step", String(WALK_STEP)));
const out = arg("out", "runtime/walk-grid.svg");

const home = resolveHome(DEFAULT_TWIN_DIR, homeId);
const scene = loadScene(home);
if (!scene) throw new Error(`장면이 없어요: ${homeId}`);
const catalog = loadCatalog(home.catalogDir);
const footprint = (type: string) => catalog.get(type)?.footprint;
const g = walkingGeometry(scene, footprint);
const grid = walkGrid(g, step);
const parts = gridParts(grid);
const sizes = new Map<number, number>();
for (const p of parts) sizes.set(p, (sizes.get(p) ?? 0) + 1);
const main = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]![0];

const PX = 60;
const PAD = 0.5;
const corners = g.floor.rooms.flatMap((r) => r.polygon);
const x0 = Math.min(...corners.map((p) => p[0])) - PAD, z0 = Math.min(...corners.map((p) => p[1])) - PAD;
const w = (Math.max(...corners.map((p) => p[0])) + PAD - x0) * PX, h = (Math.max(...corners.map((p) => p[1])) + PAD - z0) * PX;
const X = (v: number) => ((v - x0) * PX).toFixed(1);
const Z = (v: number) => ((v - z0) * PX).toFixed(1);
const pts = (poly: Vec2[]) => poly.map((p) => `${X(p[0])},${Z(p[1])}`).join(" ");
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const reachable = new Set(g.floor.robot.reachable);
const svg: string[] = [];

for (const r of g.floor.rooms) svg.push(`<polygon points="${pts(r.polygon)}" fill="${reachable.has(r.id) ? "#f7f3ee" : "#e2dedb"}" stroke="#b9b2ad" stroke-width="1"/>`);
for (const wall of g.walls) svg.push(`<line x1="${X(wall.a[0])}" y1="${Z(wall.a[1])}" x2="${X(wall.b[0])}" y2="${Z(wall.b[1])}" stroke="#413f3f" stroke-width="${Math.max(2, wall.thickness * PX).toFixed(1)}" stroke-linecap="square"/>`);
for (const o of scene.objects as SceneObject[]) {
  if (o.mount !== "floor" || !o.room || (o.plan.elevation ?? 0) >= 1.8) continue;
  const dims = o.footprint ?? footprint(o.type);
  if (!dims) continue;
  const yaw = o.rotation?.[1] ?? ((90 - o.plan.facing_deg) * Math.PI) / 180;
  const box = (extra: number): Vec2[] => {
    const [hw, hd] = [(dims[0] * (o.scale?.[0] ?? 1)) / 2 + extra, (dims[1] * (o.scale?.[2] ?? 1)) / 2 + extra];
    const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
    // walkingGeometry와 같은 상자: 지역 (u, v) → 평면 (x, z) = (u·c + v·s, −u·s + v·c)
    return ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as Vec2[]).map(([u, v]) => [o.plan.position[0] + u * c + v * s, o.plan.position[1] - u * s + v * c] as Vec2);
  };
  svg.push(`<polygon points="${pts(box(0))}" fill="#d9cfc6" stroke="#8c8079" stroke-width="1"/>`);
  svg.push(`<polygon points="${pts(box(0.18))}" fill="none" stroke="#8c8079" stroke-width="1" stroke-dasharray="4 3"/>`);
}
for (const [a, b] of grid.edges) {
  const [p, q] = [grid.points[a]!, grid.points[b]!];
  svg.push(`<line x1="${X(p[0])}" y1="${Z(p[1])}" x2="${X(q[0])}" y2="${Z(q[1])}" stroke="${parts[a] === main ? "#a1143e" : "#e07b00"}" stroke-width="1.5" opacity="0.7"/>`);
}
const doorNodes = new Set(grid.doors.flatMap((d) => [d.center, ...d.sides]));
grid.points.forEach((p, i) => {
  const color = parts[i] === main ? "#a1143e" : "#e07b00";
  svg.push(`<circle cx="${X(p[0])}" cy="${Z(p[1])}" r="${doorNodes.has(i) ? 4 : 2.5}" fill="${doorNodes.has(i) ? "#2a2627" : color}"/>`);
});
const targets: [string, Vec2][] = [
  ...scene.stations.stations.map((s): [string, Vec2] => [s.name, s.position]),
  ...scene.stations.surface_fronts.map((f): [string, Vec2] => [`${g.floor.objects.get(f.surface_id) ? catalog.get(g.floor.objects.get(f.surface_id)!.type)?.label ?? f.surface_id : f.surface_id} 앞`, f.position]),
  ...(scene.dock ? [["충전 자리", [scene.dock[0], scene.dock[2]]] as [string, Vec2]] : []),
];
for (const [name, p] of targets) {
  const at = attach(grid, g, p);
  const ok = at !== null && parts[at] === main;
  svg.push(`<rect x="${(Number(X(p[0])) - 5).toFixed(1)}" y="${(Number(Z(p[1])) - 5).toFixed(1)}" width="10" height="10" fill="${ok ? "#1f7a4d" : "#e07b00"}" stroke="#fff" stroke-width="1.5"/>`);
  svg.push(`<text x="${(Number(X(p[0])) + 8).toFixed(1)}" y="${(Number(Z(p[1])) + 4).toFixed(1)}" font-family="Pretendard, sans-serif" font-size="12" font-weight="600" fill="#2a2627">${esc(name)}</text>`);
}
const title = `${esc((scene.plan as { name?: string }).name ?? homeId)} 이동 가능 점 격자 · 간격 ${step}m · 점 ${grid.points.length}개 · 이음 ${grid.edges.length}개 · 덩어리 ${sizes.size}개`;
const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(0)}" height="${(h + 28).toFixed(0)}" viewBox="0 -28 ${w.toFixed(0)} ${(h + 28).toFixed(0)}">
<rect x="0" y="-28" width="${w.toFixed(0)}" height="${(h + 28).toFixed(0)}" fill="#ffffff"/>
<text x="8" y="-9" font-family="Pretendard, sans-serif" font-size="14" font-weight="600" fill="#2a2627">${title}</text>
${svg.join("\n")}
</svg>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, doc);
console.log(`${out}: ${title}`);
