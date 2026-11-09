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
