// 실제 폰 AR 위 그림(draw.ts): 조준점은 기준점 찍기·물건 자리 맞추기 때만(aim), 명령 대상에는 작은 고리(40px, 이름표 없음), 화면 밖이면 가장자리 화살표 하나(이름표 없음).
// 조준점: 28px, 심 3px(못 맞춤 aim.miss·맞춤 aim.hit), 안팎 흰 테 2px·숯색 1px, 맞으면 가운데 점(지름 10px). 조준점은 맨 위에 그린다.
// 화면 밖 화살표는 그릴 때 잰 위 줄(미어캣·명령) 아래 8px부터 엄지 자리 위 8px까지, 옆은 화면 가장자리 8px 안에 둔다(가로·세로 같다).
import { describe, expect, it } from "vitest";
import { color, twin } from "../../src/design/tokens.ts";
import { drawOverlay, overlayEdges, pulse } from "../src/phone/draw";

const F = twin.phoneFocus;
type Op = { op: string; [k: string]: any };
function recorder() {
  const ops: Op[] = [];
  // ctx를 읽는 칸은 블록 몸 메서드로 둔다(자기 자신을 읽는 화살표 함수는 타입 추론이 돌고 돈다)
  const ctx = {
    lineWidth: 0, strokeStyle: "", fillStyle: "", font: "", textAlign: "", textBaseline: "", lineJoin: "",
    clearRect(_x: number, _y: number, w: number, h: number) { ops.push({ op: "clear", w, h }); },
    beginPath() {},
    closePath() {},
    arc(x: number, y: number, r: number) { ops.push({ op: "arc", x, y, r }); },
    moveTo(x: number, y: number) { ops.push({ op: "move", x, y }); },
    lineTo(x: number, y: number) { ops.push({ op: "line", x, y }); },
    roundRect(x: number, y: number, w: number, h: number) { ops.push({ op: "round", x, y, w, h }); },
    stroke() { ops.push({ op: "stroke", color: ctx.strokeStyle, width: ctx.lineWidth }); },
    fill() { ops.push({ op: "fill", color: ctx.fillStyle }); },
    fillText(text: string) { ops.push({ op: "text", text }); },
    measureText(t: string) { return { width: t.length * 10 }; },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}
const SIZE = { width: 390, height: 844 };
const LAND = { width: 844, height: 390 };
const of = (ops: Op[], op: string) => ops.filter((o) => o.op === op);
const scene = (over: Partial<{ aim: boolean; hit: boolean; marks: { id: string; label: string; u: number; v: number; off: boolean; angle: number }[] }> = {}) => ({ aim: false, hit: false, marks: [], ...over });

describe("조준점(찍기·맞추기 때만)", () => {
  it("평소(aim false)에는 지우기만 하고 아무것도 그리지 않는다", () => {
    const { ctx, ops } = recorder();
    drawOverlay(ctx, SIZE, scene({ hit: true }), 0, true);
    expect(ops).toEqual([{ op: "clear", w: 390, h: 844 }]);
  });

  it("못 맞춤: 화면 가운데 aim.miss 빈 고리(심 3px), 안팎 흰 테 2px·숯색 1px", () => {
    const { ctx, ops } = recorder();
    drawOverlay(ctx, SIZE, scene({ aim: true }), 0, true);
    expect(of(ops, "arc").every((a) => a.x === 195 && a.y === 422)).toBe(true);
    expect(of(ops, "arc").map((a) => a.r)).toEqual([16.5, 8.5, 15, 10, 12.5]);
    expect(of(ops, "stroke").map((s) => [s.color, s.width])).toEqual([[F.edge.color, 1], [F.edge.color, 1], [F.casing.color, 2], [F.casing.color, 2], [F.aim.miss, 3]]);
    expect(of(ops, "fill")).toEqual([]);
  });

  it("맞춤: aim.hit 고리에 가운데 점(지름 10px)을 흰 테·숯색 1px씩 두른다", () => {
    const { ctx, ops } = recorder();
    drawOverlay(ctx, SIZE, scene({ aim: true, hit: true }), 0, true);
    expect(of(ops, "stroke").at(-1)).toEqual({ op: "stroke", color: F.aim.hit, width: 3 });
    expect(of(ops, "arc").slice(5).map((a) => a.r)).toEqual([7, 6, 5]);
    expect(of(ops, "fill").map((f) => f.color)).toEqual([F.edge.color, F.casing.color, F.aim.hit]);
  });

  it("조준점은 고리 위에 그린다", () => {
    const { ctx, ops } = recorder();
    drawOverlay(ctx, SIZE, scene({ aim: true, marks: [{ id: "cup", label: "컵", u: 0.5, v: 0.5, off: false, angle: 0 }] }), 0, true);
    const arcs = of(ops, "arc");
    expect(arcs.slice(-5).map((a) => a.r)).toEqual([16.5, 8.5, 15, 10, 12.5]);
    expect(arcs.slice(0, 5).map((a) => a.r)).toEqual([22.5, 14.5, 21, 16, 18.5]);
  });
});

describe("명령 대상 고리", () => {
  const cup = { id: "cup", label: "컵", u: 0.6, v: 0.55, off: false, angle: 0 };

  it("화면 안: 그 자리에 brand 고리 40px(심 3px), 이름표는 없다", () => {
    const { ctx, ops } = recorder();
    drawOverlay(ctx, SIZE, scene({ marks: [cup] }), 0, true);
    const ring = of(ops, "arc");
    expect(ring.map((a) => a.r)).toEqual([22.5, 14.5, 21, 16, 18.5]);
    expect(ring.every((a) => a.x === 0.6 * 390 && a.y === 0.55 * 844)).toBe(true);
    expect(of(ops, "stroke")[4]).toEqual({ op: "stroke", color: F.ring.color, width: 3 });
    expect([of(ops, "text"), of(ops, "round"), of(ops, "fill")]).toEqual([[], [], []]);
  });

  it("고리는 1.2초마다 1.12배로 숨쉰다. 움직임 줄이기면 멈춘다", () => {
    expect(pulse(0, false)).toBe(1);
    expect(pulse(600, false)).toBeCloseTo(1.12);
    expect(pulse(1200, false)).toBeCloseTo(1);
    expect(pulse(600, true)).toBe(1);
    const { ctx, ops } = recorder();
    drawOverlay(ctx, SIZE, scene({ marks: [cup] }), 600, false);
    expect(of(ops, "arc")[4]!.r).toBeCloseTo(18.5 * 1.12);
  });

  it("화면 밖: 그쪽을 가리키는 세모(22×28px)를 숯색·흰 테로 두르고 brand로 채운다. 이름표는 없다", () => {
    const { ctx, ops } = recorder();
    const x = 0.9 * 390;
    drawOverlay(ctx, SIZE, scene({ marks: [{ id: "tv", label: "TV", u: 0.9, v: 0.5, off: true, angle: 0 }] }), 0, true);
    expect(of(ops, "move")).toEqual([{ op: "move", x: x - 18, y: 408 }]);
    expect(of(ops, "line")).toEqual([{ op: "line", x: x + 4, y: 422 }, { op: "line", x: x - 18, y: 436 }]);
    expect(of(ops, "stroke").map((s) => [s.color, s.width])).toEqual([[F.edge.color, 6], [F.casing.color, 4]]);
    expect(of(ops, "fill").map((f) => f.color)).toEqual([color.brand]);
    expect(of(ops, "text")).toEqual([]);
  });
});

describe("화면 밖 화살표 자리", () => {
  function draw(size: { width: number; height: number }, m: { u: number; v: number; angle: number }, edges?: { top: number; bottom: number }) {
    const { ctx, ops } = recorder();
    const drawn = drawOverlay(ctx, size, scene({ marks: [{ id: "x", label: "TV", off: true, ...m }] }), 0, true, edges);
    const pts = [...of(ops, "move"), ...of(ops, "line")];
    return { top: Math.min(...pts.map((p) => p.y)), bottom: Math.max(...pts.map((p) => p.y)), left: Math.min(...pts.map((p) => p.x)), right: Math.max(...pts.map((p) => p.x)), drawn };
  }

  it("세로: 위쪽 화살표는 위 줄(미어캣·명령) 아래 8px부터, 아래쪽 화살표는 엄지 자리 위 8px까지", () => {
    expect(draw(SIZE, { u: 0.5, v: 0.03, angle: -90 }, { top: 72, bottom: 0 }).top).toBeGreaterThanOrEqual(72 + 8);
    expect(draw(SIZE, { u: 0.5, v: 0.97, angle: 90 }, { top: 72, bottom: 130 }).bottom).toBeLessThanOrEqual(844 - 130 - 8);
  });

  it("칸이 없으면 화면 가장자리 8px 안. 옆도 8px 안", () => {
    expect(draw(SIZE, { u: 0.5, v: 0.97, angle: 90 }).bottom).toBeLessThanOrEqual(844 - 8);
    expect(draw(SIZE, { u: 0.99, v: 0.5, angle: 0 }).right).toBeLessThanOrEqual(390 - 8);
    expect(draw(SIZE, { u: 0.01, v: 0.5, angle: 180 }).left).toBeGreaterThanOrEqual(8);
  });

  it("가로도 같은 규칙(잰 칸을 비킨다)", () => {
    expect(draw(LAND, { u: 0.5, v: 0.05, angle: -90 }, { top: 64, bottom: 0 }).top).toBeGreaterThanOrEqual(64 + 8);
    expect(draw(LAND, { u: 0.9, v: 0.95, angle: 45 }, { top: 64, bottom: 120 }).bottom).toBeLessThanOrEqual(390 - 120 - 8);
  });

  it("그린 화면 밖 화살표의 자리(세모와 테두리)를 돌려준다. 화면 안 고리는 넣지 않는다", () => {
    const { top, bottom, left, right, drawn } = draw(SIZE, { u: 0.5, v: 0.03, angle: -90 }, { top: 72, bottom: 0 });
    expect(drawn).toHaveLength(1);
    const box = drawn[0]!.box;
    expect(drawn[0]!.name).toBe("TV");
    expect(box.top).toBeLessThanOrEqual(top);
    expect(box.bottom).toBeGreaterThanOrEqual(bottom);
    expect(box.left).toBeLessThanOrEqual(left);
    expect(box.right).toBeGreaterThanOrEqual(right);
    const { ctx } = recorder();
    expect(drawOverlay(ctx, SIZE, scene({ marks: [{ id: "cup", label: "컵", u: 0.5, v: 0.3, off: false, angle: 0 }] }), 0, true)).toEqual([]);
  });
});

describe("덮개 칸 재기(overlayEdges)", () => {
  const zone = (bottom: number, top: number) => ({ getBoundingClientRect: () => ({ top, bottom, height: bottom - top }) });
  const root = (zones: Record<string, ReturnType<typeof zone> | null>) =>
    ({ querySelector: (sel: string) => zones[/data-phone-zone=(\w+)/.exec(sel)![1]!] ?? null }) as unknown as ParentNode;

  it("위 줄 아래 끝 y와, 화면 높이에서 엄지 자리 위 끝 y를 뺀 값", () => {
    expect(overlayEdges(root({ top: zone(72, 0), thumb: zone(828, 714) }), 844)).toEqual({ top: 72, bottom: 130 });
  });

  it("빈 칸(높이 0)이나 없는 칸은 0", () => {
    expect(overlayEdges(root({ top: zone(64, 64), thumb: null }), 844)).toEqual({ top: 0, bottom: 0 });
    expect(overlayEdges(null, 844)).toEqual({ top: 0, bottom: 0 });
  });
});
