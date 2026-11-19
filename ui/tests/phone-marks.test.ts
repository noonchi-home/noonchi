// 폰이 대시보드로 보내는 화면 프레임 위 표시(core/marks.js drawMarks)는 실제 폰 화면(draw.ts drawOverlay)과 같은 그림이다:
// 화면 안 대상은 아무것도 그리지 않고(고리·이름표 없음), 화면 밖 대상은 그쪽 방향 세모만(이름표 없음).
// (2026-11-19 사용자 「동그란 원 너무 거슬리는데」 「방향 표시는 너무 좋아」 「컵 위에 주방·식당 싱크대는 왜 표시되는 거야?」)
import { describe, expect, it } from "vitest";
import { twin } from "../../src/design/tokens.ts";
import { drawMarks } from "../src/phone/core/marks.js";
import { drawOverlay } from "../src/phone/draw";
import type { FocusMark } from "../src/phone/state";

const F = twin.phoneFocus;
type Op = { op: string; [k: string]: unknown };
function recorder() {
  const ops: Op[] = [];
  const ctx = {
    lineWidth: 0, strokeStyle: "", fillStyle: "", font: "", textAlign: "", lineJoin: "",
    save() {}, restore() {}, beginPath() { ops.push({ op: "begin" }); }, closePath() { ops.push({ op: "close" }); },
    clearRect() { ops.push({ op: "clear" }); },
    arc(x: number, y: number, r: number) { ops.push({ op: "arc", x, y, r }); },
    moveTo(x: number, y: number) { ops.push({ op: "move", x, y }); },
    lineTo(x: number, y: number) { ops.push({ op: "line", x, y }); },
    stroke() { ops.push({ op: "stroke", color: ctx.strokeStyle, width: ctx.lineWidth }); },
    fill() { ops.push({ op: "fill", color: ctx.fillStyle }); },
    fillRect(x: number, y: number, w: number, h: number) { ops.push({ op: "rect", x, y, w, h }); },
    fillText(text: string) { ops.push({ op: "text", text }); },
    measureText(t: string) { return { width: t.length * 10 }; },
  };
  return { ctx, ops };
}
const IN: FocusMark = { id: "sink_1", label: "주방·식당 싱크대", u: 0.5, v: 0.4, off: false, angle: 0 };
const OFF: FocusMark = { id: "sink_1", label: "주방·식당 싱크대", u: 0.02, v: 0.5, off: true, angle: 180 };

describe("폰 화면 프레임 표시(drawMarks)", () => {
  it("화면 안 대상: 아무것도 그리지 않는다(고리·이름표 없음)", () => {
    const { ctx, ops } = recorder();
    drawMarks(ctx, [IN], 780, 439);
    expect(ops).toEqual([]);
  });

  it("화면 밖 대상: 그쪽 세모(숯색·흰 테, offscreenArrow로 채움)만 그리고 이름표는 없다", () => {
    const { ctx, ops } = recorder();
    drawMarks(ctx, [OFF], 780, 439);
    expect(ops.filter((o) => o.op === "move")).toHaveLength(1);
    expect(ops.filter((o) => o.op === "line")).toHaveLength(2);
    expect(ops.filter((o) => o.op === "stroke").map((o) => o.color)).toEqual([F.edge.color, F.casing.color]);
    expect(ops.filter((o) => o.op === "fill").map((o) => o.color)).toEqual([F.offscreenArrow]);
    expect(ops.filter((o) => o.op === "text" || o.op === "rect" || o.op === "arc")).toEqual([]);
  });

  it("보내는 프레임과 실제 폰 화면은 같은 규칙·같은 모양이다: 같은 대상이면 그린 차례가 같다(실제 폰의 지우기만 다르다)", () => {
    for (const marks of [[IN], [OFF], [IN, OFF], [{ ...OFF, u: 0.98, angle: 0 }, { ...OFF, v: 0.02, angle: -90 }]]) {
      const frame = recorder();
      drawMarks(frame.ctx, marks, 780, 439);
      const screen = recorder();
      drawOverlay(screen.ctx as unknown as CanvasRenderingContext2D, { width: 780, height: 439 }, { aim: false, hit: false, hitEstimated: false, marks });
      expect(frame.ops, JSON.stringify(marks)).toEqual(screen.ops.filter((o) => o.op !== "clear"));
    }
  });
});
