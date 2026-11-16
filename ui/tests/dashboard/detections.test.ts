// @vitest-environment node
// 대시보드 폰 칸 YOLO 상자 자리(순수 함수): 폰 영상을 영상 칸에 다 보이게(contain) 깐 자리에 상자를 맞추고, 칸 가장자리에 닿은 쪽은 칸 안에서 자른다.
// 이름표는 상자 위에 두고, 자리가 없거나 앞 이름표와 겹치면 상자 아래로 옮긴다. 이름표도 칸 안에 다 들어온다. 칸 위쪽 FSM 카드 밑에는 그리지 않는다.
import { describe, expect, it } from "vitest";
import { EDGE, placeDetections, TAG_H, tagWidth, type Detection } from "../../src/dashboard/detections";
import { pageLayout, type Rect } from "../../src/dashboard/layout";
import { MASCOT } from "../../src/lib/mascot-image";
import { EYE_FRAMES } from "./fixtures";

const IMG = { width: 1280, height: 720 };
/** 대시보드 영상 칸(9:16) 크기: 1920×1080, 1440×900 화면. */
const SLOTS = [[590, 1048], [493, 876]];
const det = (label: string, box: Detection["box"], score = 0.9): Detection => ({ label, score, box });

describe("YOLO 상자 자리", () => {
  it("판이 영상과 같은 비율이면 상자를 배율만큼 키워 그 자리에 둔다", () => {
    const [b] = placeDetections([det("컵", [100, 200, 300, 400])], IMG, { width: 640, height: 360 });
    expect(b).toMatchObject({ left: 50, top: 100, width: 100, height: 100, text: "컵 0.90" });
  });

  it("판 비율이 영상과 다르면 영상을 다 보이게(contain) 줄여 가운데에 두고, 상자도 같은 만큼 옮긴다: 위아래·양옆을 자르지 않는다", () => {
    // 가로 영상(1280×720)을 9:16 칸(360×640)에: 배율 360/1280, 위아래 빈자리 (640 - 202.5) / 2
    const s = 360 / 1280;
    const [b] = placeDetections([det("컵", [100, 200, 300, 400])], IMG, { width: 360, height: 640 });
    expect(b!.left).toBeCloseTo(100 * s, 5);
    expect(b!.top).toBeCloseTo((640 - 720 * s) / 2 + 200 * s, 5);
    expect(b!.width).toBeCloseTo(200 * s, 5);
    // 가로 영상 오른쪽 끝 상자도 칸 안에 그대로 보인다(cover였으면 잘려 나갔다)
    const [r] = placeDetections([det("병", [1100, 300, 1180, 400])], IMG, { width: 640, height: 720 });
    expect(r).toBeDefined();
    expect(r!.left + r!.width).toBeLessThanOrEqual(640 - EDGE);
  });

  it("영상 가장자리에 닿은 상자는 칸 가장자리 안쪽에서 자른다", () => {
    const [t] = placeDetections([det("식탁", [0, 162, 1280, 720])], IMG, { width: 640, height: 360 });
    expect(t!.left).toBe(EDGE);
    expect(t!.left + t!.width).toBe(640 - EDGE);
    expect(t!.top + t!.height).toBe(360 - EDGE);
  });

  it("이름표는 상자 위에 두고, 위에 자리가 없으면 상자 아래에 둔다", () => {
    const [a, b] = placeDetections([det("컵", [500, 300, 600, 400]), det("식탁", [100, 2, 400, 200])], IMG, IMG);
    expect(a!.tag.top).toBeLessThan(a!.top);
    expect(a!.tag.left).toBe(a!.left);
    expect(b!.tag.top).toBeGreaterThan(b!.top + b!.height);
  });

  it("앞 이름표와 겹치면 상자 아래로 옮긴다", () => {
    const [a, b] = placeDetections([det("식탁", [100, 300, 200, 400]), det("식탁", [180, 300, 280, 400])], IMG, IMG);
    expect(a!.tag.top).toBe(300 - TAG_H - 6);
    expect(b!.tag.top).toBeGreaterThan(b!.top + b!.height);
  });

  it("이름표는 다른 상자를 가리지 않는다: 식탁 위 컵의 이름표는 식탁 상자 밖(컵 위)에 두고 식탁 이름표는 식탁 아래로 옮긴다", () => {
    const [table, cup] = placeDetections([det("식탁", [534, 338, 726, 528]), det("컵", [596, 332, 620, 357])], IMG, IMG);
    expect(cup!.tag.top + TAG_H).toBeLessThanOrEqual(table!.top);
    expect(table!.tag.top).toBeGreaterThanOrEqual(table!.top + table!.height);
  });

  it("위·아래가 다 막히면 상자 오른쪽 옆에 둔다", () => {
    // 칸 위 끝에 붙은 상자(위 자리 없음) 바로 아래에 다른 상자(아래 자리 막힘)
    const [b] = placeDetections([det("컵", [100, 12, 200, 60]), det("식탁", [60, 70, 400, 300])], IMG, IMG);
    expect(b!.tag.left).toBeGreaterThanOrEqual(b!.left + b!.width);
    expect(b!.tag.top).toBe(b!.top);
  });

  it.each(SLOTS)("눈 그림 넷 모두 %i×%i 영상 칸의 이름표끼리 겹치지 않고, 다른 상자를 가리지 않는다(제 상자가 그 상자 안에 들면 빼고)", (width, height) => {
    type R = { x0: number; y0: number; x1: number; y1: number };
    const hit = (a: R, b: R) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    const within = (a: R, b: R) => a.x0 >= b.x0 && a.y0 >= b.y0 && a.x1 <= b.x1 && a.y1 <= b.y1;
    for (const s of EYE_FRAMES) {
      const out = placeDetections(s.boxes, s, { width, height });
      const boxes = out.map((b) => ({ x0: b.left, y0: b.top, x1: b.left + b.width, y1: b.top + b.height }));
      const tags = out.map((b) => ({ x0: b.tag.left, y0: b.tag.top, x1: b.tag.left + tagWidth(b.label), y1: b.tag.top + TAG_H }));
      out.forEach((b, i) => {
        out.forEach((o, j) => {
          if (i === j) return;
          expect(hit(tags[i]!, tags[j]!), `${s.id} ${b.label}·${o.label} 이름표`).toBe(false);
          if (!within(boxes[i]!, boxes[j]!)) expect(hit(tags[i]!, boxes[j]!), `${s.id} ${b.label} 이름표가 ${o.label} 상자를 가림`).toBe(false);
        });
      });
    }
  });

  it("오른쪽 끝 상자의 이름표는 칸 오른쪽 안으로 당긴다", () => {
    const [b] = placeDetections([det("싱크대", [1230, 300, 1270, 400])], IMG, IMG);
    expect(b!.tag.left + tagWidth("싱크대")).toBeLessThanOrEqual(IMG.width - EDGE);
    expect(b!.tag.left).toBeGreaterThanOrEqual(EDGE);
  });

  it.each(SLOTS)("눈 그림 넷의 상자와 이름표가 %i×%i 영상 칸 안에 다 들어온다", (width, height) => {
    for (const s of EYE_FRAMES) {
      const out = placeDetections(s.boxes, s, { width, height });
      expect(out.map((b) => b.label), s.id).toEqual(s.boxes.map((d) => d.label));
      for (const b of out) {
        expect(b.left).toBeGreaterThanOrEqual(EDGE);
        expect(b.top).toBeGreaterThanOrEqual(EDGE);
        expect(b.left + b.width).toBeLessThanOrEqual(width - EDGE);
        expect(b.top + b.height).toBeLessThanOrEqual(height - EDGE);
        expect(b.tag.left).toBeGreaterThanOrEqual(EDGE);
        expect(b.tag.top).toBeGreaterThanOrEqual(EDGE);
        expect(b.tag.left + tagWidth(b.label)).toBeLessThanOrEqual(width - EDGE);
        expect(b.tag.top + TAG_H).toBeLessThanOrEqual(height - EDGE);
      }
    }
  });

  it("칸 위쪽 FSM 카드 아래(ceiling)에만 그린다: 위에 자리가 카드에 걸리면 이름표를 상자 아래로 옮기고, 카드 밑으로 들어간 상자 위 끝은 카드 아래에서 자른다", () => {
    const [a] = placeDetections([det("싱크대", [100, 130, 900, 400])], IMG, IMG, 100);
    expect(a!.top).toBe(130);
    expect(a!.tag.top).toBeGreaterThan(a!.top + a!.height);
    const [b] = placeDetections([det("식탁", [100, 40, 900, 400])], IMG, IMG, 100);
    expect(b!.top).toBe(100 + EDGE);
    expect(b!.tag.top).toBeGreaterThanOrEqual(100 + EDGE);
  });

  it("판 크기를 모르면 아무것도 두지 않는다", () => {
    expect(placeDetections([det("컵", [0, 0, 10, 10])], IMG, { width: 0, height: 0 })).toEqual([]);
  });
});

describe("화면 자리 위 YOLO 상자", () => {
  const right = (r: Rect) => r.left + r.width;
  const bottom = (r: Rect) => r.top + r.height;
  const hit = (a: Rect, b: Rect) => a.left < right(b) && b.left < right(a) && a.top < bottom(b) && b.top < bottom(a);
  const near = (a: number, b: number, d = 1e-6) => Math.abs(a - b) < d;

  describe.each([[1920, 1080], [1440, 900], [1522, 722]])("%i×%i", (width, height) => {
    const L = pageLayout({ width, height }, MASCOT);
    it.each(EYE_FRAMES.map((f) => [f.id, f] as const))("%s: 상자와 이름표는 미니맵 영상 안에 있고 마스코트·말풍선 카드·생각 말풍선과 겹치지 않는다", (_, f) => {
      const placed = placeDetections(f.boxes, f, L.video, 0);
      expect(placed).toHaveLength(f.boxes.length);
      for (const d of placed) {
        const box: Rect = { left: L.video.left + d.left, top: L.video.top + d.top, width: d.width, height: d.height };
        const tag: Rect = { left: L.video.left + d.tag.left, top: L.video.top + d.tag.top, width: tagWidth(d.label), height: TAG_H };
        for (const r of [box, tag]) {
          for (const [name, k] of [["마스코트", L.mascot], ["말풍선 카드", L.bubble], ["생각 말풍선", L.thought]] as const) expect(hit(r, k), `${d.label} ${name}`).toBe(false);
          expect(r.left).toBeGreaterThanOrEqual(L.video.left);
          expect(r.top).toBeGreaterThanOrEqual(L.video.top);
          expect(right(r)).toBeLessThanOrEqual(right(L.video) + 1e-6);
          expect(bottom(r)).toBeLessThanOrEqual(bottom(L.video) + 1e-6);
        }
      }
    });
  });

  it.each([[1920, 1080], [1440, 900]])("%i×%i: 세로 눈 그림(405×720)은 미니맵 높이에 맞춰 다 보이고(contain) 양옆이 빈다", (width, height) => {
    const L = pageLayout({ width, height }, MASCOT);
    const f = EYE_FRAMES[0]!;
    const k = Math.min(L.video.width / f.width, L.video.height / f.height);
    expect(near(f.height * k, L.video.height)).toBe(true);
    expect(f.width * k).toBeLessThan(L.video.width);
  });
});
