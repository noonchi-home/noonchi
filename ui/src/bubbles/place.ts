// 트윈 위 말풍선 자리 고르기(순수 함수). 말풍선끼리, 패널과 겹치지 않고 트윈이 보이는 곳 안에 둔다.
// 꼬리 끝은 늘 기기 자리에 있다: 판만 기기 위·아래(side), 가운데·왼쪽·오른쪽(align)으로 옮긴다.

export type Rect = { left: number; top: number; right: number; bottom: number };
export type Box = { w: number; h: number };
export type Placement = { side: "top" | "bottom"; align: "center" | "start" | "end" };

export const DEFAULT_PLACEMENT: Placement = { side: "top", align: "center" };
/** align start·end일 때 판 끝에서 꼬리까지(px, 판 모서리 둥근 곳을 비킨다). Tooltip alignOffset은 이 값의 음수. */
export const ALIGN_EDGE = 24;
/** 꼬리(Tooltip 화살표) 높이와 말풍선 사이 틈(px). */
const ARROW = 6;
const GAP = 6;

const SIDES = ["top", "bottom"] as const;
const ALIGNS = ["center", "end", "start"] as const;

/** 기기 자리(x, y)에 꼬리 끝을 둔 말풍선 판의 자리. scale은 방금 다룬 기기(scale-125). */
export function bubbleRect(x: number, y: number, box: Box, scale: number, p: Placement): Rect {
  const w = box.w * scale;
  const h = (box.h + ARROW) * scale;
  const e = ALIGN_EDGE * scale;
  const left = p.align === "center" ? x - w / 2 : p.align === "start" ? x - e : x + e - w;
  const top = p.side === "top" ? y - h : y;
  return { left, top, right: left + w, bottom: top + h };
}

const area = (r: Rect) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
const meet = (a: Rect, b: Rect): Rect => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
const grow = (r: Rect, d: number): Rect => ({ left: r.left - d, top: r.top - d, right: r.right + d, bottom: r.bottom + d });

/** 겹친 넓이 + 보이는 곳 밖 넓이. 0이면 그 자리에 둘 수 있다. */
function cost(r: Rect, bounds: Rect, taken: Rect[]): number {
  return taken.reduce((s, t) => s + area(meet(grow(r, GAP / 2), grow(t, GAP / 2))), 0) + (area(r) - area(meet(r, bounds)));
}

/**
 * items는 자리를 먼저 잡을 차례(방금 다룬 기기 → 경고 → 나머지). 위 가운데 → 위 오른쪽 끝 → 위 왼쪽 끝 → 아래 … 순서로 보고
 * 겹치지 않는 첫 자리를 고른다. 없으면 가장 덜 겹치는 자리. 크기(box)를 아직 모르는 말풍선은 기본 자리.
 */
export function placeBubbles(
  items: { id: string; x: number; y: number; scale: number; box?: Box }[],
  bounds: Rect,
  avoid: Rect[],
): Map<string, Placement> {
  const out = new Map<string, Placement>();
  const taken = [...avoid];
  for (const it of items) {
    if (!it.box) { out.set(it.id, DEFAULT_PLACEMENT); continue; }
    let best: { p: Placement; r: Rect; c: number } | null = null;
    search: for (const side of SIDES) for (const align of ALIGNS) {
      const p = { side, align };
      const r = bubbleRect(it.x, it.y, it.box, it.scale, p);
      const c = cost(r, bounds, taken);
      if (!best || c < best.c) best = { p, r, c };
      if (c === 0) break search;
    }
    out.set(it.id, best!.p);
    taken.push(best!.r);
  }
  return out;
}
