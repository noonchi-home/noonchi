// 도메인 경계 검사(scripts/lint-domains.ts, 도메인 나누기 설계 3.1~3.3). npm run lint와 같은 검사다.
// 실제 트리는 예외 목록(scripts/domain-exceptions.json)과 꼭 맞아야 하고, 가짜 트리·0a392c5 실제 줄은 정한 오류 글로 실패해야 한다.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MOVES_DIR } from "../scripts/domain-ast.js";
import {
  CONFIG, DEPS, EXCEPTIONS_FILE, SCREEN_DOMAINS, SERVER_DOMAINS, chainFailures, checkRepo, checkTree, compareExceptions, readBase, readExceptions, tableCycles, unbasedKeys, type Config,
} from "../scripts/lint-domains.js";

const ROOT = join(import.meta.dirname, "..");

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

/** 도메인마다 입구가 있는 가짜 트리. files로 파일을 더하거나 덮고, null이면 뺀다. */
function fakeTree(files: Record<string, string | null> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "domains-"));
  roots.push(root);
  const base: Record<string, string | null> = {};
  for (const d of SERVER_DOMAINS) base[`src/${d}/index.ts`] = "export {};\n";
  for (const d of SCREEN_DOMAINS) base[`ui/src/${d.slice(3)}/index.ts`] = "export {};\n";
  base["src/contract/events.ts"] = "export interface Ev { id: string }\n";
  base["src/shared/korean.ts"] = "export const josa = (s: string) => s;\n";
  for (const [p, text] of Object.entries({ ...base, ...files })) {
    if (text === null) continue;
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  return root;
}
const check = (root: string, config?: Config) => checkTree(root, config);
const keys = (root: string, config?: Config) => check(root, config).map((v) => v.key);
const message = (root: string, key: string) => check(root).find((v) => v.key === key)?.message ?? "";

describe("도메인 경계: 가짜 트리", () => {
  it("입구만 있는 트리는 위반이 없다", () => {
    expect(keys(fakeTree())).toEqual([]);
  });

  it("다른 도메인 안쪽 파일을 가져오면 실패하고 입구를 말한다(입구로 가져오면 통과)", () => {
    const root = fakeTree({ "src/server/a.ts": 'import { x } from "../act/b.js";\nexport const y = x;\n', "src/act/b.ts": "export const x = 1;\n" });
    expect(keys(root)).toEqual(["inner src/server/a.ts -> src/act/b.ts"]);
    expect(message(root, "inner src/server/a.ts -> src/act/b.ts")).toBe("`src/server/a.ts`이 `act` 안쪽 `src/act/b.ts`을 가져와요. `src/act/index.ts`로 가져오세요");
    const ok = fakeTree({ "src/server/a.ts": 'import { x } from "../act/index.js";\nexport const y = x;\n', "src/act/index.ts": "export { x } from \"./b.js\";\n", "src/act/b.ts": "export const x = 1;\n" });
    expect(keys(ok)).toEqual([]);
  });

  it("의존 표에 없는 방향(거꾸로)이면 실패하고 쓸 수 있는 도메인을 말한다", () => {
    const root = fakeTree({ "src/world/a.ts": 'import type { X } from "../act/index.js";\nexport type Y = X;\n' });
    expect(keys(root)).toEqual(["direction src/world/a.ts -> src/act/index.ts"]);
    expect(message(root, "direction src/world/a.ts -> src/act/index.ts")).toBe(
      "`src/world/a.ts` → `src/act/index.ts`: `world`는 `act`를 쓸 수 없어요(쓸 수 있는 것: devices·layout). 공용 타입이면 contract로, 공용 도우미면 shared로 옮기세요",
    );
  });

  it("도메인을 넘는 고리는 실패한다(타입 전용 import로 돌아도)", () => {
    for (const kw of ["import", "import type"]) {
      const root = fakeTree({
        "src/act/index.ts": 'export { b } from "./b.js";\n',
        "src/act/b.ts": `${kw} { a } from "../world/index.js";\nexport const b = 1;\nexport type B = typeof a;\n`,
        "src/world/index.ts": 'export { a } from "./a.js";\n',
        "src/world/a.ts": `${kw} { b } from "../act/index.js";\nexport const a = 1;\nexport type A = typeof b;\n`,
      });
      const ks = keys(root);
      expect(ks).toContain("cycle src/world/a.ts -> src/act/index.ts");
      expect(ks).toContain("cycle src/act/b.ts -> src/world/index.ts");
      expect(message(root, "cycle src/world/a.ts -> src/act/index.ts")).toMatch(/^`world` → `act` → `world` 고리예요/);
    }
  });

  it("shared를 거쳐 도는 고리(world → shared/x.ts → act/index.ts → world)도 잡고, shared가 도메인을 가져온 것도 잡는다", () => {
    const root = fakeTree({
      "src/world/index.ts": 'export { w } from "./w.js";\n',
      "src/world/w.ts": 'import { x } from "../shared/x.js";\nexport const w = x;\n',
      "src/shared/x.ts": 'import { a } from "../act/index.js";\nexport const x = a;\n',
      "src/act/index.ts": 'export { a } from "./a.js";\n',
      "src/act/a.ts": 'import { w } from "../world/index.js";\nexport const a = () => w;\n',
    });
    const ks = keys(root);
    expect(ks).toContain("foundation src/shared/x.ts -> src/act/index.ts");
    expect(message(root, "foundation src/shared/x.ts -> src/act/index.ts")).toContain("기반층은 도메인을 몰라야 해요. `src/act/index.ts`을 가져오지 마세요");
    expect(ks).toContain("cycle src/world/w.ts -> src/shared/x.ts");
    expect(message(root, "cycle src/world/w.ts -> src/shared/x.ts")).toMatch(/^`world` → `shared` → `act` → `world` 고리예요/);
  });

  it("shared·infer는 계약·shared·node 기본 모듈만 가져온다(바깥 패키지·공용 표도 안 됨)", () => {
    const root = fakeTree({
      "src/shared/y.ts": 'import { join } from "node:path";\nimport { z } from "zod";\nimport type { Ev } from "../contract/events.js";\nexport const y = [join, z] as unknown as Ev;\n',
      "src/infer/v.ts": 'import { CLASSES } from "../world/vocab.js";\nimport { josa } from "../shared/korean.js";\nexport const v = [CLASSES, josa];\n',
      "src/world/vocab.ts": "export const CLASSES = [];\n",
    });
    expect(keys(root)).toEqual(["foundation src/infer/v.ts -> src/world/vocab.ts", "foundation src/shared/y.ts -> zod"]);
  });

  it("공용 표가 도메인 파일을 가져오면 실패한다(계약·shared·다른 표는 된다)", () => {
    const root = fakeTree({
      "src/world/vocab.ts": 'import type { Ev } from "../contract/events.js";\nimport { josa } from "../shared/korean.js";\nimport { OBJECT_NAME } from "./labels.js";\nimport { s } from "./state.js";\nexport const CLASSES = [josa, s, OBJECT_NAME] as unknown as Ev[];\n',
      "src/world/labels.ts": "export const OBJECT_NAME = {};\n",
      "src/world/state.ts": "export const s = 1;\n",
    });
    expect(keys(root)).toEqual(["table src/world/vocab.ts -> src/world/state.ts"]);
    expect(message(root, "table src/world/vocab.ts -> src/world/state.ts")).toBe("`src/world/vocab.ts` → `src/world/state.ts`: 공용 표는 계약·shared·다른 공용 표만 가져와요");
  });

  it("계약은 계약·공용 표의 타입만 import type으로 가져온다: 값 import와 밖 import는 실패, 계약 ↔ 공용 표 타입 전용 고리는 된다", () => {
    const ok = fakeTree({
      "src/contract/world.ts": 'import type { ObjClass } from "../world/vocab.js";\nexport interface W { o: ObjClass }\n',
      "src/world/vocab.ts": 'import type { W } from "../contract/world.js";\nexport type ObjClass = "cup";\nexport type X = W;\n',
    });
    expect(keys(ok)).toEqual([]);
    const bad = fakeTree({
      "src/contract/world.ts": 'import { CLASSES } from "../world/vocab.js";\nimport type { S } from "../brain/index.js";\nexport type W = [typeof CLASSES, S];\n',
      "src/world/vocab.ts": "export const CLASSES = [];\n",
    });
    expect(keys(bad)).toEqual(["contract src/contract/world.ts -> src/brain/index.ts", "contract src/contract/world.ts -> src/world/vocab.ts"]);
    expect(message(bad, "contract src/contract/world.ts -> src/world/vocab.ts")).toBe("`src/contract/world.ts` → `src/world/vocab.ts`: 계약은 계약·공용 표의 타입만 import type으로 가져와요(값 import 금지)");
  });

  it("화면은 src에서 계약·공용 표·shared·design·layout/browser.ts만 가져온다", () => {
    const root = fakeTree({
      "ui/src/dashboard/a.ts": 'import { s } from "../../../src/world/state.js";\nimport type { Ev } from "../../../src/contract/events.ts";\nexport const a = s as unknown as Ev;\n',
      "src/world/state.ts": "export const s = 1;\n",
    });
    expect(keys(root)).toEqual(["screen-src ui/src/dashboard/a.ts -> src/world/state.ts"]);
  });

  it("화면 → layout/browser.ts → node:fs를 쓰는 파일이면 실패하고 길을 말한다(타입 import는 빌드에서 지워져 된다)", () => {
    const root = fakeTree({
      "ui/src/twin/walk.ts": 'import { route } from "../../../src/layout/browser.js";\nexport const walk = route;\n',
      "src/layout/browser.ts": 'export { route } from "./route.js";\n',
      "src/layout/route.ts": 'import { readFileSync } from "node:fs";\nexport const route = () => readFileSync;\n',
    });
    expect(keys(root)).toEqual(["node src/layout/route.ts -> node:fs"]);
    expect(message(root, "node src/layout/route.ts -> node:fs")).toBe("브라우저 입구에 node 모듈 `node:fs`이 섞여요(`ui/src/twin/walk.ts` → `src/layout/browser.ts` → `src/layout/route.ts`)");
    const typeOnly = fakeTree({
      "ui/src/twin/walk.ts": 'import type { R } from "../../../src/layout/browser.js";\nexport type W = R;\n',
      "src/layout/browser.ts": 'export type { R } from "./route.js";\n',
      "src/layout/route.ts": 'import { readFileSync } from "node:fs";\nexport type R = typeof readFileSync;\n',
    });
    expect(keys(typeOnly)).toEqual([]);
  });

  it("import.meta.url은 세 꼴만 되고, Worker 대상 파일이 없으면 실패한다", () => {
    const ok = fakeTree({
      "src/observe/d.ts": 'export const w = () => new Worker(new URL("./w.mjs", import.meta.url), { workerData: { entry: new URL("./t.ts", import.meta.url).href } });\n',
      "src/observe/w.mjs": "export {};\n",
      "src/observe/t.ts": "export {};\n",
      "src/agent/mcp.ts": 'import { isEntry } from "../shared/paths.js";\nif (isEntry(import.meta.url)) console.log(1);\n',
      "src/shared/paths.ts": 'export const ROOT = new URL("../../", import.meta.url);\nexport const isEntry = (u: string) => !!u;\n',
    });
    expect(keys(ok)).toEqual([]);
    const bad = fakeTree({
      "src/observe/d.ts": 'export const w = () => new Worker(new URL("./none.mjs", import.meta.url));\n',
      "src/server/app.ts": 'export const DIR = new URL("../../ui/dist/", import.meta.url);\n',
    });
    expect(keys(bad)).toEqual(["meta-url src/server/app.ts", "worker src/observe/d.ts -> ./none.mjs"]);
  });

  it("글자 그대로가 아닌 import()·require는 실패한다(허용 목록 파일만 된다). 글자 그대로면 import처럼 본다", () => {
    const root = fakeTree({
      "src/world/a.ts": 'const p = "../act/index.js";\nexport const load = () => import(p);\n',
      "src/world/b.ts": "export const load = (n: string) => import(`../act/${n}.js`);\n",
      "src/world/c.ts": "export const load = () => import(`../act/index.js`);\n",
      "src/world/d.ts": 'export const x = require("../act/index.js");\nconst n = "../act/index.js";\nexport const y = require(n);\n',
    });
    expect(keys(root)).toEqual([
      "direction src/world/c.ts -> src/act/index.ts",
      "direction src/world/d.ts -> src/act/index.ts",
      "dynamic src/world/a.ts",
      "dynamic src/world/b.ts",
      "dynamic src/world/d.ts",
    ]);
    expect(message(root, "dynamic src/world/a.ts")).toContain("글자 그대로가 아닌 import()·require");
    const worker = fakeTree({ "src/observe/w.mjs": 'import { workerData } from "node:worker_threads";\nawait import(workerData.entry);\n' });
    expect(keys(worker)).toEqual(["dynamic src/observe/w.mjs"]);
    expect(keys(worker, { ...CONFIG, dynamicOk: ["src/observe/w.mjs"] })).toEqual([]);
  });

  it("공용 표는 파일마다 따로 본다: 표끼리 값 import 고리는 실패하고 타입 전용 고리는 된다", () => {
    const value = fakeTree({
      "src/world/vocab.ts": 'import { TASKS } from "../act/tasks.js";\nexport const CLASSES = [TASKS];\n',
      "src/act/tasks.ts": 'import { CLASSES } from "../world/vocab.js";\nexport const TASKS = () => CLASSES;\n',
    });
    expect(keys(value)).toEqual(["cycle src/act/tasks.ts -> src/world/vocab.ts", "cycle src/world/vocab.ts -> src/act/tasks.ts"]);
    const types = fakeTree({
      "src/world/vocab.ts": 'import type { Task } from "../act/tasks.js";\nexport type Cls = { t: Task };\n',
      "src/act/tasks.ts": 'import type { Cls } from "../world/vocab.js";\nexport type Task = { c?: Cls };\n',
    });
    expect(keys(types)).toEqual([]);
  });

  it("도메인에 입구 index.ts가 없으면 실패한다", () => {
    expect(keys(fakeTree({ "src/act/index.ts": null, "ui/src/twin/index.ts": null }))).toEqual(["no-index act", "no-index ui/twin"]);
  });

  it("어느 도메인·기반층에도 없는 파일은 실패한다", () => {
    expect(keys(fakeTree({ "src/misc/x.ts": "export {};\n" }))).toEqual(["unknown src/misc/x.ts"]);
  });

  it("의존 표에 고리가 생기면 실패한다(지금 표에는 고리가 없다)", () => {
    expect(tableCycles(DEPS)).toEqual([]);
    const ks = keys(fakeTree(), { ...CONFIG, deps: { ...DEPS, devices: ["act"] } });
    expect(ks).toContain("deps-cycle devices -> act -> devices");
    expect(ks.every((k) => k.startsWith("deps-cycle "))).toBe(true);
  });
});

describe("도메인 경계: 0a392c5의 실제 위반 줄", () => {
  const fixture = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/domains/past-mistakes.json"), "utf8")) as {
    cases: { file: string; line: string; target: string; why: string; expect: string[] }[];
  };
  it("고정 자료는 여섯 줄이다", () => expect(fixture.cases).toHaveLength(6));
  for (const c of fixture.cases) {
    it(`${c.file}: ${c.line} → 실패(${c.why})`, () => {
      const root = fakeTree({ [c.file]: `${c.line}\nexport {};\n`, [c.target]: "export const x = 1;\n" });
      expect(keys(root)).toEqual(c.expect);
    });
  }
});

describe("도메인 경계: 예외 목록(줄어들기만 함)", () => {
  it("목록에 없는 새 위반과, 목록에 있는데 이제 안 생기는 줄(두 번 적은 줄 포함)을 모두 잡는다", () => {
    const v = [{ key: "inner a -> b", message: "m1" }, { key: "inner c -> d", message: "m2" }];
    expect(compareExceptions(v, ["inner a -> b", "inner c -> d"])).toEqual({ added: [], stale: [] });
    expect(compareExceptions(v, ["inner a -> b"])).toEqual({ added: [v[1]], stale: [] });
    expect(compareExceptions(v, ["inner a -> b", "inner c -> d", "inner e -> f", "inner a -> b"])).toEqual({ added: [], stale: ["inner e -> f", "inner a -> b"] });
  });

  it("실제 트리: 새 위반도 지울 예외도 없고, 엄격 모드 실패 수 = 예외 목록 줄 수", () => {
    const violations = checkTree(ROOT);
    const exceptions = readExceptions(ROOT);
    expect(compareExceptions(violations, exceptions)).toEqual({ added: [], stale: [] });
    expect(violations.length).toBe(exceptions.length);
    expect([...exceptions].sort()).toEqual(violations.map((v) => v.key));
  }, 60_000);

  it("새 위반을 예외 목록에 같이 넣어도 기준 목록에 없던 줄이면 실패한다", () => {
    const v = [{ key: "inner a -> b", message: "m1" }, { key: "inner c -> d", message: "m2" }];
    // 지금 위반과 지금 목록만 견주면 통과해 버린다
    expect(compareExceptions(v, ["inner a -> b", "inner c -> d"])).toEqual({ added: [], stale: [] });
    expect(unbasedKeys(["inner a -> b", "inner c -> d"], { keys: ["inner a -> b"], moves: [] })).toEqual(["inner c -> d"]);
  });

  it("기준 뒤 대응표로 옮긴 경로와, 같은 도메인 입구로 바꾼 import는 기준 줄로 본다", () => {
    const base = {
      keys: ["inner src/server/a.ts -> src/sync/b.ts", "direction src/world/a.ts -> src/act/b.ts", "cycle src/world/a.ts -> src/act/b.ts"],
      moves: [{ "src/sync/b.ts": "src/phone/sync/b.ts" }],
    };
    expect(unbasedKeys(["inner src/server/a.ts -> src/phone/sync/b.ts", "direction src/world/a.ts -> src/act/index.ts", "cycle src/world/a.ts -> src/act/index.ts"], base)).toEqual([]);
    expect(unbasedKeys(["direction src/world/a.ts -> src/agent/index.ts", "inner src/server/a.ts -> src/sync/b.ts"], base)).toEqual([
      "direction src/world/a.ts -> src/agent/index.ts",
      "inner src/server/a.ts -> src/sync/b.ts",
    ]);
  });

  it("같은 도메인 입구로 바꾼 줄은 옛 줄이 없어졌을 때만 같은 줄로 본다(1:1)", () => {
    const old = "direction src/world/a.ts -> src/act/b.ts";
    const entry = "direction src/world/a.ts -> src/act/index.ts";
    expect(unbasedKeys([old, entry], { keys: [old], moves: [] })).toEqual([entry]);
    expect(unbasedKeys([entry], { keys: [old], moves: [] })).toEqual([]);
    const two = { keys: [old, "direction src/world/a.ts -> src/act/c.ts"], moves: [] };
    expect(unbasedKeys([entry], two)).toEqual([]);
    expect(unbasedKeys([entry, "direction src/world/b.ts -> src/act/index.ts"], two)).toEqual(["direction src/world/b.ts -> src/act/index.ts"]);
  });

  it("기준은 git으로 읽는다: 기준 커밋의 예외 목록과, 그 뒤 새로 생긴 대응표의 files", () => {
    const root = mkdtempSync(join(tmpdir(), "domains-base-"));
    roots.push(root);
    const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { encoding: "utf8" }).trim();
    const put = (p: string, text: string) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), text); };
    git("init", "-q");
    put(EXCEPTIONS_FILE, JSON.stringify(["inner src/server/a.ts -> src/sync/b.ts"]));
    put(`${MOVES_DIR}1.json`, '{ "files": {}, "decls": {}, "new": [], "text": [] }');
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD");
    put(`${MOVES_DIR}2.json`, '{ "files": { "src/sync/b.ts": "src/phone/sync/b.ts" }, "decls": {}, "new": [], "text": [] }');
    expect(readBase(root, base)).toEqual({ keys: ["inner src/server/a.ts -> src/sync/b.ts"], moves: [{ "src/sync/b.ts": "src/phone/sync/b.ts" }] });
    expect(() => readBase(root, "0000000000000000000000000000000000000000")).toThrow(/기준 커밋/);
  }, 30_000);

  it("예외 목록은 커밋마다 바로 앞 커밋의 목록보다 늘지 않는다: 앞 단계에서 없앤 줄을 다시 넣으면 처음 목록에 있어도 실패한다", () => {
    const root = mkdtempSync(join(tmpdir(), "domains-chain-"));
    roots.push(root);
    const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { encoding: "utf8" }).trim();
    const put = (p: string, text: string) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), text); };
    const step = (n: string, lines: string[], extra: Record<string, unknown> = {}, commit = true) => {
      put(EXCEPTIONS_FILE, JSON.stringify(lines));
      put(`${MOVES_DIR}${n}.json`, JSON.stringify({ files: {}, decls: {}, new: [], text: [], ...extra }));
      if (!commit) return "";
      git("add", "-A");
      git("commit", "-q", "-m", `step ${n}`);
      return git("rev-parse", "HEAD");
    };
    const K1 = "inner src/server/a.ts -> src/act/b.ts";
    const K2 = "inner src/server/a.ts -> src/act/c.ts";
    const K3 = "inner src/server/a.ts -> src/act/d.ts";
    git("init", "-q");
    const base = step("1", [K1, K2]);
    step("2", [K1]);
    step("3", [K1, K2], {}, false);
    // 처음 목록과만 견주면 통과해 버린다
    expect(unbasedKeys([K1, K2], readBase(root, base))).toEqual([]);
    expect(chainFailures(root, base)).toEqual([`지금 트리: 앞(${git("rev-parse", "HEAD").slice(0, 7)})에 없던 예외 줄이에요: ${K2}`]);
    // 새 줄은 그 단계 대응표 exceptions에 까닭·기한과 함께 적어야 한다
    step("3", [K1, K3], { exceptions: { [K3]: { why: "merge로 들어온 새 import", until: "4" } } }, false);
    expect(chainFailures(root, base)).toEqual([]);
    step("3", [K1, K3], { exceptions: { [K3]: { why: "", until: "4" } } }, false);
    expect(chainFailures(root, base)).toEqual([`${MOVES_DIR}3.json exceptions의 까닭이 비었어요: ${K3}`]);
    step("3", [K1, K3], { exceptions: { [K3]: { why: "까닭", until: "2" } } }, false);
    expect(chainFailures(root, base)).toEqual([`${MOVES_DIR}3.json exceptions의 기한(2)이 그 단계(3)보다 앞이에요: ${K3}`]);
    step("3", [K1, K3], { exceptions: { [K3]: { why: "까닭", until: "3" } } });
    step("4", [K1, K3], {}, false);
    expect(chainFailures(root, base)).toEqual([`${MOVES_DIR}3.json exceptions의 기한(3)이 지났는데 줄이 남아 있어요: ${K3}`]);
    step("4", [K1], {}, false);
    expect(chainFailures(root, base)).toEqual([]);
  }, 60_000);

  it("새 줄을 허용한 대응표를 뒤에 지우면 처음 목록과 견줘 실패한다(바로 앞 목록에는 있어도)", () => {
    const root = mkdtempSync(join(tmpdir(), "domains-first-"));
    roots.push(root);
    const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { encoding: "utf8" }).trim();
    const put = (p: string, text: string) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), text); };
    const K1 = "inner src/server/a.ts -> src/act/b.ts";
    const K2 = "inner src/server/a.ts -> src/act/c.ts";
    git("init", "-q");
    put(EXCEPTIONS_FILE, JSON.stringify([K1]));
    put(`${MOVES_DIR}1.json`, "{}");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD");
    put(EXCEPTIONS_FILE, JSON.stringify([K1, K2]));
    put(`${MOVES_DIR}2.json`, JSON.stringify({ exceptions: { [K2]: { why: "merge로 들어온 새 import", until: "9" } } }));
    git("add", "-A");
    git("commit", "-q", "-m", "step 2");
    expect(chainFailures(root, base)).toEqual([]);
    rmSync(join(root, `${MOVES_DIR}2.json`));
    expect(chainFailures(root, base)).toEqual([`처음 목록(${base.slice(0, 7)})에 없던 예외 줄이에요: ${K2}`]);
  }, 60_000);

  it("실제 트리: 예외 목록의 모든 줄이 기준 목록(scripts/lint-domains.ts EXCEPTIONS_BASE)에 있다", () => {
    expect(checkRepo(ROOT)).toEqual({ added: [], stale: [], unbased: [] });
  }, 60_000);
});
