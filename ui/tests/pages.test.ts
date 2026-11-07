// @vitest-environment node
// 입구 HTML(대시보드·설정): 파비콘은 NOONCHI 얼굴 상자(ui/public, 위키 브랜드 그림)다. 아이콘이 없으면 브라우저가 /favicon.ico를 찾다 404를 콘솔 오류로 남긴다.
// 글자 크기는 화면마다 html[data-surface]로 고르고, 글꼴은 저장소에 묶은 Noto Sans KR Variable을 입구마다 싣는다.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const at = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const page = (p: string) => readFileSync(at(p), "utf8");

describe("입구 HTML", () => {
  it.each([["index.html", "hub"], ["setup/index.html", "setup"]])("%s는 얼굴 상자 파비콘을 넣고 data-surface=%s를 단다", (p, surface) => {
    const html = page(p);
    expect(html).toContain(`<html lang="ko" data-surface="${surface}">`);
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="any">');
    expect(html).toContain('<link rel="icon" type="image/png" href="/favicon-32.png">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
    expect(html).not.toContain("data:image/svg+xml");
    expect(html).toContain("<title>NOONCHI");
  });

  it("파비콘·로고·마스코트 그림과 출처 글이 ui/public에 있다", () => {
    for (const f of ["favicon.ico", "favicon-32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "brand/face.png", "brand/face-64.png", "brand/face-128.png", "brand/mascot.png", "brand/mascot@1x.webp", "brand/README.md", "fonts/OFL-noto-sans-kr.txt"]) {
      expect(existsSync(at(`public/${f}`)), f).toBe(true);
    }
    expect(page("public/brand/README.md")).toContain("noonchi-home/wiki");
  });

  it.each(["src/dashboard/main.tsx", "src/setup/main.tsx"])("%s는 묶은 글꼴을 싣는다(외부 CDN 없음)", (p) => {
    expect(page(p)).toContain('import "@fontsource-variable/noto-sans-kr";');
  });
});
