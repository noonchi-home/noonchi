// @vitest-environment node
// 입구 HTML(대시보드·설정): 아이콘이 없으면 브라우저가 /favicon.ico를 찾다 404를 콘솔 오류로 남긴다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const page = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

describe("입구 HTML", () => {
  it.each(["index.html", "setup/index.html"])("%s는 아이콘을 직접 넣는다", (p) => {
    expect(page(p)).toMatch(/<link rel="icon" href="data:image\/svg\+xml,/);
  });
});
