// 트윈 뷰어(/twin/viewer/)는 ui 빌드 밖 정적 페이지라 화면이 묶은 글꼴을 import하지 못한다.
// 그래서 빌드는 화면과 같은 Pretendard Variable 조각을 가리키는 @font-face만 고정 주소 /fonts/pretendard.css로 내놓는다.
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

/** dist 안 고정 주소. 뷰어 style.css가 @import한다. */
export const FONT_CSS = "fonts/pretendard.css";
const PKG_CSS = "node_modules/pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";

/** 빌드한 CSS에서 Pretendard Variable @font-face 규칙만. */
export function pretendardFaces(css: string): string[] {
  return [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0]).filter((f) => /font-family:\s*["']?Pretendard Variable["']?\s*[;}]/.test(f));
}

/** 개발 서버용: 꾸러미 CSS의 조각 상대 주소를 ui 뿌리 기준 /node_modules/ 주소로. */
export function devFontCss(pkgCss: string): string {
  return pkgCss.replaceAll("url(./woff2-dynamic-subset/", "url(/node_modules/pretendard/dist/web/variable/woff2-dynamic-subset/");
}

export function pretendardCss(): Plugin {
  return {
    name: "pretendard-css",
    enforce: "post",
    configureServer(server) {
      server.middlewares.use(`/${FONT_CSS}`, (_req, res) => {
        res.setHeader("Content-Type", "text/css; charset=utf-8");
        res.end(devFontCss(readFileSync(new URL(PKG_CSS, import.meta.url), "utf8")));
      });
    },
    generateBundle(_options, bundle) {
      const faces = new Set<string>();
      for (const out of Object.values(bundle)) {
        if (out.type === "asset" && out.fileName.endsWith(".css")) for (const f of pretendardFaces(String(out.source))) faces.add(f);
      }
      if (!faces.size) this.error("빌드한 CSS에 Pretendard Variable @font-face가 없어요");
      this.emitFile({ type: "asset", fileName: FONT_CSS, source: `${[...faces].join("\n")}\n` });
    },
  };
}
