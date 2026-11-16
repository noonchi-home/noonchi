// @vitest-environment node
// 엔진 경계: ui/src/twin/3d의 .ts(엔진·셈)는 React와 대시보드 화면을 가져오지 않는다. React 감싸개는 Twin3D.tsx 하나다.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = fileURLToPath(new URL("../../src/twin/3d/", import.meta.url));
const imports = (src: string) => [...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm)].map((m) => m[1] ?? m[2] ?? m[3]!);

describe("엔진 경계", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".ts"));
  it("엔진 파일이 있다", () => {
    expect(files).toEqual(expect.arrayContaining(["engine.ts", "view.ts", "merge.ts", "schedule.ts"]));
  });
  it("react·../dashboard를 import하지 않는다", () => {
    const bad = files.flatMap((f) => imports(readFileSync(DIR + f, "utf8")).filter((p) => /^react(?:$|[-/])/.test(p) || p.startsWith("../dashboard")).map((p) => `${f}: ${p}`));
    expect(bad).toEqual([]);
  });
  it("import 줄 읽기가 react·대시보드 import를 잡는다", () => {
    expect(imports('import { useState } from "react";\nimport { Dash } from "../dashboard/Dashboard";\nimport "react-dom/client";')).toEqual(["react", "../dashboard/Dashboard", "react-dom/client"]);
  });
});
