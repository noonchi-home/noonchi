// 폰 AR 위 그림(draw.ts): 조준점·초점 고리·화면 밖 화살표·이름표의 색·크기·자리가 옮기기 전 phone.css와 같은지 본다.
// 조준점: 28px, 심 3px(못 맞춤 error-vivid·맞춤 ok-vivid), 안팎 흰 테 2px·숯색 1px, 맞으면 가운데 점(지름 10px).
// 초점 고리: 64px, 심 3px brand, 고리+이름표 묶음의 가운데가 그 점, 이름표는 4px 아래 scrim-phone 위 on-scrim 14px.
// 그리는 순서: 초점 표시 다음 조준점(조준점이 맨 위).
// 세로 화면의 화면 밖 화살표 묶음은 위 줄(말풍선·알림) 아래, 엄지 자리 위에 둔다(덮개 칸을 잰 값 overlayEdges).
import { describe, expect, it } from "vitest";
import { color, rgba, twin } from "../../src/design/tokens.ts";
import { drawOverlay, labelFont, overlayEdges, pulse } from "../src/phone/draw";

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
    roundRect(x: number, y: number, w: number, h: number, r: number) { ops.push({ op: "round", x, y, w, h, r }); },
    stroke() { ops.push({ op: "stroke", color: ctx.strokeStyle, width: ctx.lineWidth }); },
    fill() { ops.push({ op: "fill", color: ctx.fillStyle }); },
    fillText(text: string, x: number, y: number) { ops.push({ op: "text", text, x, y, color: ctx.fillStyle, font: ctx.font }); },
    measureText(t: string) { return { width: t.length * 10 }; },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}
const SIZE = { width: 390, height: 844 };
const of = (ops: Op[], op: string) => ops.filter((o) => o.op === op);
/** 표시 하나를 그리고 이름표 판 자리를 돌려준다. */
function drawOverlayLabel(m: { id: string; label: string; u: number; v: number; off: boolean; angle: number }) {
  const { ctx, ops } = recorder();
  drawOverlay(ctx, SIZE, { hit: false, marks: [m] }, 0, true);
  return of(ops, "round")[0];
}

describe("토큰", () => {
  it("이름표는 scrim-phone 위 on-scrim, 화면 밖 화살표는 brand, 글꼴은 묶은 Noto Sans KR 14px", () => {
    expect(F.labelBg).toBe(rgba["scrim-phone"]);
    expect(F.offscreenArrow).toBe(color.brand);
    expect(labelFont).toMatch(/^400 14px "Noto Sans KR Variable"/);
  });
});

describe("조준점", () => {
  it("못 맞춤: 화면 가운데 error-vivid 빈 고리(심 3px), 안팎 흰 테 2px·숯색 1px", () => {
    const { ctx, ops } = recorder();
    drawOverlay(ctx, SIZE, { hit: false, marks: [] }, 0, true);
    expect(ops[0]).toEqual({ op: "clear", w: 390, h: 844 });
    expect(of(ops, "arc").every((a) => a.x === 195 && a.y === 422)).toBe(true);
    expect(of(ops, "arc").map((a) => a.r)).toEqual([16.5, 8.5, 15, 10, 12.5]);
    expect(of(ops, "stroke").map((s) => [s.color, s.width])).toEqual([[F.edge.color, 1], [F.edge.color, 1], [F.casing.color, 2], [F.casing.color, 2], [F.aim.miss, 3]]);
    expect(of(ops, "fill")).toEqual([]);
  });

  it("맞춤: ok-vivid 고리에 가운데 점(지름 10px)을 흰 테·숯색 1px씩 두른다", () => {
    const { ctx, ops } = recorder();
    drawOverlay(ctx, SIZE, { hit: true, marks: [] }, 0, true);
    expect(of(ops, "stroke").at(-1)).toEqual({ op: "stroke", color: F.aim.hit, width: 3 });
    expect(of(ops, "arc").slice(5).map((a) => a.r)).toEqual([7, 6, 5]);
    expect(of(ops, "fill").map((f) => f.color)).toEqual([F.edge.color, F.casing.color, F.aim.hit]);
  });
});

describe("초점 표시", () => {
  const cup = { id: "cup", label: "컵", u: 0.5, v: 0.5, off: false, angle: 0 };

  it("화면 안: brand 고리(64px, 심 3px)와 4px 아래 이름표 「클로이드 주목 · 컵」. 묶음의 가운데가 그 점이라 고리 가운데는 14px 위", () => {
    const { ctx, ops } = recorder();
    drawOverlay(ctx, SIZE, { hit: false, marks: [cup] }, 0, true);
    const ring = of(ops, "arc").slice(0, 5);
    expect(ring.map((a) => a.r)).toEqual([34.5, 26.5, 33, 28, 30.5]);
    expect(ring.every((a) => a.x === 195 && a.y === 408)).toBe(true);
    expect(of(ops, "stroke")[4]).toEqual({ op: "stroke", color: F.ring.color, width: 3 });
    const w = "클로이드 주목 · 컵".length * 10 + 16; // 글 너비(시험 measureText) + 좌우 8px
    expect(of(ops, "round")).toEqual([{ op: "round", x: 195 - w / 2, y: 444, w, h: 24, r: 8 }]);
    expect(of(ops, "fill").map((f) => f.color)).toEqual([F.labelBg]);
    expect(of(ops, "text")).toEqual([{ op: "text", text: "클로이드 주목 · 컵", x: 195, y: 456, color: F.labelText, font: labelFont }]);
  });

  it("고리는 1.2초마다 1.12배로 숨쉰다. 움직임 줄이기면 멈춘다", () => {
    expect(pulse(0, false)).toBe(1);
    expect(pulse(600, false)).toBeCloseTo(1.12);
    expect(pulse(1200, false)).toBeCloseTo(1);
    expect(pulse(600, true)).toBe(1);
    const { ctx, ops } = recorder();
    drawOverlay(ctx, SIZE, { hit: false, marks: [cup] }, 600, false);
    expect(of(ops, "arc")[4]!.r).toBeCloseTo(30.5 * 1.12);
  });

  it("화면 밖: 그쪽을 가리키는 세모(22×28px)를 숯색·흰 테로 두르고 brand로 채운다", () => {
    const { ctx, ops } = recorder();
    const x = 0.9 * 390;
    drawOverlay(ctx, SIZE, { hit: false, marks: [{ id: "tv", label: "TV", u: 0.9, v: 0.5, off: true, angle: 0 }] }, 0, true);
    expect(of(ops, "move")).toEqual([{ op: "move", x: x - 18, y: 394 }]);
    expect(of(ops, "line")).toEqual([{ op: "line", x: x + 4, y: 408 }, { op: "line", x: x - 18, y: 422 }]);
    expect(of(ops, "stroke").slice(0, 2).map((s) => [s.color, s.width])).toEqual([[F.edge.color, 6], [F.casing.color, 4]]);
    expect(of(ops, "fill").map((f) => f.color)).toEqual([F.offscreenArrow, F.labelBg]);
  });

  it("이름표는 화면 가장자리 8px 안에 머문다(세모는 그 점에 둔다)", () => {
    const { ctx, ops } = recorder();
    drawOverlay(ctx, SIZE, { hit: false, marks: [{ id: "fridge", label: "냉장고", u: 0.92, v: 0.6, off: true, angle: 15 }] }, 0, true);
    const w = "클로이드 주목 · 냉장고".length * 10 + 16;
    const [label] = of(ops, "round");
    expect(label).toMatchObject({ x: 390 - 8 - w, w });
    expect(of(ops, "text")[0]).toMatchObject({ x: 390 - 8 - w / 2 });
    const left = drawOverlayLabel({ id: "a", label: "냉장고", u: 0.02, v: 0.5, off: true, angle: 180 });
    expect(left).toMatchObject({ x: 8 });
  });
});

describe("세로 화면(390×844)의 화면 밖 화살표·이름표", () => {
  function draw(m: { u: number; v: number; angle: number }, edges?: { top: number; bottom: number }) {
    const { ctx, ops } = recorder();
    const drawn = drawOverlay(ctx, SIZE, { hit: false, marks: [{ id: "x", label: "TV", off: true, ...m }] }, 0, true, edges);
    return { arrow: of(ops, "move")[0]!, label: of(ops, "round")[0]!, drawn };
  }

  it("엄지 자리가 없으면 아래쪽 화살표 묶음은 큰 단추 줄(아래 88px) 위에 둔다", () => {
    const { label } = draw({ u: 0.5, v: 0.97, angle: 90 });
    expect(label.y + label.h).toBe(844 - 88);
    expect(label.y).toBe(844 - 88 - 24);
  });

  it("위 줄이 비면 위쪽 화살표 묶음은 위 상태 줄(64px) 아래, 오른쪽 화살표 이름표는 화면 가장자리 8px 안", () => {
    expect(draw({ u: 0.5, v: 0.03, angle: -90 }).label.y).toBe(64 + 28 + 4);
    const right = draw({ u: 0.98, v: 0.5, angle: 0 });
    expect(right.label.x + right.label.w).toBeLessThanOrEqual(390 - 8);
  });

  it("위 줄(말풍선·알림·사진 요청)이 있으면 위쪽 화살표 묶음은 그 아래 8px부터 둔다(말풍선 글을 가리지 않는다)", () => {
    // 말풍선 한 줄: 위 줄이 64~128px
    const { arrow, label } = draw({ u: 0.5, v: 0.03, angle: -90 }, { top: 128, bottom: 0 });
    expect(label.y).toBe(128 + 8 + 28 + 4);
    expect(arrow.y).toBeCloseTo(128 + 8 + 14 + 18, 5);
  });

  it("엄지 자리(승인·부탁·기준점)가 있으면 아래쪽 화살표 묶음은 그 위 8px까지 둔다(엄지 자리에 깔리지 않는다)", () => {
    // 엄지 자리 위 끝이 564px: 아래에서 280px
    const { label } = draw({ u: 0.5, v: 0.97, angle: 90 }, { top: 0, bottom: 280 });
    expect(label.y + label.h).toBe(844 - 280 - 8);
    // 옆을 가리키는 화살표도 엄지 자리 위로 올린다
    const right = draw({ u: 0.92, v: 0.9, angle: 10 }, { top: 0, bottom: 280 });
    expect(right.label.y + right.label.h).toBe(844 - 280 - 8);
  });

  it("그린 화면 밖 화살표 묶음(세모+이름표)의 자리를 돌려준다. 화면 안 고리는 넣지 않는다", () => {
    const { label, drawn } = draw({ u: 0.5, v: 0.03, angle: -90 }, { top: 128, bottom: 0 });
    expect(drawn).toHaveLength(1);
    const [group] = drawn;
    expect(group!.name).toBe("TV");
    expect(group!.box.top).toBeGreaterThanOrEqual(128 + 8 - 3);
    expect(group!.box.bottom).toBe(label.y + label.h);
    expect(group!.box.left).toBeLessThanOrEqual(label.x);
    expect(group!.box.right).toBeGreaterThanOrEqual(label.x + label.w);
    const { ctx } = recorder();
    expect(drawOverlay(ctx, SIZE, { hit: false, marks: [{ id: "cup", label: "컵", u: 0.5, v: 0.3, off: false, angle: 0 }] }, 0, true)).toEqual([]);
  });
});

describe("덮개 칸 재기(overlayEdges)", () => {
  const zone = (bottom: number, top: number) => ({ getBoundingClientRect: () => ({ top, bottom, height: bottom - top }) });
  const root = (zones: Record<string, ReturnType<typeof zone> | null>) =>
    ({ querySelector: (sel: string) => zones[/data-phone-zone=(\w+)/.exec(sel)![1]!] ?? null }) as unknown as ParentNode;

  it("위 줄 아래 끝 y와, 화면 높이에서 엄지 자리 위 끝 y를 뺀 값", () => {
    expect(overlayEdges(root({ top: zone(128, 64), thumb: zone(748, 564) }), 844)).toEqual({ top: 128, bottom: 280 });
  });

  it("빈 칸(높이 0)이나 없는 칸은 0", () => {
    expect(overlayEdges(root({ top: zone(64, 64), thumb: null }), 844)).toEqual({ top: 0, bottom: 0 });
    expect(overlayEdges(null, 844)).toEqual({ top: 0, bottom: 0 });
  });
});

describe("가로 화면(844×390)의 화면 밖 화살표·이름표", () => {
  const LAND = { width: 844, height: 390 };
  const group = 28 + 4 + 24; // 세모 + 사이 + 이름표
  function draw(m: { u: number; v: number; angle: number; off?: boolean }) {
    const { ctx, ops } = recorder();
    drawOverlay(ctx, LAND, { hit: false, marks: [{ id: "x", label: "TV", off: true, ...m }] }, 0, true);
    return { arrow: of(ops, "move")[0]!, label: of(ops, "round")[0]! };
  }

  it("위쪽 화살표 묶음은 위 상태 줄(64px) 아래에 둔다. 위 줄·엄지 자리는 조준점 옆 칸이라 재지 않는다", () => {
    const { arrow, label } = draw({ u: 0.5, v: 0.08, angle: -90 });
    const { ctx, ops } = recorder();
    drawOverlay(ctx, LAND, { hit: false, marks: [{ id: "x", label: "TV", off: true, u: 0.5, v: 0.08, angle: -90 }] }, 0, true, { top: 200, bottom: 200 });
    expect(of(ops, "round")[0]!.y).toBe(label.y);
    // 위를 가리키는 세모의 첫 꼭짓점: 세모 가운데(64 + 14)에서 18px 아래
    expect(arrow.y).toBeCloseTo(64 + 14 + 18, 5);
    expect(label.y).toBe(64 + 28 + 4);
    expect(label.y + label.h).toBe(64 + group);
  });

  it("오른쪽 화살표 묶음은 큰 단추 줄(오른쪽 96px) 왼쪽에 두고, 이름표도 그 안에 민다", () => {
    const { arrow, label } = draw({ u: 0.92, v: 0.5, angle: 0 });
    expect(arrow.x).toBe(844 - 96 - 18 - 18);
    expect(label.x + label.w).toBeLessThanOrEqual(844 - 96);
  });

  it("아래쪽·왼쪽 화살표는 화면 가장자리 8px 안", () => {
    const down = draw({ u: 0.5, v: 0.92, angle: 90 });
    expect(down.label.y + down.label.h).toBeLessThanOrEqual(390 - 8);
    const left = draw({ u: 0.08, v: 0.5, angle: 180 });
    expect(left.label.x).toBeGreaterThanOrEqual(8);
  });

  it("화면 안 고리는 물건 자리 그대로 두고, 이름표만 화면 아래 8px 안으로 올린다", () => {
    const { ctx, ops } = recorder();
    drawOverlay(ctx, LAND, { hit: false, marks: [{ id: "cup", label: "컵", u: 0.3, v: 0.97, off: false, angle: 0 }] }, 0, true);
    const ring = of(ops, "arc").slice(0, 5);
    expect(ring.every((a) => a.x === 0.3 * 844 && a.y === 0.97 * 390 - (64 + 4 + 24) / 2 + 32)).toBe(true);
    const label = of(ops, "round")[0]!;
    expect(label.y + label.h).toBe(390 - 8);
  });

  it("조준점은 초점 고리·이름표 위에 그린다. 이름표가 조준점 자리에 와도 조준점이 보인다", () => {
    const { ctx, ops } = recorder();
    drawOverlay(ctx, LAND, { hit: false, marks: [{ id: "cup", label: "컵", u: 0.5, v: 0.42, off: false, angle: 0 }] }, 0, true);
    // 이름표(y 185.8~209.8)가 조준점 상자(195 ± 14)와 겹치는 자리
    const label = of(ops, "round")[0]!;
    expect(label.y).toBeLessThan(195 + 14);
    expect(label.y + label.h).toBeGreaterThan(195 - 14);
    const arcs = of(ops, "arc");
    expect(arcs.slice(-5).every((a) => a.x === 422 && a.y === 195)).toBe(true);
    expect(arcs.slice(-5).map((a) => a.r)).toEqual([16.5, 8.5, 15, 10, 12.5]);
    expect(ops.map((o) => o.op).lastIndexOf("text")).toBeLessThan(ops.indexOf(arcs.at(-5)!));
    expect(of(ops, "stroke").at(-1)).toEqual({ op: "stroke", color: F.aim.miss, width: 3 });
  });
});
