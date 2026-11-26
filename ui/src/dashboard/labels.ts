// 트윈 위 방 이름표 자리(순수 함수, 시안 A 그대로). 방 가운데에 두되, 말풍선·목적지·클로이드와 겹치면 둘레 자리로 옮기고, 둘 곳이 없으면 뺀다.
type Pt = { x: number; y: number };
export type Box = { x0: number; y0: number; x1: number; y1: number };

/** 이름표 하나의 크기(px, 대략: Status 원래 글 text-xs 한 줄은 높이 26). */
export const LABEL = { w: 96, h: 28 };
/** 큰 말풍선이 꼬리 끝 위로 차지하는 자리(px, 대략). */
const BUBBLE = { w: 176, h: 70 };
/** 클로이드·목적지 표시 둘레(px). */
const DOT = 36;
/** 가운데가 막혔을 때 차례로 볼 둘레 자리(px). */
const OFFSETS: Pt[] = [{ x: 0, y: 0 }, { x: 0, y: 64 }, { x: 0, y: -64 }, { x: -130, y: 0 }, { x: 130, y: 0 }, { x: 0, y: 112 }, { x: -130, y: 64 }, { x: 130, y: 64 }];

const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const labelBox = (p: Pt): Box => ({ x0: p.x - LABEL.w / 2, y0: p.y - LABEL.h / 2, x1: p.x + LABEL.w / 2, y1: p.y + LABEL.h / 2 });

/** 피할 자리: 말풍선은 꼬리 끝 위 사각형, 점(클로이드·목적지)은 둘레 사각형. */
export function avoidBoxes(bubbles: Pt[], dots: Pt[]): Box[] {
  return [
    ...bubbles.map((b) => ({ x0: b.x - BUBBLE.w / 2, y0: b.y - BUBBLE.h, x1: b.x + BUBBLE.w / 2, y1: b.y + 6 })),
    ...dots.map((d) => ({ x0: d.x - DOT, y0: d.y - DOT, x1: d.x + DOT, y1: d.y + DOT })),
  ];
}

/** 이름표(21st.dev Status, 글 12px 한 줄) 대략 크기: 글자마다 한글 12px·그 밖 7px, 좌우 여백 24px, 높이 26px. */
export const tagSize = (text: string) => ({ w: 24 + [...text].reduce((w, c) => w + (c.charCodeAt(0) > 0x2fff ? 12 : 7), 0), h: 26 });

/**
 * 트윈 위 이름표 자리(가운데 px): 점(p) 바로 위에 두되, 칸 가장자리에 닿으면 칸 안으로 옮기고(글을 자르지 않는다),
 * 앞서 둔 이름표·가린 자리와 겹치면 아래·위로 비킨다. 둔 자리는 taken에 더한다.
 */
export function placeTag(p: Pt, text: string, taken: Box[], size: { width: number; height: number }): Pt {
  const { w, h } = tagSize(text);
  const inside = (q: Pt): Pt => ({
    x: Math.min(Math.max(q.x, w / 2 + 4), Math.max(w / 2 + 4, size.width - w / 2 - 4)),
    y: Math.min(Math.max(q.y, h / 2 + 4), Math.max(h / 2 + 4, size.height - h / 2 - 4)),
  });
  const box = (q: Pt): Box => ({ x0: q.x - w / 2, y0: q.y - h / 2, x1: q.x + w / 2, y1: q.y + h / 2 });
  const first = inside({ x: p.x, y: p.y - 24 });
  const tries = [0, h + 6, -(h + 6), 2 * (h + 6), -2 * (h + 6)].map((dy) => inside({ x: first.x, y: first.y + dy }));
  const at = tries.find((q) => !taken.some((a) => hit(a, box(q)))) ?? first;
  taken.push(box(at));
  return at;
}

/** 방 가운데(center)에서 가장 가까운 빈 자리. 상자(size) 밖이거나 다 막혔으면 null. 앞서 둔 이름표도 피한다. */
export function placeLabel(center: Pt, avoid: Box[], size: { width: number; height: number }): Pt | null {
  for (const o of OFFSETS) {
    const p = { x: center.x + o.x, y: center.y + o.y };
    const b = labelBox(p);
    if (b.x0 < 0 || b.y0 < 0 || b.x1 > size.width || b.y1 > size.height) continue;
    if (avoid.some((a) => hit(a, b))) continue;
    avoid.push(b);
    return p;
  }
  return null;
}
