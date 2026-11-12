// 대시보드 폰 칸 물체 모양(마스크) 그리기: 비트 풀기, 종류 무리와 색, 영상과 같은 contain 자리에 1인 칸만 칠하기, seen 저장소(600ms).
import { afterEach, describe, expect, it, vi } from "vitest";
import { maskCells as serverCells, maskOf } from "../../../src/brain/seg.ts";
import type { SeenEvent } from "../../../src/contract/events.ts";
import { viz } from "../../../src/design/tokens.ts";
import {
  MASK_COLORS, SEEN_TTL_MS, createSeenStore, maskCells, maskGroup, maskRect, maskTile, paintMasks, shapeBoxes, shapesOf, type MaskColors, type Tile,
} from "../../src/dashboard/masks";

/** 프로토 0번만 칸 (c, r)이 on이면 +1인 마스크를 서버 풀기(maskOf)로 만든다. 640 정사각 그림, 레터박스 그대로. */
function maskFrom(on: (c: number, r: number) => boolean, lbBox: [number, number, number, number]) {
  const P = 160;
  const protos = new Float32Array(32 * P * P);
  for (let r = 0; r < P; r++) for (let c = 0; c < P; c++) protos[r * P + c] = on(c, r) ? 1 : -1;
  const coeffs = new Float32Array(32);
  coeffs[0] = 1;
  return maskOf(coeffs, protos, lbBox, { ratio: 1, padX: 0, padY: 0 }, { width: 640, height: 640 })!.mask;
}
// 칸 열 12~17, 줄 22~29만 1(상자는 칸 10~19 × 20~29)
const CUP = maskFrom((c, r) => c >= 12 && c <= 17 && r >= 22 && r <= 29, [40, 80, 40, 40]);
const seen = (shapes: SeenEvent["shapes"], frame = { width: 640, height: 640 }): SeenEvent => ({ type: "seen", at_ms: 1, frame_id: "e1", captured_at_ms: 1, frame, shapes });
const COLORS: MaskColors = { person: "#010203", vessel: "#0a141e", object: "#28323c", fixture: "#46505a", opacity: 0.45 };

/** 그리기 부르기를 적는 가짜 2D 문맥. */
function fakeCtx() {
  const calls: unknown[][] = [];
  const state = { globalAlpha: 1, imageSmoothingEnabled: false };
  const ctx = {
    ...state,
    clearRect: (...a: number[]) => calls.push(["clearRect", ...a]),
    save: () => calls.push(["save"]),
    restore: () => calls.push(["restore"]),
    beginPath: () => calls.push(["beginPath"]),
    rect: (...a: number[]) => calls.push(["rect", ...a]),
    clip: () => calls.push(["clip"]),
    drawImage(tile: Tile, ...a: number[]) { calls.push(["drawImage", tile, ...a, this.globalAlpha, this.imageSmoothingEnabled]); },
  };
  return { ctx, calls };
}

describe("마스크 비트와 무리", () => {
  it("비트 풀기는 서버(src/brain/seg.ts)와 같은 규칙이다", () => {
    expect([CUP.cols, CUP.rows]).toEqual([10, 10]);
    expect([...maskCells(CUP)]).toEqual([...serverCells(CUP)]);
    expect(maskCells(CUP).reduce((a, b) => a + b, 0)).toBe(6 * 8);
    expect([...maskCells({ at: [0, 0, 1, 1], cols: 0, rows: 0, bits: "" })]).toEqual([]);
  });

  it("마스크 테두리(그림 픽셀 [왼쪽, 위, 오른쪽, 아래])는 1인 칸의 바깥 끝이다. 칸이 없으면 at 자리", () => {
    expect(maskRect(CUP)).toEqual([48, 88, 72, 120]);
    expect(maskRect({ at: [10, 20, 30, 40], cols: 0, rows: 0, bits: "" })).toEqual([10, 20, 40, 60]);
  });

  it("종류 무리: 사람 · 마시는 그릇(컵·병·그릇) · 가전 설비 · 그 밖의 물건. 색은 토큰 viz.mask다", () => {
    expect(["person", "cup", "bottle", "bowl", "sink", "refrigerator", "fork", "book"].map(maskGroup))
      .toEqual(["person", "vessel", "vessel", "vessel", "fixture", "fixture", "object", "object"]);
    expect(MASK_COLORS).toEqual({ person: viz.mask.person, vessel: viz.mask.vessel, object: viz.mask.object, fixture: viz.mask.fixture, opacity: viz.mask.opacity });
    expect(new Set([MASK_COLORS.person, MASK_COLORS.vessel, MASK_COLORS.object, MASK_COLORS.fixture]).size).toBe(4);
  });

  it("seen 사건 → 화면 모양: 이름은 화면 이름(컵), 이름표 상자는 마스크 테두리", () => {
    const shapes = shapesOf(seen([{ label: "cup", score: 0.83, mask: CUP }]));
    expect(shapes).toEqual([{ kind: "cup", label: "컵", score: 0.83, mask: CUP }]);
    expect(shapeBoxes(shapes)).toEqual([{ label: "컵", score: 0.83, box: [48, 88, 72, 120] }]);
  });
});

describe("paintMasks", () => {
  it("1인 칸만 그 무리 색으로 칠한 작은 그림을 영상과 같은 contain 배율·자리에 키워 그린다. FSM 카드 아래(ceiling)에만 그린다", () => {
    const { ctx, calls } = fakeCtx();
    // 640×640 그림을 320×480 칸에: 배율 0.5, 위아래 80px 비움
    paintMasks(ctx, shapesOf(seen([{ label: "cup", score: 0.9, mask: CUP }])), { width: 640, height: 640 }, { width: 320, height: 480 }, 100, COLORS, (t) => t);
    expect(calls[0]).toEqual(["clearRect", 0, 0, 320, 480]);
    expect(calls.slice(1, 5)).toEqual([["save"], ["beginPath"], ["rect", 0, 100, 320, 380], ["clip"]]);
    const draw = calls.find((c) => c[0] === "drawImage")!;
    const tile = draw[1] as Tile;
    // 그림 자리: at [40, 80, 40, 40] → 칸 [20, 80 + 40, 20, 20], 불투명도 0.45, 부드럽게 키움
    expect(draw.slice(2)).toEqual([20, 120, 20, 20, 0.45, true]);
    expect([tile.cols, tile.rows, tile.rgba.length]).toEqual([10, 10, 400]);
    const cells = maskCells(CUP);
    for (let i = 0; i < 100; i++) expect([...tile.rgba.subarray(i * 4, i * 4 + 4)], `칸 ${i}`).toEqual(cells[i] ? [10, 20, 30, 255] : [0, 0, 0, 0]);
    expect(calls.at(-1)).toEqual(["restore"]);
  });

  it("무리마다 색이 다르고, 가전 설비(싱크대)와 칸이 없는 모양(마스크를 못 만든 감지)은 칠하지 않는다", () => {
    const { ctx, calls } = fakeCtx();
    const empty = { at: [0, 0, 10, 10] as [number, number, number, number], cols: 0, rows: 0, bits: "" };
    paintMasks(ctx, shapesOf(seen([{ label: "person", score: 0.9, mask: CUP }, { label: "sink", score: 0.9, mask: CUP }, { label: "book", score: 0.9, mask: CUP }, { label: "cup", score: 0.9, mask: empty }])),
      { width: 640, height: 640 }, { width: 640, height: 640 }, 0, COLORS, (t) => t);
    const tiles = calls.filter((c) => c[0] === "drawImage").map((c) => c[1] as Tile);
    const colorOf = (t: Tile) => { const i = [...maskCells(CUP)].indexOf(1) * 4; return [...t.rgba.subarray(i, i + 3)]; };
    expect(tiles.map(colorOf)).toEqual([[1, 2, 3], [40, 50, 60]]);
  });

  it("모양이 없거나 칸 크기를 모르면 지우기만 한다", () => {
    const a = fakeCtx();
    paintMasks(a.ctx, [], { width: 640, height: 640 }, { width: 320, height: 480 }, 0, COLORS, (t) => t);
    expect(a.calls.filter((c) => c[0] === "drawImage")).toEqual([]);
    expect(a.calls[0]).toEqual(["clearRect", 0, 0, 320, 480]);
    const b = fakeCtx();
    paintMasks(b.ctx, shapesOf(seen([{ label: "cup", score: 0.9, mask: CUP }])), { width: 640, height: 640 }, { width: 0, height: 0 }, 0, COLORS, (t) => t);
    expect(b.calls.filter((c) => c[0] === "drawImage")).toEqual([]);
  });

  it("maskTile: 칸마다 RGBA 4바이트", () => {
    const t = maskTile(CUP, [9, 8, 7]);
    expect([t.cols, t.rows]).toEqual([10, 10]);
    expect([...t.rgba.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    const first = [...maskCells(CUP)].indexOf(1);
    expect([...t.rgba.subarray(first * 4, first * 4 + 4)]).toEqual([9, 8, 7, 255]);
  });
});

describe("seen 저장소", () => {
  afterEach(() => { vi.useRealTimers(); });
  const event = seen([{ label: "cup", score: 0.9, mask: CUP }]);

  it("seen이 600ms 넘게 안 오면 지운다(멈춘 그림이 남지 않게). 그 안에 새로 오면 이어 간다", () => {
    vi.useFakeTimers();
    expect(SEEN_TTL_MS).toBe(600);
    const store = createSeenStore();
    let told = 0;
    store.subscribe(() => { told++; });
    expect(store.get()).toBeNull();
    store.set(event);
    expect([store.get(), told]).toEqual([event, 1]);
    vi.advanceTimersByTime(500);
    const next = { ...event, frame_id: "e2" };
    store.set(next);
    vi.advanceTimersByTime(599);
    expect(store.get()).toBe(next);
    vi.advanceTimersByTime(2);
    expect([store.get(), told]).toEqual([null, 3]);
  });

  it("hold면 지우지 않는다(가짜 단계). clear는 바로 지운다", () => {
    vi.useFakeTimers();
    const store = createSeenStore({ hold: true });
    store.set(event);
    vi.advanceTimersByTime(60_000);
    expect(store.get()).toBe(event);
    store.clear();
    expect(store.get()).toBeNull();
  });
});
