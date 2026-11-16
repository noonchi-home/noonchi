// 도메인 경계 검사(도메인 나누기 설계 2.1·2.3·3.1). npm run lint와 tests/domain-boundaries.test.ts가 같은 검사를 돌린다.
// src/**·ui/src/**의 import를 읽어 파일 → 도메인 표(DOMAINS·LEGACY·TABLES)와 의존 표(DEPS)로 본다.
// 옮기는 동안은 지금 위반을 scripts/domain-exceptions.json에 적는다(3.2). 목록에 없는 새 위반도, 목록에 있는데 이제 안 생기는 줄도 실패다.
// 예외 목록은 줄기만 한다(chainFailures): EXCEPTIONS_BASE(1단계) 뒤 첫 부모 커밋마다, 그리고 지금 트리에서, 바로 앞 목록과 처음 목록에 없던 줄은 실패다.
//   새 줄은 그 커밋에 새로 생긴 대응표(moves/<단계>.json) exceptions에 까닭·기한과 함께 적은 것만 된다. 기한이 지났는데 남은 줄도 실패다.
// 쓰는 법: tsx scripts/lint-domains.ts [--strict(예외 목록 없이)] [--json(위반 열쇠를 JSON으로)] [--base <커밋>(기준 바꿔 보기)]
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MOVES_DIR, importsOf, isCode, nonLiteralLoads, parseCode, resolveSpec, walk, type AstNode, type ImportRef } from "./domain-ast.js";

/** 서버 도메인(2.1). 폴더 src/<이름>/, 입구 src/<이름>/index.ts. */
export const SERVER_DOMAINS = ["phone", "observe", "world", "brain", "act", "agent", "devices", "layout", "server"] as const;
/** 화면 도메인(2.1). 폴더 ui/src/<이름>/, 입구 ui/src/<이름>/index.ts. 서버 도메인과 이름이 겹치지 않게 "ui/"를 붙인다. */
export const SCREEN_DOMAINS = ["ui/dashboard", "ui/twin", "ui/phone", "ui/setup"] as const;

/** 의존 표(2.3): 도메인마다 가져와도 되는 도메인. 기반층(계약·공용 표·shared·infer·design·화면 공용)은 늘 된다. 줄을 고칠 때는 이 표 하나만 고친다. */
export const DEPS: Record<string, readonly string[]> = {
  devices: [],
  layout: ["devices"],
  world: ["devices", "layout"],
  phone: ["world", "layout"],
  observe: ["phone", "world", "devices"],
  brain: ["world", "devices"],
  agent: ["world", "devices", "layout"],
  act: ["agent", "brain", "observe", "phone", "world", "devices", "layout"],
  server: ["phone", "observe", "world", "brain", "act", "agent", "devices", "layout"],
  "ui/twin": [],
  "ui/dashboard": ["ui/twin"],
  "ui/setup": ["ui/twin"],
  "ui/phone": [],
};

/** 지금 자리 → 도메인(2.1 「들어갈 지금 코드」). 끝이 /면 폴더. 옮기는 단계(3·6단계)마다 줄이고 9단계에 빈다. */
export const LEGACY: Record<string, string> = {
  "src/sync/": "phone",
  "src/brain/detector.ts": "observe",
  "src/brain/detector-thread.ts": "observe",
  "src/brain/detector-worker.mjs": "observe",
  "src/world/decide.ts": "brain",
  "src/history/": "brain",
  "src/plan/hub.ts": "act",
  "src/plan/labels.ts": "act",
  "src/plan/planner.ts": "agent",
  "src/mcp/": "agent",
  "src/hub/": "devices",
  "src/matter/": "devices",
  "src/thinq/": "devices",
  "src/model/kinds.ts": "devices",
  "src/model/kinds-check.ts": "devices",
  "src/model/mapping.ts": "devices",
  "src/model/devices.ts": "devices",
  "src/model/scene.ts": "layout",
  "src/model/drawn.ts": "layout",
  "src/model/homes.ts": "layout",
  "src/plan/floor.ts": "layout",
  "src/plan/route.ts": "layout",
  "src/plan/names.ts": "layout",
  "src/phone/home-plan.ts": "layout",
  "src/setup/": "server",
  "ui/src/bubbles/": "ui/dashboard",
  "ui/src/panels/": "ui/dashboard",
  "ui/src/checks/": "ui/dashboard",
  "ui/src/twin3d/": "ui/twin",
};

/** 공용 표(2.1 기반층, 정한 것 2): 낱말 표, 가전 종류 등록부, 행동 목록, 서버 글. 지금 자리로 적고 옮기면 새 자리로 고친다. */
export const TABLES: readonly string[] = [
  "src/world/vocab.ts",
  "src/world/labels.ts",
  "src/model/kinds.ts",
  "src/act/tasks.ts",
  "src/act/prompts.ts",
  "src/plan/labels.ts",
  "src/devices/types.ts",
];

/** 기반층 폴더. */
const FOUNDATION: Record<string, Kind> = {
  "src/contract/": "contract",
  "src/shared/": "shared",
  "src/infer/": "infer",
  "src/design/": "design",
  "ui/src/components/": "ui-common",
  "ui/src/lib/": "ui-common",
};
/** 화면이 쓰는 경로 찾기 브라우저 입구(2.1). 화면은 src 도메인에서 이 파일만 가져온다. */
export const BROWSER_ENTRY = "src/layout/browser.ts";
/** import.meta.url을 마음대로 써도 되는 파일(뿌리 기준 경로를 내는 곳). */
export const PATHS_FILE = "src/shared/paths.ts";

/** 글자 그대로가 아닌 import()·require를 써도 되는 파일과 까닭. 옮기면 새 자리로 고친다. */
export const DYNAMIC_OK: Record<string, string> = {
  "src/brain/detector-worker.mjs": "Worker 입구: workerData로 받은 감지 스레드 파일(같은 폴더 detector-thread.ts)을 연다",
};

export interface Config { deps: Record<string, readonly string[]>; legacy: Record<string, string>; tables: readonly string[]; dynamicOk: readonly string[] }
export const CONFIG: Config = { deps: DEPS, legacy: LEGACY, tables: TABLES, dynamicOk: Object.keys(DYNAMIC_OK) };

type Kind = "domain" | "table" | "contract" | "shared" | "infer" | "design" | "ui-common" | "unknown";
interface Place { kind: Kind; domain?: string; unit: string }

export interface Violation { key: string; message: string }

const isScreen = (d: string) => d.startsWith("ui/");
const entriesOf = (d: string) => (isScreen(d) ? [`ui/src/${d.slice(3)}/index.ts`, `ui/src/${d.slice(3)}/index.tsx`] : [`src/${d}/index.ts`]);
const SCREEN_SRC = "contract·공용 표·shared·design·src/layout/browser.ts";

export function placeOf(path: string, config: Config): Place {
  if (config.tables.includes(path)) return { kind: "table", unit: `공용 표 ${path}` };
  for (const [prefix, kind] of Object.entries(FOUNDATION)) if (path.startsWith(prefix)) return { kind, unit: kind };
  let best = "";
  for (const key of Object.keys(config.legacy)) {
    const hit = key.endsWith("/") ? path.startsWith(key) : path === key;
    if (hit && key.length > best.length) best = key;
  }
  if (best) return { kind: "domain", domain: config.legacy[best], unit: config.legacy[best]! };
  const m = /^(src|ui\/src)\/([^/]+)\//.exec(path);
  if (m) {
    const d = m[1] === "src" ? m[2]! : `ui/${m[2]}`;
    if (d in config.deps) return { kind: "domain", domain: d, unit: d };
  }
  return { kind: "unknown", unit: "unknown" };
}

/** root 아래 src/·ui/src/의 파일 전체(뿌리 기준 posix 경로). */
export function listFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) visit(p);
      else out.push(relative(root, p).split(sep).join("/"));
    }
  };
  visit(join(root, "src"));
  visit(join(root, "ui", "src"));
  return out.sort();
}

interface Edge { from: string; to: string; typeOnly: boolean }

/** 트리 하나를 검사해 위반을 모두 낸다(예외 목록은 보지 않음). */
export function checkTree(root: string, config: Config = CONFIG): Violation[] {
  const found = new Map<string, string>();
  const add = (key: string, message: string) => { if (!found.has(key)) found.set(key, message); };
  const files = listFiles(root);
  const fileSet = new Set(files);
  const exists = (p: string) => fileSet.has(p);
  const code = files.filter(isCode);
  const places = new Map(files.map((f) => [f, placeOf(f, config)]));
  const place = (f: string) => places.get(f) ?? placeOf(f, config);
  const refsOf = new Map<string, { ref: ImportRef; to?: string; external?: string; builtin?: boolean }[]>();

  // 의존 표 자체에 고리가 없어야 한다
  for (const cycle of tableCycles(config.deps)) add(`deps-cycle ${cycle.join(" -> ")}`, `의존 표에 고리가 있어요: ${cycle.map((d) => `\`${d}\``).join(" → ")}`);
  // 도메인마다 입구
  for (const d of Object.keys(config.deps)) {
    if (!entriesOf(d).some(exists)) add(`no-index ${d}`, `\`${d}\`에 입구 \`${entriesOf(d)[0]}\`가 없어요`);
  }

  for (const f of code) {
    const pf = place(f);
    if (pf.kind === "unknown") add(`unknown ${f}`, `\`${f}\`가 어느 도메인·기반층에도 없어요. scripts/lint-domains.ts 표(2.1)에 넣으세요`);
    const ast = parseCode(f, readFileSync(join(root, f), "utf8"));
    const list: { ref: ImportRef; to?: string; external?: string; builtin?: boolean }[] = [];
    for (const ref of importsOf(ast)) {
      const r = resolveSpec(f, ref.spec, exists);
      if ("missing" in r) { add(`missing ${f} -> ${ref.spec}`, `\`${f}\`가 가져오는 \`${ref.spec}\` 파일이 없어요`); continue; }
      if ("external" in r) { list.push({ ref, external: r.external, builtin: r.builtin }); continue; }
      list.push({ ref, to: r.path });
    }
    refsOf.set(f, list);
    checkMetaUrl(f, ast, exists, add);
    if (nonLiteralLoads(ast).length && !config.dynamicOk.includes(f)) {
      add(`dynamic ${f}`, `\`${f}\`가 글자 그대로가 아닌 import()·require를 써요. 경로를 글자 그대로 적으세요(검사가 따라가지 못함). 꼭 필요하면 scripts/lint-domains.ts DYNAMIC_OK에 까닭과 함께 적어요`);
    }
    for (const { ref, to, external, builtin } of list) {
      if (to !== undefined) {
        if (!to.startsWith("src/") && !to.startsWith("ui/src/")) continue;
        for (const v of edgeRules(f, to, ref.typeOnly, pf, place(to), config)) add(v.key, v.message);
      } else if (external !== undefined) {
        if (pf.kind === "contract") add(`contract ${f} -> ${external}`, `계약 \`${f}\`은 계약·공용 표의 타입만 import type으로 가져와요. \`${external}\`을 가져오지 마세요`);
        if ((pf.kind === "shared" || pf.kind === "infer") && !builtin) add(`foundation ${f} -> ${external}`, `\`${f}\`: 기반층은 도메인을 몰라야 해요. \`${external}\`을 가져오지 마세요(계약·shared·node 기본 모듈만)`);
      }
    }
  }

  // 파일 그래프(같은 짝은 하나로, 값 import가 하나라도 있으면 값 의존)
  const edges = new Map<string, Edge>();
  for (const [from, list] of refsOf) {
    for (const { ref, to } of list) {
      if (to === undefined || !refsOf.has(to)) continue;
      const k = `${from}\n${to}`;
      const e = edges.get(k);
      if (e) e.typeOnly &&= ref.typeOnly;
      else edges.set(k, { from, to, typeOnly: ref.typeOnly });
    }
  }
  for (const v of fileCycles([...edges.values()], (f) => place(f).unit)) add(v.key, v.message);
  for (const v of browserNodeModules(refsOf)) add(v.key, v.message);
  return [...found].map(([key, message]) => ({ key, message })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function edgeRules(from: string, to: string, typeOnly: boolean, pf: Place, pt: Place, config: Config): Violation[] {
  const out: Violation[] = [];
  const at = `\`${from}\` → \`${to}\``;
  switch (pf.kind) {
    case "contract":
      if (!typeOnly || (pt.kind !== "contract" && pt.kind !== "table")) {
        out.push({ key: `contract ${from} -> ${to}`, message: `${at}: 계약은 계약·공용 표의 타입만 import type으로 가져와요${typeOnly ? "" : "(값 import 금지)"}` });
      }
      return out;
    case "table":
      if (pt.kind !== "contract" && pt.kind !== "shared" && pt.kind !== "table") {
        out.push({ key: `table ${from} -> ${to}`, message: `${at}: 공용 표는 계약·shared·다른 공용 표만 가져와요` });
      }
      return out;
    case "shared":
    case "infer":
      if (!(pt.kind === "contract" || pt.kind === "shared" || (pf.kind === "infer" && pt.kind === "infer"))) {
        out.push({ key: `foundation ${from} -> ${to}`, message: `${at}: 기반층은 도메인을 몰라야 해요. \`${to}\`을 가져오지 마세요` });
      }
      return out;
    case "design":
      if (pt.kind !== "design" && pt.kind !== "contract" && pt.kind !== "shared") {
        out.push({ key: `foundation ${from} -> ${to}`, message: `${at}: 기반층은 도메인을 몰라야 해요. \`${to}\`을 가져오지 마세요` });
      }
      return out;
    case "ui-common":
      if (to.startsWith("src/")) {
        if (!screenMaySrc(to, pt)) out.push({ key: `screen-src ${from} -> ${to}`, message: `${at}: 화면은 src에서 ${SCREEN_SRC}만 가져와요` });
      } else if (pt.kind !== "ui-common") {
        out.push({ key: `ui-common ${from} -> ${to}`, message: `${at}: 화면 공용은 화면 도메인을 가져오지 않아요` });
      }
      return out;
    case "unknown":
      return out;
    case "domain":
      break;
  }
  const d = pf.domain!;
  if (isScreen(d) && to.startsWith("src/")) {
    if (!screenMaySrc(to, pt)) out.push({ key: `screen-src ${from} -> ${to}`, message: `${at}: 화면은 src에서 ${SCREEN_SRC}만 가져와요` });
    return out;
  }
  if (pt.kind !== "domain") {
    if (pt.kind === "ui-common" && !isScreen(d)) out.push({ key: `direction ${from} -> ${to}`, message: `${at}: 서버 도메인은 화면을 쓸 수 없어요` });
    if (pt.kind === "infer" && isScreen(d)) out.push({ key: `screen-src ${from} -> ${to}`, message: `${at}: 화면은 src에서 ${SCREEN_SRC}만 가져와요` });
    return out;
  }
  const e = pt.domain!;
  if (e === d) return out;
  const allowed = config.deps[d] ?? [];
  if (!allowed.includes(e)) {
    out.push({
      key: `direction ${from} -> ${to}`,
      message: `${at}: \`${d}\`는 \`${e}\`를 쓸 수 없어요(쓸 수 있는 것: ${allowed.length ? allowed.join("·") : "없음"}). 공용 타입이면 contract로, 공용 도우미면 shared로 옮기세요`,
    });
  }
  if (!entriesOf(e).includes(to)) {
    out.push({ key: `inner ${from} -> ${to}`, message: `\`${from}\`이 \`${e}\` 안쪽 \`${to}\`을 가져와요. \`${entriesOf(e)[0]}\`로 가져오세요` });
  }
  return out;
}

const screenMaySrc = (to: string, pt: Place) => to === BROWSER_ENTRY || pt.kind === "contract" || pt.kind === "table" || pt.kind === "shared" || pt.kind === "design";

/** 의존 표의 고리(도메인 차례). */
export function tableCycles(deps: Record<string, readonly string[]>): string[][] {
  const out: string[][] = [];
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (d: string) => {
    state.set(d, 1);
    stack.push(d);
    for (const e of deps[d] ?? []) {
      if (state.get(e) === 1) out.push([...stack.slice(stack.indexOf(e)), e]);
      else if (!state.has(e)) visit(e);
    }
    stack.pop();
    state.set(d, 2);
  };
  for (const d of Object.keys(deps)) if (!state.has(d)) visit(d);
  return out;
}

/** 실제 파일 그래프에서 단위(도메인·기반층 이름, 공용 표는 파일마다)를 넘는 고리. 계약·공용 표 사이 타입 전용 import만 고리에서 뺀다(2.3).
 *  고리 안에서 단위를 넘는 import마다 위반 하나(열쇠가 import 하나라 예외 목록이 다른 곳 변화에 흔들리지 않는다). */
export function fileCycles(all: Edge[], unitOf: (f: string) => string): Violation[] {
  const typeUnit = (u: string) => u === "contract" || u.startsWith("공용 표 ");
  const edges = all.filter((e) => !(e.typeOnly && typeUnit(unitOf(e.from)) && typeUnit(unitOf(e.to))));
  const next = new Map<string, string[]>();
  for (const e of edges) (next.get(e.from) ?? next.set(e.from, []).get(e.from)!).push(e.to);
  const comp = scc([...new Set(edges.flatMap((e) => [e.from, e.to]))], (n) => next.get(n) ?? []);
  const out: Violation[] = [];
  for (const e of edges) {
    const c = comp.get(e.from);
    if (c === undefined || c !== comp.get(e.to) || unitOf(e.from) === unitOf(e.to)) continue;
    const back = shortestPath(e.to, e.from, (n) => (next.get(n) ?? []).filter((m) => comp.get(m) === c));
    const units = [e.from, e.to, ...back].map(unitOf).filter((u, i, a) => i === 0 || u !== a[i - 1]);
    out.push({ key: `cycle ${e.from} -> ${e.to}`, message: `${units.map((u) => `\`${u}\``).join(" → ")} 고리예요(\`${e.from}\` → \`${e.to}\` → … → \`${e.from}\`)` });
  }
  return out;
}

/** 강하게 이어진 묶음 번호(Tarjan, 되부름 없이). */
function scc(nodes: string[], next: (n: string) => string[]): Map<string, number> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const comp = new Map<string, number>();
  let counter = 0;
  let compId = 0;
  for (const start of nodes) {
    if (index.has(start)) continue;
    const work: { n: string; i: number }[] = [{ n: start, i: 0 }];
    index.set(start, counter); low.set(start, counter); counter++; stack.push(start); onStack.add(start);
    while (work.length) {
      const top = work[work.length - 1]!;
      const succ = next(top.n);
      if (top.i < succ.length) {
        const m = succ[top.i++]!;
        if (!index.has(m)) {
          index.set(m, counter); low.set(m, counter); counter++; stack.push(m); onStack.add(m);
          work.push({ n: m, i: 0 });
        } else if (onStack.has(m)) low.set(top.n, Math.min(low.get(top.n)!, index.get(m)!));
        continue;
      }
      work.pop();
      if (work.length) { const p = work[work.length - 1]!.n; low.set(p, Math.min(low.get(p)!, low.get(top.n)!)); }
      if (low.get(top.n) === index.get(top.n)) {
        let m: string;
        do { m = stack.pop()!; onStack.delete(m); comp.set(m, compId); } while (m !== top.n);
        compId++;
      }
    }
  }
  return comp;
}

/** from에서 to까지 가장 짧은 길(from 빼고 to 포함). */
function shortestPath(from: string, to: string, next: (n: string) => string[]): string[] {
  const prev = new Map<string, string>([[from, ""]]);
  const queue = [from];
  while (queue.length) {
    const n = queue.shift()!;
    if (n === to) break;
    for (const m of next(n)) if (!prev.has(m)) { prev.set(m, n); queue.push(m); }
  }
  if (!prev.has(to)) return [to];
  const path: string[] = [];
  for (let n = to; n !== from; n = prev.get(n)!) path.unshift(n);
  return [from, ...path].slice(1);
}

/** 화면 파일에서 값 import로 따라 들어간 src 파일이 node 기본 모듈을 쓰면 위반(타입 import는 빌드에서 지워져 뺀다). */
function browserNodeModules(refsOf: Map<string, { ref: ImportRef; to?: string; external?: string; builtin?: boolean }[]>): Violation[] {
  const out: Violation[] = [];
  const prev = new Map<string, string>();
  const queue: string[] = [];
  for (const f of refsOf.keys()) if (f.startsWith("ui/src/")) { prev.set(f, ""); queue.push(f); }
  while (queue.length) {
    const f = queue.shift()!;
    for (const { ref, to, external, builtin } of refsOf.get(f) ?? []) {
      if (ref.typeOnly) continue;
      if (to !== undefined && refsOf.has(to) && !prev.has(to)) { prev.set(to, f); queue.push(to); }
      if (external !== undefined && builtin && f.startsWith("src/")) {
        const chain: string[] = [];
        for (let n = f; n; n = prev.get(n) ?? "") chain.unshift(n);
        out.push({ key: `node ${f} -> ${external}`, message: `브라우저 입구에 node 모듈 \`${external}\`이 섞여요(${chain.map((c) => `\`${c}\``).join(" → ")})` });
      }
    }
  }
  return out;
}

/** import.meta.url은 세 꼴만: shared/paths.ts 안, new Worker(…new URL("./…", import.meta.url)…), isEntry(import.meta.url). Worker 대상 파일은 있어야 한다. */
function checkMetaUrl(file: string, ast: AstNode, exists: (p: string) => boolean, add: (key: string, message: string) => void): void {
  if (file === PATHS_FILE) return;
  walk(ast, (n, anc) => {
    if (!(n.type === "MemberExpression" && !n.computed && n.object?.type === "MetaProperty" && n.object.meta?.name === "import" && n.property?.name === "url")) return;
    const parent = anc[anc.length - 1];
    if (parent?.type === "CallExpression" && parent.callee?.type === "Identifier" && parent.callee.name === "isEntry" && parent.arguments.length === 1 && parent.arguments[0] === n) return;
    const inWorker = anc.some((a) => a.type === "NewExpression" && a.callee?.type === "Identifier" && a.callee.name === "Worker");
    const arg0 = parent?.arguments?.[0];
    if (inWorker && parent?.type === "NewExpression" && parent.callee?.name === "URL" && parent.arguments[1] === n && arg0?.type === "Literal" && typeof arg0.value === "string" && arg0.value.startsWith("./")) {
      const target = posix.normalize(posix.join(posix.dirname(file), arg0.value));
      if (!exists(target)) add(`worker ${file} -> ${arg0.value}`, `\`${file}\`의 Worker 대상 \`${target}\`이 없어요. Worker 줄은 대상 파일과 같이 옮기세요`);
      return;
    }
    add(`meta-url ${file}`, `\`${file}\`이 import.meta.url을 허용한 꼴 밖에서 써요. 자원 경로는 src/shared/paths.ts repoPath(), 직접 실행 검사는 isEntry(import.meta.url), Worker는 new Worker(new URL("./…", import.meta.url))`);
  });
}

/** 예외 목록과 견준다: 목록에 없는 위반(added)과 목록에 있는데 이제 안 생기는 줄(stale). */
export function compareExceptions(violations: Violation[], exceptions: readonly string[]): { added: Violation[]; stale: string[] } {
  const keys = new Set(violations.map((v) => v.key));
  const listed = new Set(exceptions);
  const stale = exceptions.filter((k, i) => !keys.has(k) || exceptions.indexOf(k) !== i);
  return { added: violations.filter((v) => !listed.has(v.key)), stale };
}

export const EXCEPTIONS_FILE = "scripts/domain-exceptions.json";
export function readExceptions(root: string): string[] {
  const p = join(root, EXCEPTIONS_FILE);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as string[]) : [];
}

/** 예외 목록을 처음 적은 커밋(1단계). 이 커밋부터 첫 부모 커밋마다 목록이 늘지 않는지 본다. 시험·CI·로컬 모두 git으로 읽는다(CI는 checkout fetch-depth: 0). */
export const EXCEPTIONS_BASE = "55cef6de171cac3f0f2e6bae1fd3072f507b6752";

/** 기준 목록과, 기준 뒤에 새로 생긴 대응표의 files(단계 차례). */
export interface BaseList { keys: string[]; moves: Record<string, string>[] }

/** 기준 커밋의 예외 목록을 git으로 읽고, 지금 트리에 있는데 기준 커밋에 없던 대응표(moves/*.json)의 files를 단계 차례로 모은다. 못 읽으면 실패. */
export function readBase(root: string, ref: string = EXCEPTIONS_BASE): BaseList {
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 });
  let keys: string[];
  let baseMoves: Set<string>;
  try {
    keys = JSON.parse(git("show", `${ref}:${EXCEPTIONS_FILE}`)) as string[];
    baseMoves = new Set(git("ls-tree", "-r", "--name-only", ref, "--", MOVES_DIR).split("\n").filter(Boolean));
  } catch (e) {
    throw new Error(`기준 커밋 ${ref}의 ${EXCEPTIONS_FILE}를 git으로 못 읽어요. 저장소 기록 전체가 있어야 해요(CI는 actions/checkout fetch-depth: 0): ${(e as Error).message.split("\n")[0]}`);
  }
  const dir = join(root, MOVES_DIR);
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")).sort((a, b) => a.localeCompare(b, "en", { numeric: true })) : [];
  const moves = names
    .filter((n) => !baseMoves.has(`${MOVES_DIR}${n}`))
    .map((n) => (JSON.parse(readFileSync(join(dir, n), "utf8")) as { files?: Record<string, string> }).files ?? {});
  return { keys, moves };
}

/** 예외 줄 가운데 기준 목록으로 설명되지 않는 것. 기준 줄의 경로는 대응표로 옮긴다. 같은 도메인 입구로 바꾼 대상(…/index.ts)은 옛 줄이 없어졌을 때만 1:1로 같은 줄로 본다. extra는 대응표 exceptions로 허용한 줄. */
export function unbasedKeys(exceptions: readonly string[], base: BaseList, config: Config = CONFIG, extra: Iterable<string> = []): string[] {
  const mapPath = (p: string) => base.moves.reduce((acc, m) => m[acc] ?? acc, p);
  const mapKey = (k: string) => k.split(" ").map((t) => (/^(src|ui\/src)\//.test(t) ? mapPath(t) : t)).join(" ");
  const allowed = new Set([...base.keys.map(mapKey), ...extra]);
  // 입구로 바꾼 줄은 짝이 될 옛 줄(같은 검사·같은 파일, 대상이 그 도메인)이 지금 목록에서 없어졌을 때만, 옛 줄 하나에 새 줄 하나로 본다
  const present = new Set(exceptions);
  const gone = new Map<string, string[]>();
  for (const k of base.keys.map(mapKey)) {
    if (present.has(k)) continue;
    const m = /^(\S+) (\S+) -> (\S+)$/.exec(k);
    if (m) (gone.get(`${m[1]} ${m[2]}`) ?? gone.set(`${m[1]} ${m[2]}`, []).get(`${m[1]} ${m[2]}`)!).push(m[3]!);
  }
  const entryDomain = (p: string) => Object.keys(config.deps).find((d) => entriesOf(d).includes(p));
  return exceptions.filter((k) => {
    if (allowed.has(k)) return false;
    const m = /^(\S+) (\S+) -> (\S+)$/.exec(k);
    const d = m ? entryDomain(m[3]!) : undefined;
    if (!m || !d) return true;
    const list = gone.get(`${m[1]} ${m[2]}`) ?? [];
    const i = list.findIndex((t) => placeOf(t, config).domain === d);
    if (i < 0) return true;
    list.splice(i, 1);
    return false;
  });
}

interface MovesExtra { files?: Record<string, string>; exceptions?: Record<string, { why?: string; until?: string }> }
interface ListState { label: string; lines: string[]; moves: Map<string, MovesExtra> }
const stepOf = (path: string) => posix.basename(path, ".json");
const cmpStep = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/** 예외 목록이 줄기만 하는지: 처음 목록 커밋(base) 뒤 첫 부모 커밋마다와 지금 트리에서, 바로 앞 목록에 없던 줄과 처음 목록에 없던 줄은 실패.
 *  그 사이 새로 생긴 대응표의 files로 옛 줄의 경로를 옮기고, 그 대응표 exceptions에 적은 줄만 새로 된다. exceptions는 까닭이 있어야 하고
 *  기한(단계)이 그 대응표 단계보다 앞이면 안 되며, 지금 가장 늦은 단계가 기한을 지났는데 줄이 남아 있으면 실패. */
export function chainFailures(root: string, base: string = EXCEPTIONS_BASE, config: Config = CONFIG): string[] {
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 });
  let commits: string[];
  try {
    git("cat-file", "-e", `${base}^{commit}`);
    commits = git("rev-list", "--first-parent", "--reverse", `${base}..HEAD`).split("\n").filter(Boolean);
  } catch (e) {
    throw new Error(`예외 목록 기준 커밋 ${base}를 git으로 못 읽어요. 저장소 기록 전체가 있어야 해요(CI는 actions/checkout fetch-depth: 0): ${(e as Error).message.split("\n")[0]}`);
  }
  const states: ListState[] = [];
  const atCommit = (ref: string, prev?: ListState): ListState => {
    let lines: string[] = [];
    try { lines = JSON.parse(git("show", `${ref}:${EXCEPTIONS_FILE}`)) as string[]; } catch { if (ref === base) throw new Error(`기준 커밋 ${base}에 ${EXCEPTIONS_FILE}가 없어요`); }
    const moves = new Map<string, MovesExtra>();
    for (const p of git("ls-tree", "-r", "--name-only", ref, "--", MOVES_DIR).split("\n").filter((x) => x.endsWith(".json"))) {
      moves.set(p, prev?.moves.get(p) ?? (JSON.parse(git("show", `${ref}:${p}`)) as MovesExtra));
    }
    return { label: ref.slice(0, 7), lines, moves };
  };
  states.push(atCommit(base));
  for (const c of commits) states.push(atCommit(c, states[states.length - 1]));
  const dir = join(root, MOVES_DIR);
  const wtMoves = new Map<string, MovesExtra>();
  for (const n of existsSync(dir) ? readdirSync(dir).filter((x) => x.endsWith(".json")) : []) {
    wtMoves.set(`${MOVES_DIR}${n}`, JSON.parse(readFileSync(join(dir, n), "utf8")) as MovesExtra);
  }
  const wt: ListState = { label: "지금 트리", lines: readExceptions(root), moves: wtMoves };
  states.push(wt);

  const out: string[] = [];
  const added = (p: ListState, c: ListState) => [...c.moves.keys()].filter((k) => !p.moves.has(k)).sort((a, b) => cmpStep(stepOf(a), stepOf(b)));
  const between = (p: ListState, c: ListState) => {
    const files = added(p, c).map((k) => c.moves.get(k)!);
    return { moves: files.map((m) => m.files ?? {}), extra: files.flatMap((m) => Object.keys(m.exceptions ?? {})) };
  };
  for (let i = 1; i < states.length; i++) {
    const p = states[i - 1]!;
    const c = states[i]!;
    const { moves, extra } = between(p, c);
    for (const k of unbasedKeys(c.lines, { keys: p.lines, moves }, config, extra)) out.push(`${c.label}: 앞(${p.label})에 없던 예외 줄이에요: ${k}`);
  }
  const first = states[0]!;
  const all = between(first, wt);
  for (const k of unbasedKeys(wt.lines, { keys: first.lines, moves: all.moves }, config, all.extra)) out.push(`처음 목록(${first.label})에 없던 예외 줄이에요: ${k}`);
  const newest = [...wt.moves.keys()].map(stepOf).sort(cmpStep).at(-1) ?? "";
  for (const [path, m] of [...wt.moves].sort(([a], [b]) => cmpStep(stepOf(a), stepOf(b)))) {
    const step = stepOf(path);
    for (const [k, e] of Object.entries(m.exceptions ?? {})) {
      const until = String(e?.until ?? "");
      if (!String(e?.why ?? "").trim()) out.push(`${path} exceptions의 까닭이 비었어요: ${k}`);
      else if (!/^\d+[a-z]?$/.test(until) || cmpStep(until, step) < 0) out.push(`${path} exceptions의 기한(${until})이 그 단계(${step})보다 앞이에요: ${k}`);
      else if (cmpStep(newest, until) > 0 && wt.lines.includes(k)) out.push(`${path} exceptions의 기한(${until})이 지났는데 줄이 남아 있어요: ${k}`);
    }
  }
  return out;
}

/** 트리 전체 검사: 새 위반(added), 지울 예외(stale), 목록이 늘어난 줄과 대응표 exceptions 문제(unbased). */
export function checkRepo(root: string, base: string = EXCEPTIONS_BASE, config: Config = CONFIG): { added: Violation[]; stale: string[]; unbased: string[] } {
  const exceptions = readExceptions(root);
  const { added, stale } = compareExceptions(checkTree(root, config), exceptions);
  return { added, stale, unbased: chainFailures(root, base, config) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const strict = process.argv.includes("--strict");
  const violations = checkTree(root);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(violations.map((v) => v.key), null, 2));
    process.exit(0);
  }
  const baseArg = process.argv.indexOf("--base");
  let unbased: string[] = [];
  const { added, stale } = strict ? { added: violations, stale: [] } : compareExceptions(violations, readExceptions(root));
  if (!strict) {
    try {
      unbased = chainFailures(root, baseArg > 0 ? process.argv[baseArg + 1] : EXCEPTIONS_BASE);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  }
  for (const v of added) console.error(v.message);
  for (const k of stale) console.error(`예외 목록 줄이 이제 생기지 않아요(또는 두 번 적혔어요): ${k}. ${EXCEPTIONS_FILE}에서 지우세요`);
  for (const m of unbased) console.error(`${m}. 위반을 고치세요(꼭 남겨야 하면 그 단계 대응표 exceptions에 까닭·기한과 함께 적고 검토받기)`);
  if (added.length || stale.length || unbased.length) {
    console.error(`도메인 검사: 새 위반 ${added.length}개, 지울 예외 ${stale.length}개, 목록이 늘거나 대응표 exceptions 문제 ${unbased.length}개`);
    process.exit(1);
  }
  console.log(`도메인 검사 통과(${strict ? "엄격 모드" : `예외 ${violations.length}개`})`);
}
