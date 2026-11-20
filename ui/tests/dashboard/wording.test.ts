// @vitest-environment node
// 대시보드 글(화면 이름·주석·시험 이름·문서)은 「대시보드 폰 칸」과 「실제 폰」을 나눠 쓴다. 둘 중 무엇인지 모르는 낱말(폰+화면)만 쓰지 않는다.
// 범위: ui/src/dashboard, ui/src/twin/3d, ui/tests/dashboard, ui/src/components/ui, docs/twin3d.md. 없는 범위는 건너뛴다.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCOPE = ["ui/src/dashboard", "ui/src/twin/3d", "ui/tests/dashboard", "ui/src/components/ui", "docs/twin3d.md"];
// 「실제 폰 화면」은 된다
const BARE = new RegExp("(?<!실제 )폰 ?" + "화면");

const walk = (p: string): string[] => (statSync(p).isDirectory() ? readdirSync(p).flatMap((n) => walk(join(p, n))) : [p]);

describe("대시보드 글", () => {
  it("「대시보드 폰 칸」과 「실제 폰」을 나눠 쓴다", () => {
    const found = SCOPE.map((s) => join(ROOT, s)).filter((p) => existsSync(p)).flatMap(walk)
      .filter((f) => /\.(tsx?|mjs|md)$/.test(f))
      .flatMap((f) => readFileSync(f, "utf8").split("\n").flatMap((line, i) =>
        BARE.test(line) ? [`${relative(ROOT, f).replaceAll("\\", "/")}:${i + 1}`] : []));
    expect(found, "대시보드 칸이면 「대시보드 폰 칸」(화면 이름은 「폰 카메라」), 촬영 중인 폰이면 「실제 폰」으로 쓴다").toEqual([]);
  });

  it("대시보드 폴더는 범위 안에 있다", () => {
    expect(existsSync(join(ROOT, "ui/src/dashboard"))).toBe(true);
    expect(existsSync(join(ROOT, "ui/tests/dashboard"))).toBe(true);
  });
});
