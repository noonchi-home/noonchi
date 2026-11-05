import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("메시지 계약", () => {
  it("src/contract/events.ts는 타입만 가져온다(화면 빌드에 서버 코드가 끌려오지 않게)", () => {
    const src = readFileSync(new URL("../src/contract/events.ts", import.meta.url), "utf8");
    const imports = src.split("\n").filter((l) => /^\s*import\b/.test(l));
    expect(imports.every((l) => /^\s*import type\b/.test(l))).toBe(true);
    expect(src).not.toMatch(/node:|from "zod"/);
  });
});
