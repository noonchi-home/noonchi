// @vitest-environment node
// 말풍선 자리 고르기: 말풍선끼리, 패널(판단 기록·눈 창·상태 알약)과 겹치지 않고 트윈 보이는 곳 안에 둔다. 자리가 없으면 lg 대신 md로 줄인다.
import { describe, expect, it } from "vitest";
import { bubbleRect, placeBubbles, type Rect } from "../src/bubbles/place";

const AREA: Rect = { left: 0, top: 0, right: 1440, bottom: 900 };
const LOG: Rect = { left: 1047, top: 12, right: 1428, bottom: 888 };
const LG = { w: 310, h: 92 };
const MD = { w: 170, h: 52 };
const hit = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const inside = (a: Rect, b: Rect) => a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;

describe("말풍선 자리", () => {
  it("넓은 곳에 하나면 기기 위 가운데, 큰 말풍선", () => {
    const out = placeBubbles([{ id: "a", x: 500, y: 400, scale: 1, sizes: { lg: LG } }], AREA, []);
    expect(out.get("a")).toEqual({ side: "top", align: "center", size: "lg" });
  });

  it("기기 자리가 가까운 두 말풍선은 겹치지 않는다(1440 주방 천장등·식탁 펜던트)", () => {
    const items = [
      { id: "kitchen", x: 893, y: 330, scale: 1.25, sizes: { lg: LG } },
      { id: "pendant", x: 940, y: 372, scale: 1, sizes: { lg: LG } },
    ];
    const out = placeBubbles(items, AREA, [LOG]);
    const rects = items.map((it) => bubbleRect(it.x, it.y, it.sizes.lg, it.scale, out.get(it.id)!));
    expect(hit(rects[0]!, rects[1]!)).toBe(false);
    for (const r of rects) {
      expect(hit(r, LOG)).toBe(false);
      expect(inside(r, AREA)).toBe(true);
    }
  });

  it("판단 기록 패널 가까이의 말풍선은 패널 밑으로 들어가지 않고 왼쪽으로 비킨다", () => {
    const out = placeBubbles([{ id: "a", x: 1000, y: 400, scale: 1, sizes: { lg: LG } }], AREA, [LOG]);
    expect(out.get("a")).toEqual({ side: "top", align: "end", size: "lg" });
  });

  it("앞 말풍선(방금 다룬 기기)이 먼저 자리를 잡는다", () => {
    const items = [
      { id: "focus", x: 600, y: 400, scale: 1.25, sizes: { lg: LG } },
      { id: "other", x: 600, y: 400, scale: 1, sizes: { lg: LG } },
    ];
    const out = placeBubbles(items, AREA, []);
    expect(out.get("focus")).toEqual({ side: "top", align: "center", size: "lg" });
    expect(out.get("other")).not.toEqual({ side: "top", align: "center", size: "lg" });
  });

  it("큰 말풍선 자리가 없으면 md로 줄인다", () => {
    const small: Rect = { left: 0, top: 0, right: 420, bottom: 300 };
    const items = [
      { id: "a", x: 210, y: 150, scale: 1, sizes: { lg: LG, md: MD } },
      { id: "b", x: 210, y: 150, scale: 1, sizes: { lg: LG, md: MD } },
    ];
    const out = placeBubbles(items, small, []);
    expect(out.get("a")!.size).toBe("lg");
    expect(out.get("b")!.size).toBe("md");
    const rects = items.map((it) => { const p = out.get(it.id)!; return bubbleRect(it.x, it.y, it.sizes[p.size], it.scale, p); });
    expect(hit(rects[0]!, rects[1]!)).toBe(false);
  });

  it("크기를 아직 모르는 말풍선은 기본 자리(위 가운데, lg)", () => {
    expect(placeBubbles([{ id: "a", x: 10, y: 10, scale: 1, sizes: {} }], AREA, []).get("a")).toEqual({ side: "top", align: "center", size: "lg" });
  });
});
