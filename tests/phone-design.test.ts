// 폰 화면(web/phone)의 디자인 토큰·글꼴·브랜드 그림: 색은 web/phone/tokens.css·tokens.js(src/design/tokens.json에서 만듦),
// 글꼴은 저장소에 묶은 Noto Sans KR Variable(/phone/fonts/), 파비콘·마스코트는 위키 브랜드 그림.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createPhoneServer } from "../src/phone/server.js";
import { fetchRetry } from "../src/server/net.js";
import { drawMarks, markFont } from "../web/phone/marks.js";
import { color, rgba, twin } from "../src/design/tokens.js";

const web = (p: string) => readFileSync(fileURLToPath(new URL(`../web/phone/${p}`, import.meta.url)), "utf8");
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

/** 캔버스 대신 그린 차례만 적는다. */
function recorder() {
  const ops: string[] = [];
  const ctx = {
    lineWidth: 0, font: "", textAlign: "", strokeStyle: "", fillStyle: "",
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {},
    stroke() { ops.push(`stroke ${ctx.strokeStyle} ${ctx.lineWidth.toFixed(1)}`); },
    fill() { ops.push(`fill ${ctx.fillStyle}`); },
    fillRect() { ops.push(`rect ${ctx.fillStyle}`); },
    fillText() { ops.push(`text ${ctx.fillStyle}`); },
    measureText: (t: string) => ({ width: t.length * 10 }),
  };
  return { ctx, ops };
}

describe("폰 초점 표시(marks.js)", () => {
  it("초점 고리는 세 겹: 숯색 → 흰 테 → brand 순서로 굵기를 줄이며 그린다. 이름표는 scrim-phone 위 on-scrim", () => {
    const { ctx, ops } = recorder();
    drawMarks(ctx, [{ id: "a", label: "컵", u: 0.5, v: 0.5, off: false, angle: 0 }], 640, 480);
    const strokes = ops.filter((o) => o.startsWith("stroke"));
    expect(strokes.map((o) => o.split(" ")[1])).toEqual([color.charcoal, color["twin-casing"], color.brand]);
    const widths = strokes.map((o) => Number(o.split(" ")[2]));
    expect(widths[0]).toBeGreaterThan(widths[1]!);
    expect(widths[1]).toBeGreaterThan(widths[2]!);
    expect(ops).toContain(`rect ${rgba["scrim-phone"]}`);
    expect(ops).toContain(`text ${color["on-scrim"]}`);
    expect(ctx.font).toContain("Noto Sans KR Variable");
  });

  it("화면 밖 화살표도 숯색·흰 테를 두르고 brand로 채운다", () => {
    const { ctx, ops } = recorder();
    drawMarks(ctx, [{ id: "b", label: "냉장고", u: 0.95, v: 0.5, off: true, angle: 0 }], 640, 480);
    expect(ops.slice(0, 3)).toEqual([expect.stringMatching(`^stroke ${color.charcoal}`), expect.stringMatching(`^stroke ${color["twin-casing"]}`), `fill ${twin.phoneFocus.offscreenArrow}`]);
  });

  it("marks.js·워커는 web/phone/tokens.js 값과 묶은 글꼴만 쓴다", () => {
    expect(web("marks.js")).toMatch(/from "\.\/tokens\.js"/);
    expect(markFont(640)).toMatch(/^bold \d+px "Noto Sans KR Variable"/);
    const worker = web("encoder-worker.js");
    expect(worker).toMatch(/from "\.\/fonts\/faces\.js"/);
    expect(worker).toContain("new FontFace(");
    expect(worker).toContain("self.fonts.load(");
  });
});

describe("폰 페이지(web/phone/index.html)", () => {
  const page = web("index.html");
  it("토큰·글꼴 CSS를 phone.css보다 먼저 싣고, 폰 글자 크기(data-surface=phone)를 쓴다", () => {
    expect(page).toMatch(/<html lang="ko" data-surface="phone">/);
    const at = (s: string) => page.indexOf(s);
    expect(at('href="tokens.css"')).toBeGreaterThan(0);
    expect(at('href="fonts/noto-sans-kr.css"')).toBeGreaterThan(0);
    expect(at('href="tokens.css"')).toBeLessThan(at('href="phone.css"'));
  });

  it("파비콘은 얼굴 상자, 시작 화면 제목 위에 마스코트 전신", () => {
    expect(page).toContain('<link rel="icon" href="favicon.ico" sizes="any">');
    expect(page).toContain('<link rel="apple-touch-icon" href="apple-touch-icon.png">');
    expect(page).toMatch(/<img [^>]*src="brand\/mascot@1x\.webp"[^>]*>\s*<h1>/);
  });

  it("phone.css는 토큰 변수로만 칠한다", () => {
    const css = web("phone.css");
    expect(css).toContain("var(--ink)");
    expect(css).toContain("var(--brand)");
    expect(css).toContain("var(--font-sans)");
  });
});

describe("폰 서버가 글꼴·파비콘·마스코트를 준다", () => {
  it("/phone/fonts의 woff2·라이선스, /phone/favicon.ico, /phone/brand 그림이 200", async () => {
    const targets = [{ id: "dock", label: "도크", plan: [3.9, 5.51] as [number, number] }, { id: "door", label: "현관", plan: [2.4, 3.55] as [number, number] }];
    const phone = createPhoneServer({ targets, onEye: () => {}, log: () => {} });
    const { port } = await phone.listen(0, "127.0.0.1");
    cleanups.push(() => phone.close());
    const base = `http://127.0.0.1:${port}/phone/`;
    const font = await fetchRetry(`${base}fonts/files/noto-sans-kr-0-wght-normal.woff2`);
    expect(font.status).toBe(200);
    expect(font.headers.get("content-type")).toBe("font/woff2");
    for (const p of ["fonts/noto-sans-kr.css", "fonts/OFL-noto-sans-kr.txt", "favicon.ico", "favicon-32.png", "apple-touch-icon.png", "brand/mascot@1x.webp", "tokens.css", "tokens.js"]) {
      expect((await fetchRetry(`${base}${p}`)).status, p).toBe(200);
    }
  });
});
