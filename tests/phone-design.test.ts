// 폰 초점 그림(ui/src/phone/core/marks.js): 색은 src/design/tokens.ts, 워커 글꼴은 ui 빌드가 묶은 Noto Sans KR Variable.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { drawMarks, markFont } from "../ui/src/phone/core/marks.js";
import { color, rgba, twin } from "../src/design/tokens.js";

const core = (p: string) => readFileSync(fileURLToPath(new URL(`../ui/src/phone/core/${p}`, import.meta.url)), "utf8");

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

  it("marks.js는 src/design/tokens.ts 값, 워커는 ui 빌드가 묶은 글꼴 목록(font-faces.js)을 쓴다", () => {
    expect(core("marks.js")).toContain('from "../../../../src/design/tokens.ts"');
    expect(markFont(640)).toMatch(/^bold \d+px "Noto Sans KR Variable"/);
    const worker = core("encoder-worker.js");
    expect(worker).toContain('from "./font-faces.js"');
    expect(worker).toContain("new FontFace(");
    expect(worker).toContain("self.fonts.load(");
  });
});
