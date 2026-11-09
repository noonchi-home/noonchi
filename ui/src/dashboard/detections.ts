// 대시보드 폰 칸 YOLO 상자 자리(순수 함수). 폰 영상은 영상 칸에 다 보이게(contain) 깔고, 상자도 같은 배율·자리로 옮긴다.
// 칸 가장자리에 닿은 쪽은 칸 가장자리 안쪽에서 자른다. 칸 위쪽에 떠 있는 FSM·행동 카드 밑에는 상자도 이름표도 그리지 않는다.
// 이름표는 상자 위, 아래, 오른쪽 옆, 왼쪽 옆 차례로 칸 안에 들고 다른 이름표·다른 상자와 겹치지 않는 첫 자리에 둔다.
// 제 상자가 든 큰 상자(식탁 위 컵)는 피하지 않는다. 작은 상자부터 고른다: 큰 상자 곁·안의 작은 상자는 고를 자리가 적다.
// 오른쪽 끝에 걸리면 칸 안으로 당긴다.
import { fitBox, toBox, type BoxSize } from "./fit";

/** YOLO가 찾은 물건 하나: 화면 이름, 신뢰도(0~1), 상자(그림 픽셀 [왼쪽, 위, 오른쪽, 아래]). */
export interface Detection { label: string; score: number; box: [number, number, number, number] }

/** 상자를 그리는 칸 가장자리 안쪽 틈(px). 상자 바깥 테(흰 테·숯색)까지 칸 안에 보이게. */
export const EDGE = 10;
/** 이름표 높이(px, Status 원래 글 text-xs 한 줄: 줄 높이 16 + 위아래 여백 8 + 테두리 2)와 상자와의 틈. */
export const TAG_H = 26;
const TAG_GAP = 6;
/** 이름표 너비(px, 대략, text-xs 12px): 테두리·여백 + 한글 글자 + 숫자. */
export const tagWidth = (label: string) => 24 + label.length * 12 + 5 * 8;

export interface PlacedDetection {
  label: string;
  /** 이름표 글: 이름과 신뢰도(소수 둘째 자리). */
  text: string;
  left: number; top: number; width: number; height: number;
  tag: { left: number; top: number };
}

type Rect = { x0: number; y0: number; x1: number; y1: number };
const hit = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const within = (a: Rect, b: Rect) => a.x0 >= b.x0 && a.y0 >= b.y0 && a.x1 <= b.x1 && a.y1 <= b.y1;
const area = (r: Rect) => (r.x1 - r.x0) * (r.y1 - r.y0);

/** YOLO 상자(그림 픽셀)를 영상 칸(size) 안 자리로. ceiling은 칸 위 끝에서 FSM 카드 아래 끝까지(px): 그 아래에만 그린다. 칸 크기를 모르거나 상자가 칸 안에 남지 않으면 뺀다. */
export function placeDetections(dets: Detection[], image: BoxSize, size: BoxSize, ceiling = 0): PlacedDetection[] {
  const fit = fitBox(image, size, "contain");
  if (fit.scale <= 0) return [];
  const roof = ceiling + EDGE;
  const floor = size.height - EDGE;
  const boxes = dets.flatMap((d) => {
    const a = toBox(fit, [d.box[0], d.box[1]]);
    const b = toBox(fit, [d.box[2], d.box[3]]);
    const r: Rect = { x0: Math.max(EDGE, a.x), y0: Math.max(roof, a.y), x1: Math.min(size.width - EDGE, b.x), y1: Math.min(floor, b.y) };
    return r.x1 - r.x0 < 4 || r.y1 - r.y0 < 4 ? [] : [{ d, r }];
  });
  const tags: Rect[] = [];
  const order = boxes.map((_, i) => i).sort((i, j) => area(boxes[i]!.r) - area(boxes[j]!.r));
  for (const i of order) {
    const { d, r } = boxes[i]!;
    const w = tagWidth(d.label);
    const x = Math.max(EDGE, Math.min(r.x0, size.width - EDGE - w));
    const tagAt = (left: number, top: number): Rect => ({ x0: left, y0: top, x1: left + w, y1: top + TAG_H });
    const above = tagAt(x, r.y0 - TAG_H - TAG_GAP);
    const spots = [above, tagAt(x, r.y1 + TAG_GAP), tagAt(r.x1 + TAG_GAP, r.y0), tagAt(r.x0 - TAG_GAP - w, r.y0)];
    const inSlot = (t: Rect) => t.x0 >= EDGE && t.x1 <= size.width - EDGE && t.y0 >= roof && t.y1 <= floor;
    const clear = (t: Rect) => !tags.some((o) => o && hit(o, t));
    const uncovered = (t: Rect) => boxes.every((o, j) => j === i || within(r, o.r) || !hit(t, o.r));
    tags[i] = spots.find((t) => inSlot(t) && clear(t) && uncovered(t))
      ?? spots.find((t) => inSlot(t) && clear(t))
      ?? (above.y0 >= roof ? above : tagAt(x, r.y0 + TAG_GAP));
  }
  return boxes.map(({ d, r }, i) => ({
    label: d.label, text: `${d.label} ${d.score.toFixed(2)}`,
    left: r.x0, top: r.y0, width: r.x1 - r.x0, height: r.y1 - r.y0, tag: { left: tags[i]!.x0, top: tags[i]!.y0 },
  }));
}
