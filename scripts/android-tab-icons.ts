// 안드로이드 아래 탭 아이콘 그리기: 웹 폰 탭(ui/src/components/phone-portal-chrome.tsx)과 같은 lucide House·Map·Settings를
// 선 굵기 2, 66×66 투명 PNG로 그려 apps/android/assets/tabs/에 쓴다. 앱은 22×22 자리에 두고 tintColor로 색을 입힌다.
// tests/android-tab-icons.test.ts가 PNG가 지금 lucide 원본과 같은 그림인지 본다.
// 사용: npm run heavy -- npx tsx scripts/android-tab-icons.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { repoPath } from "./design-tokens.js";

export const TAB_ICONS = { house: "House", map: "Map", settings: "Settings" } as const;

async function main() {
  const fromUi = createRequire(repoPath("ui/package.json"));
  const { createElement } = fromUi("react") as { createElement(type: never, props: object): unknown };
  const { renderToStaticMarkup } = fromUi("react-dom/server") as { renderToStaticMarkup(node: unknown): string };
  const lucide = fromUi("lucide-react") as Record<string, unknown>;
  for (const [file, icon] of Object.entries(TAB_ICONS)) {
    const svg = renderToStaticMarkup(createElement(lucide[icon] as never, { size: 66, strokeWidth: 2, color: "#000000" }));
    const path = `apps/android/assets/tabs/${file}.png`;
    mkdirSync(dirname(repoPath(path)), { recursive: true });
    writeFileSync(repoPath(path), await sharp(Buffer.from(svg)).png().toBuffer());
    console.log(`만듦 ${path} (lucide ${icon})`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
