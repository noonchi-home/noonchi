// 안드로이드 아래 탭 아이콘(apps/android/assets/tabs/*.png)은 웹 폰 탭과 같은 lucide 원본을 선 굵기 2, 66px로 그린 그림이다. 어긋나면 실패한다.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { repoPath } from "../scripts/design-tokens.js";

const fromUi = createRequire(repoPath("ui/package.json"));
const { createElement } = fromUi("react") as { createElement(type: never, props: object): unknown };
const { renderToStaticMarkup } = fromUi("react-dom/server") as { renderToStaticMarkup(node: unknown): string };
const lucide = fromUi("lucide-react") as Record<string, unknown>;
const pixels = async (input: Buffer) => sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

describe("안드로이드 아래 탭 아이콘 PNG", () => {
  it("웹 폰 탭(phone-portal-chrome.tsx)과 같은 House·Map·Settings다", () => {
    const web = readFileSync(repoPath("ui/src/components/phone-portal-chrome.tsx"), "utf8");
    expect(web).toContain('import { House, Map, Settings } from "lucide-react";');
    expect(web).toMatch(/id: "home",[^}]*icon: House \}[\s\S]*id: "scan",[^}]*icon: Map \}[\s\S]*id: "settings",[^}]*icon: Settings \}/);
  });

  it.each([["house", "House"], ["map", "Map"], ["settings", "Settings"]])("%s.png는 lucide %s를 선 굵기 2, 66×66으로 그린 그림이다(다르면 npm run heavy -- npx tsx scripts/android-tab-icons.ts)", async (file, icon) => {
    const svg = renderToStaticMarkup(createElement(lucide[icon] as never, { size: 66, strokeWidth: 2, color: "#000000" }));
    const want = await pixels(Buffer.from(svg));
    const got = await pixels(readFileSync(repoPath(`apps/android/assets/tabs/${file}.png`)));
    expect([got.info.width, got.info.height]).toEqual([66, 66]);
    expect(got.data.equals(want.data)).toBe(true);
  });
});
