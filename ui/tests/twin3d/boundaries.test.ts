// @vitest-environment node
// 엔진 경계: ui/src/twin/3d의 .ts(엔진·셈)는 React와 대시보드 화면을 가져오지 않는다. React 감싸개는 Twin3D.tsx 하나다.
import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAst } from "vite";
import { describe, expect, it } from "vitest";

const DIR = fileURLToPath(new URL("../../src/twin/3d/", import.meta.url));
const UI_SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const DASHBOARD = fileURLToPath(new URL("../../src/dashboard/", import.meta.url));

type Node = { type: string; [key: string]: unknown };
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && typeof (v as Node).type === "string";
const walk = (n: unknown, visit: (n: Node) => void): void => {
  if (Array.isArray(n)) { for (const c of n) walk(c, visit); return; }
  if (!isNode(n)) return;
  visit(n);
  for (const [k, v] of Object.entries(n)) if (k !== "start" && k !== "end" && typeof v === "object") walk(v, visit);
};
/** 글자 그대로인 모듈 글: 문자열, 식이 없는 템플릿 글. */
const literal = (n: unknown): string | undefined => {
  if (!isNode(n)) return undefined;
  if (n.type === "Literal" && typeof n.value === "string") return n.value;
  const quasis = n.quasis as { value: { cooked: string } }[] | undefined;
  if (n.type === "TemplateLiteral" && (n.expressions as unknown[]).length === 0) return quasis?.[0]?.value.cooked ?? "";
  return undefined;
};
const isMetaUrl = (n: unknown) => isNode(n) && n.type === "MemberExpression" && isNode(n.object) && n.object.type === "MetaProperty" && isNode(n.property) && n.property.name === "url";
/** 파일이 가져오는 모듈 글(구문 트리로 모음, scripts/domain-ast.ts와 같은 파서): import(부수 효과 포함)·export … from·import("…")·import(`…`)·타입 자리 import("…")·new URL("…", import.meta.url). */
const imports = (src: string, lang: "ts" | "tsx" = "ts") => {
  const out: string[] = [];
  walk(parseAst(src, { lang }), (n) => {
    if ((n.type === "ImportDeclaration" || n.type === "ExportNamedDeclaration" || n.type === "ExportAllDeclaration") && n.source) {
      const s = literal(n.source);
      if (s !== undefined) out.push(s);
    } else if (n.type === "ImportExpression") {
      const s = literal(n.source);
      if (s !== undefined) out.push(s);
    } else if (n.type === "TSImportType") {
      const s = literal(n.source ?? (n.argument as Node | undefined)?.literal ?? n.argument);
      if (s !== undefined) out.push(s);
    } else if (n.type === "NewExpression" && isNode(n.callee) && n.callee.name === "URL" && isMetaUrl((n.arguments as unknown[])[1])) {
      const s = literal((n.arguments as unknown[])[0]);
      if (s !== undefined) out.push(s);
    }
  });
  return out;
};
/** 상대 경로·@/ 별칭 import를 실제 파일 자리로 풀어 ui/src/dashboard 아래인지 본다(폴더 깊이가 바뀌어도 그대로 잡는다). */
const intoDashboard = (fromDir: string, spec: string) => {
  const target = spec.startsWith(".") ? resolve(fromDir, spec) : spec.startsWith("@/") ? resolve(UI_SRC, spec.slice(2)) : null;
  if (target === null) return false;
  const rel = relative(DASHBOARD, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

describe("엔진 경계", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".ts"));
  it("엔진 파일이 있다", () => {
    expect(files).toEqual(expect.arrayContaining(["engine.ts", "view.ts", "merge.ts", "schedule.ts"]));
  });
  it("react·대시보드 화면(ui/src/dashboard)을 import하지 않는다", () => {
    const bad = files.flatMap((f) => imports(readFileSync(DIR + f, "utf8")).filter((p) => /^react(?:$|[-/])/.test(p) || intoDashboard(DIR, p)).map((p) => `${f}: ${p}`));
    expect(bad).toEqual([]);
  });
  it("import 모으기가 모든 꼴을 잡는다: 부수 효과 import(세미콜론 없이 다음 줄이 이어져도)·export from·import(\"…\")·import(`…`)·타입 자리·new URL", () => {
    const src = [
      'import { useState } from "react"',
      'import "../../dashboard/words"',
      'export { a } from "./a"',
      'export * from "./b"',
      "const lazy = () => import(`../../dashboard/late`)",
      'const lazier = () => import("./c")',
      'type T = typeof import("./d")',
      'const w = new URL("./worker.ts", import.meta.url)',
      "const notLiteral = (p: string) => import(p)",
      'import "react-dom/client"',
    ].join("\n");
    expect(imports(src)).toEqual(["react", "../../dashboard/words", "./a", "./b", "../../dashboard/late", "./c", "./d", "./worker.ts", "react-dom/client"]);
  });
  it("대시보드 판정은 경로 글자가 아니라 풀린 자리로 한다", () => {
    expect(intoDashboard(DIR, "../../dashboard/words")).toBe(true);
    expect(intoDashboard(DIR, "../../dashboard")).toBe(true);
    expect(intoDashboard(DIR, "@/dashboard/words")).toBe(true);
    expect(intoDashboard(DIR, "../dashboard/words")).toBe(false);
    expect(intoDashboard(DIR, "./view")).toBe(false);
    expect(intoDashboard(DIR, "three")).toBe(false);
  });
});
