// 도메인 경계 검사. npm run lint와 tests/domain-boundaries.test.ts가 같은 검사를 돌린다.
// src/**·ui/src/**의 import를 읽어 파일 → 도메인 표(DOMAINS·LEGACY·TABLES)와 의존 표(DEPS)로 본다. 화면 시험(ui/tests)은 node 모듈 길만 본다.
// 엄격 모드 하나뿐이다: 위반이 하나라도 있으면 실패하고, 예외 목록이나 검사를 끄는 인자는 없다(9단계에 옮기는 동안 쓰던 예외 목록을 지웠다).
// 쓰는 법: tsx scripts/lint-domains.ts [--json(위반 열쇠를 JSON으로, 위반이 있으면 끝 코드 1)]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { importsOf, isCode, nonLiteralLoads, parseCode, resolveSpec, walk, type AstNode, type ImportRef } from "./domain-ast.js";

/** 서버 도메인(2.1). 폴더 src/<이름>/, 입구 src/<이름>/index.ts. */
export const SERVER_DOMAINS = ["bus", "phone", "observe", "world", "brain", "act", "agent", "devices", "layout", "record", "machines", "manage", "goal", "server"] as const;
/** 화면 도메인(2.1). 폴더 ui/src/<이름>/, 입구 ui/src/<이름>/index.ts. 서버 도메인과 이름이 겹치지 않게 "ui/"를 붙인다. */
export const SCREEN_DOMAINS = ["ui/dashboard", "ui/twin", "ui/phone", "ui/setup"] as const;

/** 의존 표(2.3): 도메인마다 가져와도 되는 도메인. 기반층(계약·공용 표·shared·infer·design·화면 공용)은 늘 된다. 줄을 고칠 때는 이 표 하나만 고친다. */
export const DEPS: Record<string, readonly string[]> = {
  bus: [],
  machines: [],
  manage: ["machines"],
  goal: ["manage", "agent", "world", "brain"],
  devices: ["bus"],
  layout: ["devices"],
  world: ["bus", "devices", "layout"],
  phone: ["bus", "world", "layout"],
  observe: ["bus", "phone", "world", "devices"],
  brain: ["bus", "world", "devices"],
  agent: ["world", "devices", "layout"],
  act: ["manage", "goal", "bus", "machines", "agent", "brain", "observe", "phone", "world", "devices", "layout"],
  record: ["bus", "brain"],
  server: ["manage", "goal", "bus", "phone", "observe", "world", "brain", "act", "agent", "devices", "layout", "record", "machines"],
  "ui/twin": [],
  "ui/dashboard": ["ui/twin"],
  "ui/setup": ["ui/twin"],
  "ui/phone": [],
};

/** 지금 자리 → 도메인(2.1 「들어갈 지금 코드」). 끝이 /면 폴더. 옮기는 단계(3·6단계)마다 줄이고 9단계에 빈다. */
export const LEGACY: Record<string, string> = {
};

/** 공용 표(2.1 기반층, 정한 것 2): 낱말 표, 가전 종류 등록부, 행동 목록, 서버 글, 기준점 종류. 지금 자리로 적고 옮기면 새 자리로 고친다. */
export const TABLES: readonly string[] = [
  "src/world/vocab.ts",
  "src/world/labels.ts",
  "src/devices/kinds.ts",
  "src/act/tasks.ts",
  "src/act/prompts.ts",
  "src/act/labels.ts",
  "src/devices/types.ts",
  "src/phone/sync/classes.ts",
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
  "src/observe/detector-worker.mjs": "Worker 입구: workerData로 받은 감지 스레드 파일(같은 폴더 detector-thread.ts)을 연다",
};

export interface Config { deps: Record<string, readonly string[]>; legacy: Record<string, string>; tables: readonly string[]; dynamicOk: readonly string[] }
export const CONFIG: Config = { deps: DEPS, legacy: LEGACY, tables: TABLES, dynamicOk: Object.keys(DYNAMIC_OK) };

type Kind = "domain" | "table" | "contract" | "shared" | "infer" | "design" | "ui-common" | "unknown";
interface Place { kind: Kind; domain?: string; unit: string }

export interface Violation { key: string; message: string }

const isScreen = (d: string) => d.startsWith("ui/");
/** 도메인의 입구 index.ts(화면은 index.tsx도). */
const mainEntriesOf = (d: string) => (isScreen(d) ? [`ui/src/${d.slice(3)}/index.ts`, `ui/src/${d.slice(3)}/index.tsx`] : [`src/${d}/index.ts`]);
/** 다른 도메인이 가져와도 되는 입구: index.ts와, 서버 도메인은 브라우저 입구 browser.ts(2.4). */
const entriesOf = (d: string) => (isScreen(d) ? mainEntriesOf(d) : [...mainEntriesOf(d), browserEntryOf(d)]);
/** 서버 도메인의 브라우저 입구: 따라 들어간 import에 node 모듈이 없는 이름만 낸다(화면·화면 시험이 닿는 파일이 쓴다). */
const browserEntryOf = (d: string) => `src/${d}/browser.ts`;
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

/** root 아래 한 폴더의 파일 전체(뿌리 기준 posix 경로). */
function listUnder(root: string, dir: string): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name === "dist") continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) visit(p);
      else out.push(relative(root, p).split(sep).join("/"));
    }
  };
  visit(join(root, ...dir.split("/")));
  return out.sort();
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
    if (!mainEntriesOf(d).some(exists)) add(`no-index ${d}`, `\`${d}\`에 입구 \`${mainEntriesOf(d)[0]}\`가 없어요`);
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
  // 화면 시험(ui/tests, jsdom): 다른 규칙은 보지 않고 node 모듈 길만 본다
  const testFiles = listUnder(root, "ui/tests").filter(isCode);
  const testSet = new Set(testFiles);
  const testRefs = new Map<string, { ref: ImportRef; to?: string }[]>();
  for (const f of testFiles) {
    const list: { ref: ImportRef; to?: string }[] = [];
    for (const ref of importsOf(parseCode(f, readFileSync(join(root, f), "utf8")))) {
      const r = resolveSpec(f, ref.spec, (p) => fileSet.has(p) || testSet.has(p));
      if ("path" in r) list.push({ ref, to: r.path });
    }
    testRefs.set(f, list);
  }
  const browserEntries = Object.keys(config.deps).filter((d) => !isScreen(d)).map(browserEntryOf).filter((p) => refsOf.has(p));
  for (const v of browserNodeModules(refsOf, testRefs, browserEntries)) add(v.key, v.message);
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

/** 화면 파일에서 값 import로 따라 들어간 src 파일이 node 기본 모듈을 쓰면 위반(타입 import는 빌드에서 지워져 뺀다).
 *  화면 시험(ui/tests)은 jsdom에서 돈다. 시험이 바로 가져온 src 파일은 시험이 고른 것이라(2.2) node 모듈을 써도 되고,
 *  그 파일을 거쳐 따라 들어간 src 파일에 node 모듈이 있으면 위반이다(입구가 node 파일을 끌어와 jsdom에서 깨진 일, 4b planShape). */
function browserNodeModules(refsOf: Map<string, { ref: ImportRef; to?: string; external?: string; builtin?: boolean }[]>, testRefs: Map<string, { ref: ImportRef; to?: string }[]> = new Map(), browserEntries: readonly string[] = []): Violation[] {
  const out: Violation[] = [];
  const nodeUses = (f: string, prev: Map<string, string>, say: (external: string, chain: string) => string) => {
    if (!f.startsWith("src/")) return;
    for (const { ref, external, builtin } of refsOf.get(f) ?? []) {
      if (ref.typeOnly || external === undefined || !builtin) continue;
      const chain: string[] = [];
      const onChain = new Set<string>();
      for (let n = f; n && !onChain.has(n); n = prev.get(n) ?? "") { onChain.add(n); chain.unshift(n); }
      out.push({ key: `node ${f} -> ${external}`, message: say(external, chain.map((c) => `\`${c}\``).join(" → ")) });
    }
  };
  /** 처음 방문할 때만 앞 파일(prev)을 적는다(BFS 방문 표시). skip은 따라가지 않는 파일(시험이 바로 가져온 파일). */
  const walkFrom = (starts: [string, string][], say: (external: string, chain: string) => string, skip: ReadonlySet<string> = new Set()) => {
    const prev = new Map<string, string>(starts);
    const visited = new Set<string>([...skip, ...starts.map(([f]) => f)]);
    const queue = starts.map(([f]) => f);
    while (queue.length) {
      const f = queue.shift()!;
      nodeUses(f, prev, say);
      for (const { ref, to } of refsOf.get(f) ?? []) {
        if (ref.typeOnly || to === undefined || !refsOf.has(to) || visited.has(to)) continue;
        visited.add(to);
        prev.set(to, f);
        queue.push(to);
      }
    }
  };
  const say = (m: string, chain: string) => `브라우저 입구에 node 모듈 \`${m}\`이 섞여요(${chain})`;
  walkFrom([...refsOf.keys()].filter((f) => f.startsWith("ui/src/")).map((f) => [f, ""]), say);
  // 서버 도메인의 브라우저 입구(browser.ts)는 가져오는 곳이 없어도 본다(화면에서 닿은 길이 있으면 그 글이 먼저다)
  walkFrom(browserEntries.map((f) => [f, ""]), say);
  // 시험이 바로 가져온 파일의 다음 파일부터 따라간다(시작 자리의 앞은 시험 파일, 바로 가져온 파일)
  const picked = new Map<string, string>();
  for (const [t, list] of testRefs) for (const { ref, to } of list) if (!ref.typeOnly && to !== undefined && refsOf.has(to) && !picked.has(to)) picked.set(to, t);
  const starts: [string, string][] = [];
  const seen = new Set<string>();
  for (const [p] of picked) for (const { ref, to } of refsOf.get(p) ?? []) {
    if (ref.typeOnly || to === undefined || !refsOf.has(to) || seen.has(to) || picked.has(to)) continue;
    seen.add(to);
    starts.push([to, p]);
  }
  const chainPrev = new Map(picked);
  walkFrom(starts.map(([f, p]) => [f, `${p}`]), (m, chain) => {
    const first = chain.match(/^`([^`]+)`/)?.[1] ?? "";
    const before = first && chainPrev.get(first) ? `\`${chainPrev.get(first)}\` → ` : "";
    return `화면 시험(jsdom)이 따라 들어간 src 파일에 node 모듈 \`${m}\`이 섞여요(${before}${chain}). 시험이 바로 가져온 src 파일만 node 모듈을 써도 돼요`;
  }, new Set(picked.keys()));
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

/** npm run lint 본체: 위반이 하나라도 있으면 1(엄격 모드 하나뿐, 끄는 인자 없음). --json은 위반 열쇠를 JSON으로 낸다(위반이 있으면 1). */
export function lintMain(root: string, argv: readonly string[], io: { log(m: string): void; error(m: string): void } = { log: (m) => console.log(m), error: (m) => console.error(m) }): number {
  const violations = checkTree(root);
  if (argv.includes("--json")) {
    io.log(JSON.stringify(violations.map((v) => v.key), null, 2));
    return violations.length ? 1 : 0;
  }
  for (const v of violations) io.error(v.message);
  if (violations.length) {
    io.error(`도메인 검사: 위반 ${violations.length}개`);
    return 1;
  }
  io.log("도메인 검사 통과");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(lintMain(fileURLToPath(new URL("..", import.meta.url)), process.argv.slice(2)));
}
