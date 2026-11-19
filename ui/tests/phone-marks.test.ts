// 폰이 대시보드로 보내는 화면 프레임 위 표시(core/marks.js drawMarks): 화면 안 대상에는 초점 고리를 그리지 않는다(2026-11-19 사용자 「동그란 원 너무 거슬리는데」 「완전히 제거해 줘」).
// 화면 밖 대상의 방향 세모와 이름표는 그대로다(「방향 표시는 너무 좋아」).
import { describe, expect, it } from "vitest";
import { twin } from "../../src/design/tokens.ts";
import { drawMarks } from "../src/phone/core/marks.js";

const F = twin.phoneFocus;
type Op = { op: string; [k: string]: unknown };
function recorder() {
  const ops: Op[] = [];
  const ctx = {
    lineWidth: 0, strokeStyle: "", fillStyle: "", font: "", textAlign: "",
    save() {}, restore() {}, beginPath() {}, closePath() {},
    arc(x: number, y: number, r: number) { ops.push({ op: "arc", x, y, r }); },
    moveTo(x: number, y: number) { ops.push({ op: "move", x, y }); },
    lineTo(x: number, y: number) { ops.push({ op: "line", x, y }); },
    stroke() { ops.push({ op: "stroke", color: ctx.strokeStyle }); },
    fill() { ops.push({ op: "fill", color: ctx.fillStyle }); },
    fillRect(x: number, y: number, w: number, h: number) { ops.push({ op: "rect", x, y, w, h }); },
    fillText(text: string) { ops.push({ op: "text", text }); },
    measureText(t: string) { return { width: t.length * 10 }; },
  };
  return { ctx, ops };
}

describe("폰 화면 프레임 표시(drawMarks)", () => {
  it("화면 안 대상: 초점 고리(arc)를 그리지 않는다", () => {
    const { ctx, ops } = recorder();
    drawMarks(ctx, [{ id: "sink_1", label: "주방·식당 싱크대", u: 0.5, v: 0.4, off: false, angle: 0 }], 1280, 720);
    expect(ops.filter((o) => o.op === "arc")).toEqual([]);
    expect(ops.filter((o) => o.op === "stroke")).toEqual([]);
  });

  it("화면 밖 대상: 그쪽 세모(숯색·흰 테, offscreenArrow로 채움)와 이름표는 그대로다", () => {
    const { ctx, ops } = recorder();
    drawMarks(ctx, [{ id: "sink_1", label: "주방·식당 싱크대", u: 0.05, v: 0.5, off: true, angle: 180 }], 1280, 720);
    expect(ops.filter((o) => o.op === "arc")).toEqual([]);
    expect(ops.filter((o) => o.op === "move")).toHaveLength(1);
    expect(ops.filter((o) => o.op === "line")).toHaveLength(2);
    expect(ops.filter((o) => o.op === "stroke").map((o) => o.color)).toEqual([F.edge.color, F.casing.color]);
    expect(ops.filter((o) => o.op === "fill").map((o) => o.color)).toEqual([F.offscreenArrow]);
    expect(ops.filter((o) => o.op === "text").map((o) => o.text)).toEqual(["주방·식당 싱크대"]);
  });
});
