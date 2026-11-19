// 도메인 경계 검사(scripts/lint-domains.ts). npm run lint와 같은 검사다.
// 실제 트리는 위반이 없어야 하고(엄격 모드 하나뿐, 예외 목록 없음), 가짜 트리·0a392c5 실제 줄은 정한 오류 글로 실패해야 한다.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIG, DEPS, SCREEN_DOMAINS, SERVER_DOMAINS, checkTree, lintMain, tableCycles, type Config,
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

  it("브라우저 입구(src/<도메인>/browser.ts)도 입구다: 방향 안이면 서버 도메인이 가져와도 되고, 따라 들어간 import에 node 모듈이 있으면 가져오는 곳이 없어도 실패한다", () => {
    const ok = fakeTree({
      "src/agent/plan.ts": 'import { route } from "../layout/browser.js";\nexport const plan = route;\n',
      "src/layout/browser.ts": 'export { route } from "./route.js";\n',
      "src/layout/route.ts": "export const route = 1;\n",
      "src/layout/scene.ts": 'import { attrs } from "../devices/browser.js";\nexport const scene = attrs;\n',
      "src/devices/browser.ts": 'export { attrs } from "./mapping.js";\n',
      "src/devices/mapping.ts": "export const attrs = {};\n",
    });
    expect(keys(ok)).toEqual([]);
    const reverse = fakeTree({ "src/devices/a.ts": 'import { route } from "../layout/browser.js";\nexport const a = route;\n', "src/layout/browser.ts": "export const route = 1;\n" });
    expect(keys(reverse)).toEqual(["direction src/devices/a.ts -> src/layout/browser.ts"]);
    const node = fakeTree({
      "src/devices/browser.ts": 'export { attrs } from "./mapping.js";\n',
      "src/devices/mapping.ts": 'import { readFileSync } from "node:fs";\nexport const attrs = readFileSync;\n',
    });
    expect(keys(node)).toEqual(["node src/devices/mapping.ts -> node:fs"]);
    expect(message(node, "node src/devices/mapping.ts -> node:fs")).toBe("브라우저 입구에 node 모듈 `node:fs`이 섞여요(`src/devices/browser.ts` → `src/devices/mapping.ts`)");
    const onlyBrowser = fakeTree({ "src/devices/index.ts": null, "src/devices/browser.ts": "export const attrs = {};\n" });
    expect(keys(onlyBrowser)).toEqual(["no-index devices"]);
    const screen = fakeTree({ "ui/src/twin/a.ts": 'import { attrs } from "../../../src/devices/browser.js";\nexport const a = attrs;\n', "src/devices/browser.ts": "export const attrs = {};\n" });
    expect(keys(screen)).toEqual(["screen-src ui/src/twin/a.ts -> src/devices/browser.ts"]);
  });

  it("의존 표에 없는 방향(거꾸로)이면 실패하고 쓸 수 있는 도메인을 말한다", () => {
    const root = fakeTree({ "src/world/a.ts": 'import type { X } from "../act/index.js";\nexport type Y = X;\n' });
    expect(keys(root)).toEqual(["direction src/world/a.ts -> src/act/index.ts"]);
    expect(message(root, "direction src/world/a.ts -> src/act/index.ts")).toBe(
      "`src/world/a.ts` → `src/act/index.ts`: `world`는 `act`를 쓸 수 없어요(쓸 수 있는 것: bus·devices·layout). 공용 타입이면 contract로, 공용 도우미면 shared로 옮기세요",
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

  it("부수 효과 import(세미콜론 없이 다음 줄이 이어져도)와 식이 없는 템플릿 글 import(`…`)도 import로 본다", () => {
    const root = fakeTree({
      "ui/src/twin/a.ts": 'import "../dashboard/b"\nexport { c } from "./c"\nexport const late = () => import(`../dashboard/d`)\n',
      "ui/src/twin/c.ts": "export const c = 1;\n",
      "ui/src/dashboard/b.ts": "export const b = 1;\n",
      "ui/src/dashboard/d.ts": "export const d = 1;\n",
    });
    expect(keys(root)).toEqual([
      "direction ui/src/twin/a.ts -> ui/src/dashboard/b.ts",
      "direction ui/src/twin/a.ts -> ui/src/dashboard/d.ts",
      "inner ui/src/twin/a.ts -> ui/src/dashboard/b.ts",
      "inner ui/src/twin/a.ts -> ui/src/dashboard/d.ts",
    ]);
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

  it("화면 시험(ui/tests)이 바로 가져온 src 파일은 node 모듈을 써도 되지만, 그 파일을 거쳐 따라 들어간 src 파일에 node 모듈이 있으면 실패한다(jsdom에서 깨짐)", () => {
    const files = {
      "ui/tests/dashboard/run.ts": 'import { readHome } from "../../../src/layout/homes.js";\nimport { plan } from "../../../src/agent/plan.js";\nexport const run = [readHome, plan];\n',
      "ui/tests/dashboard/a.test.ts": 'import { run } from "./run.js";\nexport const a = run;\n',
      "src/layout/homes.ts": 'import { readFileSync } from "node:fs";\nexport const readHome = readFileSync;\n',
      "src/agent/plan.ts": 'import { route } from "../layout/route.js";\nexport const plan = route;\n',
      "src/layout/route.ts": "export const route = 1;\n",
    };
    expect(keys(fakeTree(files)).filter((k) => k.startsWith("node "))).toEqual([]);
    const root = fakeTree({
      ...files,
      "src/agent/plan.ts": 'import { route } from "../layout/index.js";\nexport const plan = route;\n',
      "src/layout/index.ts": 'export { route } from "./route.js";\nexport { twinDir } from "./twin.js";\n',
      "src/layout/twin.ts": 'import { repoPath } from "../shared/paths.js";\nexport const twinDir = repoPath("twin/");\n',
      "src/shared/paths.ts": 'import { fileURLToPath } from "node:url";\nexport const repoPath = (rel: string) => fileURLToPath(new URL(rel, "file:///r/"));\n',
    });
    expect(keys(root).filter((k) => k.startsWith("node "))).toEqual(["node src/shared/paths.ts -> node:url"]);
    expect(message(root, "node src/shared/paths.ts -> node:url")).toBe("화면 시험(jsdom)이 따라 들어간 src 파일에 node 모듈 `node:url`이 섞여요(`ui/tests/dashboard/run.ts` → `src/agent/plan.ts` → `src/layout/index.ts` → `src/layout/twin.ts` → `src/shared/paths.ts`). 시험이 바로 가져온 src 파일만 node 모듈을 써도 돼요");
  });

  it("화면 시험 길에 고리(ui/tests → a → b → a)가 있어도 시간 안에 끝나고, 길을 한 번만 적는다(시험이 바로 가져온 a는 node 모듈을 써도 된다)", () => {
    const root = fakeTree({
      "ui/tests/x.test.ts": 'import { a } from "../../src/agent/a.js";\nexport const x = a;\n',
      "src/agent/a.ts": 'import { join } from "node:path";\nimport { b } from "./b.js";\nexport const a = () => [join, b];\n',
      "src/agent/b.ts": 'import { readFileSync } from "node:fs";\nimport { a } from "./a.js";\nexport const b = () => [readFileSync, a];\n',
    });
    // 검사가 끝없이 돌면 메모리를 먹으므로 따로 띄운 node에서 시간·메모리를 묶어 돌린다
    const code = 'const { pathToFileURL } = await import("node:url"); const { checkTree } = await import(pathToFileURL("scripts/lint-domains.ts").href); console.log(JSON.stringify(checkTree(process.env.CHECK_ROOT)));';
    const r = spawnSync(process.execPath, ["--max-old-space-size=128", "--import", "tsx", "--input-type=module", "-e", code], { cwd: ROOT, env: { ...process.env, CHECK_ROOT: root }, encoding: "utf8", timeout: 60_000 });
    expect(r.error?.message).toBeUndefined();
    expect(r.status, r.stderr).toBe(0);
    const node = (JSON.parse(r.stdout) as { key: string; message: string }[]).filter((v) => v.key.startsWith("node "));
    expect(node).toEqual([{ key: "node src/agent/b.ts -> node:fs", message: "화면 시험(jsdom)이 따라 들어간 src 파일에 node 모듈 `node:fs`이 섞여요(`ui/tests/x.test.ts` → `src/agent/a.ts` → `src/agent/b.ts`). 시험이 바로 가져온 src 파일만 node 모듈을 써도 돼요" }]);
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

describe("도메인 경계: 엄격 모드(예외 목록 없음)", () => {
  /** lintMain을 부르고 끝 코드와 낸 글을 모은다. */
  const run = (root: string, argv: string[]) => {
    const log: string[] = [];
    const err: string[] = [];
    const code = lintMain(root, argv, { log: (m) => log.push(m), error: (m) => err.push(m) });
    return { code, log, err };
  };

  it("실제 트리는 위반이 없다", () => {
    expect(checkTree(ROOT).map((v) => v.key)).toEqual([]);
  }, 60_000);

  it("검사는 끌 수 없다: 위반이 있으면 어떤 인자로 불러도, 예외 목록 파일을 다시 만들어 그 줄을 적어도 실패한다", () => {
    const bad = fakeTree({ "src/server/a.ts": 'import { x } from "../act/b.js";\nexport const y = x;\n', "src/act/b.ts": "export const x = 1;\n" });
    for (const argv of [[], ["--strict"], ["--no-strict"], ["--base", "55cef6de171cac3f0f2e6bae1fd3072f507b6752"], ["--json"]]) {
      expect(run(bad, argv).code, argv.join(" ")).toBe(1);
    }
    expect(run(bad, []).err).toEqual(["`src/server/a.ts`이 `act` 안쪽 `src/act/b.ts`을 가져와요. `src/act/index.ts`로 가져오세요", "도메인 검사: 위반 1개"]);
    mkdirSync(join(bad, "scripts"), { recursive: true });
    writeFileSync(join(bad, "scripts", "domain-exceptions.json"), JSON.stringify(["inner src/server/a.ts -> src/act/b.ts"]));
    expect(run(bad, []).code).toBe(1);
  });

  it("위반이 없으면 통과 글을 내고 0으로 끝난다(--json은 빈 목록)", () => {
    const ok = fakeTree();
    expect(run(ok, [])).toEqual({ code: 0, log: ["도메인 검사 통과"], err: [] });
    expect(run(ok, ["--json"])).toEqual({ code: 0, log: ["[]"], err: [] });
  });

  it("예외 목록 파일과 그것을 읽던 코드가 없다", () => {
    expect(existsSync(join(ROOT, "scripts", "domain-exceptions.json"))).toBe(false);
    expect(readFileSync(join(ROOT, "scripts", "lint-domains.ts"), "utf8")).not.toMatch(/domain-exceptions|EXCEPTIONS_BASE|chainFailures/);
  });
});
