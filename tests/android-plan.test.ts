// 안드로이드 간략 평면도(apps/android/assets/mokryeon-plan.png)는 웹 평면도 SVG를 크롬으로 그린 그림이다. 어긋나면 실패한다.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAN_PNG, pngText } from "../scripts/android-plan.js";
import { PLAN_SVG, repoPath } from "../scripts/design-tokens.js";

describe("안드로이드 간략 평면도 PNG", () => {
  it("지금 평면도 SVG(Pretendard SemiBold 글자)를 840×763으로 그린 그림이다(다르면 npm run heavy -- npx tsx scripts/android-plan.ts)", () => {
    expect(PLAN_PNG).toBe("apps/android/assets/mokryeon-plan.png");
    const svg = readFileSync(repoPath(PLAN_SVG), "utf8").replace(/\r\n/g, "\n");
    const png = readFileSync(repoPath(PLAN_PNG));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([840, 763]);
    expect(pngText(png)["noonchi:source-sha256"]).toBe(createHash("sha256").update(svg).digest("hex"));
  });
});
