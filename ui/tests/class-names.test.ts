// @vitest-environment node
// Tailwind 이름 겹침 검사. 색 토큰 이름이 글자 크기 이름과 같으면 text-<이름>이 글자 크기와 글자색을 함께 바꾼다(옛 --color-lg 때 text-lg가 LG 빨강이 됐다).
// 색은 src/design/tokens.json 하나에서 오니, 그 색·반투명·별칭 이름이 Tailwind 기본 크기와 글자 크기 토큰 이름과 겹치지 않는지 본다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tokens = JSON.parse(readFileSync(fileURLToPath(new URL("../../src/design/tokens.json", import.meta.url)), "utf8")) as {
  color: Record<string, unknown>; colorRgba: Record<string, unknown>; alias: Record<string, unknown>; type: Record<string, unknown>;
};
const TAILWIND_SIZES = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"];

describe("Tailwind 이름 겹침", () => {
  it("색 토큰 이름이 글자 크기 이름(xs·sm·lg…·caption·label·body…)과 겹치지 않는다", () => {
    const sizes = new Set([...TAILWIND_SIZES, ...Object.keys(tokens.type)]);
    const colors = [...Object.keys(tokens.color), ...Object.keys(tokens.colorRgba), ...Object.keys(tokens.alias)];
    expect(colors.filter((c) => sizes.has(c))).toEqual([]);
    expect(colors).not.toContain("lg");
  });
});
