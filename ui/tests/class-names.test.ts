// @vitest-environment node
// 화면 코드의 Tailwind 클래스 검사. styles.css의 색 토큰 --color-lg(LG 빨강) 때문에 text-lg는 글자 크기와 함께 글자색까지 빨강으로 바꾼다.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? files(join(dir, e.name)) : /\.(tsx|ts)$/.test(e.name) ? [join(dir, e.name)] : []);

describe("Tailwind 클래스", () => {
  it("text-lg를 쓰지 않는다(--color-lg와 겹쳐 글자가 LG 빨강이 된다). 큰 글자는 text-[18px]", () => {
    const hits = files(SRC).flatMap((f) => readFileSync(f, "utf8").split("\n")
      .map((line, i) => (/(?<![\w-])text-lg(?![\w-])/.test(line) ? `${relative(SRC, f)}:${i + 1}` : null))
      .filter((x): x is string => x !== null));
    expect(hits).toEqual([]);
  });
});
