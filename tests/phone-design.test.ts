// 폰 화면 프레임 명령 대상 그림(ui/src/phone/core/marks.js): 색은 src/design/tokens.ts, 워커 글꼴은 ui 빌드가 묶은 Noto Sans KR Variable.
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
  // 2026-11-19 사용자 「동그란 원 너무 거슬리는데」 「완전히 제거해 줘」: 화면 안 대상에는 고리가 없다
  it("화면 안 대상은 고리 없이 이름표만: scrim-phone 위 on-scrim", () => {
    const { ctx, ops } = recorder();
    drawMarks(ctx, [{ id: "a", label: "컵", u: 0.5, v: 0.5, off: false, angle: 0 }], 640, 480);
    expect(ops.filter((o) => o.startsWith("stroke"))).toEqual([]);
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
