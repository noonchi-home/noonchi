// marks.js의 형(테스트에서 TypeScript로 부른다).
export interface FocusMark { id: string; label: string; u: number; v: number; off: boolean; angle: number }
/** CanvasRenderingContext2D·OffscreenCanvasRenderingContext2D 중 marks.js가 쓰는 것. */
export interface MarkContext {
  lineWidth: number; font: string; textAlign: string; strokeStyle: unknown; fillStyle: unknown;
  save(): void; restore(): void; beginPath(): void; closePath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void; stroke(): void; fill(): void;
  fillRect(x: number, y: number, w: number, h: number): void; fillText(t: string, x: number, y: number): void; measureText(t: string): { width: number };
}
export function markFont(width: number): string;
export function drawMarks(ctx: MarkContext, marks: FocusMark[], width: number, height: number): void;
