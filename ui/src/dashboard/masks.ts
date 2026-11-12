// 대시보드 폰 칸 물체 모양(마스크). 서버가 감지가 끝난 프레임마다 보내는 seen(src/contract/events.ts SeenEvent)의 0/1 그림을
// 영상과 같은 배율·자리(contain)로 영상 위 canvas 한 장에 칠한다. 네모 테두리는 그리지 않는다.
// 색은 종류 무리마다 하나(토큰 viz.mask): 사람 · 마시는 그릇(컵·병·그릇) · 가전 설비 · 그 밖의 물건.
// seen이 SEEN_TTL_MS 넘게 안 오면 지운다(멈춘 그림이 남지 않게). seen은 초당 10번 오므로 대시보드 자료(data.ts)에 넣지 않고
// 따로 둔 저장소를 마스크 층(MaskLayer)만 듣는다: 화면 전체를 다시 그리지 않는다.
import type { Mask } from "../../../src/brain/seg.ts";
import type { SeenEvent } from "../../../src/contract/events.ts";
import { viz } from "../../../src/design/tokens.ts";
import { CLASSES } from "../../../src/world/vocab.ts";
import type { Detection } from "./detections";
import { fitBox, toBox, type BoxSize } from "./fit";
import { BOX_NAME } from "./words";

export type MaskGroup = "person" | "vessel" | "object" | "fixture";
/** 무리마다 칠하는 색(#rrggbb)과 불투명도. */
export type MaskColors = Record<MaskGroup, string> & { opacity: number };
export const MASK_COLORS: MaskColors = { person: viz.mask.person, vessel: viz.mask.vessel, object: viz.mask.object, fixture: viz.mask.fixture, opacity: viz.mask.opacity };
/** seen이 이만큼 안 오면 마스크와 이름표를 지운다(ms). */
export const SEEN_TTL_MS = 600;

const VESSELS: ReadonlySet<string> = new Set(["cup", "bottle", "bowl"]);
/** 감지 종류(낱말 표 열쇠) → 색 무리. 모르는 종류는 그 밖의 물건. */
export function maskGroup(kind: string): MaskGroup {
  if (kind === "person") return "person";
  if (VESSELS.has(kind)) return "vessel";
  return (CLASSES as Record<string, { role: string } | undefined>)[kind]?.role === "fixture" ? "fixture" : "object";
}

/** 화면에 그릴 모양 하나: 종류(낱말 표 열쇠), 화면 이름, 신뢰도, 마스크. */
export interface Shape { kind: string; label: string; score: number; mask: Mask }
export const shapesOf = (e: SeenEvent): Shape[] => e.shapes.map((s) => ({ kind: s.label, label: BOX_NAME[s.label] ?? s.label, score: s.score, mask: s.mask }));

/** 비트 풀기(서버 src/brain/seg.ts maskCells와 같은 규칙): 줄 순서, 바이트 안에서는 높은 비트부터. */
export function maskCells(m: Mask): Uint8Array {
  const bytes = atob(m.bits);
  const cells = new Uint8Array(m.cols * m.rows);
  for (let i = 0; i < cells.length; i++) cells[i] = (bytes.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
  return cells;
}

/** 마스크 테두리(그림 픽셀 [왼쪽, 위, 오른쪽, 아래]): 1인 칸의 바깥 끝. 칸이 없으면 at 자리. 이름표 자리를 잡을 때만 쓰고 화면에 그리지 않는다. */
export function maskRect(m: Mask): [number, number, number, number] {
  const [x, y, w, h] = m.at;
  const cells = maskCells(m);
  let c0 = m.cols, c1 = -1, r0 = m.rows, r1 = -1;
  for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
    if (!cells[r * m.cols + c]) continue;
    if (c < c0) c0 = c;
    if (c > c1) c1 = c;
    if (r < r0) r0 = r;
    if (r > r1) r1 = r;
  }
  if (c1 < 0) return [x, y, x + w, y + h];
  const cw = w / m.cols, ch = h / m.rows;
  return [x + c0 * cw, y + r0 * ch, x + (c1 + 1) * cw, y + (r1 + 1) * ch];
}

/** 이름표 자리 잡기(detections.ts placeDetections)에 넘길 상자: 화면 이름·신뢰도·마스크 테두리. */
export const shapeBoxes = (shapes: readonly Shape[]): Detection[] => shapes.map((s) => ({ label: s.label, score: s.score, box: maskRect(s.mask) }));

/** 마스크 칸 그림: 칸마다 RGBA 4바이트(1인 칸은 그 색, 아니면 투명). */
export interface Tile { cols: number; rows: number; rgba: Uint8ClampedArray }
export function maskTile(m: Mask, rgb: readonly [number, number, number]): Tile {
  const cells = maskCells(m);
  const rgba = new Uint8ClampedArray(cells.length * 4);
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;
    rgba[i * 4] = rgb[0];
    rgba[i * 4 + 1] = rgb[1];
    rgba[i * 4 + 2] = rgb[2];
    rgba[i * 4 + 3] = 255;
  }
  return { cols: m.cols, rows: m.rows, rgba };
}

const rgbOf = (color: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) as [number, number, number];

/** paintMasks가 쓰는 2D 문맥의 부분. */
export interface MaskCtx<S> {
  globalAlpha: number;
  imageSmoothingEnabled: boolean;
  clearRect(x: number, y: number, w: number, h: number): void;
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  drawImage(image: S, x: number, y: number, w: number, h: number): void;
}

/** 칸 그림 → 그릴 수 있는 그림(작은 canvas). */
export function tileCanvas(t: Tile): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = t.cols;
  c.height = t.rows;
  const ctx = c.getContext("2d");
  if (ctx) {
    const image = ctx.createImageData(t.cols, t.rows);
    image.data.set(t.rgba);
    ctx.putImageData(image, 0, 0);
  }
  return c;
}

/** 모양들을 칸(size, CSS px)에 칠한다. 그림(image)은 칸에 contain으로 놓인 것으로 보고 같은 배율·자리에 그린다.
 *  ceiling: 칸 위 끝에서 위쪽 카드 아래 끝까지(px). 그 아래에만 칠한다. 칸 그림은 작게 만들어 부드럽게 키운다. */
export function paintMasks<S>(ctx: MaskCtx<S>, shapes: readonly Shape[], image: BoxSize, size: BoxSize, ceiling: number, colors: MaskColors, toSource: (t: Tile) => S): void {
  ctx.clearRect(0, 0, size.width, size.height);
  const fit = fitBox(image, size, "contain");
  if (fit.scale <= 0 || !shapes.length) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, ceiling, size.width, Math.max(0, size.height - ceiling));
  ctx.clip();
  ctx.globalAlpha = colors.opacity;
  ctx.imageSmoothingEnabled = true;
  for (const s of shapes) {
    // 가전 설비(싱크대·냉장고·TV)는 칠하지 않는다: 가까이 보면 화면을 다 덮어 그 안의 물건을 가린다. 이름표는 그대로 붙는다
    if (!s.mask.cols || !s.mask.rows || maskGroup(s.kind) === "fixture") continue;
    const [x, y, w, h] = s.mask.at;
    const at = toBox(fit, [x, y]);
    ctx.drawImage(toSource(maskTile(s.mask, rgbOf(colors[maskGroup(s.kind)]))), at.x, at.y, w * fit.scale, h * fit.scale);
  }
  ctx.restore();
}

/** 마지막 seen 하나를 들고 듣는 쪽에 알린다(useSyncExternalStore). hold면 지우지 않는다(가짜 단계). */
export interface SeenStore {
  get(): SeenEvent | null;
  set(e: SeenEvent): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}
export function createSeenStore({ hold = false, ttlMs = SEEN_TTL_MS }: { hold?: boolean; ttlMs?: number } = {}): SeenStore {
  let event: SeenEvent | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const put = (next: SeenEvent | null) => {
    if (timer !== null) clearTimeout(timer);
    timer = next && !hold ? setTimeout(() => put(null), ttlMs) : null;
    if (next === event) return;
    event = next;
    for (const l of [...listeners]) l();
  };
  return {
    get: () => event,
    set: (e) => put(e),
    clear: () => put(null),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
